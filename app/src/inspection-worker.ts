import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import {
  type AuthoringOptions,
  type PreparedResource,
  prepareResource,
  publishResource,
} from "./authoring.ts";
import { inspectProject } from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { token } from "./ownership.ts";
import { safePath } from "./paths.ts";
import { secureRuntimeDirectory } from "./runtime.ts";

export interface InspectionResponse {
  status: Result["status"];
  json: string;
}

parentPort?.postMessage({ ready: true });
export interface AuthoringRequest {
  options?: AuthoringOptions;
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
}
const previews = new Map<string, StoredPreview>();
async function discard(preview: StoredPreview) {
  const { root } = preview.prepared;
  for (const artifact of [
    ...preview.prepared.plan.writes.map((_, index) => `staged-${index}`),
    "record.json",
  ])
    await unlink(await safePath(root, `${preview.workspace}/${artifact}`, true));
  await rmdir(await safePath(root, preview.workspace, true));
}
parentPort?.on(
  "message",
  async (request: Parameters<typeof inspectProject>[0] & { authoring?: AuthoringRequest }) => {
    let result: Result;
    try {
      const authoring = request.authoring;
      if (!authoring) result = await inspectProject(request);
      else if (authoring.mode === "preview" && authoring.options) {
        for (const [key, preview] of previews)
          if (preview.expires <= Date.now()) {
            previews.delete(key);
            await discard(preview);
          }
        if (previews.size >= 100)
          throw new ProjectError(
            "conflict",
            "PROJECT_BUSY",
            "Resource preview capacity is full. Wait for expiry.",
          );
        const prepared = await prepareResource({ ...authoring.options, project: request.project });
        if (!authoring.instanceId) throw new Error("Missing server instance.");
        const handle = token();
        const expires = Date.now() + 900000;
        const workspace = `.tbspec/previews/${authoring.instanceId}/${handle}`;
        await secureRuntimeDirectory(prepared.root, ".tbspec/previews");
        await mkdir(await safePath(prepared.root, workspace, true), {
          recursive: true,
          mode: 0o700,
        });
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
        prepared.plan.writes = prepared.plan.writes.map((write) => ({ ...write, bytes: null }));
        previews.set(handle, {
          prepared,
          expires,
          session: authoring.session,
          instanceId: authoring.instanceId,
          workspace,
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
          previews.delete(key);
          await discard(preview);
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
            previews.delete(key);
            try {
              await discard(preview);
            } catch {
              result.diagnostics.push({
                code: "CLEANUP_RETAINED",
                severity: "warning",
                file: preview.workspace,
                message:
                  "Published successfully; expired preview staging remains for manual cleanup.",
              });
            }
          }
        }
      }
    } catch (error) {
      result = failure(error);
    }
    parentPort?.postMessage({
      status: result.status,
      json: JSON.stringify(result),
    } satisfies InspectionResponse);
  },
);
