import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../../", import.meta.url);
const applicationWorkflow = await readFile(
  new URL(".github/workflows/application.yml", root),
  "utf8",
);
const qualityWorkflow = await readFile(new URL(".github/workflows/quality.yml", root), "utf8");
const packedVerifier = await readFile(
  new URL("app/scripts/verify-packed-application.mjs", root),
  "utf8",
);
const verificationEvidence = await readFile(
  new URL("scripts/verification-evidence.mjs", root),
  "utf8",
);
const modeSelector = new URL("app/scripts/select-verification-mode.mjs", root);
const gateScript = new URL("scripts/require-verification-gate.mjs", root);

function selectMode(event, ref, mode = "smoke", packed = false, macos = false, intel = false) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(modeSelector), event, ref, mode, String(packed), String(macos), String(intel)],
    { encoding: "utf8" },
  );
}

function requireGate(gate, event, ref, environment = {}) {
  return spawnSync(process.execPath, [fileURLToPath(gateScript), gate, event, ref], {
    encoding: "utf8",
    env: {
      ...process.env,
      MODE: "smoke",
      MODE_RESULT: "success",
      REQUESTED_MODE: "smoke",
      QUALITY_RESULT: "success",
      BUILD_RESULT: "success",
      SOURCE_RESULT: "success",
      INSTALLED_RESULT: "success",
      SMOKE_RESULT: "success",
      PACKED_ONLY: "false",
      MACOS_REGRESSIONS_ONLY: "false",
      MACOS_INTEL_SOURCE_ONLY: "false",
      ...environment,
    },
  });
}

