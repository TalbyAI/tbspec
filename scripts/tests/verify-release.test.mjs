import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const registry = "https://registry.npmjs.org/";
const archiveBytes = Buffer.from("published archive bytes, not a local build");
const digest = createHash("sha256").update(archiveBytes).digest("hex");

async function fixture(t, version = "1.2.3") {
  const directory = await mkdtemp(path.join(tmpdir(), "tbspec-verify-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = path.join(directory, "app");
  const scripts = path.join(app, "scripts");
  await mkdir(scripts, { recursive: true });
  await mkdir(path.join(directory, "scripts"));
  await cp(
    path.join(repositoryRoot, "scripts", "release-utils.mjs"),
    path.join(directory, "scripts", "release-utils.mjs"),
  );
  await cp(
    path.join(repositoryRoot, "app", "scripts", "verify-release.mjs"),
    path.join(scripts, "verify-release.mjs"),
  );
  await writeFile(path.join(app, "package.json"), JSON.stringify({ name: "tbspec", version }));
  const metadata = {
    name: "tbspec",
    version,
    dist: {
      tarball: `${registry}tbspec/-/tbspec-${version}.tgz`,
      integrity: `sha512-${createHash("sha512").update(archiveBytes).digest("base64")}`,
    },
  };
  const npmStub = path.join(directory, "npm.cjs");
  await writeFile(
    npmStub,
    `const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + "\\n");
if (process.env.TEST_ERROR === args[0]) {
  process.stderr.write("E404 https://user:secret@registry.npmjs.org/ token=secret");
  process.exit(1);
}
if (args[0] === "view") {
  process.stdout.write(process.env.TEST_METADATA);
} else if (args[0] === "pack") {
  const directory = args[args.indexOf("--pack-destination") + 1];
  const filename = "tbspec-" + JSON.parse(process.env.TEST_METADATA).version + ".tgz";
  fs.writeFileSync(path.join(directory, filename), Buffer.from(process.env.TEST_BYTES, "base64"));
  process.stdout.write(JSON.stringify([{ filename }]));
} else { process.exit(2); }
`,
  );
  await writeFile(
    path.join(scripts, "verify-packed-application.mjs"),
    `import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const archive = process.argv[2];
const bytes = await readFile(archive);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sidecar = await readFile(archive + ".sha256", "utf8");
if (!sidecar.startsWith(sha256 + " ")) process.exit(2);
const state = process.env.TEST_VERIFIER_STATE ?? "passed";
const report = {
  state,
  verification: { mode: process.env.TEST_WRONG_MODE ? "wrong" : process.env.TBSPEC_VERIFICATION_MODE },
  artifact: { applicationVersion: process.env.TEST_INSTALLED_VERSION ?? ${JSON.stringify(version)}, sha256, bytes: bytes.length },
  assertions: [{ name: "fixture-installed-check", passed: true }],
  scenarios: [],
  cleanup: [{ state: "verified-owned-temporary-root-removed" }],
};
if (process.env.TEST_WRONG_DIGEST) report.artifact.sha256 = "0".repeat(64);
if (!process.env.TEST_MISSING_EVIDENCE) {
  await writeFile(process.env.TBSPEC_EVIDENCE_PATH, process.env.TEST_MALFORMED_EVIDENCE ? "{" : JSON.stringify(report));
}
process.exitCode = process.env.TEST_VERIFIER_EXIT ? 1 : 0;
`,
  );
  const log = path.join(directory, "npm.jsonl");
  function run(args = [], environment = {}) {
    return spawnSync(process.execPath, [path.join(scripts, "verify-release.mjs"), ...args], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
      env: {
        ...process.env,
        TMP: directory,
        TEMP: directory,
        TMPDIR: directory,
        npm_execpath: npmStub,
        TEST_LOG: log,
        TEST_METADATA: JSON.stringify(metadata),
        TEST_BYTES: archiveBytes.toString("base64"),
        ...environment,
      },
    });
  }
  async function report(result) {
    const summary = JSON.parse(result.stdout.trim());
    const evidence = JSON.parse(await readFile(summary.evidenceFile, "utf8"));
    assert.equal(path.dirname(path.dirname(summary.evidenceFile)), directory);
    const remaining = await readdir(path.dirname(summary.evidenceFile));
    assert.deepEqual(remaining, ["verification.json"]);
    assert.equal(evidence.cleanup.state, "verified-download-directory-removed");
    return { summary, evidence };
  }
  return { run, report, log, metadata, directory };
}

test("verify-release downloads the exact published version and runs isolated smoke by default", async (t) => {
  const f = await fixture(t);
  const result = f.run([], {
    TBSPEC_VERIFICATION_MODE: "full",
    TBSPEC_EVIDENCE_PATH: "ignored.json",
  });
  assert.equal(result.status, 0, result.stderr);
  const { summary, evidence } = await f.report(result);
  assert.equal(summary.state, "passed");
  assert.equal(summary.version, "1.2.3");
  assert.equal(summary.mode, "smoke");
  assert.equal(evidence.artifact.sha256, digest);
  assert.equal(evidence.installed.verification.mode, "smoke");
  assert.equal(evidence.installed.assertions[0].passed, true);
  const calls = (await readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    calls.map((args) => args[0]),
    ["view", "pack"],
  );
  for (const args of calls) {
    assert.equal(args[1], "tbspec@1.2.3");
    assert.equal(args[args.indexOf("--registry") + 1], registry);
    assert.ok(args.includes("--prefer-online"));
    assert.ok(args[args.indexOf("--cache") + 1].startsWith(f.directory));
  }
  assert.ok(calls[1].includes("--ignore-scripts"));
});

test("verify-release supports full installed scenarios for an exact prerelease", async (t) => {
  const f = await fixture(t, "1.2.3-rc.1");
  const result = f.run(["--mode", "full"]);
  assert.equal(result.status, 0, result.stderr);
  const { summary, evidence } = await f.report(result);
  assert.equal(summary.version, "1.2.3-rc.1");
  assert.equal(evidence.installed.verification.mode, "full");
});

for (const args of [["--mode", "artifact-only"], ["extra"], ["--unknown"], ["--mode"]]) {
  test(`verify-release rejects invalid arguments ${JSON.stringify(args)}`, async (t) => {
    const f = await fixture(t);
    const result = f.run(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--mode.*smoke.*full/);
    await assert.rejects(readFile(f.log), { code: "ENOENT" });
  });
}

for (const version of ["latest", "v1.2.3", "1.2.3+build", "1.2.3\n"]) {
  test(`verify-release rejects a noncanonical manifest version ${JSON.stringify(version)}`, async (t) => {
    const f = await fixture(t, version);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canonical npm version/);
    await assert.rejects(readFile(f.log), { code: "ENOENT" });
  });
}

