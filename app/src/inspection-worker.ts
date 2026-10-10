import { parentPort } from "node:worker_threads";
import { inspectProject } from "./inspection.ts";
import type { Result } from "./output.ts";

export interface InspectionResponse {
  status: Result["status"];
  json: string;
}

parentPort?.postMessage({ ready: true });
parentPort?.on("message", async (options: Parameters<typeof inspectProject>[0]) => {
  const result = await inspectProject(options);
  parentPort?.postMessage({
    status: result.status,
    json: JSON.stringify(result),
  } satisfies InspectionResponse);
});
