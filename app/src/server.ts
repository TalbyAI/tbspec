import { readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { canonical } from "./canonical.ts";
import type { InspectionCommand } from "./inspection.ts";
import { exits, failure, hasCode, ok, ProjectError, type Result } from "./output.ts";
import { token } from "./ownership.ts";
import { opaqueToken } from "./recovery.ts";
import {
  claimRuntime,
  type RuntimeRecord,
  removeRuntime,
  replaceRuntime,
  runtimeError,
  runtimeProcess,
} from "./runtime.ts";

interface Frame {
  protocolVersion: 1;
  instanceId: string;
  sequence: number;
  type: "log" | "state" | "detach" | "stop";
  data: Record<string, unknown>;
}
const httpStatus = {
  ok: 200,
  preview: 200,
  invalid: 422,
  invalid_arguments: 400,
  conflict: 409,
  unavailable: 503,
};
function respond(
  response: ServerResponse,
  result: Result<unknown>,
  status = httpStatus[result.status],
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(result));
}
async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json")
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Expected application/json.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 16384)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Request body exceeds the limit.",
      );
    chunks.push(bytes);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const body: unknown = JSON.parse(text);
    const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}[\],:]/g) ?? [];
    const scopes: (Set<string> | null)[] = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token === "{") scopes.push(new Set());
      else if (token === "[") scopes.push(null);
      else if (token === "}" || token === "]") scopes.pop();
      else if (token?.startsWith('"') && tokens[index + 1] === ":") {
        const key = JSON.parse(token) as string;
        if (scopes.at(-1)?.has(key)) throw new Error("Duplicate JSON key.");
        scopes.at(-1)?.add(key);
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid object.");
    return body as Record<string, unknown>;
  } catch {
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Expected a UTF-8 JSON object with unique field names.",
    );
  }
}
async function installedAssets(): Promise<Map<string, { bytes: Buffer; type: string }>> {
  const assets = new Map<string, { bytes: Buffer; type: string }>();
  const root = new URL("../dist/web/", import.meta.url);
  async function walk(directory: string) {
    for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) await walk(`${path}/`);
      else if (entry.isFile())
        assets.set(`/${path}`, {
          bytes: await readFile(new URL(path, root)),
          type:
            (
              {
                ".html": "text/html; charset=utf-8",
                ".js": "text/javascript; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".svg": "image/svg+xml",
              } as Record<string, string>
            )[extname(path)] ?? "application/octet-stream",
        });
    }
  }
  await walk("");
  if (!assets.has("/index.html"))
    throw new Error("Installed web assets are missing. Build the application before starting web.");
  return assets;
}
export async function startWebServer(
  root: string,
  port = 0,
  clock: () => number = Date.now,
): Promise<{ record: RuntimeRecord; stopped: Promise<void>; stop: () => Promise<void> }> {
  // Capture this release's assets before readiness; replacing installed files never mixes releases.
  const assets = await installedAssets();
  const record = await claimRuntime(root);
  const bootstraps = new Map<string, number>();
  const sessions = new Map<string, number>();
  const consoles = new Map<ServerResponse, number>();
  const recent: { type: "state" | "log"; data: Record<string, unknown> }[] = [];
  const jobs = new Set<Promise<Result>>();
  const worker = new Worker(
    new URL(
      import.meta.url.endsWith(".ts") ? "./inspection-worker.ts" : "./inspection-worker.js",
      import.meta.url,
    ),
    { resourceLimits: { maxOldGenerationSizeMb: 256 } },
  );
  let workerFailed = false;
  worker.on("error", () => {
    workerFailed = true;
  });
  worker.on("exit", () => {
    workerFailed = true;
  });
  const workerReady = new Promise<void>((resolve, reject) => {
    worker.once("message", () => resolve());
    worker.once("error", reject);
  });
  let finishStop: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    finishStop = resolve;
  });
  let stopping: Promise<void> | undefined;
  const identity = () => ({
    protocolVersion: 1,
    projectRoot: root,
    instanceId: record.instanceId,
    process: runtimeProcess(record),
    applicationVersion: record.applicationVersion,
    controlProtocolVersion: record.controlProtocolVersion,
    jsonSchemaVersion: record.jsonSchemaVersion,
    state: record.state,
    baseUrl: record.baseUrl,
  });
  function sendFrame(response: ServerResponse, type: Frame["type"], data: Record<string, unknown>) {
    const sequence = (consoles.get(response) ?? 0) + 1;
    consoles.set(response, sequence);
    const frame: Frame = {
      protocolVersion: 1,
      instanceId: record.instanceId,
      sequence,
      type,
      data,
    };
    if (!response.write(`${JSON.stringify(frame)}\n`)) response.destroy();
  }
  function log(type: "log" | "state", data: Record<string, unknown>) {
    recent.push({ type, data });
    if (recent.length > 100) recent.shift();
    for (const response of consoles.keys()) sendFrame(response, type, data);
  }
  function openingLink() {
    const now = clock();
    for (const [key, expiry] of bootstraps) if (expiry <= now) bootstraps.delete(key);
    if (bootstraps.size >= 100) bootstraps.delete(bootstraps.keys().next().value ?? "");
    const bootstrap = token();
    const expires = now + 60000;
    bootstraps.set(bootstrap, expires);
    return {
      openingLink: `${record.baseUrl}#tbspec-bootstrap=${bootstrap}`,
      openingLinkExpiresAt: new Date(expires).toISOString(),
    };
  }
  async function inspect(command: InspectionCommand, selector?: string): Promise<Result> {
    if (workerFailed)
      return failure(
        new ProjectError(
          "unavailable",
          "IO_FAILURE",
          "Inspection worker is unavailable. Stop and restart this server.",
        ),
      );
    if (jobs.size >= 1)
      return failure(
        new ProjectError(
          "conflict",
          "PROJECT_BUSY",
          "Inspection capacity is busy; retry after it finishes.",
        ),
      );
    let finish: (result: Result) => void = () => {};
    const failed = () =>
      finish(
        failure(
          new ProjectError(
            "unavailable",
            "IO_FAILURE",
            "Inspection worker ended unexpectedly. Stop and restart this server.",
          ),
        ),
      );
    const job = new Promise<Result>((resolve) => {
      finish = resolve;
    });
    worker.once("message", finish);
    worker.once("error", failed);
    worker.once("exit", failed);
    jobs.add(job);
    worker.postMessage({ project: root, command, selector });
    try {
      return await job;
    } finally {
      jobs.delete(job);
      worker.off("message", finish);
      worker.off("error", failed);
      worker.off("exit", failed);
    }
  }
  const server = createServer((request, response) => {
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Cache-Control", "no-store");
    void handle(request, response).catch((error) => {
      if (!response.headersSent) respond(response, failure(error));
      else response.destroy();
    });
  });
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      record.state = "stopping";
      await replaceRuntime(record);
      log("state", { state: "stopping" });
      bootstraps.clear();
      sessions.clear();
      for (const response of consoles.keys()) {
        sendFrame(response, "stop", { state: "stopping" });
        response.end();
      }
      consoles.clear();
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      await Promise.allSettled([...jobs]);
      await worker.terminate();
      await closed;
      await removeRuntime(record);
      finishStop();
    })();
    return stopping;
  };
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const authority = new URL(record.baseUrl ?? "http://127.0.0.1/").host;
    const origin = new URL(record.baseUrl ?? "http://127.0.0.1/").origin;
    const headerCount = (name: string) =>
      request.rawHeaders.filter(
        (_, i) => i % 2 === 0 && request.rawHeaders[i]?.toLowerCase() === name,
      ).length;
    if (
      headerCount("host") !== 1 ||
      request.headers.host !== authority ||
      headerCount("origin") > 1 ||
      (request.headers.origin !== undefined && request.headers.origin !== origin)
    ) {
      respond(
        response,
        failure(
          new ProjectError(
            "invalid_arguments",
            "RUNTIME_AUTH_FAILED",
            "Request destination or origin rejected.",
          ),
        ),
        403,
      );
      return;
    }
    if (!request.url?.startsWith("/") || request.url.startsWith("//")) {
      respond(
        response,
        failure(
          new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Invalid request target."),
        ),
      );
      return;
    }
    const url = new URL(request.url, record.baseUrl ?? origin);
    if (url.pathname === "/api/auth/v1/bootstrap") {
      if (request.method !== "POST" || request.headers.origin !== origin) {
        respond(
          response,
          failure(
            new ProjectError(
              "invalid_arguments",
              "RUNTIME_AUTH_FAILED",
              "Bootstrap requires an exact same-origin POST.",
            ),
          ),
          403,
        );
        return;
      }
      const body = await jsonBody(request);
      const expiry =
        typeof body.bootstrap === "string" ? bootstraps.get(body.bootstrap) : undefined;
      if (
        body.protocolVersion !== 1 ||
        !opaqueToken(body.bootstrap) ||
        !expiry ||
        expiry <= clock() ||
        record.state !== "running"
      ) {
        respond(
          response,
          failure(
            new ProjectError(
              "unavailable",
              "RUNTIME_AUTH_FAILED",
              "Opening link is expired or already used. Obtain a fresh link with tbspec web status.",
            ),
          ),
          401,
        );
        return;
      }
      bootstraps.delete(body.bootstrap);
      for (const [key, expiry] of sessions) if (expiry <= clock()) sessions.delete(key);
      if (sessions.size >= 1000) {
        respond(
          response,
          failure(
            runtimeError(
              "unavailable",
              "RUNTIME_UNAVAILABLE",
              "Browser session capacity exceeded.",
            ),
          ),
        );
        return;
      }
      const sessionToken = token();
      const expires = clock() + 12 * 60 * 60 * 1000;
      sessions.set(sessionToken, expires);
      respond(
        response,
        ok({
          instanceId: record.instanceId,
          sessionToken,
          expiresAt: new Date(expires).toISOString(),
        }),
      );
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const credential = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const control = url.pathname.startsWith("/api/control/v1/");
      const authorized = control
        ? credential === record.controlToken
        : credential !== undefined && (sessions.get(credential) ?? 0) > clock();
      if (!authorized) {
        respond(
          response,
          failure(
            new ProjectError("unavailable", "RUNTIME_AUTH_FAILED", "Authorization required."),
          ),
          401,
        );
        return;
      }
      if (request.method !== "GET" && request.headers.origin !== origin && !control) {
        respond(
          response,
          failure(
            new ProjectError(
              "invalid_arguments",
              "RUNTIME_AUTH_FAILED",
              "Exact same-origin authorization required.",
            ),
          ),
          403,
        );
        return;
      }
      if (control) {
        const route = url.pathname.slice("/api/control/v1/".length);
        if (route === "handshake" && request.method === "POST") {
          const body = await jsonBody(request);
          if (
            canonical(body) !==
            canonical({
              protocolVersion: 1,
              projectRoot: root,
              instanceId: record.instanceId,
              process: runtimeProcess(record),
            })
          ) {
            respond(
              response,
              failure(
                runtimeError("conflict", "RUNTIME_OWNERSHIP_UNKNOWN", "Control identity mismatch."),
              ),
            );
            return;
          }
          respond(response, ok(identity()));
          return;
        }
        if (route === "status" && request.method === "GET") {
          respond(response, ok(identity()));
          return;
        }
        if (route === "opening-link" && request.method === "POST" && record.state === "running") {
          await jsonBody(request);
          respond(response, ok(openingLink()));
          return;
        }
        if (route === "stop" && request.method === "POST") {
          await jsonBody(request);
          respond(response, ok({ instanceId: record.instanceId, state: "stopping" }));
          void stop().catch(() => {
            log("log", {
              message: "Shutdown incomplete; preserve runtime registration for inspection.",
            });
          });
          return;
        }
        if (route === "console" && request.method === "GET" && record.state === "running") {
          response.writeHead(200, {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-store",
          });
          consoles.set(response, 0);
          sendFrame(response, "state", identity());
          for (const event of recent) sendFrame(response, event.type, event.data);
          response.on("close", () => consoles.delete(response));
          return;
        }
        if (route === "console" && request.method === "POST") {
          const body = await jsonBody(request);
          if (
            body.protocolVersion !== 1 ||
            body.instanceId !== record.instanceId ||
            !Number.isSafeInteger(body.sequence) ||
            (body.type !== "detach" && body.type !== "stop") ||
            !body.data ||
            typeof body.data !== "object"
          ) {
            respond(
              response,
              failure(
                new ProjectError(
                  "invalid_arguments",
                  "ARGUMENT_INVALID",
                  "Invalid console control frame.",
                ),
              ),
            );
            return;
          }
          respond(response, ok({ detached: body.type === "detach" }));
          if (body.type === "stop")
            void stop().catch(() =>
              log("log", { message: "Shutdown incomplete; inspect runtime state." }),
            );
          return;
        }
      } else if (request.method === "GET" && record.state === "running") {
        if (request.headers["x-tbspec-schema-version"] !== "1") {
          respond(
            response,
            failure(
              new ProjectError(
                "invalid_arguments",
                "SCHEMA_UNSUPPORTED",
                "Project APIs require X-Tbspec-Schema-Version: 1.",
              ),
            ),
          );
          return;
        }
        const routes: Record<string, InspectionCommand> = {
          "/api/project/v1/status": "status",
          "/api/project/v1/graphs": "graph.list",
          "/api/project/v1/graph": "graph.show",
          "/api/project/v1/config": "config.show",
          "/api/project/v1/model-types": "config.model-type.list",
        };
        const command = routes[url.pathname];
        if (command) {
          const result = await inspect(command, url.searchParams.get("selector") ?? undefined);
          respond(response, result);
          log("log", { message: `Inspection ${command}: ${result.status}.` });
          return;
        }
      }
      respond(
        response,
        failure(
          new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Endpoint or method is unavailable.",
          ),
        ),
        404,
      );
      return;
    }
    const asset = assets.get(url.pathname === "/" ? "/index.html" : url.pathname);
    if (!asset || (request.method !== "GET" && request.method !== "HEAD")) {
      response.writeHead(404);
      response.end("Not found.");
      return;
    }
    response.writeHead(200, { "Content-Type": asset.type });
    response.end(request.method === "HEAD" ? undefined : asset.bytes);
  }
  try {
    // Load the shared operation modules once, keeping this server tied to its launched release.
    await workerReady;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Invalid loopback listener.");
    record.baseUrl = `http://127.0.0.1:${address.port}/`;
    record.state = "running";
    await replaceRuntime(record);
    log("state", { state: "running", applicationVersion: record.applicationVersion });
    return { record, stopped, stop };
  } catch (error) {
    server.close();
    await worker.terminate();
    await removeRuntime(record).catch(() => {});
    if (hasCode(error, "EADDRINUSE"))
      throw runtimeError(
        "conflict",
        "WEB_PORT_CONFLICT",
        "Requested port is unavailable; no substitute port was selected.",
      );
    throw error;
  }
}

// A detached server retains no console/IPC dependency after publishing readiness.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const root = process.argv[2];
    if (!root) throw new Error("Missing fixed project.");
    const started = await startWebServer(root, Number(process.argv[3] ?? 0));
    process.send?.(ok({ ready: true }));
    process.disconnect?.();
    const requestStop = () => {
      void started.stop().catch(() => {
        process.exitCode = 4;
      });
    };
    process.on("SIGINT", requestStop);
    process.on("SIGTERM", requestStop);
    await started.stopped;
  } catch (error) {
    const result = failure(error);
    process.send?.(result);
    process.disconnect?.();
    process.exitCode = exits[result.status];
  }
}
