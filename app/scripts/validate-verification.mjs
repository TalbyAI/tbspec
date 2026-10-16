import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isValidReleaseVersion } from "../../scripts/release-utils.mjs";

const expectedPlatforms = ["ubuntu", "windows", "macos-arm", "macos-intel"];
const smokeAssertions = [
  "installed-public-bin:--version",
  "installed-public-bin:--help",
  "smoke-project-initialize-and-read",
  "smoke-persisted-model-readback",
  "served-browser-assets-match-launched-release",
  "smoke-authenticated-status",
  "smoke-unauthenticated-status-rejected",
  "web-stop-verified",
];
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
const requiredJobEnvironment = {
  "Repository quality": "TBSPEC_QUALITY_RESULT",
  "Application typecheck and build": "TBSPEC_BUILD_RESULT",
  "Node 24 source": "TBSPEC_SOURCE_RESULT",
  "Installed verification": "TBSPEC_INSTALLED_RESULT",
  "Application smoke": "TBSPEC_SMOKE_RESULT",
};
const expectedPlatformRuntime = {
  ubuntu: { platform: "linux", architecture: "x64" },
  windows: { platform: "win32", architecture: "x64" },
  "macos-arm": { platform: "darwin", architecture: "arm64" },
  "macos-intel": { platform: "darwin", architecture: "x64" },
};

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function requireText(value, code) {
  requireCondition(typeof value === "string" && value.length > 0, code);
  return value;
}

function requireIdentity(mode) {
  const identity = {
    mode,
    repository: requireText(process.env.TBSPEC_REPOSITORY, "WORKFLOW_REPOSITORY_REQUIRED"),
    commit: requireText(process.env.TBSPEC_COMMIT, "WORKFLOW_COMMIT_REQUIRED"),
    branch: requireText(process.env.TBSPEC_BRANCH, "WORKFLOW_BRANCH_REQUIRED"),
    runId: requireText(process.env.TBSPEC_RUN_ID, "WORKFLOW_RUN_ID_REQUIRED"),
    runAttempt: requireText(process.env.TBSPEC_RUN_ATTEMPT, "WORKFLOW_RUN_ATTEMPT_REQUIRED"),
  };
  requireCondition(/^[^/\s]+\/[^/\s]+$/.test(identity.repository), "WORKFLOW_REPOSITORY_INVALID");
  requireCondition(/^[a-f0-9]{40,64}$/i.test(identity.commit), "WORKFLOW_COMMIT_INVALID");
  requireCondition(/^[0-9]+$/.test(identity.runId), "WORKFLOW_RUN_ID_INVALID");
  requireCondition(/^[1-9][0-9]*$/.test(identity.runAttempt), "WORKFLOW_RUN_ATTEMPT_INVALID");
  if (mode === "full") {
    const match = /^release\/(.+)$/.exec(identity.branch);
    requireCondition(
      Boolean(match && isValidReleaseVersion(match[1])),
      "FULL_VERIFICATION_REQUIRES_VERSIONED_RELEASE_BRANCH",
    );
  }
  return identity;
}

