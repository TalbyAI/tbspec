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

test("CLI validates, lists shapes and confirms schema removal offline with exact signatures", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-validate-"));
  await initializeProject({ directory: root, baseIri: "urn:cli:/" });
  for (const args of [
    ["model", "create", "schema.ttl", "--type", "data"],
    ["model", "create", "model.ttl", "--type", "data", "--profile", "concrete"],
    ["model", "schema", "add", "model.ttl", "schema.ttl"],
    ["shapes", "create", "model.ttl"],
  ])
    assert.equal(invoke(args, root).status, 0);
  assert.deepEqual(
    invoke(["model", "schema", "list", "model.ttl"], root).envelope.data.items.map(
      (r: { selector: string }) => r.selector,
    ),
    ["schema.ttl"],
  );
  assert.equal(
    invoke(["shapes", "list", "--source", "model.ttl"], root).envelope.data.items[0].selector,
    "model.shacl.ttl",
  );
  assert.equal(invoke(["validate", "model.ttl"], root).status, 0);
  const preview = invoke(["model", "schema", "remove", "model.ttl", "schema.ttl"], root);
  assert.equal(preview.envelope.status, "preview", preview.stderr);
  const fingerprint = preview.envelope.data.preview.fingerprint;
  assert.equal(
    invoke(
      [
        "model",
        "schema",
        "remove",
        "model.ttl",
        "schema.ttl",
        "--confirm",
        "--accepted-preview",
        fingerprint,
      ],
      root,
    ).status,
    0,
  );
  await writeFile(join(root, "broken.ttl"), "broken Turtle [");
  assert.equal(invoke(["validate", "model.ttl"], root).status, 0);
  const whole = invoke(["validate"], root);
  assert.equal(whole.status, 1);
  assert.ok(whole.envelope.diagnostics.some((d: { code: string }) => d.code === "RDF_SYNTAX"));
  for (const args of [
    ["validate", "one", "two"],
    ["validate", "--confirm"],
    ["model", "schema", "add", "model.ttl"],
    ["model", "schema", "list", "model.ttl", "--type", "data"],
    ["shapes", "create", "model.ttl", "--source", "schema.ttl"],
  ])
    assert.equal(invoke(args, root).status, 2);
});
test("CLI authors and inspects every model family and imports locked vocabulary offline", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-author-"));
  await initializeProject({ directory: root, baseIri: "urn:cli:/" });
  for (const args of [
    ["ontology", "create", "vocabulary.ttl", "--iri", "urn:cli:vocabulary"],
    ["ontology", "import", "dep:tbspec-state-machine", "adopted.ttl"],
    ["model", "create", "concepts.ttl", "--type", "data"],
    [
      "model",
      "create",
      "individuals.ttl",
      "--type",
      "data",
      "--profile",
      "concrete",
      "--schema",
      "concepts.ttl",
      "--schema",
      "concepts.ttl",
    ],
    ["model", "create", "process.ttl", "--type", "process"],
    ["model", "create", "states.ttl", "--type", "state-machine"],
    ["model", "import", "individuals.ttl", "imported.ttl", "--type", "data"],
    ["ontology", "list"],
    ["ontology", "show", "adopted.ttl"],
    ["model", "list"],
    ["model", "show", "individuals.ttl"],
    ["ontology", "--help"],
    ["model", "--help"],
    ["llms", "modeling", "models", "import"],
  ]) {
    const result = invoke(args, root);
    assert.equal(result.status, 0, result.stderr);
  }
  for (const args of [
    ["model", "create", "missing.ttl"],
    ["model", "create", "invalid.ttl", "--type", "process", "--profile", "concrete"],
    ["ontology", "list", "--iri", "urn:extra"],
    ["status", "--type", "data"],
    [
      "model",
      "import",
      "states.ttl",
      "invalid.ttl",
      "--type",
      "state-machine",
      "--schema",
      "concepts.ttl",
    ],
  ])
    assert.equal(invoke(args, root).status, 2);
  assert.equal(invoke(["ontology", "create", "vocabulary.ttl"], root).status, 3);
  const review = invoke(
    ["ontology", "create", "reviewed.ttl", "--accepted-preview", `sha256:${"0".repeat(64)}`],
    root,
  );
  assert.equal(review.status, 3);
  assert.equal(review.envelope.data.applied, false);
  await assert.rejects(readFile(join(root, "reviewed.ttl")), { code: "ENOENT" });
  const accepted = invoke(
    [
      "ontology",
      "create",
      "reviewed.ttl",
      "--accepted-preview",
      review.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(accepted.status, 0, accepted.stderr);
});
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

test("inspection CLI routes exact signatures, portable selectors and complete offline status", async () => {
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
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.envelope.data.project.validationComplete, true);
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
