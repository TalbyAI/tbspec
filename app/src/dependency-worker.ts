import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import {
  dependencyCheck,
  dependencyClear,
  dependencyInspect,
  dependencyList,
  dependencySelect,
  dependencyShow,
  type PreparedDependency,
  prepareDependencyAdd,
  prepareDependencySupportClear,
  prepareDependencySupportSet,
  prepareDependencyUpdate,
  publishPreparedDependency,
} from "./dependencies.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { token } from "./ownership.ts";
import { safePath } from "./paths.ts";
import { discardPreview, retainedPreview } from "./previews.ts";
import { secureRuntimeDirectory } from "./runtime.ts";

export type DependencyWorkerOperation =
  | "inspect"
  | "list"
  | "show"
  | "check"
  | "select"
  | "clear"
  | "preview"
  | "update-preview"
  | "support-set-preview"
  | "support-clear-preview"
  | "apply"
  | "cancel";
export interface DependencyWorkerRequest {
  requestId: string;
  project: string;
  instanceId: string;
  session: string;
  operation: DependencyWorkerOperation;
  operationId?: string;
  source?: string;
  ref?: string;
  resource?: string;
  id?: string;
  ontologyIri?: string;
  kind?: "ontology" | "model" | "design";
  target?: string;
  role?: "shacl" | "design";
  handle?: string;
  fingerprint?: string;
  accept?: string[];
}
interface StoredPreview {
  prepared: PreparedDependency;
  expires: number;
  session: string;
  instanceId: string;
  workspace: string;
  hasBytes: boolean[];
  timer: ReturnType<typeof setTimeout>;
}
const previews = new Map<string, StoredPreview>();
const controllers = new Map<string, AbortController>();
const aborted = new Map<string, number>();
const cleanupWarnings: ReturnType<typeof retainedPreview>[] = [];
let pending = Promise.resolve();

function takeAbort(operationId: string): boolean {
  const now = Date.now();
  for (const [id, expires] of aborted) if (expires <= now) aborted.delete(id);
  return aborted.delete(operationId);
}

async function discard(handle: string) {
  const preview = previews.get(handle);
  if (!preview) return;
  previews.delete(handle);
  clearTimeout(preview.timer);
  try {
    await discardPreview(preview.prepared.root, preview.workspace);
  } catch {
    cleanupWarnings.push(retainedPreview(preview.workspace));
  }
}

