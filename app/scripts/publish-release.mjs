import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { isValidReleaseVersion } from "../../scripts/release-utils.mjs";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(appDirectory, "..");
const packageName = "tbspec";
const registry = "https://registry.npmjs.org/";
const artifactName = "tbspec-release-candidate";
const verificationArtifactName = "tbspec-release-verification";
const platforms = ["ubuntu", "windows", "macos-arm", "macos-intel"];
function execute(command, args, { env = process.env, timeout = 120_000 } = {}) {
  const useNpmCli = command === "npm" && env.npm_execpath;
  const useGhStub = command === "gh" && env.TBSPEC_GH_STUB;
  const executable =
    useNpmCli || useGhStub
      ? process.execPath
      : command === "npm" && process.platform === "win32"
        ? "npm.cmd"
        : command;
  const executableArgs = useNpmCli
    ? [env.npm_execpath, ...args]
    : useGhStub
      ? [env.TBSPEC_GH_STUB, ...args]
      : args;
  return spawnSync(executable, executableArgs, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env,
    maxBuffer: 50 * 1024 * 1024,
    shell: process.platform === "win32" && executable.endsWith(".cmd"),
    timeout,
    windowsHide: true,
  });
}

function requireCommand(command, args, failureMessage, options) {
  const result = execute(command, args, options);
  if (result.error || result.status !== 0) throw new Error(failureMessage);
  return result.stdout.trim();
}

function git(...args) {
  return requireCommand("git", args, `Could not verify the release checkout with git ${args[0]}.`);
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Could not read valid ${label} metadata.`);
  }
}

function parseJsonOutput(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Could not confirm ${label}; the registry response was not valid JSON.`);
  }
}

function packageListHasPackage(value) {
  if (Array.isArray(value)) return value.includes(packageName);
  return Boolean(value && typeof value === "object" && Object.hasOwn(value, packageName));
}

function targetsNpmjsRegistry(value) {
  try {
    return new URL(value).href === registry;
  } catch {
    return false;
  }
}

