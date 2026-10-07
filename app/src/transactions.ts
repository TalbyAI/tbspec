import { realpath } from "node:fs/promises";
import { canonical, hash, sortedSet } from "./canonical.ts";
import {
  equalRevision,
  type FileSystem,
  fileBytes,
  inventory,
  nativeFileSystem,
  type Read,
  type Revision,
  revision,
  verifyReads,
} from "./filesystem.ts";
import { acquireLock, type Ownership, releaseLock, requireNoRecovery, withLock } from "./lock.ts";
import { combineErrors, type Diagnostic, hasCode, ProjectError } from "./output.ts";
import { token } from "./ownership.ts";
import { portablePath, safePath } from "./paths.ts";

export interface Change {
  action: "create" | "replace" | "delete" | "move";
  file: string;
  before: Revision;
  after: Revision;
  to?: string;
}
export interface Write {
  file: string;
  bytes: Uint8Array | null;
  to?: string;
}
export interface Snapshot {
  projectRoot: string;
  reads: Read[];
  files: Record<string, Buffer | null>;
}
export interface Preview {
  fingerprint: string;
  operation: string;
  arguments: Record<string, unknown>;
  reads: Read[];
  changes: Change[];
  acquired: { selector: string; byteDigest: string; graphSignature: string }[];
  interpretationSignatures: Record<string, string>;
  impact: {
    baselineErrors: Diagnostic[];
    introducedErrors: Diagnostic[];
    worsenedErrors: Diagnostic[];
    skippedChecks: Diagnostic[];
    affectedFiles: string[];
    acceptance: string[];
  };
}
export interface Plan {
  preview: Preview;
  writes: Write[];
}
export interface TransactionEntry extends Change {
  originalPath: string | null;
  stagedPath: string | null;
  destinationBefore: Revision | null;
  progress: "planned" | "prepared" | "applied" | "restored";
}
interface TransactionRecord {
  recordVersion: 1;
  transactionId: string;
  acquisitionId: string;
  state: "preparing" | "publishing" | "rolling_back" | "complete";
  changes: TransactionEntry[];
}

