import { parentPort } from "node:worker_threads";
import { inspectProject } from "./inspection.ts";

parentPort?.postMessage({ ready: true });
parentPort?.on("message", async (options: Parameters<typeof inspectProject>[0]) => {
  parentPort?.postMessage(await inspectProject(options));
});