function npmNotFoundForPackage(result) {
  if (result.error || result.signal || result.status !== 1) return false;
  for (const output of [result.stdout, result.stderr]) {
    try {
      const response = JSON.parse(output.trim());
      const error = response?.error;
      if (
        error?.code === "E404" &&
        typeof error.summary === "string" &&
        /https:\/\/registry\.npmjs\.org\/tbspec(?:[?#\s"']|$)/i.test(error.summary)
      )
        return true;
    } catch {
      // A textual or malformed response is uncertainty, not evidence that the package is absent.
    }
  }
  return false;
}

async function checkNpmAccess(version) {
  const username = requireCommand(
    "npm",
    ["whoami", "--registry", registry],
    "npm is not authenticated to registry.npmjs.org. Authenticate and retry; credentials were not displayed.",
  );
  if (!username) throw new Error("npm did not confirm an authenticated registry account.");

  const packageListOutput = requireCommand(
    "npm",
    ["access", "list", "packages", "--json", "--registry", registry],
    "Could not confirm npm account access for registry.npmjs.org.",
  );
  const packageList = parseJsonOutput(packageListOutput, "npm account access");
  if (!packageList || typeof packageList !== "object" || Array.isArray(packageList))
    throw new Error(
      "Could not confirm npm account access; the registry response has an unexpected shape.",
    );

  const versionsResult = execute("npm", [
    "view",
    packageName,
    "versions",
    "--json",
    "--registry",
    registry,
  ]);
  let versions = [];
  const packageExists = versionsResult.status === 0 && !versionsResult.error;
  if (packageExists) {
    const value = parseJsonOutput(versionsResult.stdout.trim(), "package version metadata");
    versions = typeof value === "string" ? [value] : value;
    if (!Array.isArray(versions) || versions.some((item) => typeof item !== "string"))
      throw new Error("Could not confirm package versions from the npm registry.");
  } else if (!npmNotFoundForPackage(versionsResult)) {
    throw new Error(
      "Could not determine whether the target npm version exists; registry uncertainty blocks publication.",
    );
  }

  if (versions.includes(version))
    throw new Error(`${packageName}@${version} is already published.`);
  if (!packageExists && packageListHasPackage(packageList)) {
    throw new Error(
      "npm account access and package metadata disagree; registry uncertainty blocks publication.",
    );
  }
  if (!packageExists) return;

  const permission = packageList?.[packageName];
  if (permission !== "read-write" && permission !== "admin")
    throw new Error(
      `The authenticated npm account does not have read-write access to ${packageName}.`,
    );
}

function collectRunPages(value) {
  const pages = Array.isArray(value) ? value : [value];
  if (pages.some((page) => !Array.isArray(page.workflow_runs)))
    throw new Error("GitHub did not return a valid workflow-run list.");
  return pages.flatMap((page) => page.workflow_runs);
}

async function latestFullRun(branch, commit) {
  const response = requireCommand(
    "gh",
    [
      "api",
      "--method",
      "GET",
      "--paginate",
      "--slurp",
      "repos/TalbyAI/tbspec/actions/workflows/application.yml/runs",
      "-f",
      `branch=${branch}`,
      "-F",
      "per_page=100",
    ],
    "Could not read GitHub Actions verification history. Install and authenticate gh, then retry.",
  );
  const runs = collectRunPages(parseJsonOutput(response, "GitHub Actions workflow history"));
  const title = `Full release verification \u2014 ${branch}`;
  const relevant = runs
    .filter(
      (run) =>
        run.head_branch === branch &&
        String(run.head_sha).toLowerCase() === commit.toLowerCase() &&
        run.display_title === title &&
        (run.event === "push" || run.event === "workflow_dispatch"),
    )
    .sort(
      (left, right) =>
        Number(right.run_number) - Number(left.run_number) ||
        Number(right.run_attempt) - Number(left.run_attempt),
    );
  const run = relevant[0];
  if (!run)
    throw new Error("No complete release verification exists for this exact branch and commit.");
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(
      "The latest full verification for this release commit is pending or unsuccessful.",
    );
  }
  if (!/^\d+$/.test(String(run.id)) || !/^[1-9]\d*$/.test(String(run.run_attempt)))
    throw new Error("The latest full verification has invalid run identity metadata.");
  return run;
}

function requireSuccessfulJob(jobs, name) {
  const matches = jobs.filter((job) => job.name === name);
  if (
    matches.length !== 1 ||
    matches[0].status !== "completed" ||
    matches[0].conclusion !== "success"
  )
    throw new Error(`Full verification job ${name} did not complete successfully.`);
  return matches[0];
}

function requireSuccessfulSteps(jobs, jobName, names) {
  const job = requireSuccessfulJob(jobs, jobName);
  for (const name of names) {
    const matches = (job.steps ?? []).filter((step) => step.name === name);
    if (
      matches.length !== 1 ||
      matches[0].status !== "completed" ||
      matches[0].conclusion !== "success"
    )
      throw new Error(
        `Full verification step ${name} in ${jobName} did not complete successfully.`,
      );
  }
}

function requireSuccessfulSourceJobs(jobs) {
  const commonSteps = ["Install isolated application dependencies", "Typecheck and compile"];
  const expectedTestSteps = [
    ["Node 24 source (Ubuntu)", ["Test public operations and processes"]],
    [
      "Node 24 source (Windows standard user)",
      ["Test public operations and processes as a standard Windows user"],
    ],
    [
      "Node 24 source (macOS ARM)",
      ["Verify native macOS process identity", "Test public operations and processes"],
    ],
    [
      "Node 24 source (macOS Intel source partition 1/3)",
      ["Test public operations and processes in an Intel source partition"],
    ],
    [
      "Node 24 source (macOS Intel source partition 2/3)",
      ["Test public operations and processes in an Intel source partition"],
    ],
    [
      "Node 24 source (macOS Intel source partition 3/3)",
      ["Test public operations and processes in an Intel source partition"],
    ],
  ];
  for (const [jobName, testSteps] of expectedTestSteps)
    requireSuccessfulSteps(jobs, jobName, [...commonSteps, ...testSteps]);
}

function requireSuccessfulInstalledJobs(jobs) {
  const commonSteps = ["Set up Node", "Download the same packed artifact and SHA-256 file"];
  for (const platform of ["Ubuntu", "macOS ARM", "macOS Intel"])
    requireSuccessfulSteps(jobs, `Installed verification (${platform})`, [
      ...commonSteps,
      "Install and verify fully on non-Windows platforms",
      "Upload installed-artifact evidence",
    ]);
  requireSuccessfulSteps(jobs, "Installed verification (Windows standard user)", [
    ...commonSteps,
    "Install, verify and clean up as a standard Windows user",
    "Upload installed-artifact evidence",
  ]);
}

function successfulFullJobResults(jobs) {
  requireSuccessfulSteps(jobs, "Repository quality", [
    "Require the selected mode and quality workflow",
  ]);
  requireSuccessfulSteps(jobs, "Application typecheck and build", [
    "Install application build dependencies",
    "Typecheck application and tests",
    "Build and pack one npm artifact",
    "Publish workflow artifact for the platform matrix",
  ]);
  requireSuccessfulSteps(jobs, "Application smoke", [
    "Require the artifact producer and every platform lane",
    "Download release candidate",
    "Download all installed evidence",
    "Require complete smoke evidence and cleanup",
  ]);
  requireSuccessfulSteps(jobs, "Complete verification", [
    "Require quality, build, source, installed and smoke gates",
    "Download release candidate",
    "Download all installed evidence",
    "Bind complete verification to this run and artifact",
    "Publish complete verification evidence",
  ]);
  requireSuccessfulSourceJobs(jobs);
  requireSuccessfulInstalledJobs(jobs);
  return {
    TBSPEC_QUALITY_RESULT: "success",
    TBSPEC_BUILD_RESULT: "success",
    TBSPEC_SOURCE_RESULT: "success",
    TBSPEC_INSTALLED_RESULT: "success",
    TBSPEC_SMOKE_RESULT: "success",
  };
}

async function fullJobResults(run) {
  const response = requireCommand(
    "gh",
    ["run", "view", String(run.id), "--json", "jobs"],
    "Could not inspect jobs for the latest full verification.",
  );
  const jobs = parseJsonOutput(response, "GitHub Actions job results").jobs;
  if (!Array.isArray(jobs))
    throw new Error("GitHub did not return job results for the latest full verification.");
  return successfulFullJobResults(jobs);
}

async function recheckReleaseEligibility(branch, commit, run) {
  const latestRun = await latestFullRun(branch, commit);
  if (
    String(latestRun.id) !== String(run.id) ||
    String(latestRun.run_attempt) !== String(run.run_attempt)
  )
    throw new Error(
      "A newer full verification appeared during publication checks; rerun publish-release.",
    );
  if (
    git("branch", "--show-current") !== branch ||
    git("rev-parse", "HEAD").toLowerCase() !== commit.toLowerCase() ||
    git("status", "--porcelain", "--untracked-files=all")
  ) {
    throw new Error(
      "The release checkout changed during publication checks; restore the verified clean commit and retry.",
    );
  }
}

async function filesNamed(directory, filename) {
  const matches = [];
  async function visit(currentDirectory) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name === filename) matches.push(entryPath);
    }
  }
  await visit(directory);
  return matches;
}

