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
function macOSTimeval(bytes: Buffer): string {
  const seconds = bytes.readBigInt64LE(0);
  // Darwin user64_timeval has a signed 32-bit tv_usec followed by padding.
  const micros = bytes.readInt32LE(8);
  if (seconds <= 0n || seconds > BigInt(Number.MAX_SAFE_INTEGER) || micros < 0 || micros >= 1000000)
    throw new Error("Invalid macOS OS timestamp.");
  return `${seconds}:${micros}`;
}
export function parseMacOSIdentity(
  host: string,
  boot: Buffer,
  processRecord: Buffer,
  pid: number,
): ProcessIdentity {
  const hosts = [...host.matchAll(/"IOPlatformUUID"\s*=\s*"([^"]*)"/g)];
  const uuid = hosts[0]?.[1];
  if (
    hosts.length !== 1 ||
    !uuid ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid) ||
    boot.length !== 16 ||
    processRecord.length !== 648 ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    processRecord.readInt32LE(40) !== pid ||
    ![2, 3, 4].includes(processRecord.readInt8(36))
  )
    throw new Error("Incomplete or unsupported macOS process identity.");
  // LP64 user64_kinfo_proc: start timeval at 0, status at 36, pid at 40.
  // Reject other layouts rather than guessing offsets or falling back to ps/PID.
  return {
    hostId: osIdentity("macos-platform-uuid", uuid.toUpperCase()),
    bootId: osIdentity("macos-kernel-boot-time", macOSTimeval(boot)),
    pid,
    processStartId: osIdentity("macos-kinfo-proc64-start-time", macOSTimeval(processRecord)),
  };
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
  if (process.platform === "darwin" && ["arm64", "x64"].includes(process.arch)) {
    const options = { timeout: 10000, maxBuffer: 65536, encoding: "buffer" as const };
    const [host, boot, processRecord] = await Promise.all([
      execute("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], options),
      execute("/usr/sbin/sysctl", ["-b", "kern.boottime"], options),
      execute("/usr/sbin/sysctl", ["-b", `kern.proc.pid.${pid}`], options),
    ]);
    return parseMacOSIdentity(host.stdout.toString("utf8"), boot.stdout, processRecord.stdout, pid);
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
