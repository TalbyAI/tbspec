import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import {
  type AuthoringOptions,
  type PreparedResource,
  prepareResource,
  publishResource,
} from "./authoring.ts";
import {
  type ModelTypeConfigurationOptions,
  type PreparedModelTypeConfiguration,
  prepareModelTypeConfiguration,
  publishModelTypeConfiguration,
} from "./configuration.ts";
import { listDesigns, showDesign } from "./designs.ts";
import {
  type EditingOptions,
  type ElementDeletionOptions,
  prepareEdit,
  prepareElementDeletion,
} from "./editing.ts";
import { inspectProject } from "./inspection.ts";
import { type Diagnostic, failure, ok, ProjectError, type Result } from "./output.ts";
import { token } from "./ownership.ts";
import { safePath } from "./paths.ts";
import { discardPreview, retainedPreview } from "./previews.ts";
import { type QueryOperation, queryOperation } from "./query.ts";
import {
  listReferences,
  type PreparedRepair,
  prepareRepair,
  publishRepair,
  type RepairRequest,
  type SupportCandidate,
} from "./repair.ts";
import {
  inspectImpact,
  type LifecycleOptions,
  type LifecycleResourceKind,
  type PreparedResourceLifecycle,
  prepareResourceLifecycle,
  publishResourceLifecycle,
} from "./resource-lifecycle.ts";
import { secureRuntimeDirectory } from "./runtime.ts";
import { listViews, prepareEditWithViews, showView, type ViewOptions } from "./views.ts";

export type WorkspaceRead =
  | { operation: "views.list"; source?: string }
  | { operation: "views.show"; selector: string }
  | { operation: "designs.list" }
  | { operation: "designs.show"; selector: string };

export interface InspectionResponse {
  status: Result["status"];
  json: string;
}

parentPort?.postMessage({ ready: true });
export interface AuthoringRequest {
  options?: AuthoringOptions;
  configuration?: ModelTypeConfigurationOptions;
  editing?: EditingOptions;
  deletion?: ElementDeletionOptions;
  views?: ViewOptions;
  lifecycle?: LifecycleOptions & { action: "remove" | "move" };
  impact?: { kind: LifecycleResourceKind; selector: string };
  referenceList?: { target?: string; dangling?: boolean };
  garbageList?: boolean;
  repair?: RepairRequest;
  repairApply?: boolean;
  session: string;
  mode: "preview" | "apply" | "cancel";
  fingerprint?: string;
  instanceId?: string;
  handle?: string;
  accept?: string[];
}
interface StoredPreview {
  prepared:
    | PreparedResource
    | PreparedModelTypeConfiguration
    | PreparedResourceLifecycle
    | PreparedRepair;
  repair?: boolean;
  repairRequest?: RepairRequest;
  candidates?: SupportCandidate[];
  expires: number;
  session: string;
  instanceId: string;
  workspace: string;
  timer: ReturnType<typeof setTimeout>;
}
type WorkerRequest =
  | (Parameters<typeof inspectProject>[0] & {
      authoring?: AuthoringRequest;
      workspaceRead?: WorkspaceRead;
      warnings?: Diagnostic[];
    })
  | { project: string; query: QueryOperation; warnings?: Diagnostic[] };
