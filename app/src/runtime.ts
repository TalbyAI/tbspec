import { execFile } from "node:child_process";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { canonical } from "./canonical.ts";
import { acquireLock, type Ownership, releaseLock } from "./lock.ts";
import { combineErrors, hasCode, ProjectError } from "./output.ts";
import { type ProcessIdentity, processIdentity, token } from "./ownership.ts";
import { safePath } from "./paths.ts";
import { opaqueToken, validOwnershipRecord } from "./recovery.ts";

export const applicationVersion = "0.1.0";
export const runtimePath = ".tbspec/runtime/web.json";
const execute = promisify(execFile);
const registrationLock = ".tbspec/runtime/registration.lock";
async function withRuntimeLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 30000;
  let owner: Ownership;
  for (;;) {
    try {
      owner = await acquireLock(root, undefined, registrationLock);
      break;
    } catch (error) {
      const vanished =
        hasCode(error, "ENOENT") &&
        error instanceof Error &&
        "path" in error &&
        error.path === join(root, registrationLock);
      if (
        !vanished &&
        (!(error instanceof ProjectError) ||
          !["PROJECT_BUSY", "RECOVERY_REQUIRED"].includes(error.diagnostic.code))
      )
        throw error;
      if (Date.now() >= deadline)
        throw runtimeError(
          "conflict",
          "RUNTIME_OWNERSHIP_UNKNOWN",
          "Runtime registration guard is busy. Inspect it before retrying; no cleanup performed.",
        );
      await delay(100);
    }
  }
  let outcome: { ok: true; data: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, data: await work() };
  } catch (error) {
    outcome = { ok: false, error };
  }
  try {
    await releaseLock(root, owner, undefined, registrationLock);
  } catch (error) {
    if (!outcome.ok) throw combineErrors(outcome.error, error);
    throw error;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.data;
}
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
  // Administrators and SYSTEM can bypass user isolation regardless of the project DACL.
  const rootCheck = [root, join(root, ".tbspec")]
    .map((parent) => {
      const literal = `'${parent.replaceAll("'", "''")}'`;
      return `$rootAcl=[IO.Directory]::GetAccessControl(${literal}); if($rootAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sidValue.Value){throw 'Wrong runtime parent owner'}; $unsafeRights=[int]([Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership); foreach($ruleValue in $rootAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($ruleValue.AccessControlType -eq 'Allow' -and ([int]$ruleValue.FileSystemRights -band $unsafeRights) -ne 0 -and $ruleValue.IdentityReference.Value -notin @($sidValue.Value,'S-1-5-18','S-1-5-32-544')){throw 'Shared writable runtime parent'}}`;
    })
    .join(" ");
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
async function checkUnixParents(root: string): Promise<void> {
  for (const parent of [root, await safePath(root, ".tbspec")]) {
    const info = await stat(parent);
    if (info.uid !== process.getuid?.() || (info.mode & 0o022) !== 0)
      throw new Error("Runtime parent permits replacement by another user.");
    if (process.platform === "darwin") await checkMacOSAcl(parent, false);
  }
}
async function checkMacOSAcl(path: string, privateStorage: boolean): Promise<void> {
  // ls -e silently treats ACL lookup failures as absent ACLs; call the native API instead.
  const script = `
    ObjC.import('Foundation');
    ObjC.bindFunction('open', ['int', ['char *', 'int']]);
    ObjC.bindFunction('close', ['int', ['int']]);
    ObjC.bindFunction('__error', ['int *', []]);
    ObjC.bindFunction('acl_get_fd_np', ['void *', ['int', 'int']]);
    ObjC.bindFunction('acl_valid', ['int', ['void *']]);
    ObjC.bindFunction('acl_to_text', ['void *', ['void *', 'long *']]);
    ObjC.bindFunction('acl_free', ['int', ['void *']]);
    function run(argv) {
      var fd = $.open(argv[0], 0);
      if (fd < 0) throw new Error('ACL file open failed');
      try {
        var errno = $.__error();
        errno[0] = 0;
        var acl = $.acl_get_fd_np(fd, 0x100);
        var error = errno[0];
        if ($.acl_valid(acl) !== 0) {
          // ENOENT on an already-open descriptor denotes an absent ACL, not a missing path.
          if (error === 2) return JSON.stringify('!#acl 1\\n');
          throw new Error('ACL lookup failed');
        }
        try {
          var length = Ref('long');
          length[0] = '0';
          var text = $.acl_to_text(acl, length);
          if (Number(length[0]) <= 0) throw new Error('ACL export failed');
          try {
            var bytes = $.NSData.dataWithBytesLength(text, Number(length[0]));
            return JSON.stringify(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(bytes, 4)));
          } finally { $.acl_free(text); }
        } finally { $.acl_free(acl); }
      } finally { $.close(fd); }
    }
  `;
  const { stdout } = await execute("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, path], {
    timeout: 10000,
    maxBuffer: 65536,
  });
  const text: unknown = JSON.parse(stdout);
  if (typeof text !== "string") throw new Error("Invalid ACL export.");
  const [header, ...entries] = text.trim().split("\n");
  if (
    !/^!#acl 1(?: (?:no_inherit|defer_inherit)(?:,(?:no_inherit|defer_inherit))*)?$/.test(
      header ?? "",
    )
  )
    throw new Error("Unsupported ACL export.");
  for (const entry of entries) {
    const fields = entry.split(":");
    if (fields.length < 5 || fields.length > 6 || !["user", "group"].includes(fields[0] ?? ""))
      throw new Error("Unsupported ACL entry.");
    const action = fields[4]?.split(",")[0];
    if (action === "deny") continue;
    if (action !== "allow") throw new Error("Unsupported ACL entry.");
    if (fields[0] === "user" && fields[3] === String(process.getuid?.())) continue;
    const rights = fields[5]?.split(",") ?? [];
    if (
      rights.some(
        (right) =>
          privateStorage ||
          !["read", "execute", "readattr", "readextattr", "readsecurity"].includes(right),
      )
    )
      throw new Error("Non-owner ACL access.");
  }
}
export async function checkRuntimePermissions(root: string): Promise<void> {
  const path = await safePath(root, runtimePath, true);
  try {
    const paths = [await safePath(root, ".tbspec/runtime"), path];
    if (process.platform === "win32") await windowsPermissions(root, paths, false);
    else {
      await checkUnixParents(root);
      for (const checked of paths) {
        const info = await stat(checked);
        if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
          throw new Error("Non-owner access.");
        if (process.platform === "darwin") await checkMacOSAcl(checked, true);
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
  let path: string;
  let text: string;
  try {
    path = await safePath(root, runtimePath, true);
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
    const paths = [directory];
    if (process.platform === "win32") await windowsPermissions(root, paths, true);
    else {
      await checkUnixParents(root);
      for (const checked of paths) {
        if ((await stat(checked)).uid !== process.getuid?.()) throw new Error("Wrong owner.");
        if (process.platform === "darwin") await checkMacOSAcl(checked, true);
        await chmod(checked, 0o700);
      }
    }
  } catch {
    throw runtimeError(
      "unavailable",
      "RUNTIME_UNAVAILABLE",
      "Cannot secure runtime storage. The project root and .tbspec must belong to the current OS user and prevent writes by other users; their permissions are not changed.",
    );
  }
  return withRuntimeLock(root, async () => {
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
  });
}
export async function replaceRuntime(record: RuntimeRecord): Promise<void> {
  return withRuntimeLock(record.projectRoot, async () => {
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
  });
}
export async function removeRuntime(record: RuntimeRecord): Promise<void> {
  return withRuntimeLock(record.projectRoot, async () => {
    const current = await readRuntime(record.projectRoot);
    if (!current || canonical(current) !== canonical(record))
      throw runtimeError(
        "conflict",
        "RUNTIME_OWNERSHIP_UNKNOWN",
        "Runtime registration changed; no cleanup performed.",
      );
    await unlink(await safePath(record.projectRoot, runtimePath, true));
  });
}
