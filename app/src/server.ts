import { readdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { AuthoringOptions } from "./authoring.ts";
import { canonical } from "./canonical.ts";
import type { ModelTypeConfigurationOptions } from "./configuration.ts";
import type { DependencyWorkerRequest } from "./dependency-worker.ts";
import { listDesigns, showDesign } from "./designs.ts";
import type { EditingOptions } from "./editing.ts";
import type { InspectionCommand } from "./inspection.ts";
import type { AuthoringRequest, InspectionResponse } from "./inspection-worker.ts";
import { withLock } from "./lock.ts";
import { exits, failure, hasCode, ok, ProjectError, type Result } from "./output.ts";
import { token } from "./ownership.ts";
import { cleanupPreviews } from "./previews.ts";
import type { QueryOperation, QueryRevisions } from "./query.ts";
import { opaqueToken } from "./recovery.ts";
import type { LifecycleOptions, LifecycleResourceKind } from "./resource-lifecycle.ts";
import {
  claimRuntime,
  type RuntimeRecord,
  removeRuntime,
  replaceRuntime,
  runtimeError,
  runtimeProcess,
} from "./runtime.ts";
import { listViews, showView, type ViewOptions } from "./views.ts";

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
  result: Result<unknown> | InspectionResponse,
  status = httpStatus[result.status],
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end("json" in result ? result.json : JSON.stringify(result));
}
async function jsonBody(request: IncomingMessage, limit = 16384): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json")
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Expected application/json.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > limit)
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
function expectedQueryRevisions(value: unknown): QueryRevisions {
  const invalid = () =>
    new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Query mutations require valid reviewed file revisions.",
    );
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const revisions = value as Record<string, unknown>;
  if (Object.keys(revisions).sort().join(",") !== "parameters,query") throw invalid();
  const parse = (entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid();
    const revision = entry as Record<string, unknown>;
    if (revision.state === "absent" && Object.keys(revision).length === 1)
      return { state: "absent" } as const;
    if (
      revision.state === "present" &&
      Object.keys(revision).sort().join(",") === "digest,state" &&
      typeof revision.digest === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(revision.digest)
    )
      return { state: "present", digest: revision.digest } as const;
    throw invalid();
  };
  return { query: parse(revisions.query), parameters: parse(revisions.parameters) };
}
function expectedViewRevision(value: unknown): ViewOptions["viewRevision"] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "View edits require captured file revisions.",
    );
  const revision = value as Record<string, unknown>;
  if (
    Object.keys(revision).sort().join(",") !== "digest,state" ||
    revision.state !== "present" ||
    typeof revision.digest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(revision.digest)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "View edits require captured file revisions.",
    );
  return revision as unknown as ViewOptions["viewRevision"];
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
  const previewWarnings = await cleanupPreviews(root);
  const bootstraps = new Map<string, number>();
  const sessions = new Map<string, number>();
  const consoles = new Map<ServerResponse, number>();
  const recent: { type: "state" | "log"; data: Record<string, unknown> }[] = [];
  const jobs = new Set<Promise<Result | InspectionResponse>>();
  const dependencyJobs = new Set<Promise<Result>>();
  const dependencyRequests = new Map<string, (result: Result) => void>();
  const activeDependencyOperations = new Map<string, string>();
  let dependencyWorkerFailed = false;
  const dependencyWorker = new Worker(
    new URL(
      import.meta.url.endsWith(".ts") ? "./dependency-worker.ts" : "./dependency-worker.js",
      import.meta.url,
    ),
    { resourceLimits: { maxOldGenerationSizeMb: 512 } },
  );
  const dependencyWorkerReady = new Promise<void>((resolve, reject) => {
    const failDependencyWorker = () => {
      dependencyWorkerFailed = true;
      for (const finish of dependencyRequests.values())
        finish(
          failure(
            new ProjectError("unavailable", "IO_FAILURE", "Dependency worker ended unexpectedly."),
          ),
        );
      dependencyRequests.clear();
    };
    dependencyWorker.on(
      "message",
      (message: { ready?: boolean; requestId?: string; json?: string }) => {
        if (message.ready) {
          resolve();
          return;
        }
        const requestId = message.requestId;
        const finish = requestId ? dependencyRequests.get(requestId) : undefined;
        if (!requestId || !finish || !message.json) return;
        dependencyRequests.delete(requestId);
        try {
          finish(JSON.parse(message.json) as Result);
        } catch {
          finish(
            failure(
              new ProjectError(
                "unavailable",
                "IO_FAILURE",
                "Dependency worker returned an invalid result.",
              ),
            ),
          );
        }
      },
    );
    dependencyWorker.once("error", (error) => {
      failDependencyWorker();
      reject(error);
    });
    dependencyWorker.once("exit", () => {
      if (record.state !== "stopping") {
        failDependencyWorker();
        reject(new Error("Dependency worker ended before server shutdown."));
      }
    });
    dependencyWorker.on("error", failDependencyWorker);
  });
  // The worker is created once per server instance and remains independent from inspection jobs.
  let workerFailed = false;
  let workerReady = Promise.resolve();
  function createWorker(): Worker {
    const current = new Worker(
      new URL(
        import.meta.url.endsWith(".ts") ? "./inspection-worker.ts" : "./inspection-worker.js",
        import.meta.url,
      ),
      // shortcut: this old-generation limit is provisional, recalibrate with representative projects.
      { resourceLimits: { maxOldGenerationSizeMb: 512 } },
    );
    workerFailed = false;
    current.on("error", () => {
      workerFailed = true;
    });
    current.on("exit", () => {
      workerFailed = true;
    });
    workerReady = new Promise<void>((resolve, reject) => {
      const ended = () => reject(new Error("Inspection worker ended before readiness."));
      current.once("message", () => {
        current.off("error", reject);
        current.off("exit", ended);
        resolve();
      });
      current.once("error", reject);
      current.once("exit", ended);
    });
    return current;
  }
  let worker = createWorker();
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
  async function inspect(
    command: InspectionCommand,
    selector?: string,
    authoring?: AuthoringRequest,
    query?: QueryOperation,
  ): Promise<Result | InspectionResponse> {
    if (jobs.size >= 1)
      return failure(
        new ProjectError(
          "conflict",
          "PROJECT_BUSY",
          "Inspection capacity is busy; retry after it finishes.",
        ),
      );
    let finish: (result: Result | InspectionResponse) => void = () => {};
    const failed = () =>
      finish(
        failure(
          new ProjectError(
            "unavailable",
            "IO_FAILURE",
            authoring
              ? "Resource worker ended unexpectedly. Inspect project files before any new write; do not automatically retry publication."
              : "Inspection worker ended unexpectedly. Retry the read; retained recovery state is never cleared automatically.",
          ),
        ),
      );
    const job = (async () => {
      if (workerFailed) {
        // Reuse normal coordination to refuse retained locks or pending transaction recovery.
        await withLock(root, async () => undefined);
        await worker.terminate();
        previewWarnings.push(...(await cleanupPreviews(root, record.instanceId)));
        worker = createWorker();
        await workerReady;
      }
      return new Promise<Result | InspectionResponse>((resolve) => {
        finish = resolve;
        worker.once("message", finish);
        worker.once("error", failed);
        worker.once("exit", failed);
        worker.postMessage({
          project: root,
          ...(query
            ? { query }
            : {
                command,
                selector,
                authoring: authoring ? { ...authoring, instanceId: record.instanceId } : undefined,
              }),
          warnings: previewWarnings,
        });
      });
    })();
    jobs.add(job);
    try {
      return await job;
    } catch (error) {
      return failure(error);
    } finally {
      jobs.delete(job);
      worker.off("message", finish);
      worker.off("error", failed);
      worker.off("exit", failed);
    }
  }
  async function acquire(
    data: Omit<DependencyWorkerRequest, "requestId" | "project" | "instanceId" | "session">,
    session = "",
  ): Promise<Result> {
    try {
      await dependencyWorkerReady;
      if (dependencyWorkerFailed)
        return failure(
          new ProjectError("unavailable", "IO_FAILURE", "Dependency worker is unavailable."),
        );
      if (data.operationId) {
        const owner = activeDependencyOperations.get(data.operationId);
        if (owner !== undefined && owner !== session)
          return failure(
            new ProjectError(
              "conflict",
              "OPERATION_OWNERSHIP",
              "Dependency operation belongs to another session.",
            ),
          );
        activeDependencyOperations.set(data.operationId, session);
      }
      const requestId = token();
      const job = new Promise<Result>((resolve) => {
        dependencyRequests.set(requestId, resolve);
        dependencyWorker.postMessage({
          ...data,
          requestId,
          project: root,
          instanceId: record.instanceId,
          session,
        } satisfies DependencyWorkerRequest);
      });
      dependencyJobs.add(job);
      try {
        return await job;
      } finally {
        dependencyJobs.delete(job);
      }
    } catch (error) {
      return failure(error);
    } finally {
      if (data.operationId && activeDependencyOperations.get(data.operationId) === session)
        activeDependencyOperations.delete(data.operationId);
    }
  }
  const queryProject = (operation: QueryOperation) =>
    inspect("status", undefined, undefined, operation);
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
      await replaceRuntime({ ...record, state: "stopping" });
      record.state = "stopping";
      log("state", { state: "stopping" });
      bootstraps.clear();
      sessions.clear();
      for (const operationId of activeDependencyOperations.keys())
        dependencyWorker.postMessage({ operation: "abort", operationId });
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeIdleConnections();
      await Promise.allSettled([...jobs, ...dependencyJobs]);
      await worker.terminate();
      await dependencyWorker.terminate();
      previewWarnings.push(...(await cleanupPreviews(root, record.instanceId)));
      for (const warning of previewWarnings) log("log", { ...warning });
      for (const response of consoles.keys()) {
        sendFrame(response, "stop", { state: "stopping" });
        response.end();
      }
      consoles.clear();
      await closed;
      await removeRuntime(record);
      finishStop();
    })().catch((error: unknown) => {
      if (record.state !== "stopping") stopping = undefined;
      throw error;
    });
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
          respond(response, ok(identity(), previewWarnings));
          return;
        }
        if (route === "status" && request.method === "GET") {
          respond(response, ok(identity(), previewWarnings));
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
      } else if (
        (request.method === "GET" || request.method === "POST") &&
        record.state === "running"
      ) {
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
        if (request.method === "GET" && url.pathname === "/api/project/v1/dependencies") {
          respond(response, await acquire({ operation: "list" }, credential ?? ""));
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/project/v1/dependency") {
          const ids = url.searchParams.getAll("id");
          if (ids.length !== 1 || [...url.searchParams.keys()].some((key) => key !== "id"))
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Dependency show requires one ID.",
            );
          respond(
            response,
            await acquire({ operation: "show", id: ids[0] ?? "" }, credential ?? ""),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/project/v1/dependencies/check") {
          const body = await jsonBody(request);
          if (
            Object.keys(body).some((key) => !["id", "operationId"].includes(key)) ||
            (body.id !== undefined && typeof body.id !== "string") ||
            (body.operationId !== undefined &&
              (typeof body.operationId !== "string" ||
                !/^[A-Za-z0-9_-]{16,64}$/.test(body.operationId)))
          )
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Invalid dependency check fields.",
            );
          const operationId = typeof body.operationId === "string" ? body.operationId : token();
          if (activeDependencyOperations.has(operationId))
            throw new ProjectError(
              "conflict",
              "OPERATION_OWNERSHIP",
              "Dependency operation ID is already active.",
            );
          activeDependencyOperations.set(operationId, credential ?? "");
          respond(
            response,
            await acquire(
              {
                operation: "check",
                ...(typeof body.id === "string" ? { id: body.id } : {}),
                operationId,
              },
              credential ?? "",
            ),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/project/v1/dependencies/select") {
          const body = await jsonBody(request);
          if (
            Object.keys(body).some((key) => !["ontologyIri", "id"].includes(key)) ||
            typeof body.ontologyIri !== "string" ||
            typeof body.id !== "string"
          )
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Dependency select requires an ontology IRI and ID.",
            );
          respond(
            response,
            await acquire(
              { operation: "select", ontologyIri: body.ontologyIri, id: body.id },
              credential ?? "",
            ),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/project/v1/dependencies/clear") {
          const body = await jsonBody(request);
          if (Object.keys(body).length !== 1 || typeof body.ontologyIri !== "string")
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Dependency clear requires an ontology IRI.",
            );
          respond(
            response,
            await acquire({ operation: "clear", ontologyIri: body.ontologyIri }, credential ?? ""),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/project/v1/dependencies/inspect") {
          const body = await jsonBody(request);
          if (
            Object.keys(body).some(
              (key) => !["source", "ref", "resource", "operationId"].includes(key),
            ) ||
            typeof body.source !== "string" ||
            ["ref", "resource", "operationId"].some(
              (key) => body[key] !== undefined && typeof body[key] !== "string",
            ) ||
            (body.operationId !== undefined &&
              !/^[A-Za-z0-9_-]{16,64}$/.test(body.operationId as string))
          )
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Invalid dependency inspect fields.",
            );
          const operationId = typeof body.operationId === "string" ? body.operationId : token();
          if (activeDependencyOperations.has(operationId))
            throw new ProjectError(
              "conflict",
              "OPERATION_OWNERSHIP",
              "Dependency operation ID is already active.",
            );
          activeDependencyOperations.set(operationId, credential ?? "");
          respond(
            response,
            await acquire(
              {
                operation: "inspect",
                source: body.source,
                ...(typeof body.ref === "string" ? { ref: body.ref } : {}),
                ...(typeof body.resource === "string" ? { resource: body.resource } : {}),
                operationId,
              },
              credential ?? "",
            ),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/project/v1/dependencies/add") {
          const body = await jsonBody(request);
          if (
            Object.keys(body).some(
              (key) => !["id", "source", "kind", "ref", "resource", "operationId"].includes(key),
            ) ||
            typeof body.id !== "string" ||
            typeof body.source !== "string" ||
            (body.kind !== "ontology" && body.kind !== "model" && body.kind !== "design") ||
            ["ref", "resource", "operationId"].some(
              (key) => body[key] !== undefined && typeof body[key] !== "string",
            ) ||
            (body.operationId !== undefined &&
              !/^[A-Za-z0-9_-]{16,64}$/.test(body.operationId as string))
          )
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Invalid dependency add fields.",
            );
          const operationId = typeof body.operationId === "string" ? body.operationId : token();
          if (activeDependencyOperations.has(operationId))
            throw new ProjectError(
              "conflict",
              "OPERATION_OWNERSHIP",
              "Dependency operation ID is already active.",
            );
          activeDependencyOperations.set(operationId, credential ?? "");
          respond(
            response,
            await acquire(
              {
                operation: "preview",
                id: body.id,
                source: body.source,
                kind: body.kind,
                ...(typeof body.ref === "string" ? { ref: body.ref } : {}),
                ...(typeof body.resource === "string" ? { resource: body.resource } : {}),
                operationId,
              },
              credential ?? "",
            ),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/project/v1/dependencies/apply") {
          const body = await jsonBody(request);
          if (
            Object.keys(body).some((key) => !["handle", "fingerprint"].includes(key)) ||
            typeof body.handle !== "string" ||
            typeof body.fingerprint !== "string"
          )
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Invalid dependency apply fields.",
            );
          respond(
            response,
            await acquire(
              { operation: "apply", handle: body.handle, fingerprint: body.fingerprint },
              credential ?? "",
            ),
          );
          return;
        }
        if (request.method === "POST" && url.pathname === "/api/project/v1/dependencies/cancel") {
          const body = await jsonBody(request);
          if (
            Object.keys(body).length !== 1 ||
            (typeof body.operationId !== "string" && typeof body.handle !== "string") ||
            (body.operationId !== undefined &&
              (typeof body.operationId !== "string" ||
                !/^[A-Za-z0-9_-]{16,64}$/.test(body.operationId))) ||
            (body.handle !== undefined && typeof body.handle !== "string")
          )
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Cancellation requires one operation ID or preview handle.",
            );
          if (typeof body.operationId === "string") {
            if (activeDependencyOperations.get(body.operationId) !== credential) {
              respond(response, ok({ cancelling: false }));
              return;
            }
            dependencyWorker.postMessage({ operation: "abort", operationId: body.operationId });
            respond(response, ok({ cancelling: true }));
          } else {
            respond(
              response,
              await acquire({ operation: "cancel", handle: body.handle }, credential ?? ""),
            );
          }
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/project/v1/queries") {
          respond(response, await queryProject({ action: "list" }));
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/project/v1/query") {
          const names = url.searchParams.getAll("name");
          if (names.length !== 1 || [...url.searchParams.keys()].some((key) => key !== "name"))
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Query show requires one name.",
            );
          respond(response, await queryProject({ action: "show", name: names[0] ?? "" }));
          return;
        }
        if (request.method === "POST" && url.pathname.startsWith("/api/project/v1/query/")) {
          const action = url.pathname.slice("/api/project/v1/query/".length);
          const body = await jsonBody(request, 4194304);
          if (action === "save") {
            if (
              Object.keys(body).some(
                (key) =>
                  !["name", "queryText", "parametersText", "expectedRevisions"].includes(key),
              ) ||
              typeof body.name !== "string" ||
              typeof body.queryText !== "string" ||
              (body.parametersText !== undefined && typeof body.parametersText !== "string")
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                "Invalid saved-query fields.",
              );
            const expectedRevisions = expectedQueryRevisions(body.expectedRevisions);
            respond(
              response,
              await queryProject({
                action: "save",
                name: body.name,
                queryText: body.queryText,
                expectedRevisions,
                ...(typeof body.parametersText === "string"
                  ? { parametersText: body.parametersText }
                  : {}),
              }),
            );
            return;
          }
          if (action === "run") {
            if (
              Object.keys(body).some(
                (key) => !["queryText", "saved", "graph", "bindingsText"].includes(key),
              ) ||
              (body.queryText !== undefined && typeof body.queryText !== "string") ||
              (body.saved !== undefined && typeof body.saved !== "string") ||
              (body.graph !== undefined && typeof body.graph !== "string") ||
              (body.bindingsText !== undefined && typeof body.bindingsText !== "string")
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                "Invalid query-run fields.",
              );
            respond(
              response,
              await queryProject({
                action: "run",
                ...(typeof body.queryText === "string" ? { queryText: body.queryText } : {}),
                ...(typeof body.saved === "string" ? { saved: body.saved } : {}),
                ...(typeof body.graph === "string" ? { graph: body.graph } : {}),
                ...(typeof body.bindingsText === "string"
                  ? { bindingsText: body.bindingsText }
                  : {}),
              }),
            );
            return;
          }
          if (action === "remove") {
            if (
              Object.keys(body).some(
                (key) => !["name", "confirm", "expectedRevisions"].includes(key),
              ) ||
              typeof body.name !== "string" ||
              (body.confirm !== undefined && typeof body.confirm !== "boolean")
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                "Invalid query-removal fields.",
              );
            const expectedRevisions = expectedQueryRevisions(body.expectedRevisions);
            respond(
              response,
              await queryProject({
                action: "remove",
                name: body.name,
                expectedRevisions,
                ...(typeof body.confirm === "boolean" ? { confirm: body.confirm } : {}),
              }),
            );
            return;
          }
        }
        if (request.method === "GET" && url.pathname === "/api/project/v1/views") {
          const sources = url.searchParams.getAll("source");
          if (url.searchParams.size > 1 || sources.length > 1)
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "View listing accepts at most one source selector.",
            );
          respond(
            response,
            await listViews({ project: root, ...(sources[0] ? { source: sources[0] } : {}) }),
          );
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/project/v1/designs") {
          if (url.searchParams.size)
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Design listing takes no query parameters.",
            );
          respond(response, await listDesigns({ project: root }));
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/project/v1/design") {
          const selectors = url.searchParams.getAll("selector");
          if (url.searchParams.size !== 1 || selectors.length !== 1)
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Design inspection requires one selector.",
            );
          respond(response, await showDesign({ project: root, selector: selectors[0] ?? "" }));
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/project/v1/view") {
          const selectors = url.searchParams.getAll("selector");
          if (url.searchParams.size !== 1 || selectors.length !== 1)
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "View inspection requires one selector.",
            );
          respond(response, await showView({ project: root, selector: selectors[0] ?? "" }));
          return;
        }
        const routes: Record<string, InspectionCommand> = {
          "/api/project/v1/editor": "editor.show",
          "/api/project/v1/status": "status",
          "/api/project/v1/validate": "validate",
          "/api/project/v1/shapes": "shapes.list",
          "/api/project/v1/model-schemas": "model.schema.list",
          "/api/project/v1/graphs": "graph.list",
          "/api/project/v1/graph": "graph.show",
          "/api/project/v1/config": "config.show",
          "/api/project/v1/model-types": "config.model-type.list",
          "/api/project/v1/ontologies": "ontology.list",
          "/api/project/v1/ontology": "ontology.show",
          "/api/project/v1/models": "model.list",
          "/api/project/v1/model": "model.show",
        };
        const command = routes[url.pathname];
        if (url.pathname === "/api/project/v1/impact" && request.method === "GET") {
          const kinds = url.searchParams.getAll("kind");
          const selectors = url.searchParams.getAll("selector");
          if (
            url.searchParams.size !== 2 ||
            kinds.length !== 1 ||
            selectors.length !== 1 ||
            !["ontology", "model", "design", "shapes", "model-type"].includes(kinds[0] ?? "")
          )
            throw new ProjectError(
              "invalid_arguments",
              "ARGUMENT_INVALID",
              "Impact requires one kind and one exact selector.",
            );
          respond(
            response,
            await inspect("status", undefined, {
              mode: "preview",
              session: credential ?? "",
              impact: {
                kind: kinds[0] as LifecycleResourceKind,
                selector: selectors[0] ?? "",
              },
            }),
          );
          return;
        }
        if (command && request.method === "GET") {
          const result = await inspect(command, url.searchParams.get("selector") ?? undefined);
          respond(response, result);
          log("log", { message: `Inspection ${command}: ${result.status}.` });
          return;
        }
        if (request.method === "POST") {
          const viewRoute = url.pathname.match(
            /^\/api\/project\/v1\/(views\/create|views\/remove|view\/edit)$/,
          );
          if (viewRoute) {
            const body = await jsonBody(request, 65536);
            const action =
              viewRoute[1] === "views/create"
                ? "create"
                : viewRoute[1] === "views/remove"
                  ? "remove"
                  : "edit";
            let views: ViewOptions;
            if (action === "create") {
              if (
                Object.keys(body).some((key) => !["path", "source", "protocol"].includes(key)) ||
                typeof body.path !== "string" ||
                typeof body.source !== "string" ||
                (body.protocol !== undefined && typeof body.protocol !== "string")
              )
                throw new ProjectError(
                  "invalid_arguments",
                  "ARGUMENT_INVALID",
                  "Invalid view-creation fields.",
                );
              views = {
                action,
                path: body.path,
                source: body.source,
                ...(typeof body.protocol === "string" ? { protocol: body.protocol } : {}),
              };
            } else if (action === "remove") {
              if (
                Object.keys(body).some((key) => key !== "selector") ||
                typeof body.selector !== "string"
              )
                throw new ProjectError(
                  "invalid_arguments",
                  "ARGUMENT_INVALID",
                  "Invalid view-removal fields.",
                );
              views = { action, selector: body.selector };
            } else {
              const allowed = [
                "selector",
                "viewRevision",
                "presentationRevision",
                "members",
                "relationships",
                "positions",
                "nodeAppearances",
                "relationshipAppearances",
              ];
              const required = [
                "selector",
                "viewRevision",
                "presentationRevision",
                "members",
                "relationships",
                "positions",
              ];
              if (
                Object.keys(body).some((key) => !allowed.includes(key)) ||
                required.some((key) => body[key] === undefined) ||
                typeof body.selector !== "string" ||
                !Array.isArray(body.members) ||
                body.members.length > 10000 ||
                body.members.some((member) => typeof member !== "string") ||
                !Array.isArray(body.relationships) ||
                body.relationships.length > 10000 ||
                !Array.isArray(body.positions) ||
                body.positions.length > 10000 ||
                (body.nodeAppearances !== undefined &&
                  (!Array.isArray(body.nodeAppearances) || body.nodeAppearances.length > 10000)) ||
                (body.relationshipAppearances !== undefined &&
                  (!Array.isArray(body.relationshipAppearances) ||
                    body.relationshipAppearances.length > 10000))
              )
                throw new ProjectError(
                  "invalid_arguments",
                  "ARGUMENT_INVALID",
                  "Invalid view-edit fields.",
                );
              for (const tuple of body.relationships) {
                if (
                  !tuple ||
                  typeof tuple !== "object" ||
                  Array.isArray(tuple) ||
                  Object.keys(tuple).sort().join(",") !== "object,predicate,subject" ||
                  ["subject", "predicate", "object"].some(
                    (key) => typeof (tuple as Record<string, unknown>)[key] !== "string",
                  )
                )
                  throw new ProjectError(
                    "invalid_arguments",
                    "ARGUMENT_INVALID",
                    "View relationship selections require exact IRI tuples.",
                  );
              }
              for (const position of body.positions) {
                if (
                  !position ||
                  typeof position !== "object" ||
                  Array.isArray(position) ||
                  Object.keys(position).sort().join(",") !== "element,x,y" ||
                  ["element", "x", "y"].some(
                    (key) => typeof (position as Record<string, unknown>)[key] !== "string",
                  )
                )
                  throw new ProjectError(
                    "invalid_arguments",
                    "ARGUMENT_INVALID",
                    "View positions require an IRI and string coordinates.",
                  );
              }
              const validateAppearance = (
                candidate: unknown,
                identifiers: string[],
                appearanceFields: string[],
              ) => {
                if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
                  return false;
                const row = candidate as Record<string, unknown>;
                if (
                  Object.keys(row).some(
                    (key) => ![...identifiers, ...appearanceFields].includes(key),
                  ) ||
                  identifiers.some((key) => typeof row[key] !== "string")
                )
                  return false;
                for (const [key, value] of Object.entries(row)) {
                  if (identifiers.includes(key) || value === null || typeof value === "string")
                    continue;
                  if (
                    key === "labelText" &&
                    value &&
                    typeof value === "object" &&
                    !Array.isArray(value) &&
                    Object.keys(value).every((field) => ["value", "language"].includes(field)) &&
                    typeof (value as Record<string, unknown>).value === "string" &&
                    ((value as Record<string, unknown>).language === undefined ||
                      typeof (value as Record<string, unknown>).language === "string")
                  )
                    continue;
                  return false;
                }
                return true;
              };
              const nodeFields = [
                "nodeShape",
                "fillColor",
                "strokeColor",
                "textColor",
                "strokeWidth",
                "fontFamily",
                "fontSize",
                "fontWeight",
                "fontStyle",
                "lineStyle",
                "labelMode",
                "labelProperty",
                "labelText",
                "chosenRule",
                "group",
              ];
              const edgeFields = [
                "strokeColor",
                "textColor",
                "strokeWidth",
                "fontFamily",
                "fontSize",
                "fontWeight",
                "fontStyle",
                "lineStyle",
                "edgeRouting",
                "arrowHead",
                "labelMode",
                "labelProperty",
                "labelText",
                "chosenRule",
              ];
              if (
                (body.nodeAppearances as unknown[] | undefined)?.some(
                  (item) => !validateAppearance(item, ["element"], nodeFields),
                ) ||
                (body.relationshipAppearances as unknown[] | undefined)?.some(
                  (item) =>
                    !validateAppearance(item, ["subject", "predicate", "object"], edgeFields),
                )
              )
                throw new ProjectError(
                  "invalid_arguments",
                  "ARGUMENT_INVALID",
                  "Presentation overrides contain an unsupported field or value type.",
                );
              views = {
                action,
                selector: body.selector,
                viewRevision: expectedViewRevision(body.viewRevision),
                presentationRevision: expectedViewRevision(body.presentationRevision),
                members: body.members as string[],
                relationships: body.relationships as ViewOptions["relationships"],
                positions: body.positions as ViewOptions["positions"],
                ...(Array.isArray(body.nodeAppearances)
                  ? { nodeAppearances: body.nodeAppearances as ViewOptions["nodeAppearances"] }
                  : {}),
                ...(Array.isArray(body.relationshipAppearances)
                  ? {
                      relationshipAppearances:
                        body.relationshipAppearances as ViewOptions["relationshipAppearances"],
                    }
                  : {}),
              };
            }
            respond(
              response,
              await inspect("status", undefined, {
                mode: "preview",
                session: credential ?? "",
                views,
              }),
            );
            return;
          }
          const lifecycleRoute = url.pathname.match(
            /^\/api\/project\/v1\/resources\/(remove|move)$/,
          );
          if (lifecycleRoute) {
            const action = lifecycleRoute[1] as "remove" | "move";
            const body = await jsonBody(request);
            const required =
              action === "remove" ? ["kind", "selector"] : ["selector", "destination"];
            if (
              Object.keys(body).some((key) => !required.includes(key)) ||
              required.some((key) => body[key] === undefined) ||
              typeof body.selector !== "string" ||
              (action === "remove" &&
                (typeof body.kind !== "string" ||
                  !["ontology", "model", "design", "shapes", "model-type"].includes(body.kind))) ||
              (action === "move" && typeof body.destination !== "string")
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                `Invalid resource ${action} fields.`,
              );
            const lifecycle = {
              action,
              selector: body.selector,
              ...(typeof body.kind === "string"
                ? { kind: body.kind as LifecycleResourceKind }
                : {}),
              ...(typeof body.destination === "string" ? { destination: body.destination } : {}),
            } as LifecycleOptions & { action: "remove" | "move" };
            respond(
              response,
              await inspect("status", undefined, {
                mode: "preview",
                session: credential ?? "",
                lifecycle,
              }),
            );
            return;
          }
          if (url.pathname === "/api/project/v1/model-types/configure") {
            const body = await jsonBody(request);
            const commands = [
              "config.model-type.set",
              "config.model-type.disable",
              "config.model-type.enable",
              "config.model-type.reset",
              "config.model-type.design.set",
              "config.model-type.design.clear",
            ];
            const expectedFields =
              body.command === "config.model-type.set"
                ? ["command", "name", "ontology"]
                : body.command === "config.model-type.design.set"
                  ? ["command", "name", "design"]
                  : ["command", "name"];
            if (
              Object.keys(body).some((key) => !expectedFields.includes(key)) ||
              expectedFields.some((key) => body[key] === undefined) ||
              typeof body.command !== "string" ||
              !commands.includes(body.command) ||
              typeof body.name !== "string" ||
              ["ontology", "design"].some(
                (key) => body[key] !== undefined && typeof body[key] !== "string",
              )
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                "Invalid model-type configuration fields.",
              );
            respond(
              response,
              await inspect("status", undefined, {
                mode: "preview",
                session: credential ?? "",
                configuration: body as unknown as ModelTypeConfigurationOptions,
              }),
            );
            return;
          }
          if (url.pathname === "/api/project/v1/editor/save") {
            const body = await jsonBody(request, 67108864);
            if (
              Object.keys(body).some(
                (k) => !["selector", "revision", "sourceText", "edits", "creation"].includes(k),
              ) ||
              typeof body.selector !== "string"
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                "Invalid editor save fields.",
              );
            respond(
              response,
              await inspect("status", undefined, {
                mode: "preview",
                session: credential ?? "",
                editing: body as unknown as EditingOptions,
              }),
            );
            return;
          }
          const action = url.pathname.match(
            /^\/api\/project\/v1\/(ontology|model|design|shapes|model\/schema)\/(create|import|select|clear|add|remove)$/,
          );
          const cancellation = url.pathname === "/api/project/v1/resource/cancel";
          if (action || url.pathname === "/api/project/v1/resource/apply" || cancellation) {
            const body = await jsonBody(request);
            if (!action) {
              if (
                Object.keys(body).some(
                  (key) =>
                    !(
                      cancellation
                        ? ["schemaVersion", "handle"]
                        : ["schemaVersion", "handle", "fingerprint", "accept"]
                    ).includes(key),
                ) ||
                body.schemaVersion !== 1 ||
                typeof body.handle !== "string" ||
                (!cancellation &&
                  (typeof body.fingerprint !== "string" ||
                    !Array.isArray(body.accept) ||
                    body.accept.some((flag) => typeof flag !== "string")))
              )
                throw new ProjectError(
                  "invalid_arguments",
                  "ARGUMENT_INVALID",
                  "Import application requires schemaVersion 1, handle, fingerprint and accepted flags.",
                );
              respond(
                response,
                await inspect("status", undefined, {
                  mode: cancellation ? "cancel" : "apply",
                  session: credential ?? "",
                  fingerprint: body.fingerprint as string | undefined,
                  handle: body.handle,
                  accept: body.accept as string[] | undefined,
                }),
              );
              return;
            }
            if (
              Object.keys(body).some(
                (key) => !["path", "source", "iri", "type", "profile", "schemas"].includes(key),
              ) ||
              typeof body.path !== "string" ||
              ["source", "iri", "type", "profile"].some(
                (key) => body[key] !== undefined && typeof body[key] !== "string",
              ) ||
              (body.schemas !== undefined &&
                (!Array.isArray(body.schemas) ||
                  body.schemas.some((item) => typeof item !== "string")))
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                "Invalid resource authoring fields.",
              );
            const options = {
              ...body,
              command: `${action[1]?.replaceAll("/", ".")}.${action[2]}`,
            } as unknown as AuthoringOptions;
            if (
              ![
                "ontology.create",
                "ontology.import",
                "model.create",
                "model.import",
                "shapes.create",
                "design.create",
                "design.import",
                "design.select",
                "design.clear",
                "model.schema.add",
                "model.schema.remove",
              ].includes(options.command)
            )
              throw new ProjectError(
                "invalid_arguments",
                "ARGUMENT_INVALID",
                "Unknown resource operation.",
              );
            respond(
              response,
              await inspect("status", undefined, {
                mode: "preview",
                session: credential ?? "",
                options,
              }),
            );
            return;
          }
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
    await Promise.all([workerReady, dependencyWorkerReady]);
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
    for (const warning of previewWarnings) log("log", { ...warning });
    return { record, stopped, stop };
  } catch (error) {
    server.close();
    await worker.terminate();
    await dependencyWorker.terminate();
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