const previews = new Map<string, StoredPreview>();
const cleanupWarnings: Diagnostic[] = [];
let pending = Promise.resolve();
async function discard(key: string) {
  const preview = previews.get(key);
  if (!preview) return;
  previews.delete(key);
  clearTimeout(preview.timer);
  try {
    await discardPreview(preview.prepared.root, preview.workspace);
  } catch {
    cleanupWarnings.push(retainedPreview(preview.workspace));
  }
}
async function handle(request: WorkerRequest) {
  let result: Result;
  try {
    const authoring = "authoring" in request ? request.authoring : undefined;
    if ("query" in request)
      result = await queryOperation({ project: request.project, operation: request.query });
    else if ("workspaceRead" in request && request.workspaceRead) {
      const read = request.workspaceRead;
      switch (read.operation) {
        case "views.list":
          result = await listViews({ project: request.project, source: read.source });
          break;
        case "views.show":
          result = await showView({ project: request.project, selector: read.selector });
          break;
        case "designs.list":
          result = await listDesigns({ project: request.project });
          break;
        case "designs.show":
          result = await showDesign({ project: request.project, selector: read.selector });
          break;
      }
    } else if (!authoring) result = await inspectProject(request);
    else if (authoring.impact) {
      result = await inspectImpact({
        project: request.project,
        ...authoring.impact,
      });
    } else if (authoring.referenceList) {
      result = await listReferences({ project: request.project, ...authoring.referenceList });
    } else if (authoring.garbageList) {
      if (!request.project)
        throw new ProjectError(
          "invalid_arguments",
          "PROJECT_REQUIRED",
          "Reference inspection requires a project.",
        );
      const inventory = await prepareRepair({ operation: "gc" }, request.project);
      result = ok({ candidates: inventory.candidates ?? [] });
    } else if (
      authoring.mode === "preview" &&
      (authoring.options ||
        authoring.editing ||
        authoring.deletion ||
        authoring.views ||
        authoring.configuration ||
        authoring.lifecycle ||
        authoring.repair)
    ) {
      for (const [key, preview] of previews)
        if (preview.expires <= Date.now()) {
          await discard(key);
        }
      // shortcut: the shared 100-preview cap is provisional, recalibrate with representative workloads.
      if (previews.size >= 100)
        throw new ProjectError(
          "conflict",
          "PROJECT_BUSY",
          "Resource preview capacity is full. Wait for expiry.",
        );
      if (authoring.repair && !request.project)
        throw new ProjectError(
          "invalid_arguments",
          "PROJECT_REQUIRED",
          "Reference repair requires a project.",
        );
      const repairPlan =
        authoring.repair && request.project
          ? await prepareRepair(authoring.repair, request.project)
          : undefined;
      const prepared =
        repairPlan?.prepared ??
        (authoring.deletion
          ? await prepareElementDeletion({ ...authoring.deletion, project: request.project })
          : authoring.editing
            ? await prepareEdit({ ...authoring.editing, project: request.project })
            : authoring.views
              ? await prepareEditWithViews({ ...authoring.views, project: request.project })
              : authoring.configuration
                ? await prepareModelTypeConfiguration({
                    ...authoring.configuration,
                    project: request.project,
                  })
                : authoring.lifecycle
                  ? await prepareResourceLifecycle({
                      ...authoring.lifecycle,
                      project: request.project,
                    })
                  : await prepareResource({
                      ...(authoring.options as AuthoringOptions),
                      project: request.project,
                    }));
      if (!authoring.instanceId) throw new Error("Missing server instance.");
      const handle = token();
      const expires = Date.now() + 900000;
      const workspace = `.tbspec/previews/${authoring.instanceId}/${handle}`;
      await secureRuntimeDirectory(prepared.root, ".tbspec/previews");
      await mkdir(await safePath(prepared.root, `.tbspec/previews/${authoring.instanceId}`, true), {
        recursive: true,
        mode: 0o700,
      });
      await mkdir(await safePath(prepared.root, workspace, true), { mode: 0o700 });
      try {
        for (const [index, write] of prepared.plan.writes.entries())
          await writeFile(
            await safePath(prepared.root, `${workspace}/staged-${index}`, true),
            write.bytes ?? new Uint8Array(),
            { flag: "wx", mode: 0o600 },
          );
        await writeFile(
          await safePath(prepared.root, `${workspace}/record.json`, true),
          JSON.stringify({
            instanceId: authoring.instanceId,
            handle,
            expiresAt: new Date(expires).toISOString(),
            preview: prepared.plan.preview,
          }),
          { flag: "wx", mode: 0o600 },
        );
      } catch (error) {
        try {
          await discardPreview(prepared.root, workspace);
        } catch {
          cleanupWarnings.push(retainedPreview(workspace));
        }
        throw error;
      }
      prepared.plan.writes = prepared.plan.writes.map((write) => ({ ...write, bytes: null }));
      // Expiry joins the operation queue, so it cannot remove bytes during publication.
      const timer = setTimeout(
        () => {
          pending = pending.then(() => discard(handle));
        },
        Math.max(0, expires - Date.now()),
      );
      timer.unref();
      previews.set(handle, {
        prepared,
        ...(authoring.repair ? { repair: true } : {}),
        ...(authoring.repair ? { repairRequest: authoring.repair } : {}),
        ...(repairPlan?.candidates ? { candidates: repairPlan.candidates } : {}),
        expires,
        session: authoring.session,
        instanceId: authoring.instanceId,
        workspace,
        timer,
      });
      const nonRepairPrepared = prepared as
        | PreparedResource
        | PreparedModelTypeConfiguration
        | PreparedResourceLifecycle;
      let previewDetails: Record<string, unknown>;
      if (authoring.repair) {
        if (!repairPlan)
          throw new ProjectError(
            "invalid_arguments",
            "PROJECT_REQUIRED",
            "Reference repair requires a project.",
          );
        previewDetails = {
          projectValidity: repairPlan.prepared.projectValidity,
          validationComplete: repairPlan.prepared.validationComplete,
          ...(repairPlan.candidates ? { candidates: repairPlan.candidates } : {}),
        };
      } else if ("lifecycle" in nonRepairPrepared) {
        previewDetails = {
          resource: nonRepairPrepared.resource,
          modelType: nonRepairPrepared.modelType,
          affectedModels: nonRepairPrepared.affectedModels,
          projectValidity: nonRepairPrepared.projectValidity,
          validationComplete: nonRepairPrepared.validationComplete,
        };
      } else if ("modelType" in nonRepairPrepared) {
        previewDetails = {
          modelType: nonRepairPrepared.modelType,
          affectedModels: nonRepairPrepared.affectedModels,
          projectValidity: nonRepairPrepared.projectValidity,
          validationComplete: nonRepairPrepared.validationComplete,
        };
      } else {
        previewDetails = {
          resource: nonRepairPrepared.resource,
          projectValidity: nonRepairPrepared.validation?.validity ?? "unchecked",
          validationComplete: nonRepairPrepared.validation?.validationComplete ?? false,
          ...(nonRepairPrepared.validation ? { validation: nonRepairPrepared.validation } : {}),
        };
      }
      result = {
        ...ok(
          {
            ...previewDetails,
            applied: false,
            preview: prepared.plan.preview,
            handle,
            instanceId: authoring.instanceId,
            expiresAt: new Date(expires).toISOString(),
          },
          prepared.diagnostics,
        ),
        status: "preview",
      };
    } else {
      const key = authoring.handle ?? "";
      const preview = previews.get(key);
      if (
        !preview ||
        preview.expires <= Date.now() ||
        preview.session !== authoring.session ||
        preview.instanceId !== authoring.instanceId ||
        Boolean(preview.repair) !== Boolean(authoring.repairApply) ||
        (authoring.mode !== "cancel" &&
          preview.prepared.plan.preview.fingerprint !== authoring.fingerprint)
      )
        throw new ProjectError(
          "conflict",
          "PREVIEW_CHANGED",
          "Resource preview expired, was consumed, or belongs to another session. Prepare a fresh preview.",
        );
      if (authoring.mode === "cancel") {
        await discard(key);
        result = ok({ cancelled: true });
      } else {
        if (
          authoring.mode === "apply" &&
          preview.repairRequest?.operation === "gc" &&
          preview.repairRequest.all !== true &&
          !preview.repairRequest.resources?.length
        )
          throw new ProjectError(
            "invalid_arguments",
            "GC_SCOPE_REQUIRED",
            "GC application requires explicit candidate paths or all=true.",
          );
        if (
          preview.prepared.plan.preview.impact.acceptance.some(
            (flag) => !authoring.accept?.includes(flag),
          )
        )
          throw new ProjectError(
            "conflict",
            "ACCEPTANCE_REQUIRED",
            "Accept the required preview flags before application.",
          );
        const writes = await Promise.all(
          preview.prepared.plan.writes.map(async (write, index) => {
            const change = preview.prepared.plan.preview.changes[index];
            return {
              ...write,
              bytes:
                change?.action === "delete"
                  ? null
                  : await readFile(
                      await safePath(preview.prepared.root, `${preview.workspace}/staged-${index}`),
                    ),
            };
          }),
        );
        const publication = { ...preview.prepared, plan: { ...preview.prepared.plan, writes } };
        result = preview.repair
          ? await publishRepair(publication as PreparedRepair)
          : "lifecycle" in publication
            ? await publishResourceLifecycle(publication)
            : "modelType" in publication
              ? await publishModelTypeConfiguration(publication)
              : await publishResource(publication as PreparedResource);
        if (result.status === "ok") {
          await discard(key);
        } else if (
          result.diagnostics.some((diagnostic) => diagnostic.code === "REVISION_CONFLICT")
        ) {
          await discard(key);
        }
      }
    }
  } catch (error) {
    result = failure(error);
  }
  result.diagnostics.push(...(request.warnings ?? []), ...cleanupWarnings.splice(0));
  parentPort?.postMessage({
    status: result.status,
    json: JSON.stringify(result),
  } satisfies InspectionResponse);
}
parentPort?.on("message", (request: WorkerRequest) => {
  pending = pending.then(() => handle(request));
});
