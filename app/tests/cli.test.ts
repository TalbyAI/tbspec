import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverProject, initializeProject } from "../src/project.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const offline = new URL("fixtures/offline.ts", import.meta.url).href;
function invoke(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, ["--import", offline, cli, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.stdout.trim().split("\n").length, 1, result.stdout);
  assert.ok(result.stdout.trim(), result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schemaVersion, 1);
  assert.deepEqual(Object.keys(envelope).sort(), [
    "data",
    "diagnostics",
    "schemaVersion",
    "status",
  ]);
  return { ...result, envelope };
}
test("help/version, argument errors and recursive llms produce exactly one envelope without a project", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tbspec-cli-"));
  for (const args of [
    ["--help"],
    ["init", "--help"],
    ["llms", "--help"],
    ["--version"],
    ["llms"],
    ...["project", "modeling", "views", "dependencies", "queries", "repair"].map((topic) => [
      "llms",
      topic,
    ]),
    ["llms", "projects"],
    ["llms", "projects", "init"],
    ["llms", "safety", "recovery"],
  ]) {
    const result = invoke(args, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.envelope.status, "ok");
    assert.equal(result.stderr, "");
  }
  for (const args of [
    ["unknown"],
    ["init", "--base-iri"],
    ["init", "a", "b"],
    ["--unknown", "--help"],
    ["init", "--base-iri", "relative/"],
    ["init", "--base-iri", "https://example.org/no-trailing-slash"],
    ["llms", "projects", "missing"],
    ["init", "--project", cwd, "other"],
  ]) {
    const result = invoke(args, cwd);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.envelope.status, "invalid_arguments");
    assert.match(result.stderr, /ARGUMENT_INVALID/);
  }
});
test("CLI init works with Node alone, preserves ignore bytes and explicit root overrides discovery", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-cli-init-"));
  const root = join(parent, "one");
  await mkdir(root);
  const ignore = "# human rules\r\nartifacts/\r\n";
  await writeFile(join(root, ".gitignore"), ignore);
  const result = invoke(["init", root, "--base-iri", "urn:example:knowledge/"], parent);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.envelope.data.projectValidity, "unchecked");
  assert.equal(
    await readFile(join(root, ".gitignore"), "utf8"),
    `${ignore}.tbspec/runtime/\r\n.tbspec/previews/\r\n.tbspec/transactions/\r\n.tbspec/operation.lock\r\n`,
  );
  const repeated = invoke(["init", root], parent);
  assert.equal(repeated.status, 3);
  assert.equal(repeated.envelope.status, "conflict");
  const manifestBefore = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    manifestBefore.replace("schema_version = 1", "schema_version = 2"),
  );
  const incompatible = invoke(["init", root], parent);
  assert.equal(incompatible.status, 1);
  assert.equal(incompatible.envelope.status, "invalid");
  assert.equal(incompatible.envelope.diagnostics[0].code, "SCHEMA_UNSUPPORTED");
  await writeFile(join(root, "tbspec.toml"), manifestBefore);
  const other = join(parent, "two");
  await initializeProject({ directory: other });
  const child = join(root, "subdirectory");
  await mkdir(child);
  assert.equal(await discoverProject({ cwd: child, project: other }), await realpath(other));
  await assert.rejects(discoverProject({ cwd: child, project: parent }), /Explicit directory/);
  const missingParent = invoke(["init", join(root, "tbspec.toml", "cannot-be-directory")], parent);
  assert.equal(missingParent.status, 4);
  assert.equal(missingParent.envelope.status, "unavailable");
});

test("inspection CLI routes exact signatures, portable selectors and incomplete status", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-cli-inspect-"));
  await initializeProject({ directory: root });
  await mkdir(join(root, "models"));
  await writeFile(join(root, "models/plain.ttl"), '<urn:a> <urn:p> "value" .');
  const cwd = join(root, "models");
  for (const args of [
    ["graph", "list"],
    ["graph", "show", "models\\plain.ttl"],
    ["graph", "show", "dep:tbspec-metadata"],
    ["config", "show"],
    ["config", "model-type", "list"],
  ]) {
    const result = invoke(args, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.envelope.status, "ok");
  }
  const status = invoke(["status"], cwd);
  assert.equal(status.status, 1);
  assert.equal(status.envelope.data.project.validationComplete, false);
  assert.equal(status.envelope.data.counts.resources, 1);
  for (const args of [
    ["status", "extra"],
    ["graph", "show"],
    ["graph", "list", "extra"],
    ["config", "model-type", "set", "new"],
    ["web", "status", "--background"],
    ["web", "--port", "0"],
    ["web", "--port", "1e3"],
  ])
    assert.equal(invoke(args, cwd).status, 2);
  for (const args of [
    ["graph", "--help"],
    ["config", "--help"],
    ["web", "--help"],
    ["llms", "project", "inspect"],
    ["llms", "project", "web"],
  ])
    assert.equal(invoke(args, tmpdir()).status, 0);
});
