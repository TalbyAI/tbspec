import { lstat, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const packageManifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
if (packageManifest.name !== "tbspec")
  throw new Error("Refusing to clean output outside the tbspec package.");

const outputDirectory = resolve(packageDirectory, "dist");
if (relative(packageDirectory, outputDirectory) !== "dist")
  throw new Error("Refusing to clean an output path outside the tbspec package.");

try {
  const output = await lstat(outputDirectory);
  if (!output.isDirectory() || output.isSymbolicLink())
    throw new Error("Refusing to clean dist because it is not an owned directory.");
  await rm(outputDirectory, { recursive: true });
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
