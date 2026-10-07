import type { FileHandle } from "node:fs/promises";
import { canonical } from "./canonical.ts";
import { type FileSystem, nativeFileSystem } from "./filesystem.ts";
import { combineErrors, hasCode, ProjectError } from "./output.ts";
import { type ProcessIdentity, processIdentity, token, verifyIdentity } from "./ownership.ts";
import { safePath } from "./paths.ts";
import { validOwnershipRecord, validRecoveryRecord } from "./recovery.ts";

export interface Ownership extends ProcessIdentity {
  recordVersion: 1;
  acquisitionId: string;
  createdAt: string;
}
export async function acquireLock(
  root: string,
  fs: FileSystem = nativeFileSystem,
): Promise<Ownership> {
  await fs.mkdir(await safePath(root, ".tbspec", true), { recursive: true, mode: 0o700 });
  const target = await safePath(root, ".tbspec/operation.lock", true);
  let handle: FileHandle;
  try {
    handle = await fs.open(target, "wx", 0o600);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    let observed: Ownership | undefined;
    try {
      observed = JSON.parse(await fs.readFile(target, "utf8"));
    } catch {
      /* Partial records block without modification. */
    }
    const verified =
      observed !== undefined &&
      validOwnershipRecord(observed) &&
      (await verifyIdentity({
        hostId: observed.hostId,
        bootId: observed.bootId,
        pid: observed.pid,
        processStartId: observed.processStartId,
      }));
    throw new ProjectError(
      "conflict",
      verified ? "PROJECT_BUSY" : "RECOVERY_REQUIRED",
      verified
        ? "Another operation owns the project lock. Retry after it finishes."
        : "Project lock ownership is unknown or abandoned. Preserve the lock and inspect it before manual recovery.",
      ".tbspec/operation.lock",
    );
  }
  let ownership: Ownership | undefined;
  try {
    ownership = {
      recordVersion: 1,
      acquisitionId: token(),
      ...(await processIdentity()),
      createdAt: new Date().toISOString(),
    };
    await handle.writeFile(canonical(ownership));
    await handle.close();
    return ownership;
  } catch (error) {
    try {
      await handle.close();
    } catch {
      /* A close failure is still a failed acquisition. */
    }
    if (ownership) {
      try {
        await releaseLock(root, ownership, fs);
      } catch {
        /* Unverifiable locks are retained. */
      }
    }
    throw new ProjectError(
      "unavailable",
      "IO_FAILURE",
      `Ownership record could not be completed. Inspect .tbspec/operation.lock before clearing it: ${error instanceof Error ? error.message : "OS failure"}`,
      ".tbspec/operation.lock",
    );
  }
}
export async function releaseLock(
  root: string,
  ownership: Ownership,
  fs: FileSystem = nativeFileSystem,
): Promise<void> {
  const path = await safePath(root, ".tbspec/operation.lock", true);
  let current: unknown;
  try {
    current = JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    throw new ProjectError(
      "conflict",
      "RECOVERY_REQUIRED",
      "Lock record is missing or incomplete; normal release is unsafe.",
      ".tbspec/operation.lock",
    );
  }
  if (
    ownership.pid !== process.pid ||
    !validOwnershipRecord(current) ||
    canonical(current) !== canonical(ownership) ||
    !(await verifyIdentity({
      hostId: ownership.hostId,
      bootId: ownership.bootId,
      pid: ownership.pid,
      processStartId: ownership.processStartId,
    }))
  )
    throw new ProjectError(
      "conflict",
      "RECOVERY_REQUIRED",
      "Lock token or full process ownership changed; retained for recovery.",
      ".tbspec/operation.lock",
    );
  await fs.unlink(path);
}
export async function requireNoRecovery(
  root: string,
  fs: FileSystem = nativeFileSystem,
): Promise<void> {
  const directory = await safePath(root, ".tbspec/transactions");
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  for (const name of names) {
    let record: unknown;
    const path = `.tbspec/transactions/${name}/record.json`;
    try {
      record = JSON.parse(await fs.readFile(await safePath(root, path), "utf8"));
    } catch {
      throw new ProjectError(
        "conflict",
        "RECOVERY_REQUIRED",
        "Recovery metadata is missing or incomplete. Preserve transaction artifacts and establish exclusive access before manual recovery.",
        path,
      );
    }
    if (!validRecoveryRecord(record, name) || record.state !== "complete")
      throw new ProjectError(
        "conflict",
        "RECOVERY_REQUIRED",
        "Pending transaction may contain mixed state. Preserve originals and inspect before manual recovery.",
        path,
      );
  }
}
export async function withLock<T>(
  root: string,
  work: (ownership: Ownership) => Promise<T>,
  fs: FileSystem = nativeFileSystem,
): Promise<T> {
  const owner = await acquireLock(root, fs);
  let outcome: { ok: true; data: T } | { ok: false; error: unknown };
  try {
    await requireNoRecovery(root, fs);
    outcome = { ok: true, data: await work(owner) };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await releaseLock(root, owner, fs);
  } catch (error) {
    if (!outcome.ok) throw combineErrors(outcome.error, error);
    throw error;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.data;
}
