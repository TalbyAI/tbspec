import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ephemeral, type FileSystem, fileBytes, nativeFileSystem } from "./filesystem.ts";
import { failure, hasCode, ok, ProjectError, type Result } from "./output.ts";
import { absoluteIri, safePath } from "./paths.ts";
import { parseGraph } from "./rdf.ts";
import { recoveryArtifacts, validOwnershipRecord, validRecoveryRecord } from "./recovery.ts";
import {
  editBaseIri,
  type Lock,
  parseLock,
  parseManifest,
  type Row,
  writeToml,
} from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { capture, preparePlan, publishPlan, type Snapshot } from "./transactions.ts";

export async function discoverProject(
  options: { cwd?: string; project?: string } = {},
): Promise<string> {
  let root = await realpath(resolve(options.project ?? options.cwd ?? process.cwd()));
  if (!(await stat(root)).isDirectory())
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Project selection must be a directory.",
    );
  for (;;) {
    if ((await fileBytes(root, "tbspec.toml")) !== null) return root;
    const parent = dirname(root);
    if (options.project || parent === root)
      throw new ProjectError(
        "unavailable",
        "RESOURCE_MISSING",
        options.project
          ? "Explicit directory contains no tbspec.toml. Select the project root."
          : "No tbspec.toml found upward. Run tbspec init [directory] first.",
      );
    root = parent;
  }
}
export interface ProjectSnapshot {
  root: string;
  manifest: Row;
  lock: Lock;
  snapshot: Snapshot;
}
export async function readProject(
  options: { cwd?: string; project?: string } = {},
  fs: FileSystem = nativeFileSystem,
): Promise<ProjectSnapshot> {
  const root = await discoverProject(options);
  const first = await capture(root, ["tbspec.toml", "tbspec.lock"], [], fs);
  const manifest = parseManifest(first.files["tbspec.toml"]?.toString("utf8") ?? "");
  if (!first.files["tbspec.lock"])
    throw new ProjectError(
      "invalid",
      "LOCK_INVALID",
      "Required starter lock is missing. Restore it; installed defaults are never substituted.",
      "tbspec.lock",
    );
  const lock = parseLock(first.files["tbspec.lock"].toString("utf8"));
  const paths = Object.values(lock.dependencies).flatMap((dependency) =>
    dependency.files.map((file) => `${dependency.snapshot_path}/${file.key}`),
  );
  const snapshot = await capture(root, ["tbspec.toml", "tbspec.lock", ...paths], [], fs);
  for (const path of ["tbspec.toml", "tbspec.lock"])
    if (!first.files[path]?.equals(snapshot.files[path] ?? Buffer.alloc(0)))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Project configuration changed during capture; retry with a fresh read.",
        path,
      );
  const bundle = await loadStarters();
  for (const dependency of Object.values(lock.dependencies))
    for (const file of dependency.files) {
      const physical = `${dependency.snapshot_path}/${file.key}`;
      const bytes = snapshot.files[physical];
      if (!bytes)
        throw new ProjectError(
          "invalid",
          "SNAPSHOT_INTEGRITY",
          "Locked file is missing. Restore the recorded snapshot; no automatic fetch.",
          physical,
        );
      await parseGraph(bytes, file, bundle.vettedDigest);
    }
  return { root, manifest, lock, snapshot };
}
export async function initializeProject(
  options: { directory?: string; baseIri?: string; cwd?: string } = {},
  fs: FileSystem = nativeFileSystem,
): Promise<Result> {
  try {
    if (
      options.baseIri !== undefined &&
      (!absoluteIri(options.baseIri) || !/[#/]$/.test(options.baseIri))
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--base-iri must be an absolute IRI ending in / or #.",
      );
    const bundle = await loadStarters();
    const directory = resolve(options.cwd ?? process.cwd(), options.directory ?? ".");
    await mkdir(directory, { recursive: true });
    const root = await realpath(directory);
    const manifest = writeToml({
      schema_version: 1,
      ...(options.baseIri ? { base_iri: options.baseIri } : {}),
      model_types: bundle.lock.starters.model_types,
    });
    const paths = ["tbspec.toml", "tbspec.lock", ".gitignore", ...Object.keys(bundle.files)];
    const snapshot = await capture(root, paths, [], fs);
    const existingManifest = snapshot.files["tbspec.toml"];
    const existingLock = snapshot.files["tbspec.lock"];
    if (existingManifest) parseManifest(existingManifest.toString("utf8"));
    if (existingLock) parseLock(existingLock.toString("utf8"));
    for (const path of paths.filter((path) => path !== ".gitignore"))
      if (snapshot.files[path] !== null)
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          `Initialization destination already exists: ${path}. Use an empty project destination; existing content was preserved.`,
          path,
        );
    const ignore = snapshot.files[".gitignore"]?.toString("utf8") ?? "";
    const newline = ignore.includes("\r\n") ? "\r\n" : "\n";
    const missing = [
      ".tbspec/runtime/",
      ".tbspec/previews/",
      ".tbspec/transactions/",
      ".tbspec/operation.lock",
    ].filter((pattern) => !ignore.split(/\r?\n/).includes(pattern));
    const ignoreText =
      ignore +
      (missing.length
        ? `${ignore && !ignore.endsWith("\n") ? newline : ""}${missing.join(newline)}${newline}`
        : "");
    const proposed = [
      { file: "tbspec.toml", bytes: Buffer.from(manifest) },
      { file: "tbspec.lock", bytes: Buffer.from(writeToml(bundle.lock)) },
      ...(ignoreText !== ignore || !snapshot.files[".gitignore"]
        ? [{ file: ".gitignore", bytes: Buffer.from(ignoreText) }]
        : []),
      ...Object.entries(bundle.files).map(([file, bytes]) => ({ file, bytes })),
    ];
    const plan = preparePlan(snapshot, "init", proposed, { baseIri: options.baseIri ?? null });
    const diagnostics = await publishPlan(root, plan, fs);
    return ok(
      { applied: true, changes: plan.preview.changes, projectValidity: "unchecked" },
      diagnostics,
    );
  } catch (error) {
    return failure(error);
  }
}
export async function setProjectBaseIri(
  options: { project: string; baseIri: string },
  fs: FileSystem = nativeFileSystem,
): Promise<Result> {
  try {
    const project = await readProject({ project: options.project }, fs);
    const text = project.snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
    const plan = preparePlan(
      project.snapshot,
      "config.base-iri",
      [{ file: "tbspec.toml", bytes: Buffer.from(editBaseIri(text, options.baseIri)) }],
      { baseIri: options.baseIri },
    );
    const diagnostics = await publishPlan(project.root, plan, fs);
    return ok(
      { applied: true, changes: plan.preview.changes, projectValidity: "unchecked" },
      diagnostics,
    );
  } catch (error) {
    return failure(error);
  }
}
export const projectDiscoveryScope = {
  path: "",
  included: [""],
  excluded: [...ephemeral, ".git", "node_modules"],
};
export async function inspectRecovery(project: string): Promise<Result> {
  // Read-only recovery inspection intentionally does not acquire or clear retained ownership.
  try {
    const root = await realpath(resolve(project));
    const lockBytes = await fileBytes(root, ".tbspec/operation.lock");
    const transactions: {
      location: string;
      record: unknown;
      incomplete: boolean;
      artifacts: Awaited<ReturnType<typeof recoveryArtifacts>>;
    }[] = [];
    let names: string[] = [];
    try {
      names = await nativeFileSystem.readdir(await safePath(root, ".tbspec/transactions"));
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
    for (const name of names) {
      const location = `.tbspec/transactions/${name}/record.json`;
      let record: unknown = null;
      try {
        record = JSON.parse((await fileBytes(root, location))?.toString("utf8") ?? "");
      } catch {
        /* Report incomplete metadata explicitly. */
      }
      transactions.push({
        location,
        record,
        incomplete: !validRecoveryRecord(record, name),
        artifacts: await recoveryArtifacts(root, location, record, nativeFileSystem),
      });
    }
    let ownership: unknown = null;
    try {
      ownership = JSON.parse(lockBytes?.toString("utf8") ?? "");
    } catch {
      /* Partial record retained. */
    }
    return ok({
      projectRoot: root,
      ownership,
      ownershipIncomplete: lockBytes !== null && !validOwnershipRecord(ownership),
      transactions,
      guidance:
        "Stop all CLI/web processes and prevent new invocations. Preserve lock, records and originals. Restore or explicitly accept a coherent disk state before manually clearing recovery evidence. Leave the lock if exclusive access cannot be established.",
    });
  } catch (error) {
    return failure(error);
  }
}