export async function capture(
  root: string,
  paths: string[],
  scopes: { path: string; included: string[]; excluded: string[] }[] = [],
  fs: FileSystem = nativeFileSystem,
): Promise<Snapshot> {
  root = await realpath(root);
  return withLock(
    root,
    async () => {
      const files: Record<string, Buffer | null> = {};
      const reads: Read[] = [];
      for (const path of sortedSet(paths.map(portablePath))) {
        files[path] = await fileBytes(root, path, fs);
        reads.push({ kind: "file", path, revision: revision(files[path] ?? null) });
      }
      for (const scope of scopes) {
        const { path, ...selection } = scope;
        reads.push({
          kind: "inventory",
          path,
          revision: await inventory(root, path, selection, fs),
          scope: selection,
        });
      }
      // Catch observed outside-editor changes while capturing files and inventories.
      await verifyReads(root, reads, fs);
      return { projectRoot: root, files, reads };
    },
    fs,
  );
}
export function preparePlan(
  snapshot: Snapshot,
  operation: string,
  proposed: Write[],
  args: Record<string, unknown> = {},
): Plan {
  const writes = proposed.map((write) => ({
    ...write,
    file: portablePath(write.file),
    ...(write.to ? { to: portablePath(write.to) } : {}),
    bytes: write.bytes === null ? null : Buffer.from(write.bytes),
  }));
  const targets = new Set<string>();
  const changes = writes.map((write): Change => {
    for (const path of [write.file, ...(write.to ? [write.to] : [])]) {
      const equivalent = path.toLowerCase();
      if (targets.has(equivalent))
        throw new ProjectError(
          "conflict",
          "PATH_UNSAFE",
          `Duplicate or aliased publication target: ${path}`,
          path,
        );
      targets.add(equivalent);
      if (!snapshot.reads.some((read) => read.kind === "file" && read.path === path))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          `Plan lacks captured revision for ${path}.`,
          path,
        );
    }
    const before = revision(snapshot.files[write.file] ?? null);
    if (
      write.to &&
      (before.state !== "present" || snapshot.files[write.to] !== null || write.bytes === null)
    )
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Move requires a present source, staged bytes and absent destination.",
        write.to,
      );
    if (!write.to && write.bytes === null && before.state !== "present")
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Delete requires a present file.",
        write.file,
      );
    return {
      action: write.to
        ? "move"
        : write.bytes === null
          ? "delete"
          : before.state === "absent"
            ? "create"
            : "replace",
      file: write.file,
      before,
      after: revision(write.bytes),
      ...(write.to ? { to: write.to } : {}),
    };
  });
  const body = {
    operation,
    arguments: { ...args, projectRoot: snapshot.projectRoot },
    reads: sortedSet(snapshot.reads),
    changes,
    acquired: [],
    interpretationSignatures: {},
    impact: {
      baselineErrors: [],
      introducedErrors: [],
      worsenedErrors: [],
      skippedChecks: [],
      affectedFiles: sortedSet(
        writes.flatMap((write) => [write.file, ...(write.to ? [write.to] : [])]),
      ),
      acceptance: [],
    },
  };
  return { preview: { fingerprint: hash(["tbspec.preview", 1, body]), ...body }, writes };
}
async function matches(root: string, path: string, expected: Revision, fs: FileSystem) {
  if (!equalRevision(revision(await fileBytes(root, path, fs)), expected))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      `File changed before filesystem action: ${path}.`,
      path,
    );
}
async function ensureParent(root: string, path: string, fs: FileSystem) {
  const components = path.split("/");
  components.pop();
  if (components.length)
    await fs.mkdir(await safePath(root, components.join("/"), true), {
      recursive: true,
      mode: 0o700,
    });
  return safePath(root, path, true);
}
async function cleanup(root: string, workspace: string, record: TransactionRecord, fs: FileSystem) {
  // Delete only explicitly recorded artifacts. Never recursively delete an unverified tree.
  for (const entry of record.changes)
    for (const artifact of [
      entry.originalPath,
      entry.stagedPath,
      ...(entry.originalPath ? [`${entry.originalPath}.restore`] : []),
    ])
      if (artifact) {
        try {
          await fs.unlink(await safePath(root, `${workspace}/${artifact}`, true));
        } catch (error) {
          if (!hasCode(error, "ENOENT")) throw error;
        }
      }
  const journal = await safePath(root, `${workspace}/record.json`, true);
  await fs.unlink(journal);
  try {
    await fs.rmdir(await safePath(root, workspace, true));
  } catch (error) {
    // Retain recognizable completed evidence if removing the directory fails.
    await fs.writeFile(journal, canonical(record), { flag: "wx", mode: 0o600 });
    throw error;
  }
}
async function runTransaction(
  root: string,
  plan: Plan,
  owner: Ownership,
  fs: FileSystem,
): Promise<Diagnostic[]> {
  const transactionId = token();
  const workspace = `.tbspec/transactions/${transactionId}`;
  const record: TransactionRecord = {
    recordVersion: 1,
    transactionId,
    acquisitionId: owner.acquisitionId,
    state: "preparing",
    changes: plan.preview.changes.map((change, index) => ({
      ...change,
      originalPath: change.before.state === "present" ? `original-${index}` : null,
      stagedPath: change.after.state === "present" ? `staged-${index}` : null,
      destinationBefore: change.action === "move" ? { state: "absent" } : null,
      progress: "planned",
    })),
  };
  await fs.mkdir(await safePath(root, workspace, true), { recursive: true, mode: 0o700 });
  const journal = await safePath(root, `${workspace}/record.json`, true);
  const save = async () => {
    await fs.writeFile(journal, canonical(record), { mode: 0o600 });
  };
  const acted: { path: string; before: Revision; after: Revision; original: string | null }[] = [];
  try {
    await save();
    for (let index = 0; index < record.changes.length; index++) {
      const entry = record.changes[index];
      const write = plan.writes[index];
      if (!entry || !write) throw new Error("Incomplete write plan.");
      await safePath(root, entry.file, true);
      if (entry.to) await safePath(root, entry.to, true);
      await matches(root, entry.file, entry.before, fs);
      if (entry.originalPath) {
        const artifact = await safePath(root, `${workspace}/${entry.originalPath}`, true);
        await fs.copyFile(
          await safePath(root, entry.file, true),
          artifact,
          fs.constants.COPYFILE_EXCL,
        );
        const stat = await fs.stat(await safePath(root, entry.file, true));
        await fs.chmod(artifact, stat.mode & 0o777);
        if (!equalRevision(revision(await fs.readFile(artifact)), entry.before))
          throw new ProjectError(
            "conflict",
            "REVISION_CONFLICT",
            "Before-image changed during preparation.",
            entry.file,
          );
      }
      if (entry.stagedPath && write.bytes) {
        const artifact = await safePath(root, `${workspace}/${entry.stagedPath}`, true);
        await fs.writeFile(artifact, write.bytes, { flag: "wx", mode: 0o600 });
        if (entry.before.state === "present") {
          const stat = await fs.stat(await safePath(root, entry.file, true));
          await fs.chmod(artifact, stat.mode & 0o777);
        }
        if (!equalRevision(revision(await fs.readFile(artifact)), entry.after))
          throw new Error("Staged bytes failed verification.");
      }
      entry.progress = "prepared";
      await save();
    }
    for (const entry of record.changes)
      for (const [artifact, expected] of [
        [entry.originalPath, entry.before],
        [entry.stagedPath, entry.after],
      ] as const)
        if (
          artifact &&
          !equalRevision(
            revision(await fs.readFile(await safePath(root, `${workspace}/${artifact}`, true))),
            expected,
          )
        )
          throw new Error("Prepared transaction artifact changed before publication.");
    await verifyReads(root, plan.preview.reads, fs);
    record.state = "publishing";
    await save();
    for (const entry of record.changes) {
      await matches(root, entry.file, entry.before, fs);
      const target = await ensureParent(root, entry.to ?? entry.file, fs);
      if (entry.action === "delete") {
        await matches(root, entry.file, entry.before, fs);
        await fs.unlink(await safePath(root, entry.file, true));
        acted.push({
          path: entry.file,
          before: entry.before,
          after: { state: "absent" },
          original: entry.originalPath,
        });
      } else {
        if (!entry.stagedPath) throw new Error("Missing staged artifact.");
        const staged = await safePath(root, `${workspace}/${entry.stagedPath}`, true);
        if (!equalRevision(revision(await fs.readFile(staged)), entry.after))
          throw new Error("Staged artifact changed before publication.");
        if (entry.action === "create" || entry.action === "move") {
          await matches(root, entry.to ?? entry.file, { state: "absent" }, fs);
          // Native exclusive linking publishes complete bytes without replacing an occupied destination.
          await fs.link(staged, target);
          acted.push({
            path: entry.to ?? entry.file,
            before: { state: "absent" },
            after: entry.after,
            original: null,
          });
          await fs.unlink(staged);
        } else {
          await matches(root, entry.file, entry.before, fs);
          await safePath(root, entry.file, true);
          await fs.rename(staged, target);
          acted.push({
            path: entry.file,
            before: entry.before,
            after: entry.after,
            original: entry.originalPath,
          });
        }
        if (entry.action === "move") {
          await matches(root, entry.file, entry.before, fs);
          await fs.unlink(await safePath(root, entry.file, true));
          acted.push({
            path: entry.file,
            before: entry.before,
            after: { state: "absent" },
            original: entry.originalPath,
          });
        }
      }
      entry.progress = "applied";
      await save();
    }
    for (const action of acted) await matches(root, action.path, action.after, fs);
    record.state = "complete";
    await save();
  } catch (error) {
    let restored = true;
    record.state = "rolling_back";
    try {
      await save();
    } catch {
      restored = false;
    }
    for (const action of [...acted].reverse()) {
      try {
        await matches(root, action.path, action.after, fs);
        const target = await safePath(root, action.path, true);
        if (action.before.state === "absent") await fs.unlink(target);
        else {
          if (!action.original) throw new Error("Missing before-image.");
          const original = await safePath(root, `${workspace}/${action.original}`, true);
          if (!equalRevision(revision(await fs.readFile(original)), action.before))
            throw new Error("Before-image failed verification.");
          const restorePath = await safePath(root, `${workspace}/${action.original}.restore`, true);
          await fs.copyFile(original, restorePath, fs.constants.COPYFILE_EXCL);
          await fs.chmod(restorePath, (await fs.stat(original)).mode & 0o777);
          if (!equalRevision(revision(await fs.readFile(restorePath)), action.before))
            throw new Error("Restoration bytes failed verification.");
          await matches(root, action.path, action.after, fs);
          await safePath(root, action.path, true);
          if (action.after.state === "absent") {
            await fs.link(restorePath, target);
            await fs.unlink(restorePath);
          } else await fs.rename(restorePath, target);
        }
        await matches(root, action.path, action.before, fs);
      } catch {
        restored = false;
      }
    }
    if (restored) {
      for (const entry of record.changes) entry.progress = "restored";
      try {
        await save();
        await cleanup(root, workspace, record, fs);
      } catch {
        restored = false;
      }
    }
    if (!restored)
      throw combineErrors(
        new ProjectError(
          "conflict",
          "RECOVERY_REQUIRED",
          `Publication or rollback was incomplete. Preserve ${workspace} and inspect affected files before manual recovery. Original failure: ${error instanceof Error ? error.message : "filesystem failure"}`,
          `${workspace}/record.json`,
          {
            affectedFiles: record.changes.flatMap((entry) => [
              entry.file,
              ...(entry.to ? [entry.to] : []),
            ]),
          },
        ),
        error,
      );
    throw error;
  }
  try {
    await cleanup(root, workspace, record, fs);
    return [];
  } catch {
    return [
      {
        code: "CLEANUP_RETAINED",
        severity: "warning",
        message: `Publication succeeded. Completed artifacts remain at ${workspace}.`,
        file: `${workspace}/record.json`,
      },
    ];
  }
}
export async function publishPlan(
  root: string,
  plan: Plan,
  fs: FileSystem = nativeFileSystem,
): Promise<Diagnostic[]> {
  root = await realpath(root);
  const { fingerprint, ...body } = plan.preview;
  if (
    plan.preview.arguments.projectRoot !== root ||
    hash(["tbspec.preview", 1, body]) !== fingerprint ||
    plan.writes.length !== plan.preview.changes.length
  )
    throw new ProjectError(
      "conflict",
      "PREVIEW_CHANGED",
      "Write plan or canonical project changed. Prepare a fresh plan.",
    );
  for (let index = 0; index < plan.writes.length; index++) {
    const write = plan.writes[index];
    const change = plan.preview.changes[index];
    if (
      !write ||
      !change ||
      write.file !== change.file ||
      write.to !== change.to ||
      !equalRevision(revision(write.bytes), change.after)
    )
      throw new ProjectError(
        "conflict",
        "PREVIEW_CHANGED",
        "Proposed bytes or paths changed after planning.",
      );
  }
  const owner = await acquireLock(root, fs);
  let workFailure: { error: unknown } | undefined;
  const diagnostics: Diagnostic[] = [];
  try {
    await requireNoRecovery(root, fs);
    await verifyReads(root, plan.preview.reads, fs);
    diagnostics.push(...(await runTransaction(root, plan, owner, fs)));
  } catch (error) {
    workFailure = { error };
  }
  try {
    await releaseLock(root, owner, fs);
  } catch (error) {
    if (workFailure) throw combineErrors(workFailure.error, error);
    diagnostics.push({
      code: "CLEANUP_RETAINED",
      severity: "warning",
      file: ".tbspec/operation.lock",
      message:
        "Publication succeeded but operation-lock release failed. Preserve ownership evidence and inspect before manual recovery.",
    });
  }
  if (workFailure) throw workFailure.error;
  return diagnostics;
}
