import type { Dirent } from "node:fs";
import { readdir, rmdir, unlink } from "node:fs/promises";
import { type Diagnostic, hasCode, ProjectError } from "./output.ts";
import { safePath } from "./paths.ts";
import { opaqueToken } from "./recovery.ts";

export function retainedPreview(workspace: string): Diagnostic {
  return {
    code: "CLEANUP_RETAINED",
    severity: "warning",
    file: workspace,
    message:
      "Preview files could not be safely removed. Inspect this workspace before manual cleanup.",
  };
}

export async function discardPreview(root: string, workspace: string): Promise<void> {
  const parts = workspace.split("/");
  if (
    parts.length !== 4 ||
    parts[0] !== ".tbspec" ||
    parts[1] !== "previews" ||
    !opaqueToken(parts[2]) ||
    !opaqueToken(parts[3])
  )
    throw new ProjectError("conflict", "PATH_UNSAFE", "Invalid preview workspace.", workspace);
  const directory = await safePath(root, workspace, true);
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  // Validate every artifact before removing any; unknown content is preserved.
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !(entry.name === "record.json" || /^staged-(0|[1-9][0-9]*)$/.test(entry.name))
    )
      throw new ProjectError(
        "conflict",
        "PATH_UNSAFE",
        "Unrecognized preview artifact.",
        workspace,
      );
    await safePath(root, `${workspace}/${entry.name}`, true);
  }
  for (const entry of entries)
    await unlink(await safePath(root, `${workspace}/${entry.name}`, true));
  await rmdir(directory);
}

// Called only after exclusive server ownership and after the relevant worker has stopped.
export async function cleanupPreviews(root: string, instanceId?: string): Promise<Diagnostic[]> {
  const warnings: Diagnostic[] = [];
  const base = ".tbspec/previews";
  try {
    const instances = instanceId ? [instanceId] : await readdir(await safePath(root, base, true));
    for (const instance of instances) {
      const directory = `${base}/${instance}`;
      try {
        if (!opaqueToken(instance)) throw new Error("Unrecognized preview instance.");
        for (const handle of await readdir(await safePath(root, directory, true))) {
          const workspace = `${directory}/${handle}`;
          try {
            await discardPreview(root, workspace);
          } catch {
            warnings.push(retainedPreview(workspace));
          }
        }
        if (!(await readdir(await safePath(root, directory, true))).length)
          await rmdir(await safePath(root, directory, true));
      } catch (error) {
        if (!hasCode(error, "ENOENT")) warnings.push(retainedPreview(directory));
      }
    }
  } catch (error) {
    if (!hasCode(error, "ENOENT")) warnings.push(retainedPreview(base));
  }
  return warnings;
}
