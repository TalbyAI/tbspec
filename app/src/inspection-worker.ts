import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import {
  type AuthoringOptions,
  type PreparedResource,
  prepareResource,
  publishResource,
} from "./authoring.ts";
import { type EditingOptions, prepareEdit } from "./editing.ts";
import { inspectProject } from "./inspection.ts";
import { type Diagnostic, failure, ok, ProjectError, type Result } from "./output.ts";
import { token } from "./ownership.ts";
import { safePath } from "./paths.ts";
import { discardPreview, retainedPreview } from "./previews.ts";
import { secureRuntimeDirectory } from "./runtime.ts";

export interface InspectionResponse {
  status: Result["status"];
  json: string;
}

parentPort?.postMessage({ ready: true });
export interface AuthoringRequest {
  options?: AuthoringOptions;
  editing?: EditingOptions;
  session: string;
  mode: "preview" | "apply" | "cancel";
  fingerprint?: string;
  instanceId?: string;
  handle?: string;
  accept?: string[];
}
interface StoredPreview {
  prepared: PreparedResource;
  expires: number;
  session: string;
  instanceId: string;
  workspace: string;
  timer: ReturnType<typeof setTimeout>;
}
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
async function handle(
  request: Parameters<typeof inspectProject>[0] & {
    authoring?: AuthoringRequest;
    warnings?: Diagnostic[];
  },
) {
  let result: Result;
  try {
    const authoring = request.authoring;
    if (!authoring) result = await inspectProject(request);
    else if (authoring.mode === "preview" && (authoring.options || authoring.editing)) {
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
      const prepared = authoring.editing
        ? await prepareEdit({ ...authoring.editing, project: request.project })
        : await prepareResource({
            ...(authoring.options as AuthoringOptions),
            project: request.project,
          });
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
        expires,
        session: authoring.session,
        instanceId: authoring.instanceId,
        workspace,
        timer,
      });
      result = {
        ...ok(
          {
            resource: prepared.resource,
            applied: false,
            preview: prepared.plan.preview,
            handle,
            instanceId: authoring.instanceId,
            expiresAt: new Date(expires).toISOString(),
            projectValidity: prepared.diagnostics.some((d) => d.severity === "error")
              ? "invalid"
              : "unchecked",
            validationComplete: false,
            ...(prepared.validation ? { validation: prepared.validation } : {}),
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
          preview.prepared.plan.writes.map(async (write, index) => ({
            ...write,
            bytes: await readFile(
              await safePath(preview.prepared.root, `${preview.workspace}/staged-${index}`),
            ),
          })),
        );
        result = await publishResource({
          ...preview.prepared,
          plan: { ...preview.prepared.plan, writes },
        });
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
parentPort?.on("message", (request: Parameters<typeof handle>[0]) => {
  pending = pending.then(() => handle(request));
});
