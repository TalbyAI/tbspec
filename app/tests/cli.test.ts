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

test("CLI query commands save, inspect, bind, run and confirm removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-query-"));
  await initializeProject({ directory: root, baseIri: "urn:query-cli:/" });
  await writeFile(
    join(root, "data.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> . <urn:cli:data> a owl:Ontology; <urn:cli:value> "7" .`,
  );
  await writeFile(
    join(root, "source.rq"),
    "\uFEFFSELECT ?subject WHERE { ?subject <urn:cli:value> ?value }",
  );
  await writeFile(
    join(root, "parameters.toml"),
    `\uFEFFschema_version = 1\n\n[[parameters]]\nname = "value"\nkind = "literal"\nrequired = true\n`,
  );
  await writeFile(join(root, "bindings.json"), '{"value":{"kind":"literal","value":"7"}}');

  const help = invoke(["query", "--help"], root);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.envelope.data.text, /query run/);
  assert.equal(invoke(["query", "list"], root).status, 0);
  const saved = invoke(
    ["query", "save", "cli-example", "--file", "source.rq", "--parameters", "parameters.toml"],
    root,
  );
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.envelope.data.applied, true);
  const shown = invoke(["query", "show", "cli-example"], root);
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(shown.envelope.data.parameters[0].name, "value");
  assert.equal(
    shown.envelope.data.queryText,
    "\uFEFFSELECT ?subject WHERE { ?subject <urn:cli:value> ?value }",
  );
  assert.deepEqual(
    await readFile(join(root, "queries/cli-example.rq")),
    Buffer.from("\uFEFFSELECT ?subject WHERE { ?subject <urn:cli:value> ?value }"),
  );
  const run = invoke(
    ["query", "run", "--saved", "cli-example", "--bindings", "bindings.json"],
    root,
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.envelope.data.rows[0].subject, { kind: "iri", value: "urn:cli:data" });
  assert.equal(invoke(["query", "run", "--saved", "cli-example"], root).status, 2);
  const preview = invoke(["query", "remove", "cli-example"], root);
  assert.equal(preview.status, 0);
  assert.equal(preview.envelope.status, "preview");
  const removed = invoke(["query", "remove", "cli-example", "--confirm"], root);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(invoke(["query", "list"], root).envelope.data.items.length, 0);
});

test("CLI dependency commands inspect a source and apply its reviewed fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-dependency-"));
  const source = join(root, "source");
  const project = join(root, "project");
  await mkdir(source);
  await initializeProject({ directory: project, baseIri: "urn:dependency-cli:/" });
  await writeFile(
    join(source, "shop.ttl"),
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/shop> a owl:Ontology .\n",
  );
  const inspected = invoke(["dependency", "inspect", "--source", source], project);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(inspected.envelope.data.items[0].resource, "shop.ttl");

  const preview = invoke(
    ["dependency", "add", "shop", "--source", source, "--kind", "ontology"],
    project,
  );
  assert.equal(preview.status, 3, preview.stderr);
  assert.equal(preview.envelope.status, "conflict");
  const fingerprint = preview.envelope.data.preview.fingerprint;
  assert.equal(
    invoke(
      [
        "dependency",
        "add",
        "shop",
        "--source",
        source,
        "--kind",
        "ontology",
        "--accepted-preview",
        fingerprint,
      ],
      project,
    ).status,
    0,
  );
  assert.ok(
    invoke(["dependency", "list"], project).envelope.data.items.some(
      (dependency: { id: string }) => dependency.id === "shop",
    ),
  );
  assert.equal(
    invoke(["dependency", "show", "shop"], project).envelope.data.dependency.primarySelector,
    "dep:shop/source/shop.ttl",
  );
  for (const args of [
    ["dependency", "add", "shop", "--source", source, "--kind", "ontology", "--accept-impact"],
    ["dependency", "inspect", "--resource", "shop.ttl"],
  ]) {
    const rejected = invoke(args, project);
    assert.equal(rejected.status, 2, `${args.join(" ")}: ${rejected.stderr}`);
  }
});

