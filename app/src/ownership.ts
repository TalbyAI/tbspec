import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { canonical } from "./canonical.ts";

const execute = promisify(execFile);
export function token(): string {
  return randomBytes(32).toString("base64url");
}
export interface ProcessIdentity {
  hostId: string;
  bootId: string;
  pid: number;
  processStartId: string;
}
function osIdentity(provider: string, value: string): string {
  if (!value) throw new Error("OS identity unavailable.");
  return `os:v1:${Buffer.from(canonical({ provider, value })).toString("base64url")}`;
}
let ownIdentity: Promise<ProcessIdentity> | undefined;
export async function processIdentity(pid = process.pid): Promise<ProcessIdentity> {
  if (pid !== process.pid) return readProcessIdentity(pid);
  ownIdentity ??= readProcessIdentity(pid);
  return ownIdentity;
}
async function readProcessIdentity(pid: number): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid process ID.");
  if (process.platform === "win32") {
    const shell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const script = `$ErrorActionPreference='Stop'; $hostValue=(Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Cryptography').MachineGuid; $bootValue=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o'); $startValue=(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o'); ConvertTo-Json -Compress -InputObject @($hostValue,$bootValue,$startValue)`;
    const { stdout } = await execute(shell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 65536,
    });
    const values: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ""));
    if (
      !Array.isArray(values) ||
      values.length !== 3 ||
      values.some((value) => typeof value !== "string" || !value)
    )
      throw new Error("Incomplete Windows process identity.");
    return {
      hostId: osIdentity("windows-machine-guid", values[0]),
      bootId: osIdentity("windows-boot-time", values[1]),
      pid,
      processStartId: osIdentity("windows-process-start", values[2]),
    };
  }
  if (process.platform === "linux") {
    const [host, boot, stat] = await Promise.all([
      readFile("/etc/machine-id", "utf8"),
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return {
      hostId: osIdentity("linux-machine-id", host.trim()),
      bootId: osIdentity("linux-boot-id", boot.trim()),
      pid,
      processStartId: osIdentity("linux-proc-start-ticks", fields[19] ?? ""),
    };
  }
  throw new Error(`Full OS process identity is not implemented for ${process.platform}.`);
}
export async function verifyIdentity(identity: ProcessIdentity): Promise<boolean> {
  try {
    return canonical(await processIdentity(identity.pid)) === canonical(identity);
  } catch {
    return false;
  }
}
