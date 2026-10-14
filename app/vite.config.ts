import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { OutputAsset, OutputChunk } from "rolldown";
import { defineConfig, type Plugin } from "vite";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const nodeModulesDirectory = resolve(packageDirectory, "node_modules");
const nodeModulesPrefix = `${nodeModulesDirectory}${sep}`;

interface PackageReference {
  name: string;
  path: string;
  version: string;
}

interface ModuleContribution {
  file: string;
  package: PackageReference | null;
  rendered: { unit: "rollup-code-units" | "utf8-bytes"; value: number };
}

interface StylesheetSourceModule {
  file: string;
  package: PackageReference | null;
  sourceBytes: number;
}

function normalizedSourcePath(source: string, baseDirectory = packageDirectory): string | null {
  if (source.startsWith("file://")) {
    try {
      source = fileURLToPath(source);
    } catch {
      return null;
    }
  }
  if (source.startsWith("\0") || source.startsWith("data:") || source.startsWith("http:"))
    return null;
  const clean = source.split("?")[0];
  if (!clean) return null;
  if (clean.startsWith("/@fs/")) source = clean.slice("/@fs/".length);
  else if (isAbsolute(clean)) source = clean;
  else if (clean.startsWith("/")) source = resolve(packageDirectory, `.${clean}`);
  else source = clean;
  const absolute = isAbsolute(source) ? resolve(source) : resolve(baseDirectory, source);
  const fromPackage = relative(packageDirectory, absolute);
  if (fromPackage === ".." || fromPackage.startsWith(`..${sep}`) || isAbsolute(fromPackage))
    return null;
  return absolute;
}

function packageReference(sourcePath: string | null): PackageReference | null {
  if (!sourcePath?.startsWith(nodeModulesPrefix)) return null;
  let directory = dirname(sourcePath);
  while (directory.startsWith(nodeModulesPrefix)) {
    try {
      const metadata = JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (typeof metadata.name === "string" && typeof metadata.version === "string")
        return {
          name: metadata.name,
          path: relative(packageDirectory, directory).split(sep).join("/"),
          version: metadata.version,
        };
    } catch {
      // Continue to the containing package directory.
    }
    directory = dirname(directory);
  }
  return null;
}

function virtualModulePackage(source: string): PackageReference | null {
  const match = /^\0([^/]+)\//.exec(source);
  if (!match?.[1]) return null;
  return packageReference(resolve(nodeModulesDirectory, match[1], "package.json"));
}

function moduleContribution(
  source: string,
  renderedLength: number,
  unit: "rollup-code-units" | "utf8-bytes",
): ModuleContribution {
  const sourcePath = normalizedSourcePath(source);
  const relativeSource = sourcePath
    ? relative(packageDirectory, sourcePath).split(sep).join("/")
    : source;
  return {
    file: source.startsWith("\0") ? `virtual:${source.slice(1)}` : relativeSource,
    package: packageReference(sourcePath) ?? virtualModulePackage(source),
    rendered: { unit, value: renderedLength },
  };
}

