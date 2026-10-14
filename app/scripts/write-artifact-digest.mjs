import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = new URL(".", import.meta.url);
const packageDirectory = resolve(fileURLToPath(scriptDirectory), "..");
const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
const destination = resolve(process.argv[2] ?? "../packed-application");
const destinationInfo = await stat(destination);
const archivePath = destinationInfo.isDirectory()
  ? join(
      destination,
      (await readdir(destination)).find(
        (entry) => entry === `${manifest.name}-${manifest.version}.tgz`,
      ) ?? `${manifest.name}-${manifest.version}.tgz`,
    )
  : destination;
const archive = await readFile(archivePath);
const digest = createHash("sha256").update(archive).digest("hex");
await writeFile(`${archivePath}.sha256`, `${digest}  ${basename(archivePath)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ file: basename(archivePath), sha256: digest })}\n`);