test("CLI dependencies select and clear an ontology winner and check source drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-dependency-resolution-"));
  const source = join(root, "source");
  const project = join(root, "project");
  const ontologyIri = "https://example.org/selected-vocabulary";
  await mkdir(source);
  await initializeProject({ directory: project, baseIri: "urn:dependency-resolution-cli:/" });
  await writeFile(
    join(source, "vocabulary.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${ontologyIri}> a owl:Ontology .\n`,
  );
  const preview = invoke(
    ["dependency", "add", "vocabulary", "--source", source, "--kind", "ontology"],
    project,
  );
  assert.equal(preview.status, 3, preview.stderr);
  assert.equal(
    invoke(
      [
        "dependency",
        "add",
        "vocabulary",
        "--source",
        source,
        "--kind",
        "ontology",
        "--accepted-preview",
        preview.envelope.data.preview.fingerprint,
      ],
      project,
    ).status,
    0,
  );

  const selected = invoke(["dependency", "select", ontologyIri, "vocabulary"], project);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.envelope.data.applied, true);
  assert.match(await readFile(join(project, "tbspec.toml"), "utf8"), /\[ontology_choices\]/);

  const cleared = invoke(["dependency", "clear", ontologyIri], project);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(cleared.envelope.data.applied, true);
  assert.equal(
    await readFile(join(project, "tbspec.toml"), "utf8").then((text) =>
      text.includes(`"${ontologyIri}"`),
    ),
    false,
  );

  const lockBefore = await readFile(join(project, "tbspec.lock"));
  const checked = invoke(["dependency", "check", "vocabulary"], project);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.envelope.data.items[0].state, "unchanged");
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBefore);
  assert.equal(invoke(["dependency", "check"], project).status, 0);
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
    ["llms", "views", "designs"],
    ["llms", "safety", "recovery"],
  ]) {
    const result = invoke(args, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.envelope.status, "ok");
    assert.equal(result.stderr, "");
  }
  const designHelp = invoke(["llms", "views", "designs"], cwd);
  assert.equal(designHelp.status, 0, designHelp.stderr);
  assert.match(JSON.stringify(designHelp.envelope.data), /design import/);
  assert.match(JSON.stringify(designHelp.envelope.data), /nearest inherited dependency/);
  assert.match(JSON.stringify(designHelp.envelope.data), /presentation graph/);
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

test("CLI configures model types and requires explicit acceptance for incompatible used vocabulary", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-cli-model-type-"));
  await initializeProject({ directory: root, baseIri: "urn:cli-model-type:/" });
  const local = "<urn:cli-model-type:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n";
  await writeFile(join(root, "replacement.ttl"), local);
  const added = invoke(
    ["config", "model-type", "set", "custom", "--ontology", "replacement.ttl"],
    root,
  );
  assert.equal(added.envelope.status, "ok", added.stderr);
  assert.deepEqual(
    invoke(["config", "model-type", "show", "custom"], root).envelope.data.modelType,
    {
      name: "custom",
      enabled: true,
      ontology: "replacement.ttl",
      design: null,
      origin: "manifest",
    },
  );
  assert.equal(invoke(["config", "model-type", "disable", "custom"], root).status, 0);
  assert.equal(
    invoke(["config", "model-type", "show", "custom"], root).envelope.data.modelType.enabled,
    false,
  );
  assert.equal(invoke(["config", "model-type", "enable", "custom"], root).status, 0);
  assert.equal(invoke(["config", "model-type", "reset", "custom"], root).status, 2);
  assert.equal(
    invoke(["config", "model-type", "set", "custom", "--ontology", "missing.ttl"], root).status,
    1,
  );

  assert.equal(invoke(["model", "create", "models/plan.ttl", "--type", "process"], root).status, 0);
  const modelBytes = await readFile(join(root, "models/plan.ttl"));
  const preview = invoke(
    ["config", "model-type", "set", "process", "--ontology", "replacement.ttl"],
    root,
  );
  assert.equal(preview.envelope.status, "preview", preview.stderr);
  assert.deepEqual(await readFile(join(root, "models/plan.ttl")), modelBytes);
  assert.deepEqual(preview.envelope.data.preview.impact.acceptance, ["accept-impact"]);
  assert.equal(
    invoke(
      [
        "config",
        "model-type",
        "set",
        "process",
        "--ontology",
        "replacement.ttl",
        "--accept-impact",
        "--accepted-preview",
        preview.envelope.data.preview.fingerprint,
      ],
      root,
    ).status,
    0,
  );
  assert.deepEqual(await readFile(join(root, "models/plan.ttl")), modelBytes);
  assert.equal(
    invoke(["config", "model-type", "show", "process"], root).envelope.data.modelType.design,
    null,
  );
  assert.equal(
    invoke(["config", "model-type", "design", "set", "process", "dep:tbspec-process-design"], root)
      .status,
    0,
  );
  assert.equal(invoke(["config", "model-type", "design", "clear", "process"], root).status, 0);
  for (const args of [
    ["config", "model-type", "set", "process", "--ontology", "replacement.ttl", "--confirm"],
    ["config", "model-type", "disable", "process", "--accept-impact"],
    ["config", "model-type", "design", "set", "process"],
  ])
    assert.equal(invoke(args, root).status, 2);
});

