import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const validator = fileURLToPath(new URL("app/scripts/validate-verification.mjs", root));
const platforms = ["ubuntu", "windows", "macos-arm", "macos-intel"];
const requiredAssertions = [
  "installed-public-bin:--version",
  "installed-public-bin:--help",
  "smoke-project-initialize-and-read",
  "smoke-persisted-model-readback",
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

async function fixture(mode = "smoke") {
  const root = await mkdtemp(join(tmpdir(), "tbspec-evidence-test-"));
  const artifactDirectory = join(root, "artifact");
  const evidenceDirectory = join(root, "evidence");
  const outputDirectory = join(root, "verification");
  await Promise.all([mkdir(artifactDirectory), mkdir(evidenceDirectory)]);
  const archiveBytes = Buffer.from("verified archive fixture");
  const filename = "tbspec-0.1.0.tgz";
  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  await writeFile(join(artifactDirectory, filename), archiveBytes);
  await writeFile(join(artifactDirectory, `${filename}.sha256`), `${digest}  ${filename}\n`);
  for (const platformKey of platforms) {
    const evidence = {
      schemaVersion: 1,
      state: "passed",
      verification: {
        mode,
        platformKey,
        commit: "0123456789abcdef0123456789abcdef01234567",
        branch: mode === "full" ? "release/0.1.0" : "main",
        repository: "TalbyAI/tbspec",
        runId: "123456789",
        runAttempt: "1",
        startedAt: "2026-10-17T09:00:00.000Z",
        completedAt: "2026-10-17T09:00:25.000Z",
        durationMs: 25_000,
      },
      artifact: {
        filename,
        bytes: archiveBytes.byteLength,
        sha256: digest,
        applicationVersion: "0.1.0",
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
        ...requiredAssertions.map((name) => ({ name, passed: true })),
        { name: "served-browser-assets-match-launched-release", passed: true, count: 2 },
        ...(mode === "full"
          ? [{ name: "public-command-family-help-and-one-envelope-routing", passed: true }]
          : []),
      ],
      scenarios: mode === "full" ? fullScenarios.map((name) => ({ name, status: "passed" })) : [],
      cleanup: [
        { state: "stopped-and-verified" },
        { state: "verified-owned-temporary-root-removed" },
      ],
    };
    await writeFile(
      join(evidenceDirectory, `${platformKey}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  }
  return { root, artifactDirectory, evidenceDirectory, outputDirectory, digest };
}

function run(fixtureData, mode, extraEnv = {}) {
  const evidenceMode = extraEnv.TBSPEC_VERIFICATION_MODE ?? mode;
  return spawnSync(
    process.execPath,
    [
      validator,
      fixtureData.artifactDirectory,
      fixtureData.evidenceDirectory,
      mode,
      ...(mode === "full" ? [fixtureData.outputDirectory] : []),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TBSPEC_REPOSITORY: "TalbyAI/tbspec",
        TBSPEC_VERIFICATION_MODE: evidenceMode,
        TBSPEC_COMMIT: "0123456789abcdef0123456789abcdef01234567",
        TBSPEC_BRANCH: evidenceMode === "full" ? "release/0.1.0" : "main",
        TBSPEC_RUN_ID: "123456789",
        TBSPEC_RUN_ATTEMPT: "1",
        TBSPEC_QUALITY_RESULT: "success",
        TBSPEC_BUILD_RESULT: "success",
        TBSPEC_SOURCE_RESULT: "success",
        TBSPEC_INSTALLED_RESULT: "success",
        TBSPEC_SMOKE_RESULT: "success",
        ...extraEnv,
      },
    },
  );
}

async function readEvidence(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

test("installed verifier acceptance requires all four smoke lanes, identity and cleanup", async () => {
  const data = await fixture();
  try {
    const result = run(data, "smoke");
    assert.equal(result.status, 0, result.stderr);
    const missingPlatform = join(data.evidenceDirectory, "macos-intel.json");
    await rm(missingPlatform);
    assert.equal(run(data, "smoke").status, 1);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
  const fullData = await fixture("full");
  try {
    const fullSmoke = run(fullData, "smoke", { TBSPEC_VERIFICATION_MODE: "full" });
    assert.equal(fullSmoke.status, 0, fullSmoke.stderr);
  } finally {
    await rm(fullData.root, { recursive: true, force: true });
  }
});

test("cleanup, budget, mode, digest and cross-platform mismatches fail closed", async () => {
  const data = await fixture();
  const evidencePath = join(data.evidenceDirectory, "ubuntu.json");
  const original = await readEvidence(evidencePath);
  try {
    const mutations = [
      (value) => (value.cleanup[1].state = "temporary-root-retained"),
      (value) => (value.verification.durationMs = 300_001),
      (value) => (value.verification.mode = "artifact-only"),
      (value) => (value.artifact.sha256 = "0".repeat(64)),
      (value) => (value.platform.architecture = "arm64"),
      (value) => (value.verification.commit = "ffffffffffffffffffffffffffffffffffffffff"),
    ];
    for (const mutate of mutations) {
      const value = structuredClone(original);
      mutate(value);
      await writeFile(evidencePath, JSON.stringify(value));
      assert.equal(run(data, "smoke").status, 1);
    }
  } finally {
    await writeFile(evidencePath, JSON.stringify(original));
    await rm(data.root, { recursive: true, force: true });
  }
});

test("full verification emits a release-bound manifest and requires successful quality", async () => {
  const data = await fixture("full");
  try {
    const result = run(data, "full");
    assert.equal(result.status, 0, result.stderr);
    const manifest = await readEvidence(join(data.outputDirectory, "verification.json"));
    assert.equal(manifest.verification.commit, "0123456789abcdef0123456789abcdef01234567");
    assert.equal(manifest.verification.runId, "123456789");
    assert.equal(manifest.artifact.sha256, data.digest);
    assert.deepEqual(manifest.expectedPlatforms, platforms);
    assert.equal(manifest.requiredJobs["Repository quality"], "success");
    assert.equal(run(data, "full", { TBSPEC_QUALITY_RESULT: "skipped" }).status, 1);

    const evidencePath = join(data.evidenceDirectory, "macos-arm.json");
    const value = await readEvidence(evidencePath);
    value.scenarios.pop();
    await writeFile(evidencePath, JSON.stringify(value));
    assert.equal(run(data, "full").status, 1);
  } finally {
    await rm(data.root, { recursive: true, force: true });
  }
});
