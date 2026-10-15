import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { threadId } from "node:worker_threads";

const output = process.env.TBSPEC_PROFILE_OUTPUT;
if (!output) throw new Error("TBSPEC_PROFILE_OUTPUT is required.");
const start = performance.now();
function record(metric, ms, detail) {
  appendFileSync(output, JSON.stringify({ pid: process.pid, threadId, metric, ms, detail }) + "\n");
}
globalThis.__tbspecMeasure = async (name, work) => {
  const since = performance.now();
  try {
    return await work();
  } finally {
    record(name, performance.now() - since);
  }
};
globalThis.__tbspecMeasureSync = (name, work) => {
  const since = performance.now();
  try {
    return work();
  } finally {
    record(name, performance.now() - since);
  }
};
process.on("exit", () => record("process.lifetime", performance.now() - start));

const originalExecFile = childProcess.execFile;
childProcess.execFile = function (file, ...args) {
  const since = performance.now();
  const child = originalExecFile.call(this, file, ...args);
  const text = JSON.stringify(args[0]);
  const category = /Get-CimInstance/.test(text)
    ? "identity"
    : /GetAccessControl/.test(text)
      ? "permissions"
      : /SetAccessControl/.test(text)
        ? "privateDirectory"
        : "other";
  child.once("close", () => record("execFile." + category, performance.now() - since));
  return child;
};
childProcess.execFile[promisify.custom] = (file, ...args) =>
  new Promise((resolve, reject) => {
    childProcess.execFile(file, ...args, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else resolve({ stdout, stderr });
    });
  });
const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function (file, args, options) {
  const since = performance.now();
  try {
    return originalSpawnSync.call(this, file, args, options);
  } finally {
    record(
      "spawnSync",
      performance.now() - since,
      args?.filter((arg) => !String(arg).includes("file:")).slice(-12),
    );
  }
};
syncBuiltinESMExports();

const functions = {
  "starters.ts": ["loadStarters"],
  "rdf.ts": ["parseGraph", "parseRdf"],
  "validation.ts": ["validateInspection"],
  "shacl-execution.ts": ["runShapes"],
  "shacl-profile.ts": ["prepareShapes"],
  "project.ts": ["readProject", "initializeProject"],
  "inspection.ts": ["inspectProject", "captureInspection"],
  "authoring.ts": ["prepareResource", "publishResource"],
  "repair.ts": ["prepareRepair", "publishRepair", "listReferences"],
};
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.includes("/app/src/")) return result;
    const names = functions[url.split("/").at(-1)];
    if (!names) return result;
    let source = String(result.source);
    for (const name of names) {
      const isAsync = source.includes(`export async function ${name}(`);
      const declaration = `export ${isAsync ? "async " : ""}function ${name}(`;
      if (!source.includes(declaration))
        throw new Error(`Missing instrumentation seam: ${url} ${name}`);
      source = source.replace(
        declaration,
        `${isAsync ? "async " : ""}function __tbspecOriginal_${name}(`,
      );
      const call = `__tbspecOriginal_${name}(...args)`;
      source += `\nexport ${isAsync ? "async " : ""}function ${name}(...args) { return globalThis.__tbspecMeasure${isAsync ? "" : "Sync"}('${name}', () => ${call}); }\n`;
    }
    return { ...result, source };
  },
});
