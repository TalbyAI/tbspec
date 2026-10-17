import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isValidReleaseVersion } from "../../scripts/release-utils.mjs";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = "https://registry.npmjs.org/";

class ReleaseVerificationFailure extends Error {}

function requireCondition(condition, code) {
  if (!condition) throw new ReleaseVerificationFailure(code);
}

function parseJson(value, code) {
  try {
    return JSON.parse(value);
  } catch {
    throw new ReleaseVerificationFailure(code);
  }
}

function npm(args, directory) {
  const cli = process.env.npm_execpath;
  const executable = cli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(executable, cli ? [cli, ...args] : args, {
    cwd: directory,
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
    windowsHide: true,
  });
}

async function main() {
  let mode;
  try {
    const { values } = parseArgs({ options: { mode: { type: "string", default: "smoke" } } });
    mode = values.mode;
    if (mode !== "smoke" && mode !== "full") throw new Error();
  } catch {
    throw new Error("Usage: verify-release [--mode smoke|full].");
  }
  const manifest = JSON.parse(await readFile(path.join(appDirectory, "package.json"), "utf8"));
  const version = manifest.version;
  if (manifest.name !== "tbspec" || !isValidReleaseVersion(version) || version.includes("+"))
    throw new Error(
      "The application must be tbspec with a canonical npm version without build metadata.",
    );

  const reportDirectory = await mkdtemp(path.join(tmpdir(), "tbspec-release-verification-"));
  const evidenceFile = path.join(reportDirectory, "verification.json");
  const downloadDirectory = path.join(reportDirectory, "download");
  const installedEvidencePath = path.join(downloadDirectory, "installed.json");
  const report = {
    schemaVersion: 1,
    state: "running",
    version,
    mode,
    registry,
    platform: { platform: process.platform, architecture: process.arch, node: process.version },
    startedAt: new Date().toISOString(),
    completedAt: null,
    artifact: null,
    installed: null,
    cleanup: { state: "pending" },
    failure: null,
  };
  let step = "download-setup";
  try {
    await mkdir(downloadDirectory);
    const cache = path.join(downloadDirectory, "cache");
    await mkdir(cache);
    const spec = `tbspec@${version}`;
    const options = ["--json", "--registry", registry, "--cache", cache, "--prefer-online"];
    step = "registry-metadata";
    const lookup = npm(["view", spec, ...options], downloadDirectory);
    requireCondition(!lookup.error && lookup.status === 0, "REGISTRY_METADATA_UNAVAILABLE");
    const metadata = parseJson(lookup.stdout, "REGISTRY_METADATA_INVALID");
    const tarball = `${registry}tbspec/-/tbspec-${version}.tgz`;
    requireCondition(
      metadata?.name === "tbspec" &&
        metadata.version === version &&
        metadata.dist?.tarball === tarball &&
        typeof metadata.dist.integrity === "string" &&
        /^sha512-[A-Za-z0-9+/]{86}==$/.test(metadata.dist.integrity),
      "REGISTRY_METADATA_INVALID",
    );
    step = "registry-download";
    const download = npm(
      ["pack", spec, ...options, "--ignore-scripts", "--pack-destination", downloadDirectory],
      downloadDirectory,
    );
    requireCondition(!download.error && download.status === 0, "REGISTRY_DOWNLOAD_FAILED");
    const filename = `tbspec-${version}.tgz`;
    const archive = path.join(downloadDirectory, filename);
    step = "registry-integrity";
    const bytes = await readFile(archive);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    requireCondition(integrity === metadata.dist.integrity, "REGISTRY_INTEGRITY_MISMATCH");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    report.artifact = { filename, tarball, integrity, sha256, bytes: bytes.length };
    await writeFile(`${archive}.sha256`, `${sha256}  ${filename}\n`);

    step = "installed-verification";
    const verification = spawnSync(
      process.execPath,
      [path.join(appDirectory, "scripts", "verify-packed-application.mjs"), archive],
      {
        cwd: downloadDirectory,
        env: {
          ...process.env,
          TBSPEC_VERIFICATION_MODE: mode,
          TBSPEC_EVIDENCE_PATH: installedEvidencePath,
        },
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      },
    );
    try {
      report.installed = parseJson(
        await readFile(installedEvidencePath, "utf8"),
        "INSTALLED_RESULT_INVALID",
      );
    } catch {
      requireCondition(false, "INSTALLED_RESULT_INVALID");
    }
    requireCondition(
      !verification.error && verification.status === 0,
      "INSTALLED_VERIFICATION_FAILED",
    );
    requireCondition(
      report.installed?.state === "passed" &&
        report.installed.verification?.mode === mode &&
        report.installed.artifact?.applicationVersion === version &&
        report.installed.artifact.sha256 === sha256 &&
        report.installed.artifact.bytes === bytes.length,
      "INSTALLED_RESULT_INVALID",
    );
    report.state = "passed";
  } catch (error) {
    report.state = "failed";
    report.failure = {
      step,
      code:
        error instanceof ReleaseVerificationFailure ? error.message : "RELEASE_VERIFICATION_FAILED",
    };
  } finally {
    try {
      // The download directory is fixed under this invocation's freshly created report directory.
      requireCondition(
        path.dirname(downloadDirectory) === reportDirectory &&
          path.basename(downloadDirectory) === "download",
        "DOWNLOAD_CLEANUP_FAILED",
      );
      await rm(downloadDirectory, { recursive: true, force: true });
      requireCondition(
        !(await readdir(reportDirectory)).includes("download"),
        "DOWNLOAD_CLEANUP_FAILED",
      );
      report.cleanup.state = "verified-download-directory-removed";
    } catch {
      report.state = "failed";
      report.cleanup.state = "failed";
      report.failure ??= { step: "download-cleanup", code: "DOWNLOAD_CLEANUP_FAILED" };
    }
    report.completedAt = new Date().toISOString();
    await writeFile(evidenceFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(
    JSON.stringify({
      state: report.state,
      version,
      mode,
      sha256: report.artifact?.sha256 ?? null,
      evidenceFile,
    }),
  );
  if (report.state !== "passed") {
    console.error(`Release verification failed: ${report.failure.code}. See ${evidenceFile}.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error && !error.code
      ? error.message
      : "Could not initialize or save release verification evidence.",
  );
  process.exitCode = 1;
});
