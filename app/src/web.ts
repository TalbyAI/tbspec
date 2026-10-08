import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { canonical } from "./canonical.ts";
import { failure, ok, type Result } from "./output.ts";
import { discoverProject } from "./project.ts";
import { opaqueToken } from "./recovery.ts";
import {
  observeRuntime,
  type RuntimeRecord,
  readRuntime,
  removeRuntime,
  runtimeError,
  runtimeProcess,
} from "./runtime.ts";

export interface ServerRecord {
  state: "running" | "stopped" | "unknown" | "unavailable" | "starting" | "stopping";
  projectRoot: string;
  verified: boolean;
  instanceId: string | null;
  pid: number | null;
  applicationVersion: string | null;
  controlProtocolVersion: number | null;
  baseUrl: string | null;
  openingLink: string | null;
  openingLinkExpiresAt: string | null;
  openingLinkTransient: true;
}
interface WebData extends Record<string, unknown> {
  server: ServerRecord;
}
function stoppedRecord(root: string): ServerRecord {
  return {
    state: "stopped",
    projectRoot: root,
    verified: false,
    instanceId: null,
    pid: null,
    applicationVersion: null,
    controlProtocolVersion: null,
    baseUrl: null,
    openingLink: null,
    openingLinkExpiresAt: null,
    openingLinkTransient: true,
  };
}
export async function controlRequest(
  record: RuntimeRecord,
  route: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!record.baseUrl)
    throw runtimeError(
      "conflict",
      "RUNTIME_OWNERSHIP_UNKNOWN",
      "Server has not published an authenticated endpoint.",
    );
  let response: Response;
  try {
    response = await fetch(new URL(`api/control/v1/${route}`, record.baseUrl), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${record.controlToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    const result = (await response.json()) as Result;
    if (response.status === 401 || response.status === 403)
      throw runtimeError(
        "unavailable",
        "RUNTIME_AUTH_FAILED",
        "Verified live server rejected control authentication. Inspect it; no automatic restart or retry.",
      );
    if (!response.ok || result.schemaVersion !== 1 || result.status !== "ok" || !result.data)
      throw runtimeError(
        "unavailable",
        "RUNTIME_UNAVAILABLE",
        "Verified live server returned an unusable response.",
      );
    return result.data;
  } catch (error) {
    if (error instanceof Error && "diagnostic" in error) throw error;
    throw runtimeError(
      "unavailable",
      "RUNTIME_UNAVAILABLE",
      "Verified live server is unreachable. Inspect the running instance; no automatic restart or write retry.",
    );
  }
}
async function verified(record: RuntimeRecord): Promise<void> {
  if ((await observeRuntime(record)) !== "live")
    throw runtimeError(
      "conflict",
      "RUNTIME_OWNERSHIP_UNKNOWN",
      "Full runtime ownership is unknown or ended. Preserve the registration for inspection; status/stop never clear it.",
    );
  const body = {
    protocolVersion: 1,
    projectRoot: record.projectRoot,
    instanceId: record.instanceId,
    process: runtimeProcess(record),
  };
  const reply = await controlRequest(record, "handshake", body);
  if (
    reply.projectRoot !== record.projectRoot ||
    reply.instanceId !== record.instanceId ||
    canonical(reply.process) !== canonical(body.process) ||
    reply.controlProtocolVersion !== 1 ||
    reply.jsonSchemaVersion !== 1 ||
    reply.applicationVersion !== record.applicationVersion ||
    reply.baseUrl !== record.baseUrl ||
    !["running", "starting", "stopping"].includes(String(reply.state))
  )
    throw runtimeError(
      "conflict",
      "RUNTIME_OWNERSHIP_UNKNOWN",
      "Authenticated endpoint did not match the registered instance, full process identity or versions.",
    );
  record.state = reply.state as RuntimeRecord["state"];
}
async function spawnServer(root: string, port: number): Promise<Result> {
  const module = new URL(
    import.meta.url.endsWith(".ts") ? "./server.ts" : "./server.js",
    import.meta.url,
  );
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(module), root, String(port)], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: process.env,
    });
    const timeout = setTimeout(() => {
      child.disconnect();
      child.unref();
      resolve(
        failure(
          runtimeError(
            "unavailable",
            "RUNTIME_UNAVAILABLE",
            "Startup readiness timed out. Inspect web status before retrying.",
          ),
        ),
      );
    }, 30000);
    const finish = (result: Result) => {
      clearTimeout(timeout);
      child.unref();
      resolve(result);
    };
    child.once("message", (message) => finish(message as Result));
    child.once("error", () =>
      finish(
        failure(
          runtimeError("unavailable", "RUNTIME_UNAVAILABLE", "Cannot launch the server process."),
        ),
      ),
    );
    child.once("exit", () => {
      finish(
        failure(
          runtimeError("unavailable", "RUNTIME_UNAVAILABLE", "Server exited before readiness."),
        ),
      );
    });
  });
}
export async function webProject(options: {
  project?: string;
  cwd?: string;
  action: "start" | "status" | "stop";
  port?: number;
}): Promise<Result<WebData>> {
  let root: string | undefined;
  let data: WebData | undefined;
  try {
    root = await discoverProject(options);
    if (
      options.port !== undefined &&
      (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)
    )
      throw runtimeError(
        "conflict",
        "WEB_PORT_CONFLICT",
        "Port must be an integer from 1 to 65535.",
      );
    let record = await readRuntime(root);
    if (options.action === "start") {
      if (record && (await observeRuntime(record)) === "ended") {
        const ended = record;
        try {
          await removeRuntime(ended);
          record = null;
        } catch (error) {
          const current = await readRuntime(root);
          if (current?.instanceId === ended.instanceId) throw error;
          record = current;
        }
      }
      if (!record) {
        const launched = await spawnServer(root, options.port ?? 0);
        // Simultaneous launch losers inspect the winning exclusive registration, never start again.
        const deadline = Date.now() + 30000;
        do {
          try {
            record = await readRuntime(root);
          } catch (error) {
            if (Date.now() >= deadline) throw error;
          }
          if (record?.state === "running") break;
          if (launched.status !== "ok" && !record)
            return {
              ...launched,
              data: {
                server: {
                  ...stoppedRecord(root),
                  state: launched.status === "conflict" ? "unknown" : "unavailable",
                },
              },
            };
          await delay(100);
        } while (Date.now() < deadline);
      }
      if (record?.state === "starting") {
        const deadline = Date.now() + 30000;
        while (record.state === "starting" && Date.now() < deadline) {
          await delay(100);
          record = await readRuntime(root);
          if (!record) break;
        }
      }
    }
    if (!record) {
      if (options.action === "start")
        throw runtimeError(
          "unavailable",
          "RUNTIME_UNAVAILABLE",
          "Server disappeared before readiness could be verified. Inspect status before retrying.",
        );
      return ok({ server: stoppedRecord(root) });
    }
    if (options.port && record.baseUrl && Number(new URL(record.baseUrl).port) !== options.port)
      throw runtimeError(
        "conflict",
        "WEB_PORT_CONFLICT",
        "Explicit port differs from the existing server. Stop it deliberately before changing ports.",
      );
    await verified(record);
    const server: ServerRecord = {
      ...stoppedRecord(root),
      state: record.state,
      verified: true,
      instanceId: record.instanceId,
      pid: record.pid,
      applicationVersion: record.applicationVersion,
      controlProtocolVersion: record.controlProtocolVersion,
      baseUrl: record.baseUrl,
    };
    data = { server };
    if (options.action === "stop") {
      await controlRequest(record, "stop", {});
      const deadline = Date.now() + 30000;
      do {
        const remaining = await readRuntime(root);
        if (remaining && remaining.instanceId !== record.instanceId)
          throw runtimeError(
            "conflict",
            "RUNTIME_OWNERSHIP_UNKNOWN",
            "Another registration appeared during shutdown; inspect it.",
          );
        if (!remaining && (await observeRuntime(record)) === "ended")
          return ok({ server: stoppedRecord(root) });
        await delay(100);
      } while (Date.now() < deadline);
      throw runtimeError(
        "unavailable",
        "RUNTIME_UNAVAILABLE",
        "Shutdown or owned-registration release could not be verified before timeout.",
      );
    }
    if (options.action === "start" && record.state !== "running")
      throw runtimeError(
        "unavailable",
        "RUNTIME_UNAVAILABLE",
        "Server is not ready for attachment.",
      );
    if (record.state === "running") {
      const link = await controlRequest(record, "opening-link", {});
      if (
        typeof link.openingLink !== "string" ||
        !link.openingLink.startsWith(`${record.baseUrl}#tbspec-bootstrap=`) ||
        !opaqueToken(link.openingLink.slice(`${record.baseUrl}#tbspec-bootstrap=`.length)) ||
        typeof link.openingLinkExpiresAt !== "string" ||
        !Number.isFinite(Date.parse(link.openingLinkExpiresAt))
      )
        throw runtimeError(
          "unavailable",
          "RUNTIME_UNAVAILABLE",
          "Server returned an unusable opening link.",
        );
      server.openingLink = link.openingLink;
      server.openingLinkExpiresAt = link.openingLinkExpiresAt;
    }
    return ok(data);
  } catch (error) {
    const result = failure(error);
    return {
      ...result,
      data:
        data ??
        (root
          ? {
              server: {
                ...stoppedRecord(root),
                state: result.status === "unavailable" ? "unavailable" : "unknown",
              },
            }
          : null),
    };
  }
}