function provenancePlugin(): Plugin {
  const cssModules = new Map<string, number>();
  const elkWorkerSources = new Set<string>();
  return {
    name: "tbspec-build-provenance",
    apply: "build",
    transform(code, id) {
      if (id.split("?")[0]?.toLowerCase().endsWith(".css"))
        cssModules.set(id, Buffer.byteLength(code));
      if (id.includes("elk-worker.min.js")) elkWorkerSources.add(id);
      return null;
    },
    async resolveId(source, importer) {
      if (source.includes("elk-worker.min.js")) {
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (resolved) elkWorkerSources.add(resolved.id);
      }
      return null;
    },
    generateBundle(_options, bundle) {
      const chunks: Array<{ file: string; modules: ModuleContribution[] }> = [];
      const assets: Array<{
        file: string;
        kind: "asset" | "chunk";
        originalFiles: string[];
        bytes: number;
      }> = [];
      const cssAssets = new Map<string, OutputAsset>();
      const workers: Array<{ file: string; package: PackageReference | null; bytes: number }> = [];
      const packageRefs = new Map<string, PackageReference>();

      for (const entry of Object.values(bundle)) {
        if (entry.fileName.endsWith(".map")) continue;
        if (entry.type === "chunk") {
          const chunk = entry as OutputChunk;
          const modules = Object.entries(chunk.modules)
            .filter(([, info]) => info.renderedLength > 0)
            .map(([id, info]) => moduleContribution(id, info.renderedLength, "rollup-code-units"));
          for (const item of modules) {
            if (item.package) packageRefs.set(item.package.path, item.package);
          }
          chunks.push({ file: chunk.fileName, modules });
          assets.push({
            file: chunk.fileName,
            kind: "chunk",
            originalFiles: [],
            bytes: Buffer.byteLength(chunk.code),
          });
          continue;
        }

        const asset = entry as OutputAsset & { originalFileNames?: string[] };
        const originalFiles = asset.originalFileNames ?? [];
        const bytes =
          typeof asset.source === "string"
            ? Buffer.byteLength(asset.source)
            : asset.source.byteLength;
        assets.push({ file: asset.fileName, kind: "asset", originalFiles, bytes });
        if (asset.fileName.endsWith(".css")) cssAssets.set(asset.fileName, asset);

        const sourcePaths = [...originalFiles, asset.name ?? ""].filter(Boolean);
        const isWorkerAsset = sourcePaths.some((source) =>
          /elk-worker(?:\.min)?[^/\\]*\.js/i.test(source),
        );
        const workerSource = isWorkerAsset
          ? [...sourcePaths, ...elkWorkerSources]
              .map((source) => normalizedSourcePath(source))
              .find((source) =>
                source ? /[\\/]elkjs[\\/]lib[\\/]elk-worker\.min\.js$/i.test(source) : false,
              )
          : null;
        if (isWorkerAsset) {
          const reference = packageReference(
            workerSource ?? normalizedSourcePath([...elkWorkerSources][0] ?? ""),
          );
          if (reference) packageRefs.set(reference.path, reference);
          workers.push({
            file: asset.fileName,
            package: reference,
            bytes,
          });
        }
      }

      const stylesheets: Array<{
        file: string;
        bytes: number;
        sourceModules: StylesheetSourceModule[];
      }> = [];
      if (cssAssets.size !== 1 || cssModules.size === 0)
        throw new Error("Vite must emit one stylesheet with tracked CSS source modules.");
      const [stylesheetFile, stylesheet] = [...cssAssets.entries()][0] ?? [];
      if (!stylesheetFile || !stylesheet)
        throw new Error("Vite CSS output is missing its emitted stylesheet.");
      const css =
        typeof stylesheet.source === "string"
          ? stylesheet.source
          : Buffer.from(stylesheet.source).toString("utf8");
      const sourceModules: StylesheetSourceModule[] = [...cssModules.entries()].map(
        ([id, sourceBytes]) => {
          const sourcePath = normalizedSourcePath(id);
          const sourceModule = {
            file: sourcePath ? relative(packageDirectory, sourcePath).split(sep).join("/") : id,
            package: packageReference(sourcePath),
            sourceBytes,
          };
          if (sourceModule.package)
            packageRefs.set(sourceModule.package.path, sourceModule.package);
          return sourceModule;
        },
      );
      if (!sourceModules.some((module) => module.file === "web/style.css"))
        throw new Error("Vite output does not identify the application stylesheet source.");
      if (!sourceModules.some((module) => module.package?.name === "@xyflow/react"))
        throw new Error("Vite output does not identify the emitted React Flow stylesheet source.");
      stylesheets.push({ file: stylesheetFile, bytes: Buffer.byteLength(css), sourceModules });
      if (workers.length === 0 || workers.some((worker) => worker.package?.name !== "elkjs"))
        throw new Error("Vite output is missing the packaged ELK worker provenance.");
      if (![...packageRefs.values()].some((item) => item.name === "@xyflow/react"))
        throw new Error("Vite output does not identify the emitted React Flow modules.");

      for (const entry of Object.keys(bundle)) if (entry.endsWith(".map")) delete bundle[entry];
      this.emitFile({
        type: "asset",
        fileName: "build-provenance.json",
        source: `${JSON.stringify(
          {
            schemaVersion: 1,
            assets: assets.sort((a, b) => a.file.localeCompare(b.file)),
            chunks: chunks.sort((a, b) => a.file.localeCompare(b.file)),
            stylesheets: stylesheets.sort((a, b) => a.file.localeCompare(b.file)),
            workers,
            browserPackages: [...packageRefs.values()].sort((a, b) =>
              `${a.name}@${a.version}:${a.path}`.localeCompare(`${b.name}@${b.version}:${b.path}`),
            ),
          },
          null,
          2,
        )}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [provenancePlugin()],
});
