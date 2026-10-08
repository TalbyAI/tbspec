import type { Dirent } from "node:fs";
import * as filesystem from "node:fs/promises";
import { canonical, digest, hash, sortedSet } from "./canonical.ts";
import { hasCode, ProjectError } from "./output.ts";
import { portablePath, safePath } from "./paths.ts";

// The native filesystem is the fault boundary, also used by process/failure checks.
export type FileSystem = typeof filesystem;
export const nativeFileSystem = filesystem;
export type Revision = { state: "absent" } | { state: "present"; digest: string };
export interface InventoryScope {
  included: string[];
  excluded: string[];
}
export type Read =
  | { kind: "file"; path: string; revision: Revision }
  | { kind: "inventory"; path: string; revision: Revision; scope: InventoryScope };
export const ephemeral = [
  ".tbspec/runtime",
  ".tbspec/previews",
  ".tbspec/transactions",
  ".tbspec/operation.lock",
];
export async function fileBytes(
  root: string,
  path: string,
  fs = nativeFileSystem,
): Promise<Buffer | null> {
  const target = await safePath(root, path);
  try {
    return await fs.readFile(target);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}
export function revision(bytes: Uint8Array | null): Revision {
  return bytes === null ? { state: "absent" } : { state: "present", digest: digest(bytes) };
}
export function equalRevision(left: Revision, right: Revision): boolean {
  return canonical(left) === canonical(right);
}
export async function inventory(
  root: string,
  path: string,
  scope: InventoryScope,
  fs = nativeFileSystem,
): Promise<Revision> {
  const entries: { path: string; kind: "file" | "directory" }[] = [];
  const excluded = (entry: string) =>
    scope.excluded.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`));
  async function walk(directory: string) {
    const target = directory ? await safePath(root, directory) : root;
    let children: Dirent[];
    try {
      children = await fs.readdir(target, { withFileTypes: true });
    } catch (error) {
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }
    for (const child of children) {
      const entry = directory ? `${directory}/${child.name}` : child.name;
      if (excluded(entry)) continue;
      portablePath(entry);
      await safePath(root, entry);
      if (!child.isDirectory() && !child.isFile())
        throw new ProjectError(
          "conflict",
          "PATH_UNSAFE",
          `Unsafe inventory entry: ${entry}`,
          entry,
        );
      entries.push({ path: entry, kind: child.isDirectory() ? "directory" : "file" });
      if (child.isDirectory()) await walk(entry);
    }
  }
  for (const prefix of scope.included) {
    if (prefix && excluded(prefix)) continue;
    await walk(prefix || path);
  }
  return { state: "present", digest: hash(sortedSet(entries)) };
}
export async function verifyReads(
  root: string,
  reads: Read[],
  fs = nativeFileSystem,
): Promise<void> {
  for (const read of reads) {
    const current =
      read.kind === "file"
        ? revision(await fileBytes(root, read.path, fs))
        : await inventory(root, read.path, read.scope, fs);
    if (!equalRevision(read.revision, current))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        `Project changed since capture: ${read.path || "project inventory"}. Review a fresh plan.`,
        read.path || null,
      );
  }
}
