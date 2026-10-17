import { canonical } from "./canonical.ts";
import type { FileSystem, Revision } from "./filesystem.ts";
import { fileBytes, revision } from "./filesystem.ts";
import { portablePath } from "./paths.ts";

export function opaqueToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function validOwnershipRecord(value: unknown): boolean {
  if (
    !record(value) ||
    value.recordVersion !== 1 ||
    !opaqueToken(value.acquisitionId) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    Object.keys(value).length !== 7
  )
    return false;
  try {
    for (const field of ["hostId", "bootId", "processStartId"]) {
      const wire = value[field];
      if (typeof wire !== "string" || !/^os:v1:[A-Za-z0-9_-]+$/.test(wire)) return false;
      const encoded = wire.slice(6);
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded) return false;
      const content: unknown = JSON.parse(bytes.toString("utf8"));
      if (
        !record(content) ||
        Object.keys(content).length !== 2 ||
        typeof content.provider !== "string" ||
        !content.provider ||
        typeof content.value !== "string" ||
        !content.value ||
        canonical(content) !== bytes.toString("utf8")
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
function wireRevision(value: unknown): value is Revision {
  return (
    record(value) &&
    ((value.state === "absent" && Object.keys(value).length === 1) ||
      (value.state === "present" &&
        typeof value.digest === "string" &&
        /^sha256:[0-9a-f]{64}$/.test(value.digest) &&
        Object.keys(value).length === 2))
  );
}
export function validRecoveryRecord(
  value: unknown,
  name: string,
): value is Record<string, unknown> & { changes: Record<string, unknown>[] } {
  if (
    !record(value) ||
    value.recordVersion !== 1 ||
    value.transactionId !== name ||
    !opaqueToken(value.transactionId) ||
    !opaqueToken(value.acquisitionId) ||
    !["preparing", "publishing", "rolling_back", "complete"].includes(String(value.state)) ||
    !Array.isArray(value.changes) ||
    Object.keys(value).length !== 5
  )
    return false;
  try {
    for (const entry of value.changes) {
      if (
        !record(entry) ||
        !["create", "replace", "delete", "move"].includes(String(entry.action)) ||
        typeof entry.file !== "string" ||
        !wireRevision(entry.before) ||
        !wireRevision(entry.after) ||
        !["planned", "prepared", "applied", "restored"].includes(String(entry.progress))
      )
        return false;
      portablePath(entry.file);
      const required = [
        "action",
        "file",
        "before",
        "after",
        "originalPath",
        "stagedPath",
        "destinationBefore",
        "progress",
        ...(entry.action === "move" ? ["to"] : []),
      ];
      if (
        required.some((key) => !(key in entry)) ||
        Object.keys(entry).some((key) => !required.includes(key))
      )
        return false;
      if (
        (entry.action === "create" &&
          (entry.before.state !== "absent" || entry.after.state !== "present")) ||
        (entry.action === "delete" &&
          (entry.before.state !== "present" || entry.after.state !== "absent")) ||
        (["replace", "move"].includes(String(entry.action)) &&
          (entry.before.state !== "present" || entry.after.state !== "present"))
      )
        return false;
      if (
        entry.before.state === "present"
          ? typeof entry.originalPath !== "string"
          : entry.originalPath !== null
      )
        return false;
      if (
        entry.after.state === "present"
          ? typeof entry.stagedPath !== "string"
          : entry.stagedPath !== null
      )
        return false;
      for (const path of [entry.originalPath, entry.stagedPath])
        if (typeof path === "string") portablePath(path);
      if (entry.action === "move") {
        if (
          typeof entry.to !== "string" ||
          !wireRevision(entry.destinationBefore) ||
          entry.destinationBefore.state !== "absent"
        )
          return false;
        portablePath(entry.to);
      } else if (entry.destinationBefore !== null) return false;
      if (value.state === "complete" && entry.progress !== "applied") return false;
    }
    return true;
  } catch {
    return false;
  }
}
export async function recoveryArtifacts(
  root: string,
  location: string,
  value: unknown,
  fs: FileSystem,
): Promise<{ path: string; revision: Revision; expected: Revision | null }[]> {
  if (!record(value) || !Array.isArray(value.changes)) return [];
  const workspace = location.slice(0, location.lastIndexOf("/"));
  const artifacts: { path: string; revision: Revision; expected: Revision | null }[] = [];
  for (const entry of value.changes)
    if (record(entry))
      for (const [field, expectedField] of [
        ["originalPath", "before"],
        ["stagedPath", "after"],
      ]) {
        const path = entry[field ?? ""];
        if (typeof path !== "string") continue;
        try {
          const physical = `${workspace}/${portablePath(path)}`;
          const expected = entry[expectedField ?? ""];
          artifacts.push({
            path: physical,
            revision: revision(await fileBytes(root, physical, fs)),
            expected: wireRevision(expected) ? expected : null,
          });
        } catch {
          /* Unsafe artifact names are explicitly reflected by incomplete metadata. */
        }
      }
  return artifacts;
}