async function preview(request: DependencyWorkerRequest): Promise<Result> {
  if (!request.operationId)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Dependency preview requires an operation ID.",
    );
  if (takeAbort(request.operationId))
    throw new ProjectError(
      "conflict",
      "ACQUISITION_CANCELLED",
      "Dependency acquisition was cancelled.",
    );
  const controller = new AbortController();
  controllers.set(request.operationId, controller);
  let prepared: PreparedDependency | undefined;
  let workspace: string | undefined;
  try {
    if (request.operation === "preview") {
      if (!request.source || !request.id || !request.kind)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Dependency add preview fields are incomplete.",
        );
      prepared = await prepareDependencyAdd({
        project: request.project,
        source: request.source,
        id: request.id,
        kind: request.kind,
        ...(request.ref ? { ref: request.ref } : {}),
        ...(request.resource ? { resource: request.resource } : {}),
        signal: controller.signal,
      });
    } else if (request.operation === "update-preview") {
      if (!request.id)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Dependency update requires an ID.",
        );
      prepared = await prepareDependencyUpdate({
        project: request.project,
        id: request.id,
        signal: controller.signal,
      });
    } else if (request.operation === "support-set-preview") {
      if (!request.id || !request.target || !request.role || !request.source || !request.resource)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Manual support preview fields are incomplete.",
        );
      prepared = await prepareDependencySupportSet({
        project: request.project,
        id: request.id,
        target: request.target,
        role: request.role,
        source: request.source,
        resource: request.resource,
        ...(request.ref ? { ref: request.ref } : {}),
        signal: controller.signal,
      });
    } else {
      if (!request.id || !request.target || !request.role || !request.resource)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Manual support clear fields are incomplete.",
        );
      prepared = await prepareDependencySupportClear({
        project: request.project,
        id: request.id,
        target: request.target,
        role: request.role,
        resource: request.resource,
      });
    }
    if (controller.signal.aborted)
      throw new ProjectError(
        "conflict",
        "ACQUISITION_CANCELLED",
        "Dependency acquisition was cancelled.",
      );
    for (const [key, value] of previews) if (value.expires <= Date.now()) await discard(key);
    if (previews.size >= 100)
      throw new ProjectError(
        "conflict",
        "PROJECT_BUSY",
        "Dependency preview capacity is full. Wait for expiry.",
      );
    const handle = token();
    const expires = Date.now() + 900000;
    workspace = `.tbspec/previews/${request.instanceId}/${handle}`;
    await secureRuntimeDirectory(prepared.root, ".tbspec/previews");
    await mkdir(await safePath(prepared.root, `.tbspec/previews/${request.instanceId}`, true), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(await safePath(prepared.root, workspace, true), { mode: 0o700 });
    const hasBytes: boolean[] = [];
    try {
      for (const [index, write] of prepared.plan.writes.entries()) {
        if (controller.signal.aborted)
          throw new ProjectError(
            "conflict",
            "ACQUISITION_CANCELLED",
            "Dependency acquisition was cancelled.",
          );
        hasBytes.push(write.bytes !== null);
        if (write.bytes !== null)
          await writeFile(
            await safePath(prepared.root, `${workspace}/staged-${index}`, true),
            write.bytes,
            { flag: "wx", mode: 0o600 },
          );
      }
      if (controller.signal.aborted)
        throw new ProjectError(
          "conflict",
          "ACQUISITION_CANCELLED",
          "Dependency acquisition was cancelled.",
        );
      await writeFile(
        await safePath(prepared.root, `${workspace}/record.json`, true),
        JSON.stringify({
          instanceId: request.instanceId,
          handle,
          expiresAt: new Date(expires).toISOString(),
          preview: prepared.plan.preview,
          stagedWrites: hasBytes,
        }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      try {
        await discardPreview(prepared.root, workspace);
      } catch {
        cleanupWarnings.push(retainedPreview(workspace));
      }
      workspace = undefined;
      throw error;
    }
    prepared.plan.writes = prepared.plan.writes.map((write) => ({ ...write, bytes: null }));
    const timer = setTimeout(
      () => {
        pending = pending.then(() => discard(handle));
      },
      Math.max(0, expires - Date.now()),
    );
    timer.unref();
    previews.set(handle, {
      prepared,
      expires,
      session: request.session,
      instanceId: request.instanceId,
      workspace,
      hasBytes,
      timer,
    });
    const result = ok(
      {
        id: prepared.id,
        dependency: prepared.dependency,
        primarySelector: `dep:${prepared.id}/${prepared.dependency.primary}`,
        projectValidity: prepared.projectValidity,
        validationComplete: prepared.validationComplete,
        applied: false,
        preview: prepared.plan.preview,
        handle,
        instanceId: request.instanceId,
        expiresAt: new Date(expires).toISOString(),
      },
      prepared.diagnostics,
    );
    result.status = "preview";
    return result;
  } finally {
    controllers.delete(request.operationId);
  }
}

async function apply(request: DependencyWorkerRequest): Promise<Result> {
  const handle = request.handle ?? "";
  const stored = previews.get(handle);
  if (
    !stored ||
    stored.expires <= Date.now() ||
    stored.session !== request.session ||
    stored.instanceId !== request.instanceId ||
    stored.prepared.plan.preview.fingerprint !== request.fingerprint
  )
    throw new ProjectError(
      "conflict",
      "PREVIEW_CHANGED",
      "Dependency preview expired, was consumed, or belongs to another session. Prepare a fresh preview.",
    );
  const required = stored.prepared.plan.preview.impact.acceptance;
  const accepted = request.accept ?? [];
  if (
    !Array.isArray(accepted) ||
    accepted.some((item) => !["apply", "accept-impact"].includes(item)) ||
    new Set(accepted).size !== accepted.length
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Apply acceptance flags are invalid.",
    );
  if (accepted.some((item) => !required.includes(item)))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Apply included an acceptance flag not requested by this preview.",
    );
  if (required.some((item) => !accepted.includes(item)))
    throw new ProjectError(
      "conflict",
      "ACCEPTANCE_REQUIRED",
      "Review and accept every flag required by this preview.",
    );
  const writes = await Promise.all(
    stored.prepared.plan.writes.map(async (write, index) => ({
      ...write,
      bytes: stored.hasBytes[index]
        ? await readFile(
            await safePath(stored.prepared.root, `${stored.workspace}/staged-${index}`),
          )
        : null,
    })),
  );
  const publication = { ...stored.prepared, plan: { ...stored.prepared.plan, writes } };
  const result = await publishPreparedDependency(publication);
  if (
    result.status === "ok" ||
    result.diagnostics.some((diagnostic) => diagnostic.code === "REVISION_CONFLICT")
  )
    await discard(handle);
  return result;
}

