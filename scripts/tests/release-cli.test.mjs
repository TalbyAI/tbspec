import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const prepareScript = path.join(repositoryRoot, "app", "scripts", "prepare-release.mjs");
const publishScript = path.join(repositoryRoot, "app", "scripts", "publish-release.mjs");
const verificationScript = path.join(repositoryRoot, "app", "scripts", "validate-verification.mjs");
const releaseVersion = "1.2.3";
const platformKeys = ["ubuntu", "windows", "macos-arm", "macos-intel"];
const fullScenarios = [
  "dynamic-version-and-runtime-compatibility",
  "project-conceptual-concrete-schema-forms",
  "directory-acquisition-check-update",
  "accepted-vocabulary-replacement",
  "independent-views-and-design-ties",
  "retained-transitive-ontology-conflict",
  "breaking-removal-repair-ordinary-deletion-gc",
  "malformed-source-isolated-query",
];
const fullAssertions = [
  "installed-public-bin:--version",
  "installed-public-bin:--help",
  "smoke-project-initialize-and-read",
  "smoke-persisted-model-readback",
  "smoke-authenticated-status",
  "smoke-unauthenticated-status-rejected",
  "web-stop-verified",
  "public-command-family-help-and-one-envelope-routing",
];
const sourceJobNames = [
  "Node 24 source (Ubuntu)",
  "Node 24 source (Windows standard user)",
  "Node 24 source (macOS ARM)",
  "Node 24 source (macOS Intel source partition 1/3)",
  "Node 24 source (macOS Intel source partition 2/3)",
  "Node 24 source (macOS Intel source partition 3/3)",
];
const installedJobNames = [
  "Installed verification (Ubuntu)",
  "Installed verification (Windows standard user)",
  "Installed verification (macOS ARM)",
  "Installed verification (macOS Intel)",
];