test("application workflow routes routine events to smoke and release pushes to complete verification", () => {
  assert.match(applicationWorkflow, /pull_request:/);
  assert.match(applicationWorkflow, /branches:\s*\[main,\s*['"]?release\/\*\*['"]?\]/);
  assert.match(applicationWorkflow, /verification_mode:[\s\S]*?default:\s*smoke/);
  assert.match(applicationWorkflow, /select-verification-mode\.mjs/);
  assert.match(applicationWorkflow, /name:\s*Application smoke/);
  assert.match(applicationWorkflow, /name:\s*Complete verification/);
  assert.match(applicationWorkflow, /retention-days:\s*90/);
  assert.match(applicationWorkflow, /uses:\s*\.\/\.github\/workflows\/quality\.yml/);
  assert.match(applicationWorkflow, /needs:\s*\[[^\]]*repository-quality/);
  assert.match(applicationWorkflow, /always\(\)[\s\S]*github\.event_name == 'pull_request'/);
  assert.match(applicationWorkflow, /require-verification-gate\.mjs smoke/);
  assert.match(applicationWorkflow, /require-verification-gate\.mjs full/);
  assert.match(applicationWorkflow, /::add-mask::\$plainPassword/);
  assert.doesNotMatch(applicationWorkflow, /Remove-Item[^\r\n]*SilentlyContinue/);
});

test("Windows installed budget covers standard-user setup, verification and cleanup in one step", () => {
  assert.match(
    applicationWorkflow,
    /name: Install, verify and clean up as a standard Windows user[\s\S]*?timeout-minutes: \$\{\{[^\r\n]*10[^\r\n]*90[^\r\n]*\}\}/,
  );
  assert.match(
    applicationWorkflow,
    /name: Install the artifact offline and verify smoke workflows[\s\S]*?timeout-minutes: 5/,
  );
  assert.doesNotMatch(applicationWorkflow, /name: Prepare standard Windows user/);
  assert.doesNotMatch(applicationWorkflow, /name: Remove standard Windows test account and files/);
  assert.match(applicationWorkflow, /Diagnostics\.Stopwatch/);
  assert.match(applicationWorkflow, /budget\.ElapsedMilliseconds -gt 600000/);
  assert.match(applicationWorkflow, /scripts\\verification-evidence\.mjs/);
  assert.match(applicationWorkflow, /if \(\$operationFailed -or \$operationExitCode -ne 0/);
  assert.match(packedVerifier, /process\.platform === "win32" \? 600_000 : 300_000/);
  assert.match(verificationEvidence, /evidence\.verification\.durationMs = result\.durationMs/);
  assert.match(verificationEvidence, /evidence\.verification\.durationScope =/);
  assert.match(verificationEvidence, /windows-standard-user-cleanup-verified/);
  assert.match(
    applicationWorkflow,
    /name: Upload installed-artifact evidence[\s\S]*?path: packed-evidence\/\$\{\{ matrix\.platform_key \}\}\.json/,
  );
});

test("quality workflow runs for release commits as well as routine integration", () => {
  assert.match(qualityWorkflow, /workflow_call:/);
  assert.match(qualityWorkflow, /npm run test:release-tooling/);
});

test("pull requests, including release-fix pull requests, select smoke", () => {
  const result = selectMode("pull_request", "refs/pull/18/merge", "full");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, "smoke");
});

test("main pushes select smoke and versioned release pushes select full verification", () => {
  const main = selectMode("push", "refs/heads/main");
  const release = selectMode("push", "refs/heads/release/1.2.3");
  assert.equal(main.status, 0, main.stderr);
  assert.equal(release.status, 0, release.stderr);
  assert.equal(JSON.parse(main.stdout).mode, "smoke");
  assert.equal(JSON.parse(release.stdout).mode, "full");
});

test("release branch parsing rejects a trailing newline instead of accepting a partial ref", () => {
  const selected = selectMode("push", "refs/heads/release/1.2.3\n");
  const gated = requireGate("full", "workflow_dispatch", "refs/heads/release/1.2.3\n", {
    MODE: "full",
    REQUESTED_MODE: "full",
  });
  assert.equal(selected.status, 1);
  assert.equal(gated.status, 1);
});

test("manual smoke works on feature branches while manual full is limited to release branches", () => {
  const smoke = selectMode("workflow_dispatch", "refs/heads/feature/check", "smoke");
  const full = selectMode("workflow_dispatch", "refs/heads/release/1.2.3", "full");
  const invalid = selectMode("workflow_dispatch", "refs/heads/feature/check", "full");
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.equal(full.status, 0, full.stderr);
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(smoke.stdout).mode, "smoke");
  assert.equal(JSON.parse(full.stdout).mode, "full");
});

test("diagnostic selections are distinct and conflicting selections fail closed", () => {
  const packed = selectMode("workflow_dispatch", "refs/heads/feature/check", "smoke", true);
  const focused = selectMode("workflow_dispatch", "refs/heads/feature/check", "smoke", false, true);
  const intel = selectMode(
    "workflow_dispatch",
    "refs/heads/feature/check",
    "smoke",
    false,
    false,
    true,
  );
  const conflict = selectMode("workflow_dispatch", "refs/heads/release/1.2.3", "full", true);
  const multiple = selectMode("workflow_dispatch", "refs/heads/feature/check", "smoke", true, true);
  assert.equal(packed.status, 0, packed.stderr);
  assert.equal(focused.status, 0, focused.stderr);
  assert.equal(intel.status, 0, intel.stderr);
  assert.equal(conflict.status, 1);
  assert.equal(multiple.status, 1);
  assert.equal(JSON.parse(packed.stdout).mode, "artifact-only");
  assert.equal(JSON.parse(focused.stdout).mode, "focused");
  assert.equal(JSON.parse(intel.stdout).mode, "intel-partition");
});

test("PR smoke gate runs even when classification or a required lane fails", () => {
  const releaseFix = requireGate("smoke", "pull_request", "refs/pull/18/merge");
  const selectorFailed = requireGate("smoke", "pull_request", "refs/pull/18/merge", {
    MODE_RESULT: "failure",
  });
  const installedSkipped = requireGate("smoke", "pull_request", "refs/pull/18/merge", {
    INSTALLED_RESULT: "skipped",
  });
  assert.equal(releaseFix.status, 0, releaseFix.stderr);
  assert.equal(selectorFailed.status, 1);
  assert.equal(installedSkipped.status, 1);
});

test("full gate requires release routing and every complete verification job", () => {
  const release = requireGate("full", "push", "refs/heads/release/1.2.3", {
    MODE: "full",
    REQUESTED_MODE: "smoke",
  });
  const skippedSource = requireGate("full", "push", "refs/heads/release/1.2.3", {
    MODE: "full",
    SOURCE_RESULT: "skipped",
  });
  const featureBranch = requireGate("full", "workflow_dispatch", "refs/heads/feature/test", {
    MODE: "full",
    REQUESTED_MODE: "full",
  });
  assert.equal(release.status, 0, release.stderr);
  assert.equal(skippedSource.status, 1);
  assert.equal(featureBranch.status, 1);
});

test("diagnostics cannot authorize repository, smoke or full aggregate gates", () => {
  const partial = requireGate("smoke", "workflow_dispatch", "refs/heads/feature/test", {
    PACKED_ONLY: "true",
  });
  const conflict = requireGate("full", "push", "refs/heads/release/1.2.3", {
    MODE: "full",
    MACOS_INTEL_SOURCE_ONLY: "true",
  });
  assert.equal(partial.status, 1);
  assert.equal(conflict.status, 1);
});