async function oneDownloadedFile(directory, filename, label) {
  const matches = await filesNamed(directory, filename);
  if (matches.length !== 1)
    throw new Error(`${label} is missing, duplicated or expired; run complete verification again.`);
  return matches[0];
}

async function downloadArtifact(run, name, directory) {
  await mkdir(directory, { recursive: true });
  const result = execute("gh", [
    "run",
    "download",
    String(run.id),
    "--name",
    name,
    "--dir",
    directory,
  ]);
  if (result.error || result.status !== 0)
    throw new Error(
      `GitHub artifact ${name} is unavailable or expired; run complete verification again.`,
    );
}

async function downloadReleaseEvidence(run, version, temporaryDirectory) {
  const rawArchiveDirectory = path.join(temporaryDirectory, "archive-download");
  const archiveDirectory = path.join(temporaryDirectory, "archive");
  const evidenceDirectory = path.join(temporaryDirectory, "evidence");
  const reportDownloadDirectory = path.join(temporaryDirectory, "report-download");
  await Promise.all([mkdir(archiveDirectory), mkdir(evidenceDirectory)]);

  await downloadArtifact(run, artifactName, rawArchiveDirectory);
  const archiveName = `${packageName}-${version}.tgz`;
  const archivePath = await oneDownloadedFile(rawArchiveDirectory, archiveName, "Release archive");
  const sidecarPath = await oneDownloadedFile(
    rawArchiveDirectory,
    `${archiveName}.sha256`,
    "Release archive digest",
  );
  await Promise.all([
    cp(archivePath, path.join(archiveDirectory, archiveName)),
    cp(sidecarPath, path.join(archiveDirectory, `${archiveName}.sha256`)),
  ]);

  for (const platform of platforms) {
    const artifact = `tbspec-installed-evidence-${platform}`;
    const downloadDirectory = path.join(temporaryDirectory, `evidence-${platform}-download`);
    await downloadArtifact(run, artifact, downloadDirectory);
    const evidence = await oneDownloadedFile(
      downloadDirectory,
      `${platform}.json`,
      `${platform} verification evidence`,
    );
    await cp(evidence, path.join(evidenceDirectory, `${platform}.json`));
  }

  await downloadArtifact(run, verificationArtifactName, reportDownloadDirectory);
  const reportPath = await oneDownloadedFile(
    reportDownloadDirectory,
    "verification.json",
    "Complete verification report",
  );
  return { archiveDirectory, evidenceDirectory, reportPath, archiveName };
}

