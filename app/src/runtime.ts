import { execFile } from "node:child_process";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { canonical } from "./canonical.ts";
import { hasCode, ProjectError } from "./output.ts";
import { type ProcessIdentity, processIdentity, token } from "./ownership.ts";
import { safePath } from "./paths.ts";
import { opaqueToken, validOwnershipRecord } from "./recovery.ts";

export const applicationVersion = "0.1.0";
export const runtimePath = ".tbspec/runtime/web.json";
const execute = promisify(execFile);
export interface RuntimeRecord extends ProcessIdentity {
  recordVersion: 1;
  projectRoot: string;
  instanceId: string;
  applicationVersion: string;
  controlProtocolVersion: number;
  jsonSchemaVersion: number;
  state: "starting" | "running" | "stopping";
  baseUrl: string | null;
  controlToken: string;
  createdAt: string;
}
export function runtimeProcess(record: ProcessIdentity): ProcessIdentity {
  return {
    hostId: record.hostId,
    bootId: record.bootId,
    pid: record.pid,
    processStartId: record.processStartId,
  };
}
export function runtimeError(
  status: "conflict" | "unavailable",
  code: string,
  message: string,
): ProjectError {
  return new ProjectError(status, code, message, runtimePath);
}
async function windowsPermissions(root: string, paths: string[], create: boolean): Promise<void> {
  const rootLiteral = `'${root.replaceAll("'", "''")}'`;
  // Administrators and SYSTEM can bypass user isolation regardless of the project DACL.
  const rootCheck = `$rootAcl=[IO.Directory]::GetAccessControl(${rootLiteral}); if($rootAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sidValue.Value){throw 'Wrong project owner'}; $unsafeRights=[int]([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership); foreach($ruleValue in $rootAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($ruleValue.AccessControlType -eq 'Allow' -and ([int]$ruleValue.FileSystemRights -band $unsafeRights) -ne 0 -and $ruleValue.IdentityReference.Value -notin @($sidValue.Value,'S-1-5-18','S-1-5-32-544')){throw 'Shared writable project root'}}`;
  const checks = paths
    .map((path) => {
      const literal = `'${path.replaceAll("'", "''")}'`;
      const setup = create
        ? `$previousAcl=[IO.Directory]::GetAccessControl(${literal}); if($previousAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sidValue.Value){throw 'Wrong owner'}; $aclValue=[Security.AccessControl.DirectorySecurity]::new(); $aclValue.SetAccessRuleProtection($true,$false); $ruleValue=[Security.AccessControl.FileSystemAccessRule]::new($sidValue,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $aclValue.AddAccessRule($ruleValue); [IO.Directory]::SetAccessControl(${literal},$aclValue);`
        : "";
      return `${setup} $checkedAcl=if([IO.Directory]::Exists(${literal})){[IO.Directory]::GetAccessControl(${literal})}else{[IO.File]::GetAccessControl(${literal})}; if($checkedAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sidValue.Value){throw 'Wrong owner'}; foreach($ruleValue in $checkedAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($ruleValue.AccessControlType -eq 'Allow' -and $ruleValue.IdentityReference.Value -ne $sidValue.Value){throw 'Non-owner access'}}`;
    })
    .join(" ");
  const script = `$ErrorActionPreference='Stop'; $sidValue=[Security.Principal.WindowsIdentity]::GetCurrent().User; ${rootCheck} ${checks}`;
  await execute(
    join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 10000, maxBuffer: 65536 },
  );
}
async function checkUnixRoot(root: string): Promise<void> {
  const info = await stat(root);
  if (info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0)
    throw new Error("Project root permits replacement by another user.");
}
export async function checkRuntimePermissions(root: string): Promise<void> {
  const path = await safePath(root, runtimePath, true);
  try {
    const paths = [await safePath(root, ".tbspec"), await safePath(root, ".tbspec/runtime"), path];
    if (process.platform === "win32") await windowsPermissions(root, paths, false);
    else {
      await checkUnixRoot(root);
      for (const checked of paths) {
        const info = await stat(checked);
        if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
          throw new Error("Non-owner access.");
      }
    }
  } catch {
    throw runtimeError(
      "conflict",
      "RUNTIME_OWNERSHIP_UNKNOWN",
      "Runtime registration is not protected to the current OS user. Preserve it for manual inspection.",
    );
  }
}
function validRuntime(value: unknown, root: string): value is RuntimeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as RuntimeRecord;
  if (
    row.projectRoot !== root ||
    !opaqueToken(row.instanceId) ||
    !opaqueToken(row.controlToken) ||
    typeof row.applicationVersion !== "string" ||
    !row.applicationVersion ||
    !Number.isSafeInteger(row.controlProtocolVersion) ||
    !Number.isSafeInteger(row.jsonSchemaVersion) ||
    !["starting", "running", "stopping"].includes(row.state)
  )
    return false;
  if (
    row.baseUrl !== null &&
    (typeof row.baseUrl !== "string" ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*\/$/.test(row.baseUrl) ||
      Number(row.baseUrl.slice("http://127.0.0.1:".length, -1)) > 65535)
  )
    return false;
  if (row.state === "running" && !row.baseUrl) return false;
  return validOwnershipRecord({
    recordVersion: row.recordVersion,
    acquisitionId: row.instanceId,
    ...runtimeProcess(row),
    createdAt: row.createdAt,
  });
}
export async function readRuntime(root: string): Promise<RuntimeRecord | null> {
  const path = await safePath(root, runtimePath, true);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
  try {
    await checkRuntimePermissions(root);
  } catch (error) {
    try {
      await stat(path);
    } catch (missing) {
      if (hasCode(missing, "ENOENT")) return null;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    /* Partial creation is unknown ownership. */
  }
  if (!validRuntime(value, root))
    throw runtimeError(
      "conflict",
      "RUNTIME_OWNERSHIP_UNKNOWN",
      "Runtime record is incomplete, incompatible or belongs to another project. Preserve it for manual inspection.",
    );
  if (value.controlProtocolVersion !== 1 || value.jsonSchemaVersion !== 1)
    throw runtimeError(
      "conflict",
      "RUNTIME_PROTOCOL_UNSUPPORTED",
      "Use the running application's compatible CLI to stop this server, then restart. No stop protocol was guessed.",
    );
  return value;
}
export async function observeRuntime(record: RuntimeRecord): Promise<"live" | "ended" | "unknown"> {
  try {
    const current = await processIdentity();
    if (record.hostId !== current.hostId) return "unknown";
    const provider = (value: string) =>
      (
        JSON.parse(Buffer.from(value.slice(6), "base64url").toString("utf8")) as {
          provider: string;
        }
      ).provider;
    if (
      provider(record.bootId) !== provider(current.bootId) ||
      provider(record.processStartId) !== provider(current.processStartId)
    )
      return "unknown";
    if (record.bootId !== current.bootId) return "ended";
    try {
      return canonical(await processIdentity(record.pid)) === canonical(runtimeProcess(record))
        ? "live"
        : "ended";
    } catch {
      try {
        process.kill(record.pid, 0);
      } catch (error) {
        if (hasCode(error, "ESRCH")) return "ended";
      }
      return "unknown";
    }
  } catch {
    return "unknown";
  }
}
export async function claimRuntime(root: string): Promise<RuntimeRecord> {
  const identity = await processIdentity();
  const directory = await safePath(root, ".tbspec/runtime", true);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const paths = [await safePath(root, ".tbspec"), directory];
    if (process.platform === "win32") await windowsPermissions(root, paths, true);
    else {
      await checkUnixRoot(root);
      for (const checked of paths) {
        if ((await stat(checked)).uid !== process.getuid?.()) throw new Error("Wrong owner.");
        await chmod(checked, 0o700);
      }
    }
  } catch {
    throw runtimeError(
      "unavailable",
      "RUNTIME_UNAVAILABLE",
      "Cannot secure runtime storage. The project root must belong to the current OS user and prevent writes by other users.",
    );
  }
  const path = await safePath(root, runtimePath, true);
  const handle = await open(path, "wx", 0o600);
  const record: RuntimeRecord = {
    recordVersion: 1,
    projectRoot: root,
    instanceId: token(),
    ...identity,
    applicationVersion,
    controlProtocolVersion: 1,
    jsonSchemaVersion: 1,
    state: "starting",
    baseUrl: null,
    controlToken: token(),
    createdAt: new Date().toISOString(),
  };
  try {
    await handle.writeFile(canonical(record));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await checkRuntimePermissions(root);
  return record;
}
export async function replaceRuntime(record: RuntimeRecord): Promise<void> {
  const current = await readRuntime(record.projectRoot);
  if (
    !current ||
    current.instanceId !== record.instanceId ||
    canonical(runtimeProcess(current)) !== canonical(runtimeProcess(record))
  )
    throw runtimeError(
      "conflict",
      "RUNTIME_OWNERSHIP_UNKNOWN",
      "Runtime ownership changed; retained for inspection.",
    );
  const temporary = await safePath(record.projectRoot, `.tbspec/runtime/${token()}.json`, true);
  await writeFile(temporary, canonical(record), { flag: "wx", mode: 0o600 });
  try {
    const before = await readRuntime(record.projectRoot);
    if (!before || before.instanceId !== record.instanceId)
      throw runtimeError(
        "conflict",
        "RUNTIME_OWNERSHIP_UNKNOWN",
        "Runtime ownership changed before replacement.",
      );
    await rename(temporary, await safePath(record.projectRoot, runtimePath, true));
  } finally {
    await unlink(temporary).catch((error) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}
export async function removeRuntime(record: RuntimeRecord): Promise<void> {
  const current = await readRuntime(record.projectRoot);
  if (!current || canonical(current) !== canonical(record))
    throw runtimeError(
      "conflict",
      "RUNTIME_OWNERSHIP_UNKNOWN",
      "Runtime registration changed; no cleanup performed.",
    );
  await unlink(await safePath(record.projectRoot, runtimePath, true));
}