async function makeReleaseFixture(t) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tbspec-release-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));

  const root = path.join(temporaryDirectory, "repo");
  const bareRemote = path.join(temporaryDirectory, "origin.git");
  await mkdir(path.join(root, "app", "scripts"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await cp(prepareScript, path.join(root, "app", "scripts", "prepare-release.mjs"));
  await cp(
    path.join(repositoryRoot, "scripts", "release-utils.mjs"),
    path.join(root, "scripts", "release-utils.mjs"),
  );
  await writeFile(
    path.join(root, "app", "package.json"),
    `${JSON.stringify({ name: "tbspec", version: "0.1.0", private: true }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "app", "package-lock.json"),
    `${JSON.stringify(
      {
        name: "tbspec",
        version: "0.1.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "tbspec", version: "0.1.0" } },
      },
      null,
      2,
    )}\n`,
  );
  execFileSync("git", ["init", "--bare", bareRemote], { stdio: "ignore" });
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "release-test@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "--all"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Initial application version"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: root });
  execFileSync("git", ["push", "--set-upstream", "origin", "main"], { cwd: root, stdio: "ignore" });

  return { root, bareRemote, temporaryDirectory };
}

function runPrepare(root, version) {
  return spawnSync(
    process.execPath,
    [path.join(root, "app", "scripts", "prepare-release.mjs"), version],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function makePublishFixture(t) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "tbspec-publish-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const root = path.join(temporaryDirectory, "repo");
  const stubDirectory = path.join(temporaryDirectory, "stubs");
  const artifactsDirectory = path.join(temporaryDirectory, "artifacts");
  await mkdir(path.join(root, "app", "scripts"), { recursive: true });
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await mkdir(stubDirectory, { recursive: true });
  await cp(publishScript, path.join(root, "app", "scripts", "publish-release.mjs"));
  await cp(verificationScript, path.join(root, "app", "scripts", "validate-verification.mjs"));
  await cp(
    path.join(repositoryRoot, "scripts", "release-utils.mjs"),
    path.join(root, "scripts", "release-utils.mjs"),
  );
  await writeFile(
    path.join(root, "app", "package.json"),
    `${JSON.stringify({ name: "tbspec", version: releaseVersion }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "app", "package-lock.json"),
    `${JSON.stringify(
      {
        name: "tbspec",
        version: releaseVersion,
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "tbspec", version: releaseVersion } },
      },
      null,
      2,
    )}\n`,
  );
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "release-test@example.invalid"], { cwd: root });
  execFileSync("git", ["add", "--all"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Initial release version"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["switch", "--create", `release/${releaseVersion}`], {
    cwd: root,
    stdio: "ignore",
  });

  const commit = git(root, "rev-parse", "HEAD");
  const run = {
    id: 123456789,
    run_number: 10,
    run_attempt: 2,
    head_branch: `release/${releaseVersion}`,
    head_sha: commit,
    event: "push",
    status: "completed",
    conclusion: "success",
    display_title: `Full release verification \u2014 release/${releaseVersion}`,
  };
  const jobSteps = {
    "Repository quality": ["Require the selected mode and quality workflow"],
    "Application typecheck and build": [
      "Install application build dependencies",
      "Typecheck application and tests",
      "Build and pack one npm artifact",
      "Publish workflow artifact for the platform matrix",
    ],
    [sourceJobNames[0]]: [
      "Install isolated application dependencies",
      "Typecheck and compile",
      "Test public operations and processes",
    ],
    [sourceJobNames[1]]: [
      "Install isolated application dependencies",
      "Typecheck and compile",
      "Test public operations and processes as a standard Windows user",
    ],
    [sourceJobNames[2]]: [
      "Install isolated application dependencies",
      "Typecheck and compile",
      "Verify native macOS process identity",
      "Test public operations and processes",
    ],
    [sourceJobNames[3]]: [
      "Install isolated application dependencies",
      "Typecheck and compile",
      "Test public operations and processes in an Intel source partition",
    ],
    [sourceJobNames[4]]: [
      "Install isolated application dependencies",
      "Typecheck and compile",
      "Test public operations and processes in an Intel source partition",
    ],
    [sourceJobNames[5]]: [
      "Install isolated application dependencies",
      "Typecheck and compile",
      "Test public operations and processes in an Intel source partition",
    ],
    [installedJobNames[0]]: [
      "Set up Node",
      "Download the same packed artifact and SHA-256 file",
      "Install and verify fully on non-Windows platforms",
      "Upload installed-artifact evidence",
    ],
    [installedJobNames[1]]: [
      "Set up Node",
      "Download the same packed artifact and SHA-256 file",
      "Install, verify and clean up as a standard Windows user",
      "Upload installed-artifact evidence",
    ],
    [installedJobNames[2]]: [
      "Set up Node",
      "Download the same packed artifact and SHA-256 file",
      "Install and verify fully on non-Windows platforms",
      "Upload installed-artifact evidence",
    ],
    [installedJobNames[3]]: [
      "Set up Node",
      "Download the same packed artifact and SHA-256 file",
      "Install and verify fully on non-Windows platforms",
      "Upload installed-artifact evidence",
    ],
    "Application smoke": [
      "Require the artifact producer and every platform lane",
      "Download release candidate",
      "Download all installed evidence",
      "Require complete smoke evidence and cleanup",
    ],
    "Complete verification": [
      "Require quality, build, source, installed and smoke gates",
      "Download release candidate",
      "Download all installed evidence",
      "Bind complete verification to this run and artifact",
      "Publish complete verification evidence",
    ],
  };
  const jobs = Object.entries(jobSteps).map(([name, stepNames]) => ({
    name,
    status: "completed",
    conclusion: "success",
    steps: stepNames.map((stepName) => ({
      name: stepName,
      status: "completed",
      conclusion: "success",
    })),
  }));
  await writeFile(path.join(temporaryDirectory, "runs.json"), JSON.stringify([run]));
  await writeFile(path.join(temporaryDirectory, "jobs.json"), JSON.stringify(jobs));

  const candidateDirectory = path.join(artifactsDirectory, "tbspec-release-candidate");
  const evidenceDirectory = path.join(artifactsDirectory, "evidence");
  const reportDirectory = path.join(artifactsDirectory, "tbspec-release-verification");
  await mkdir(candidateDirectory, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });
  await mkdir(reportDirectory, { recursive: true });
  const archiveName = `tbspec-${releaseVersion}.tgz`;
  const archiveBytes = Buffer.from("exact validated release archive fixture");
  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  await writeFile(path.join(candidateDirectory, archiveName), archiveBytes);
  await writeFile(
    path.join(candidateDirectory, `${archiveName}.sha256`),
    `${digest}  ${archiveName}\n`,
  );

  for (const platformKey of platformKeys) {
    const evidence = {
      schemaVersion: 1,
      state: "passed",
      verification: {
        mode: "full",
        platformKey,
        repository: "TalbyAI/tbspec",
        commit,
        branch: `release/${releaseVersion}`,
        runId: String(run.id),
        runAttempt: String(run.run_attempt),
        startedAt: "2026-10-17T09:00:00.000Z",
        completedAt: "2026-10-17T09:01:00.000Z",
        durationMs: 60_000,
        ...(platformKey === "windows"
          ? { durationScope: "windows-standard-user-installed-verification-and-cleanup" }
          : {}),
      },
      artifact: {
        filename: archiveName,
        bytes: archiveBytes.byteLength,
        sha256: digest,
        applicationVersion: releaseVersion,
      },
      platform: {
        platform:
          platformKey === "ubuntu" ? "linux" : platformKey === "windows" ? "win32" : "darwin",
        architecture: platformKey === "macos-arm" ? "arm64" : "x64",
        node: "v24.0.0",
        npm: "11.0.0",
      },
      installs: [{ offline: true, emptyCacheBeforeInstall: true, exit: 0, errorCode: null }],
      http: [
        { route: "/status", method: "GET", status: 200, authenticated: true },
        { route: "/status", method: "GET", status: 401, authenticated: false },
      ],
      assertions: [
        ...fullAssertions.map((name) => ({ name, passed: true })),
        { name: "served-browser-assets-match-launched-release", passed: true, count: 2 },
        ...(platformKey === "windows"
          ? [{ name: "windows-standard-user-cleanup-verified", passed: true }]
          : []),
      ],
      scenarios: fullScenarios.map((name) => ({ name, status: "passed" })),
      cleanup: [
        { state: "stopped-and-verified" },
        { state: "verified-owned-temporary-root-removed" },
        ...(platformKey === "windows"
          ? [{ state: "standard-user-account-removed" }, { state: "shared-test-directory-removed" }]
          : []),
      ],
    };
    const platformDirectory = path.join(
      evidenceDirectory,
      `tbspec-installed-evidence-${platformKey}`,
    );
    await mkdir(platformDirectory, { recursive: true });
    await writeFile(
      path.join(platformDirectory, `${platformKey}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  }

  const validationDirectory = path.join(temporaryDirectory, "initial-validation");
  const combinedEvidence = path.join(temporaryDirectory, "all-evidence");
  await mkdir(combinedEvidence, { recursive: true });
  for (const platformKey of platformKeys)
    await cp(
      path.join(
        evidenceDirectory,
        `tbspec-installed-evidence-${platformKey}`,
        `${platformKey}.json`,
      ),
      path.join(combinedEvidence, `${platformKey}.json`),
    );
  const report = spawnSync(
    process.execPath,
    [
      path.join(root, "app", "scripts", "validate-verification.mjs"),
      candidateDirectory,
      combinedEvidence,
      "full",
      validationDirectory,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TBSPEC_VERIFICATION_MODE: "full",
        TBSPEC_REPOSITORY: "TalbyAI/tbspec",
        TBSPEC_COMMIT: commit,
        TBSPEC_BRANCH: `release/${releaseVersion}`,
        TBSPEC_RUN_ID: String(run.id),
        TBSPEC_RUN_ATTEMPT: String(run.run_attempt),
        TBSPEC_QUALITY_RESULT: "success",
        TBSPEC_BUILD_RESULT: "success",
        TBSPEC_SOURCE_RESULT: "success",
        TBSPEC_INSTALLED_RESULT: "success",
        TBSPEC_SMOKE_RESULT: "success",
      },
    },
  );
  if (report.status !== 0) throw new Error(`Publish fixture evidence failed: ${report.stderr}`);
  await cp(
    path.join(validationDirectory, "verification.json"),
    path.join(reportDirectory, "verification.json"),
  );

  const ghStub = `const fs = require("node:fs");
const path = require("node:path");
const fixture = process.env.RELEASE_STUB_FIXTURE;
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "api") {
  if (args[args.indexOf("--method") + 1] !== "GET") process.exit(2);
  process.stdout.write(JSON.stringify([{ workflow_runs: JSON.parse(fs.readFileSync(path.join(fixture, "runs.json"), "utf8")) }]));
} else if (args[0] === "run" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ jobs: JSON.parse(fs.readFileSync(path.join(fixture, "jobs.json"), "utf8")) }));
} else if (args[0] === "run" && args[1] === "download") {
  const name = args[args.indexOf("--name") + 1];
  const destination = args[args.indexOf("--dir") + 1];
  if (process.env.GH_STUB_MISSING_ARTIFACT === name) process.exit(1);
  const source = name === "tbspec-release-candidate"
    ? path.join(fixture, "artifacts", name)
    : name === "tbspec-release-verification"
      ? path.join(fixture, "artifacts", name)
      : path.join(fixture, "artifacts", "evidence", name);
  if (!fs.existsSync(source)) process.exit(1);
  fs.cpSync(source, destination, { recursive: true });
  if (name === "tbspec-release-candidate" && process.env.GH_STUB_MUTATE_CHECKOUT === "true") {
    fs.writeFileSync(path.join(process.cwd(), "late-checkout-change.txt"), "changed during download\\n");
  }
  if (name === "tbspec-release-candidate" && process.env.GH_STUB_NEWER_FULL_AFTER_DOWNLOAD === "true") {
    const runsPath = path.join(fixture, "runs.json");
    const runs = JSON.parse(fs.readFileSync(runsPath, "utf8"));
    runs.push({ ...runs[0], run_attempt: runs[0].run_attempt + 1 });
    fs.writeFileSync(runsPath, JSON.stringify(runs));
  }
} else {
  process.exit(2);
}
`;
  await writeFile(path.join(stubDirectory, "gh-stub.cjs"), ghStub);
  const ghStubPath = path.join(stubDirectory, "gh-stub.cjs");

  const npmStub = `const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const command = args[0];