async function verifyDownloadedEvidence(
  run,
  branch,
  commit,
  version,
  jobsEnv,
  downloaded,
  temporaryDirectory,
) {
  const storedManifest = await readJson(downloaded.reportPath, "complete verification report");
  const outputDirectory = path.join(temporaryDirectory, "revalidated-report");
  const validationEnvironment = {
    ...process.env,
    ...jobsEnv,
    TBSPEC_VERIFICATION_MODE: "full",
    TBSPEC_REPOSITORY: "TalbyAI/tbspec",
    TBSPEC_COMMIT: commit,
    TBSPEC_BRANCH: branch,
    TBSPEC_RUN_ID: String(run.id),
    TBSPEC_RUN_ATTEMPT: String(run.run_attempt),
  };
  const validator = path.join(appDirectory, "scripts", "validate-verification.mjs");
  const validation = execute(
    process.execPath,
    [validator, downloaded.archiveDirectory, downloaded.evidenceDirectory, "full", outputDirectory],
    { env: validationEnvironment },
  );
  if (validation.error || validation.status !== 0)
    throw new Error(
      `Downloaded artifact or platform evidence did not validate: ${validation.stderr.trim()}`,
    );

  const validatedManifest = await readJson(
    path.join(outputDirectory, "verification.json"),
    "revalidated report",
  );
  if (
    storedManifest.verification?.mode !== "full" ||
    storedManifest.verification?.repository !== "TalbyAI/tbspec" ||
    storedManifest.verification?.commit?.toLowerCase() !== commit.toLowerCase() ||
    storedManifest.verification?.branch !== branch ||
    storedManifest.verification?.runId !== String(run.id) ||
    storedManifest.verification?.runAttempt !== String(run.run_attempt) ||
    storedManifest.artifact?.filename !== downloaded.archiveName ||
    storedManifest.artifact?.applicationVersion !== version ||
    !isDeepStrictEqual(storedManifest, validatedManifest)
  ) {
    throw new Error(
      "The downloaded full verification report does not match this commit, run, evidence and archive.",
    );
  }
}

function publicationFailure(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  if (/\bEOTP\b|one-time password|\botp\b/i.test(output))
    return "npm requires additional one-time authentication. Configure npm's current authentication requirement and retry; credentials were not displayed.";
  if (/\bENEEDAUTH\b|\bE401\b|not authenticated/i.test(output))
    return "npm authentication is no longer valid for registry.npmjs.org. Authenticate and retry; credentials were not displayed.";
  if (/\bE403\b|403 Forbidden|permission|not authorized/i.test(output))
    return `npm denied publication. Confirm read-write access to ${packageName} and any required one-time authentication; credentials were not displayed.`;
  return "npm could not publish the verified archive. Check registry availability and npm's reported error without sharing credentials.";
}

async function main() {
  if (process.argv.length !== 2) throw new Error("publish-release takes no arguments.");
  const branch = git("branch", "--show-current");
  const match = /^release\/(.+)$/.exec(branch);
  const version = match?.[1];
  if (!version || !isValidReleaseVersion(version) || version.includes("+"))
    throw new Error(
      "Publish from a versioned release/<version> branch with a canonical npm version.",
    );

  const manifest = await readJson(path.join(appDirectory, "package.json"), "application package");
  const lock = await readJson(path.join(appDirectory, "package-lock.json"), "application lockfile");
  if (
    manifest.name !== packageName ||
    manifest.version !== version ||
    lock.version !== version ||
    lock.packages?.[""]?.version !== version
  )
    throw new Error("The release branch version must match the application package and lockfile.");
  if (manifest.private === true)
    throw new Error("The application package is still marked private and cannot be published.");
  if (
    manifest.publishConfig?.registry !== undefined &&
    !targetsNpmjsRegistry(manifest.publishConfig.registry)
  )
    throw new Error(
      "The application publishConfig registry conflicts with the intended registry.npmjs.org destination.",
    );
  if (git("status", "--porcelain", "--untracked-files=all"))
    throw new Error("Publish only from a clean release checkout.");
  const commit = git("rev-parse", "HEAD");

  await checkNpmAccess(version);
  const run = await latestFullRun(branch, commit);
  const jobsEnv = await fullJobResults(run);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tbspec-release-publish-"));
  try {
    const downloaded = await downloadReleaseEvidence(run, version, temporaryDirectory);
    await verifyDownloadedEvidence(
      run,
      branch,
      commit,
      version,
      jobsEnv,
      downloaded,
      temporaryDirectory,
    );
    await recheckReleaseEligibility(branch, commit, run);

    const publication = execute("npm", [
      "publish",
      path.join(downloaded.archiveDirectory, downloaded.archiveName),
      "--ignore-scripts",
      "--registry",
      registry,
    ]);
    if (publication.error || publication.status !== 0)
      throw new Error(publicationFailure(publication));
    console.log(`Published ${packageName}@${version} from the verified archive for ${commit}.`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