async function handle(request: DependencyWorkerRequest): Promise<Result> {
  try {
    switch (request.operation) {
      case "inspect": {
        if (!request.source)
          throw new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Dependency inspect requires a source.",
          );
        if (request.operationId && takeAbort(request.operationId))
          throw new ProjectError(
            "conflict",
            "ACQUISITION_CANCELLED",
            "Dependency acquisition was cancelled.",
          );
        const controller = new AbortController();
        if (request.operationId) controllers.set(request.operationId, controller);
        try {
          return await dependencyInspect({
            project: request.project,
            source: request.source,
            ...(request.ref ? { ref: request.ref } : {}),
            ...(request.resource ? { resource: request.resource } : {}),
            signal: controller.signal,
          });
        } finally {
          if (request.operationId) controllers.delete(request.operationId);
        }
      }
      case "list":
        return await dependencyList({ project: request.project });
      case "show":
        if (!request.id)
          throw new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Dependency show requires an ID.",
          );
        return await dependencyShow({ project: request.project, id: request.id });
      case "check": {
        if (request.operationId && takeAbort(request.operationId))
          throw new ProjectError(
            "conflict",
            "ACQUISITION_CANCELLED",
            "Dependency check was cancelled.",
          );
        const controller = new AbortController();
        if (request.operationId) controllers.set(request.operationId, controller);
        try {
          return await dependencyCheck({
            project: request.project,
            ...(request.id ? { id: request.id } : {}),
            signal: controller.signal,
          });
        } finally {
          if (request.operationId) controllers.delete(request.operationId);
        }
      }
      case "select":
        if (!request.id || !request.ontologyIri)
          throw new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Dependency select requires an ontology IRI and ID.",
          );
        return await dependencySelect({
          project: request.project,
          id: request.id,
          ontologyIri: request.ontologyIri,
        });
      case "clear":
        if (!request.ontologyIri)
          throw new ProjectError(
            "invalid_arguments",
            "ARGUMENT_INVALID",
            "Dependency clear requires an ontology IRI.",
          );
        return await dependencyClear({
          project: request.project,
          ontologyIri: request.ontologyIri,
        });
      case "preview":
      case "update-preview":
      case "support-set-preview":
      case "support-clear-preview":
        return await preview(request);
      case "apply":
        return await apply(request);
      case "cancel":
        if (request.handle) {
          const preview = previews.get(request.handle);
          if (
            preview &&
            (preview.session !== request.session || preview.instanceId !== request.instanceId)
          )
            throw new ProjectError(
              "conflict",
              "PREVIEW_CHANGED",
              "Dependency preview expired, was consumed, or belongs to another session.",
            );
          await discard(request.handle);
        }
        return ok({ cancelled: true });
    }
  } catch (error) {
    return failure(error);
  }
}

parentPort?.postMessage({ ready: true });
parentPort?.on(
  "message",
  (request: DependencyWorkerRequest | { operation: "abort"; operationId: string }) => {
    if (request.operation === "abort") {
      const controller = controllers.get(request.operationId);
      if (controller) controller.abort();
      else {
        const now = Date.now();
        for (const [id, expires] of aborted) if (expires <= now) aborted.delete(id);
        while (aborted.size >= 1000) aborted.delete(aborted.keys().next().value ?? "");
        aborted.set(request.operationId, now + 300000);
      }
      return;
    }
    pending = pending.then(async () => {
      const result = await handle(request);
      result.diagnostics.push(...cleanupWarnings.splice(0));
      parentPort?.postMessage({
        requestId: request.requestId,
        status: result.status,
        json: JSON.stringify(result),
      });
    });
  },
);