function validateEvidence(evidence, platformKey, identity, artifact, maxDurationMs) {
  requireCondition(
    evidence && typeof evidence === "object",
    `EVIDENCE_JSON_INVALID_${platformKey}`,
  );
  requireCondition(evidence.schemaVersion === 1, `EVIDENCE_SCHEMA_VERSION_${platformKey}`);
  requireCondition(evidence.state === "passed", `EVIDENCE_STATE_${platformKey}`);
  const verification = evidence.verification;
  requireCondition(verification?.mode === identity.mode, `EVIDENCE_MODE_${platformKey}`);
  requireCondition(verification?.platformKey === platformKey, `EVIDENCE_PLATFORM_${platformKey}`);
  for (const key of ["repository", "commit", "branch", "runId", "runAttempt"])
    requireCondition(
      verification[key] === identity[key],
      `EVIDENCE_${key.toUpperCase()}_${platformKey}`,
    );
  requireCondition(
    Number.isFinite(verification.durationMs) && verification.durationMs >= 0,
    `EVIDENCE_DURATION_${platformKey}`,
  );
  const startedAt = Date.parse(verification.startedAt);
  const completedAt = Date.parse(verification.completedAt);
  requireCondition(
    Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt,
    `EVIDENCE_TIMESTAMPS_${platformKey}`,
  );
  if (maxDurationMs !== null)
    requireCondition(
      verification.durationMs <= maxDurationMs,
      `SMOKE_BUDGET_EXCEEDED_${platformKey}`,
    );

  requireCondition(
    evidence.artifact?.filename === artifact.filename &&
      evidence.artifact?.bytes === artifact.bytes &&
      evidence.artifact?.sha256 === artifact.sha256 &&
      evidence.artifact?.applicationVersion === artifact.applicationVersion,
    `EVIDENCE_ARTIFACT_MISMATCH_${platformKey}`,
  );
  requireCondition(
    Array.isArray(evidence.installs) &&
      evidence.installs.some(
        (install) =>
          install.offline === true &&
          install.emptyCacheBeforeInstall === true &&
          install.exit === 0,
      ),
    `OFFLINE_INSTALL_NOT_VERIFIED_${platformKey}`,
  );
  requireCondition(
    Array.isArray(evidence.assertions),
    `EVIDENCE_ASSERTIONS_MISSING_${platformKey}`,
  );
  const expectedRuntime = expectedPlatformRuntime[platformKey];
  requireCondition(
    evidence.platform?.platform === expectedRuntime.platform &&
      evidence.platform?.architecture === expectedRuntime.architecture,
    `PLATFORM_RUNTIME_MISMATCH_${platformKey}`,
  );
  requireCondition(
    evidence.assertions.every((assertion) => assertion?.passed === true),
    `FAILED_ASSERTION_RECORDED_${platformKey}`,
  );
  const passedAssertions = new Set(evidence.assertions.map((assertion) => assertion.name));
  for (const name of smokeAssertions)
    requireCondition(passedAssertions.has(name), `REQUIRED_ASSERTION_${name}_${platformKey}`);
  const assetAssertion = evidence.assertions.find(
    (assertion) => assertion.name === "served-browser-assets-match-launched-release",
  );
  requireCondition(
    Number.isInteger(assetAssertion?.count) && assetAssertion.count > 0,
    `SERVED_ASSET_COVERAGE_${platformKey}`,
  );
  requireCondition(
    Array.isArray(evidence.http) &&
      evidence.http.some(
        (item) =>
          item.route === "/status" &&
          item.method === "GET" &&
          item.status === 200 &&
          item.authenticated === true,
      ) &&
      evidence.http.some(
        (item) =>
          item.route === "/status" &&
          item.method === "GET" &&
          item.status === 401 &&
          item.authenticated === false,
      ),
    `HTTP_AUTHENTICATION_COVERAGE_${platformKey}`,
  );
  requireCondition(Array.isArray(evidence.cleanup), `EVIDENCE_CLEANUP_MISSING_${platformKey}`);
  requireCondition(
    evidence.cleanup.some((entry) => entry.state === "stopped-and-verified") &&
      evidence.cleanup.some((entry) => entry.state === "verified-owned-temporary-root-removed"),
    `VERIFIED_CLEANUP_MISSING_${platformKey}`,
  );
  if (platformKey === "windows") {
    requireCondition(
      verification.durationScope === "windows-standard-user-installed-verification-and-cleanup",
      "WINDOWS_DURATION_SCOPE_INVALID",
    );
    requireCondition(
      passedAssertions.has("windows-standard-user-cleanup-verified"),
      "WINDOWS_OUTER_CLEANUP_ASSERTION_MISSING",
    );
    requireCondition(
      evidence.cleanup.some((entry) => entry.state === "standard-user-account-removed") &&
        evidence.cleanup.some((entry) => entry.state === "shared-test-directory-removed"),
      "WINDOWS_OUTER_CLEANUP_EVIDENCE_MISSING",
    );
  }

  if (identity.mode === "full") {
    requireCondition(
      passedAssertions.has("public-command-family-help-and-one-envelope-routing"),
      `FULL_COMMAND_FAMILY_COVERAGE_${platformKey}`,
    );
    requireCondition(Array.isArray(evidence.scenarios), `FULL_SCENARIOS_MISSING_${platformKey}`);
    for (const name of fullScenarios)
      requireCondition(
        evidence.scenarios.some(
          (scenario) => scenario.name === name && scenario.status === "passed",
        ),
        `FULL_SCENARIO_${name}_${platformKey}`,
      );
    requireCondition(
      evidence.scenarios.length === fullScenarios.length,
      `FULL_SCENARIO_SELECTION_MISMATCH_${platformKey}`,
    );
  }

  return {
    platformKey,
    platform: evidence.platform,
    durationMs: verification.durationMs,
    durationScope: verification.durationScope ?? "installed-verifier",
    startedAt: verification.startedAt,
    completedAt: verification.completedAt,
    assertions: [...passedAssertions].sort(),
    scenarios: (evidence.scenarios ?? []).map(({ name, status }) => ({ name, status })),
  };
}

