import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectProject } from "../src/inspection.ts";
import { initializeProject } from "../src/project.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";

test("inspection includes OWL RDF/XML and keeps invalid project arguments distinct", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-inspect-owl-"));
  await initializeProject({ directory: root });
  await writeFile(
    join(root, "ontology.owl"),
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:owl="http://www.w3.org/2002/07/owl#"><owl:Ontology rdf:about="urn:ontology"/></rdf:RDF>',
  );
  await writeFile(
    join(root, "literal.ttl"),
    '<urn:x> a "https://talby.ai/ontology/tbspec#Model" .',
  );
  const listed = await inspectProject({ project: root, command: "graph.list" });
  assert.equal(listed.status, "ok");
  assert.deepEqual(
    listed.data?.items?.map((r) => [r.selector, r.kind]),
    [
      ["literal.ttl", "unclassified"],
      ["ontology.owl", "ontology"],
    ],
  );
  const shown = await inspectProject({
    project: root,
    command: "graph.show",
    selector: "ontology.owl",
  });
  assert.equal(shown.data?.resource?.graphIri, "urn:ontology");
  assert.equal(
    (await inspectProject({ project: join(root, "tbspec.toml"), command: "status" })).status,
    "invalid_arguments",
  );
});

test("inspection lists owned graphs, classifies compatible roots and reports incomplete validation", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-inspect-"));
  assert.equal((await initializeProject({ directory: root })).status, "ok");
  await mkdir(join(root, "models"));
  await writeFile(
    join(root, "models/process.ttl"),
    `
    @prefix t: <https://talby.ai/ontology/tbspec#> .
    <urn:plan> a t:Model, t:ProcessModel; t:modelType "process" .
    <urn:step> a <http://purl.org/net/p-plan#Step> .
  `,
  );
  await writeFile(join(root, "models/plain.ttl"), '<urn:a> <urn:p> "hello"@es .');
  const listed = await inspectProject({ project: root, command: "graph.list" });
  assert.equal(listed.status, "ok", JSON.stringify(listed));
  assert.deepEqual(
    listed.data?.items?.map((item) => [item.selector, item.kind]),
    [
      ["models/plain.ttl", "unclassified"],
      ["models/process.ttl", "process-model"],
    ],
  );
  assert.equal(
    listed.data?.items?.[0]?.graphIri,
    "urn:tbspec:graph:7387d13d707a5121df14d411dc7f8849b14725dc0738e3dfc9419960fc69d237",
  );
  const shown = await inspectProject({
    project: root,
    command: "graph.show",
    selector: "dep:tbspec-metadata",
  });
  assert.equal(shown.status, "ok", JSON.stringify(shown));
  assert.match(shown.data?.resource?.selector ?? "", /^dep:tbspec-metadata\/source\//);
  assert.equal(shown.data?.resource?.ownership, "dependency");
  const pplan = await inspectProject({
    project: root,
    command: "graph.show",
    selector: "dep:tbspec-process/source/p-plan.owl",
  });
  assert.equal(pplan.status, "ok", JSON.stringify(pplan));
  assert.equal(pplan.data?.resource?.kind, "ontology");
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const dep = lock.dependencies["tbspec-process"];
  assert.ok(dep);
  dep.bindings.push({
    context: dep.files[0]?.context,
    resource: dep.primary,
    ontologies: ["source/p-plan.owl"],
    schemas: [],
  });
  dep.interpretation_signature = interpretationSignature(dep);
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  const bound = await inspectProject({
    project: root,
    command: "graph.show",
    selector: "dep:tbspec-process",
  });
  assert.equal(bound.status, "ok", JSON.stringify(bound));
  assert.ok(
    bound.data?.resource?.associations.some(
      (a) => a.role === "ontology" && a.selector === "dep:tbspec-process/source/p-plan.owl",
    ),
  );
  const status = await inspectProject({ project: root, command: "status" });
  assert.equal(status.data?.project?.validationComplete, false);
  assert.equal(status.data?.counts?.resources, 2);
  assert.ok(status.diagnostics.some((d) => d.code === "CHECK_SKIPPED"));
});

