import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

export async function privateDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(prefix);
  if (process.platform === "win32") {
    // Test runners can inherit sandbox accounts with write access to temporary roots.
    const literal = `'${path.replaceAll("'", "''")}'`;
    const script = `$ErrorActionPreference='Stop'; $sidValue=[Security.Principal.WindowsIdentity]::GetCurrent().User; $aclValue=[Security.AccessControl.DirectorySecurity]::new(); $aclValue.SetAccessRuleProtection($true,$false); $ruleValue=[Security.AccessControl.FileSystemAccessRule]::new($sidValue,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $aclValue.AddAccessRule($ruleValue); [IO.Directory]::SetAccessControl(${literal},$aclValue);`;
    await promisify(execFile)(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
    );
  }
  return path;
}
