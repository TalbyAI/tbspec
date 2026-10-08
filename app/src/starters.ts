import { readFile } from "node:fs/promises";
import { digest } from "./canonical.ts";
import { ProjectError } from "./output.ts";
import { parseGraph } from "./rdf.ts";
import { type Lock, parseLock, writeToml } from "./schemas.ts";

export const starterDirectory = new URL("../starters/0.1.0/", import.meta.url);
export async function loadStarters(): Promise<{
  lock: Lock;
  files: Record<string, Buffer>;
  vettedDigest: string;
}> {
  const inventoryBytes = await readFile(new URL("inventory.toml", starterDirectory));
  const inventoryDigest = digest(inventoryBytes);
  const parsed = parseLock(inventoryBytes.toString("utf8"), true);
  const { schema_version, starters, dependencies } = parsed;
  const lock: Lock = { schema_version, starters, dependencies };
  const files: Record<string, Buffer> = {};
  const vetted = lock.dependencies["tbspec-process"]?.files.find(
    (file) => file.key === "source/p-plan.owl",
  );
  if (!vetted)
    throw new ProjectError(
      "invalid",
      "LOCK_INVALID",
      "Installed starter inventory lacks pinned P-Plan.",
    );
  for (const dependency of Object.values(lock.dependencies)) {
    for (const source of dependency.sources) source.inventory_digest = inventoryDigest;
    for (const file of dependency.files) {
      const bytes = await readFile(new URL(file.key, starterDirectory));
      await parseGraph(bytes, file, vetted.byte_digest);
      files[`${dependency.snapshot_path}/${file.key}`] = bytes;
    }
  }
  // Validate the filled consumer representation independently of the packaged self-reference exception.
  parseLock(writeToml(lock));
  return { lock, files, vettedDigest: vetted.byte_digest };
}