function record(value) { fs.appendFileSync(process.env.NPM_STUB_LOG, JSON.stringify(value) + "\\n"); }
record({ args });
if (command === "whoami") {
  if (process.env.NPM_STUB_WHOAMI_ERROR) {
    process.stderr.write(process.env.NPM_STUB_WHOAMI_ERROR);
    process.exit(1);
  }
  process.stdout.write("test-user\\n");
} else if (command === "view") {
  if (process.env.NPM_STUB_VIEW_ERROR === "missing") {
    process.stderr.write(JSON.stringify({ error: { code: "E404", summary: "Not Found - GET https://registry.npmjs.org/tbspec - Not found" } }));
    process.exit(1);
  }
  if (process.env.NPM_STUB_VIEW_ERROR === "text404") {
    process.stderr.write("npm error code E404\\nnpm error 404 Not Found - GET https://registry.npmjs.org/tbspec - Not found\\n");
    process.exit(1);
  }
  if (process.env.NPM_STUB_VIEW_ERROR) {
    process.stderr.write("npm error code E503\\nnpm error 503 Service Unavailable\\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(JSON.parse(process.env.NPM_STUB_VERSIONS || "[]")) + "\\n");
} else if (command === "access" && args[1] === "list" && args[2] === "packages") {
  process.stdout.write(JSON.stringify(JSON.parse(process.env.NPM_STUB_PACKAGES || "{}")) + "\\n");
} else if (command === "publish") {
  const archive = args[1];
  record({ publishArchive: archive, archiveSha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(archive)).digest("hex") });
  if (process.env.NPM_STUB_PUBLISH_ERROR) {
    process.stderr.write(process.env.NPM_STUB_PUBLISH_ERROR);
    process.exit(1);
  }
  process.stdout.write("published\\n");
} else {
  process.exit(2);
}
`;
  const npmStubPath = path.join(stubDirectory, "npm-stub.cjs");
  await writeFile(npmStubPath, npmStub);
  const npmCalls = path.join(temporaryDirectory, "npm-calls.jsonl");
  const ghCalls = path.join(temporaryDirectory, "gh-calls.jsonl");
  const environment = {
    ...process.env,
    PATH: [stubDirectory, process.env.PATH].join(path.delimiter),
    npm_execpath: npmStubPath,
    NPM_STUB_LOG: npmCalls,
    NPM_STUB_VIEW_ERROR: "missing",
    NPM_STUB_PACKAGES: "{}",
    GH_STUB_LOG: ghCalls,
    TBSPEC_GH_STUB: ghStubPath,
    RELEASE_STUB_FIXTURE: temporaryDirectory,
  };
  return {
    root,
    temporaryDirectory,
    artifactsDirectory,
    candidateDirectory,
    evidenceDirectory,
    reportDirectory,
    stubDirectory,
    npmCalls,
    ghCalls,
    environment,
    run,
    jobs,
    commit,
    digest,
    archiveName,
  };
}

function runPublish(fixture, env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(fixture.root, "app", "scripts", "publish-release.mjs")],
    {
      cwd: fixture.root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...fixture.environment, ...env },
    },
  );
}

async function readJsonLines(file) {
  try {
    return (await readFile(file, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test("release preparation commits matching version metadata locally without pushing", async (t) => {
  const { root } = await makeReleaseFixture(t);
  const originalCommit = git(root, "rev-parse", "HEAD");
  const result = runPrepare(root, "1.2.3-rc.1");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(root, "branch", "--show-current"), "release/1.2.3-rc.1");
  assert.notEqual(git(root, "rev-parse", "HEAD"), originalCommit);
  assert.equal(git(root, "status", "--porcelain"), "");
  assert.equal(git(root, "ls-remote", "origin", "refs/heads/release/1.2.3-rc.1"), "");

  const manifest = JSON.parse(await readFile(path.join(root, "app", "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(root, "app", "package-lock.json"), "utf8"));
  assert.equal(manifest.version, "1.2.3-rc.1");
  assert.equal(lock.version, "1.2.3-rc.1");
  assert.equal(lock.packages[""].version, "1.2.3-rc.1");
});

test("release preparation rejects an invalid version without changing the checkout", async (t) => {
  const invalidVersions = ["v1.2.3", "9007199254740992.0.0", `1.0.0-${"a".repeat(251)}`, "1.0.0\n"];
  for (const version of invalidVersions) {
    const { root } = await makeReleaseFixture(t);
    const originalCommit = git(root, "rev-parse", "HEAD");
    const originalPackage = await readFile(path.join(root, "app", "package.json"), "utf8");
    const result = runPrepare(root, version);

    assert.notEqual(result.status, 0, `accepted invalid version ${JSON.stringify(version)}`);
    assert.match(result.stderr, /valid npm semantic version/i);
    assert.equal(git(root, "rev-parse", "HEAD"), originalCommit);
    assert.equal(git(root, "branch", "--show-current"), "main");
    assert.equal(git(root, "status", "--porcelain"), "");
    assert.equal(await readFile(path.join(root, "app", "package.json"), "utf8"), originalPackage);
  }
});

test("release preparation rejects versions that npm cannot preserve as distinct release identities", async (t) => {
  const { root } = await makeReleaseFixture(t);
  const result = runPrepare(root, "0.1.0+build.1");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /without build metadata/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
});

test("release preparation rejects the current package version before creating a branch", async (t) => {
  const { root } = await makeReleaseFixture(t);
  const result = runPrepare(root, "0.1.0");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differ from the current application version/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("release preparation rejects dirty main without discarding changes", async (t) => {
  const { root } = await makeReleaseFixture(t);
  await writeFile(path.join(root, "authored.txt"), "keep this work\n");
  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /clean/i);
  assert.equal(await readFile(path.join(root, "authored.txt"), "utf8"), "keep this work\n");
  assert.equal(git(root, "branch", "--show-current"), "main");
});

test("release preparation rejects a clean checkout on a branch other than main", async (t) => {
  const { root } = await makeReleaseFixture(t);
  execFileSync("git", ["switch", "--create", "feature/work"], { cwd: root, stdio: "ignore" });
  const originalCommit = git(root, "rev-parse", "HEAD");
  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkout of main/i);
  assert.equal(git(root, "branch", "--show-current"), "feature/work");
  assert.equal(git(root, "rev-parse", "HEAD"), originalCommit);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("release preparation rejects a local branch collision before editing metadata", async (t) => {
  const { root } = await makeReleaseFixture(t);
  execFileSync("git", ["branch", "release/1.2.3"], { cwd: root });
  const originalPackage = await readFile(path.join(root, "app", "package.json"), "utf8");
  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(await readFile(path.join(root, "app", "package.json"), "utf8"), originalPackage);
});

test("release preparation rejects a main checkout behind its configured remote", async (t) => {
  const { root } = await makeReleaseFixture(t);
  execFileSync("git", ["switch", "--create", "advance"], { cwd: root, stdio: "ignore" });
  await writeFile(path.join(root, "advance.txt"), "remote main advanced\n");
  execFileSync("git", ["add", "advance.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Advance remote main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["push", "origin", "HEAD:main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["switch", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["branch", "--delete", "--force", "advance"], { cwd: root, stdio: "ignore" });

  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not up to date/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("release preparation rejects a main checkout ahead of its configured remote", async (t) => {
  const { root } = await makeReleaseFixture(t);
  await writeFile(path.join(root, "local-ahead.txt"), "local main advanced\n");
  execFileSync("git", ["add", "local-ahead.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Advance local main"], { cwd: root, stdio: "ignore" });
  const originalCommit = git(root, "rev-parse", "HEAD");

  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not up to date/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "rev-parse", "HEAD"), originalCommit);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("release preparation rejects divergent local and remote main histories", async (t) => {
  const { root } = await makeReleaseFixture(t);
  execFileSync("git", ["switch", "--create", "remote-advance"], { cwd: root, stdio: "ignore" });
  await writeFile(path.join(root, "remote-ahead.txt"), "remote main advanced\n");
  execFileSync("git", ["add", "remote-ahead.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Advance remote main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["push", "origin", "HEAD:main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["switch", "main"], { cwd: root, stdio: "ignore" });
  await writeFile(path.join(root, "local-ahead.txt"), "local main advanced\n");
  execFileSync("git", ["add", "local-ahead.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "Advance local main"], { cwd: root, stdio: "ignore" });
  const originalCommit = git(root, "rev-parse", "HEAD");

  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not up to date/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "rev-parse", "HEAD"), originalCommit);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("release preparation reports a fetch failure without altering the authored checkout", async (t) => {
  const { root, temporaryDirectory } = await makeReleaseFixture(t);
  execFileSync(
    "git",
    ["remote", "set-url", "origin", path.join(temporaryDirectory, "missing.git")],
    { cwd: root },
  );
  const originalCommit = git(root, "rev-parse", "HEAD");
  const originalPackage = await readFile(path.join(root, "app", "package.json"), "utf8");

  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not fetch/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "rev-parse", "HEAD"), originalCommit);
  assert.equal(await readFile(path.join(root, "app", "package.json"), "utf8"), originalPackage);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("release preparation rejects a release branch already present on the remote", async (t) => {
  const { root } = await makeReleaseFixture(t);
  execFileSync("git", ["switch", "--create", "release/1.2.3"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["push", "--set-upstream", "origin", "release/1.2.3"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["switch", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["branch", "--delete", "--force", "release/1.2.3"], {
    cwd: root,
    stdio: "ignore",
  });

  const result = runPrepare(root, "1.2.3");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists on the configured remote/i);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("release publication sends the exact artifact from the latest successful full run", async (t) => {
  const fixture = await makePublishFixture(t);
  const result = runPublish(fixture);

  assert.equal(result.status, 0, result.stderr);
  const calls = await readJsonLines(fixture.npmCalls);
  const publicationIndex = calls.findIndex((call) => call.publishArchive);
  const publication = calls[publicationIndex];
  assert.ok(publication);
  assert.equal(path.basename(publication.publishArchive), fixture.archiveName);
  assert.notEqual(
    publication.publishArchive,
    path.join(fixture.candidateDirectory, fixture.archiveName),
  );
  assert.equal(publication.archiveSha256, fixture.digest);
  assert.deepEqual(calls[publicationIndex - 1].args.slice(0, 2), [
    "publish",
    publication.publishArchive,
  ]);
  assert.ok(calls[publicationIndex - 1].args.includes("--ignore-scripts"));
  assert.equal(calls[publicationIndex - 1].args.at(-1), "https://registry.npmjs.org/");
  assert.equal(
    calls.some(({ args }) => args?.includes("pack")),
    false,
  );

  const ghCalls = await readJsonLines(fixture.ghCalls);
  assert.ok(
    ghCalls.some((args) => args[0] === "api" && args.includes("--method") && args.includes("GET")),
  );
  assert.ok(ghCalls.some((args) => args.includes("tbspec-release-candidate")));
  assert.ok(ghCalls.some((args) => args.includes("tbspec-release-verification")));
  for (const platformKey of platformKeys)
    assert.ok(ghCalls.some((args) => args.includes(`tbspec-installed-evidence-${platformKey}`)));
});

test("release publication rejects non-release, dirty and version-mismatched checkouts before npm access", async (t) => {
  const notRelease = await makePublishFixture(t);
  execFileSync("git", ["switch", "main"], { cwd: notRelease.root, stdio: "ignore" });
  const branchResult = runPublish(notRelease);
  assert.notEqual(branchResult.status, 0);
  assert.match(branchResult.stderr, /release\/<version>/i);
  assert.deepEqual(await readJsonLines(notRelease.npmCalls), []);

  const dirty = await makePublishFixture(t);
  await writeFile(path.join(dirty.root, "uncommitted.txt"), "keep\n");
  const dirtyResult = runPublish(dirty);
  assert.notEqual(dirtyResult.status, 0);
  assert.match(dirtyResult.stderr, /clean release checkout/i);
  assert.deepEqual(await readJsonLines(dirty.npmCalls), []);

  const mismatch = await makePublishFixture(t);
  const manifestPath = path.join(mismatch.root, "app", "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = "1.2.4";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  execFileSync("git", ["add", "app/package.json"], { cwd: mismatch.root });
  execFileSync("git", ["commit", "-m", "Change manifest version"], {
    cwd: mismatch.root,
    stdio: "ignore",
  });
  const mismatchResult = runPublish(mismatch);
  assert.notEqual(mismatchResult.status, 0);
  assert.match(mismatchResult.stderr, /branch version must match/i);
  assert.deepEqual(await readJsonLines(mismatch.npmCalls), []);
});

test("release publication distinguishes an existing version from registry uncertainty", async (t) => {
  const published = await makePublishFixture(t);
  const publishedResult = runPublish(published, {
    NPM_STUB_VIEW_ERROR: "",
    NPM_STUB_VERSIONS: JSON.stringify([releaseVersion]),
  });
  assert.notEqual(publishedResult.status, 0);
  assert.match(publishedResult.stderr, /already published/i);
  assert.deepEqual(await readJsonLines(published.ghCalls), []);

  const uncertain = await makePublishFixture(t);
  const uncertainResult = runPublish(uncertain, { NPM_STUB_VIEW_ERROR: "unavailable" });
  assert.notEqual(uncertainResult.status, 0);
  assert.match(uncertainResult.stderr, /registry uncertainty/i);
  assert.deepEqual(await readJsonLines(uncertain.ghCalls), []);

  const textual404 = await makePublishFixture(t);
  const textual404Result = runPublish(textual404, { NPM_STUB_VIEW_ERROR: "text404" });
  assert.notEqual(textual404Result.status, 0);
  assert.match(textual404Result.stderr, /registry uncertainty/i);
  assert.deepEqual(await readJsonLines(textual404.ghCalls), []);
});

test("release publication accepts an existing package when npm confirms read-write access", async (t) => {
  const fixture = await makePublishFixture(t);
  const result = runPublish(fixture, {
    NPM_STUB_VIEW_ERROR: "",
    NPM_STUB_VERSIONS: JSON.stringify(["1.0.0"]),
    NPM_STUB_PACKAGES: JSON.stringify({ tbspec: "read-write" }),
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok((await readJsonLines(fixture.npmCalls)).some((call) => call.publishArchive));
});

test("release publication rejects a conflicting package publish registry before external checks", async (t) => {
  const fixture = await makePublishFixture(t);
  const manifestPath = path.join(fixture.root, "app", "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.publishConfig = { registry: "https://registry.example.invalid/" };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = runPublish(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /publishConfig registry conflicts/i);
  assert.deepEqual(await readJsonLines(fixture.npmCalls), []);
});

test("release publication rejects missing npm authentication without exposing its error details", async (t) => {
  const fixture = await makePublishFixture(t);
  const result = runPublish(fixture, {
    NPM_STUB_WHOAMI_ERROR: "E401 token=private-test-token",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not authenticated to registry\.npmjs\.org/i);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /private-test-token/);
  assert.deepEqual(await readJsonLines(fixture.ghCalls), []);
});

test("release publication requires verified write access for an existing npm package", async (t) => {
  const fixture = await makePublishFixture(t);
  const result = runPublish(fixture, {
    NPM_STUB_VIEW_ERROR: "",
    NPM_STUB_VERSIONS: JSON.stringify(["1.0.0"]),
    NPM_STUB_PACKAGES: JSON.stringify({ tbspec: "read-only" }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /read-write access/i);
  assert.deepEqual(await readJsonLines(fixture.ghCalls), []);
});

test("release publication rejects malformed npm account access responses", async (t) => {
  for (const response of ["null", "[]", "false", '"unexpected"']) {
    const fixture = await makePublishFixture(t);
    const result = runPublish(fixture, { NPM_STUB_PACKAGES: response });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not confirm npm account access/i);
    assert.deepEqual(await readJsonLines(fixture.ghCalls), []);
    assert.equal(
      (await readJsonLines(fixture.npmCalls)).some((call) => call.publishArchive),
      false,
    );
  }
});

test("release publication rejects a failed or pending latest full attempt instead of using an older success", async (t) => {
  for (const state of [
    { status: "completed", conclusion: "failure" },
    { status: "completed", conclusion: "cancelled" },
    { status: "in_progress", conclusion: null },
  ]) {
    const fixture = await makePublishFixture(t);
    const laterAttempt = {
      ...fixture.run,
      id: fixture.run.id + 1,
      run_number: fixture.run.run_number + 1,
      status: state.status,
      conclusion: state.conclusion,
    };
    await writeFile(
      path.join(fixture.temporaryDirectory, "runs.json"),
      JSON.stringify([fixture.run, laterAttempt]),
    );
    const result = runPublish(fixture);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /latest full verification .* pending or unsuccessful/i);
    const publications = (await readJsonLines(fixture.npmCalls)).filter(
      (call) => call.publishArchive,
    );
    assert.deepEqual(publications, []);
  }
});

test("release publication rejects wrong-commit runs and unsuccessful required matrix lanes", async (t) => {
  const wrongCommit = await makePublishFixture(t);
  await writeFile(
    path.join(wrongCommit.temporaryDirectory, "runs.json"),
    JSON.stringify([{ ...wrongCommit.run, head_sha: "f".repeat(40) }]),
  );
  const wrongCommitResult = runPublish(wrongCommit);
  assert.notEqual(wrongCommitResult.status, 0);
  assert.match(wrongCommitResult.stderr, /no complete release verification/i);

  const missingLane = await makePublishFixture(t);
  const jobs = missingLane.jobs.filter((job) => job.name !== sourceJobNames.at(-1));
  await writeFile(path.join(missingLane.temporaryDirectory, "jobs.json"), JSON.stringify(jobs));
  const missingLaneResult = runPublish(missingLane);
  assert.notEqual(missingLaneResult.status, 0);
  assert.match(missingLaneResult.stderr, /full verification job .* did not complete/i);

  const skippedTest = await makePublishFixture(t);
  const skippedJobs = structuredClone(skippedTest.jobs);
  const ubuntu = skippedJobs.find((job) => job.name === sourceJobNames[0]);
  ubuntu.steps.find((step) => step.name === "Test public operations and processes").conclusion =
    "skipped";
  await writeFile(
    path.join(skippedTest.temporaryDirectory, "jobs.json"),
    JSON.stringify(skippedJobs),
  );
  const skippedResult = runPublish(skippedTest);
  assert.notEqual(skippedResult.status, 0);
  assert.match(
    skippedResult.stderr,
    /verification step Test public operations and processes .* did not complete/i,
  );

  const failedWindowsCleanup = await makePublishFixture(t);
  const jobsWithFailedCleanup = structuredClone(failedWindowsCleanup.jobs);
  const windows = jobsWithFailedCleanup.find(
    (job) => job.name === "Installed verification (Windows standard user)",
  );
  windows.steps.find(
    (step) => step.name === "Install, verify and clean up as a standard Windows user",
  ).conclusion = "failure";
  await writeFile(
    path.join(failedWindowsCleanup.temporaryDirectory, "jobs.json"),
    JSON.stringify(jobsWithFailedCleanup),
  );
  const cleanupResult = runPublish(failedWindowsCleanup);
  assert.notEqual(cleanupResult.status, 0);
  assert.match(cleanupResult.stderr, /Install, verify and clean up.*did not complete/i);
  assert.equal(
    (await readJsonLines(failedWindowsCleanup.npmCalls)).some((call) => call.publishArchive),
    false,
  );
});

test("release publication rejects expired or digest-mismatched artifacts", async (t) => {
  const expired = await makePublishFixture(t);
  const expiredResult = runPublish(expired, {
    GH_STUB_MISSING_ARTIFACT: "tbspec-release-candidate",
  });
  assert.notEqual(expiredResult.status, 0);
  assert.match(expiredResult.stderr, /unavailable or expired/i);

  const digestMismatch = await makePublishFixture(t);
  await writeFile(
    path.join(digestMismatch.candidateDirectory, `${digestMismatch.archiveName}.sha256`),
    `${"0".repeat(64)}  ${digestMismatch.archiveName}\n`,
  );
  const digestResult = runPublish(digestMismatch);
  assert.notEqual(digestResult.status, 0);
  assert.match(digestResult.stderr, /did not validate/i);
  const publications = (await readJsonLines(digestMismatch.npmCalls)).filter(
    (call) => call.publishArchive,
  );
  assert.deepEqual(publications, []);
});

test("release publication rechecks checkout and latest full run after artifact downloads", async (t) => {
  const changedCheckout = await makePublishFixture(t);
  const changedResult = runPublish(changedCheckout, { GH_STUB_MUTATE_CHECKOUT: "true" });
  assert.notEqual(changedResult.status, 0);
  assert.match(changedResult.stderr, /checkout changed during publication checks/i);
  assert.deepEqual(
    (await readJsonLines(changedCheckout.npmCalls)).filter((call) => call.publishArchive),
    [],
  );

  const newerFullRun = await makePublishFixture(t);
  const newerResult = runPublish(newerFullRun, { GH_STUB_NEWER_FULL_AFTER_DOWNLOAD: "true" });
  assert.notEqual(newerResult.status, 0);
  assert.match(newerResult.stderr, /newer full verification appeared/i);
  assert.deepEqual(
    (await readJsonLines(newerFullRun.npmCalls)).filter((call) => call.publishArchive),
    [],
  );
});

test("release publication validates matching evidence and keeps npm authentication out of logs", async (t) => {
  const mismatchedEvidence = await makePublishFixture(t);
  const evidencePath = path.join(
    mismatchedEvidence.evidenceDirectory,
    "tbspec-installed-evidence-ubuntu",
    "ubuntu.json",
  );
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.verification.commit = "f".repeat(40);
  await writeFile(evidencePath, JSON.stringify(evidence));
  const evidenceResult = runPublish(mismatchedEvidence);
  assert.notEqual(evidenceResult.status, 0);
  assert.match(evidenceResult.stderr, /did not validate/i);

  const authRequired = await makePublishFixture(t);
  const authResult = runPublish(authRequired, {
    NPM_STUB_PUBLISH_ERROR:
      "npm error code EOTP\nnpm error one-time password 123456; token=secret-value",
  });
  assert.notEqual(authResult.status, 0);
  assert.match(authResult.stderr, /additional one-time authentication/i);
  assert.doesNotMatch(`${authResult.stdout}\n${authResult.stderr}`, /123456|secret-value/);
});