const failures = [
  ["unavailable version or registry", { TEST_ERROR: "view" }, "REGISTRY_METADATA_UNAVAILABLE"],
  ["failed download", { TEST_ERROR: "pack" }, "REGISTRY_DOWNLOAD_FAILED"],
  ["malformed registry JSON", { TEST_METADATA: "{" }, "REGISTRY_METADATA_INVALID"],
  [
    "corrupt downloaded bytes",
    { TEST_BYTES: Buffer.from("corrupt").toString("base64") },
    "REGISTRY_INTEGRITY_MISMATCH",
  ],
  ["installed version mismatch", { TEST_INSTALLED_VERSION: "9.9.9" }, "INSTALLED_RESULT_INVALID"],
  ["installed digest mismatch", { TEST_WRONG_DIGEST: "true" }, "INSTALLED_RESULT_INVALID"],
  ["installed mode mismatch", { TEST_WRONG_MODE: "true" }, "INSTALLED_RESULT_INVALID"],
  ["incomplete verifier", { TEST_VERIFIER_STATE: "running" }, "INSTALLED_RESULT_INVALID"],
  ["missing verifier evidence", { TEST_MISSING_EVIDENCE: "true" }, "INSTALLED_RESULT_INVALID"],
  ["malformed verifier evidence", { TEST_MALFORMED_EVIDENCE: "true" }, "INSTALLED_RESULT_INVALID"],
  [
    "verifier failure",
    { TEST_VERIFIER_EXIT: "true", TEST_VERIFIER_STATE: "failed" },
    "INSTALLED_VERIFICATION_FAILED",
  ],
];
for (const [label, environment, code] of failures) {
  test(`verify-release retains failure evidence and cleans downloads: ${label}`, async (t) => {
    const f = await fixture(t);
    const result = f.run([], environment);
    assert.notEqual(result.status, 0);
    const { summary, evidence } = await f.report(result);
    assert.equal(summary.state, "failed");
    assert.equal(evidence.failure.code, code);
    assert.ok(!JSON.stringify({ result, evidence }).includes("secret"));
  });
}

test("verify-release cannot pass when download cleanup fails", async (t) => {
  const f = await fixture(t);
  const preload = path.join(f.directory, "fail-cleanup.mjs");
  await writeFile(
    preload,
    `import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
const original = fs.promises.rm;
fs.promises.rm = async (target, options) => {
  if (path.basename(target) === "download") throw new Error("simulated cleanup failure");
  return original(target, options);
};
syncBuiltinESMExports();
`,
  );
  const result = f.run([], { NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` });
  assert.notEqual(result.status, 0);
  assert.ok(result.stdout, result.stderr);
  const summary = JSON.parse(result.stdout.trim());
  const evidence = JSON.parse(await readFile(summary.evidenceFile, "utf8"));
  assert.equal(evidence.state, "failed");
  assert.equal(evidence.installed.state, "passed");
  assert.equal(evidence.failure.code, "DOWNLOAD_CLEANUP_FAILED");
  assert.equal(evidence.cleanup.state, "failed");
});

for (const mutation of [
  { name: "other" },
  { version: "9.9.9" },
  { dist: {} },
  { dist: { integrity: "sha512-invalid", tarball: "https://other.example/tbspec.tgz" } },
]) {
  test(`verify-release refuses unexpected registry metadata ${JSON.stringify(mutation)}`, async (t) => {
    const f = await fixture(t);
    const result = f.run([], { TEST_METADATA: JSON.stringify({ ...f.metadata, ...mutation }) });
    assert.notEqual(result.status, 0);
    const { evidence } = await f.report(result);
    assert.equal(evidence.failure.code, "REGISTRY_METADATA_INVALID");
    const calls = (await readFile(f.log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      calls.map((args) => args[0]),
      ["view"],
    );
  });
}