async function verifyArtifact(directory) {
  const entries = await readdir(directory);
  const archives = entries.filter((name) => name.endsWith(".tgz"));
  requireCondition(archives.length === 1, "ONE_RELEASE_ARCHIVE_REQUIRED");
  const filename = archives[0];
  const versionMatch = /^tbspec-(.+)\.tgz$/.exec(filename);
  requireCondition(
    Boolean(versionMatch && isValidReleaseVersion(versionMatch[1])),
    "ARCHIVE_NAME_INVALID",
  );
  const archivePath = join(directory, filename);
  const archive = await readFile(archivePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  const sidecar = (await readFile(`${archivePath}.sha256`, "utf8")).trim();
  const sidecarMatch = /^([a-f0-9]{64})\s+(.+)$/.exec(sidecar);
  requireCondition(
    sidecarMatch?.[1] === digest && sidecarMatch[2] === filename,
    "RELEASE_ARCHIVE_SHA256_MISMATCH",
  );
  return {
    filename,
    bytes: archive.byteLength,
    sha256: digest,
    applicationVersion: versionMatch[1],
  };
}

async function verifyEvidenceDirectory(directory, identity, artifact) {
  const entries = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const expectedEntries = expectedPlatforms.map((platform) => `${platform}.json`).sort();
  requireCondition(
    JSON.stringify(entries) === JSON.stringify(expectedEntries),
    "ALL_FOUR_PLATFORM_EVIDENCE_REQUIRED",
  );
  const maxDurationMs = identity.mode === "smoke" ? 300_000 : null;
  const outcomes = [];
  for (const platformKey of expectedPlatforms) {
    let evidence;
    try {
      evidence = JSON.parse(await readFile(join(directory, `${platformKey}.json`), "utf8"));
    } catch {
      throw new Error(`EVIDENCE_JSON_INVALID_${platformKey}`);
    }
    outcomes.push(validateEvidence(evidence, platformKey, identity, artifact, maxDurationMs));
  }
  return outcomes;
}

function requireFullJobResults() {
  const results = {};
  for (const [name, environmentName] of Object.entries(requiredJobEnvironment)) {
    const result = process.env[environmentName];
    requireCondition(result === "success", `FULL_REQUIRED_JOB_${name.replaceAll(" ", "_")}`);
    results[name] = result;
  }
  return results;
}

async function main() {
  const [artifactDirectory, evidenceDirectory, validationMode, outputDirectory] =
    process.argv.slice(2);
  requireCondition(
    typeof artifactDirectory === "string" && typeof evidenceDirectory === "string",
    "USAGE: validate-verification <artifact-dir> <evidence-dir> <smoke|full> [output-dir]",
  );
  requireCondition(
    validationMode === "smoke" || validationMode === "full",
    "VERIFICATION_MODE_INVALID",
  );
  const mode = process.env.TBSPEC_VERIFICATION_MODE ?? validationMode;
  requireCondition(
    validationMode === "smoke" ? mode === "smoke" || mode === "full" : mode === "full",
    "VERIFICATION_MODE_MISMATCH",
  );
  if (validationMode === "full")
    requireCondition(
      typeof outputDirectory === "string",
      "FULL_VERIFICATION_OUTPUT_DIRECTORY_REQUIRED",
    );
  const identity = requireIdentity(mode);
  const artifactPath = resolve(artifactDirectory);
  const evidencePath = resolve(evidenceDirectory);
  requireCondition((await stat(artifactPath)).isDirectory(), "ARTIFACT_DIRECTORY_REQUIRED");
  requireCondition((await stat(evidencePath)).isDirectory(), "EVIDENCE_DIRECTORY_REQUIRED");
  const artifact = await verifyArtifact(artifactPath);
  if (mode === "full")
    requireCondition(
      identity.branch === `release/${artifact.applicationVersion}`,
      "RELEASE_BRANCH_VERSION_MISMATCH",
    );
  const platforms = await verifyEvidenceDirectory(evidencePath, identity, artifact);
  if (validationMode === "smoke") {
    process.stdout.write(
      `${JSON.stringify({ mode, artifact: artifact.filename, platforms: platforms.length, accepted: true })}\n`,
    );
    return;
  }

  const requiredJobs = requireFullJobResults();
  const manifest = {
    schemaVersion: 1,
    verification: identity,
    artifact,
    expectedPlatforms,
    platforms,
    requiredJobs,
  };
  const destination = resolve(outputDirectory);
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "verification.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${JSON.stringify({ mode, artifact: artifact.filename, platforms: platforms.length, manifest: "verification.json", accepted: true })}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