test("malformed and ambiguous graphs retain independent inspection and scoped exact terms", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-inspect-invalid-"));
  await initializeProject({ directory: root });
  const prefix = "@prefix t: <https://talby.ai/ontology/tbspec#> .";
  await writeFile(
    join(root, "mixed.ttl"),
    `${prefix} <urn:x> a t:ProcessModel, t:StateMachineModel .`,
  );
  await writeFile(join(root, "roots.ttl"), `${prefix} <urn:x> a t:Model . <urn:y> a t:Model .`);
  await writeFile(join(root, "broken.ttl"), '<urn:x> <urn:p> "unterminated');
  await writeFile(
    join(root, "plain.nt"),
    '_:b <urn:p> "hola"@es .\n<urn:x> <urn:p> "01"^^<http://www.w3.org/2001/XMLSchema#integer> .',
  );
  const before = await readFile(join(root, "mixed.ttl"));
  const listed = await inspectProject({ project: root, command: "graph.list" });
  assert.equal(listed.status, "invalid");
  assert.equal(listed.data?.items?.length, 4);
  assert.equal(listed.diagnostics.filter((d) => d.code === "GRAPH_CLASSIFICATION").length, 2);
  assert.equal(listed.diagnostics.filter((d) => d.code === "RDF_SYNTAX").length, 1);
  const shown = await inspectProject({
    project: root,
    command: "graph.show",
    selector: "plain.nt",
  });
  assert.equal(shown.status, "ok");
  assert.deepEqual(
    shown.data?.triples?.map((t) => t.object),
    [
      { kind: "literal", value: "hola", language: "es" },
      { kind: "literal", value: "01", datatype: "http://www.w3.org/2001/XMLSchema#integer" },
    ],
  );
  assert.equal(shown.data?.triples?.[0]?.subject.scope, "plain.nt");
  assert.deepEqual(await readFile(join(root, "mixed.ttl")), before);
  for (const selector of [
    "../escape.ttl",
    "dep:tbspec-metadata/../escape.ttl",
    ".tbspec/runtime/web.json",
    "dep:tbspec-metadata/unlisted.ttl",
  ])
    assert.notEqual(
      (await inspectProject({ project: root, command: "graph.show", selector })).status,
      "ok",
    );
});

test("effective configuration uses project-locked defaults and whole manifest replacements", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-config-"));
  await initializeProject({ directory: root });
  const text =
    'schema_version = 1\r\n# human note\r\n[unknown]\r\nkeep = "yes"\r\n[model_types.process]\r\nontology = "dep:tbspec-process"\r\nenabled = false\r\n';
  await writeFile(join(root, "tbspec.toml"), text);
  const config = await inspectProject({ project: root, command: "config.show" });
  assert.equal(config.status, "ok");
  const types = config.data?.modelTypes as {
    name: string;
    enabled: boolean;
    design: string | null;
    origin: string;
  }[];
  assert.deepEqual(
    types.find((type) => type.name === "process"),
    {
      name: "process",
      enabled: false,
      ontology: "dep:tbspec-process",
      design: null,
      origin: "manifest",
    },
  );
  assert.equal(types.find((type) => type.name === "data")?.origin, "locked-default");
  assert.equal(
    (config.data?.acquisition as { maxGraphBytes: number } | undefined)?.maxGraphBytes,
    67108864,
  );
  assert.equal(config.data?.baseIri, null);
  assert.equal(await readFile(join(root, "tbspec.toml"), "utf8"), text);
  await writeFile(join(root, "tbspec.lock"), "schema_version = 2\n");
  const incompatible = await inspectProject({ project: root, command: "status" });
  assert.equal(incompatible.status, "invalid");
  assert.ok(incompatible.diagnostics.some((d) => d.code === "SCHEMA_UNSUPPORTED"));
});