test("CLI inventories impact and confirms removals and fingerprint-bound resource moves", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-cli-lifecycle-"));
  await initializeProject({ directory: root, baseIri: "urn:cli-lifecycle:/" });
  assert.equal(
    invoke(["ontology", "create", "vocabulary.ttl", "--iri", "urn:cli-lifecycle:vocabulary"], root)
      .status,
    0,
  );
  await writeFile(
    join(root, "vocabulary.ttl"),
    "<urn:cli-lifecycle:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n<urn:cli-lifecycle:Term> a <http://www.w3.org/2002/07/owl#Class> .\n",
  );
  await writeFile(
    join(root, "model.ttl"),
    '<urn:cli-lifecycle:model> a <https://talby.ai/ontology/tbspec#ConceptualDataModel>; <https://talby.ai/ontology/tbspec#modelType> "data" .\n<urn:cli-lifecycle:data> <urn:cli-lifecycle:uses> <urn:cli-lifecycle:Term> .\n',
  );
  const impact = invoke(["impact", "ontology", "vocabulary.ttl"], root);
  assert.equal(impact.envelope.status, "ok", impact.stderr);
  assert.ok(impact.envelope.data.targetIris.includes("urn:cli-lifecycle:vocabulary"));

  const removal = invoke(["ontology", "remove", "vocabulary.ttl"], root);
  assert.equal(removal.envelope.status, "preview", removal.stderr);
  assert.ok(
    removal.envelope.data.preview.impact.affectedFiles.includes("model.ttl"),
    JSON.stringify(removal.envelope.data.preview),
  );
  const removed = invoke(
    [
      "ontology",
      "remove",
      "vocabulary.ttl",
      "--confirm",
      "--accepted-preview",
      removal.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(await readFile(join(root, "model.ttl"), "utf8"), /urn:cli-lifecycle:Term/);
  await assert.rejects(readFile(join(root, "vocabulary.ttl")), { code: "ENOENT" });

  await writeFile(join(root, "loose.ttl"), "<urn:loose:s> <urn:loose:p> <urn:loose:o> .\n");
  const move = invoke(["resource", "move", "loose.ttl", "archive/loose.ttl"], root);
  assert.equal(move.envelope.status, "preview", move.stderr);
  assert.ok(
    move.envelope.data.preview.arguments.identityChanges.some(
      (item: { identity: string }) => item.identity === "generated",
    ),
  );
  const moved = invoke(
    [
      "resource",
      "move",
      "loose.ttl",
      "archive/loose.ttl",
      "--apply",
      "--accepted-preview",
      move.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(moved.status, 0, moved.stderr);
  await assert.rejects(readFile(join(root, "loose.ttl")), { code: "ENOENT" });
  assert.match(await readFile(join(root, "archive/loose.ttl"), "utf8"), /urn:loose:s/);

  await writeFile(
    join(root, "custom.ttl"),
    "<urn:cli-lifecycle:custom> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );
  assert.equal(
    invoke(["config", "model-type", "set", "custom", "--ontology", "custom.ttl"], root).status,
    0,
  );
  assert.equal(invoke(["model", "create", "custom-model.ttl", "--type", "custom"], root).status, 0);
  const typePreview = invoke(["config", "model-type", "remove", "custom"], root);
  assert.equal(typePreview.envelope.status, "preview", typePreview.stderr);
  assert.deepEqual(typePreview.envelope.data.affectedModels, [
    { selector: "custom-model.ttl", file: "custom-model.ttl" },
  ]);
  const typeRemoval = invoke(
    [
      "config",
      "model-type",
      "remove",
      "custom",
      "--confirm",
      "--accepted-preview",
      typePreview.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(typeRemoval.status, 0, typeRemoval.stderr);
  assert.ok(
    typeRemoval.envelope.diagnostics.some((d: { code: string }) => d.code === "ASSOCIATION_BROKEN"),
  );
  await readFile(join(root, "custom-model.ttl"));
  assert.equal(invoke(["config", "model-type", "remove", "data", "--confirm"], root).status, 2);
});
