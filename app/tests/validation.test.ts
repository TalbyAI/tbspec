import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource, prepareResource, publishResource } from "../src/authoring.ts";
import { digest, graphSignature } from "../src/canonical.ts";
import { captureInspection, inspectProject, inspectSnapshot } from "../src/inspection.ts";
import { exits } from "../src/output.ts";
import { initializeProject } from "../src/project.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";

async function project() {
  const root = await mkdtemp(join(tmpdir(), "tb-validation-"));
  assert.equal(
    (await initializeProject({ directory: root, baseIri: "https://example.org/" })).status,
    "ok",
  );
  return realpath(root);
}

test("offline status establishes complete validity for installed starters and empty models", async () => {
  const root = await project();
  for (const type of ["data", "process", "state-machine"])
    assert.equal(
      (await authorResource({ project: root, command: "model.create", path: `${type}.ttl`, type }))
        .status,
      "ok",
    );
  const result = await inspectProject({ project: root, command: "status" });
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.deepEqual(result.data?.project, { root, validity: "valid", validationComplete: true });
});

const prefixes = `@prefix t: <https://talby.ai/ontology/tbspec#> . @prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <urn:ex:> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .`;

test("selected validation reports deferred read failures as unavailable I/O", async () => {
  const root = await project();
  const selector = "dep:tbspec-process";
  const snapshot = await captureInspection(root, "validate", selector);
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const dep = lock.dependencies["tbspec-process"];
  assert.ok(dep);
  const path = `${dep.snapshot_path}/${dep.primary}`;
  assert.equal(Object.hasOwn(snapshot.files, path), false);
  assert.ok(!snapshot.reads.some((read) => read.kind === "file" && read.path === path));
  await rm(join(root, path));
  await mkdir(join(root, path));

  const result = await inspectSnapshot(root, snapshot, { command: "validate", selector });
  assert.equal(result.status, "unavailable", JSON.stringify(result));
  assert.equal(exits[result.status], 4);
  assert.ok(result.diagnostics.some((d) => d.code === "IO_FAILURE"));
  assert.ok(!result.diagnostics.some((d) => d.code === "RDF_SYNTAX"));
});

test("selected validation attributes Core results and treats warnings as success", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:item a ex:Thing . ex:Thing a owl:Class .`,
  );
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:required a sh:NodeShape; sh:targetClass ex:Thing; sh:severity sh:Warning; sh:message "Add a label"@en; sh:property [ sh:path rdfs:label; sh:minCount 1; sh:severity sh:Warning ] .`,
  );
  await writeFile(join(root, "unrelated.ttl"), "broken Turtle [");
  const result = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  assert.equal(result.status, "ok", JSON.stringify(result.diagnostics));
  assert.equal(result.data?.validationComplete, true);
  const warning = result.diagnostics.find((d) => d.code === "SHACL_RESULT");
  assert.equal(warning?.severity, "warning");
  assert.equal(warning?.file, "model.ttl");
  assert.equal(warning?.shacl?.selector, "model.shacl.ttl");
  assert.equal(warning?.shacl?.graphIri, "urn:ex:shapes");
  assert.deepEqual(warning?.shacl?.focusNode, { kind: "iri", value: "urn:ex:item" });
  assert.equal(warning?.line, undefined);
  assert.ok(!result.diagnostics.some((d) => d.file === "unrelated.ttl"));
});

test("unsafe constraint graphs are skipped whole while independent shapes and targets continue", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:item a ex:Thing . ex:Thing a owl:Class .`,
  );
  await writeFile(
    join(root, "good.ttl"),
    `${prefixes} ex:good a t:ShapesGraph . ex:required a sh:NodeShape; sh:targetClass ex:Thing; sh:property [sh:path rdfs:label; sh:minCount 1] .`,
  );
  const original = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    `${original}\n[[associations]]\nresource = "model.ttl"\nsupport = "good.ttl"\nrole = "shacl"\n`,
  );
  for (const query of [
    "SELECT $this WHERE { SERVICE <http://127.0.0.1:1/> { $this ?p ?o } }",
    "SELECT $this FROM <http://127.0.0.1:1/> WHERE { $this ?p ?o }",
    "SELECT $this WHERE { MINUS { $this ?p ?o } }",
    "SELECT $this WHERE { VALUES ?x { 1 } }",
    "SELECT $this WHERE { BIND(1 AS ?this) }",
    "SELECT $this WHERE { { SELECT ?x WHERE { ?x ?p ?o } } }",
    "SELECT $this WHERE { $this ?p $shapesGraph }",
    "SELECT ?x WHERE { ?x ?p ?o }",
    "SELECT $this WHERE { $PATH ?p $this }",
    "INSERT DATA { <urn:x> <urn:p> <urn:o> }",
  ]) {
    await writeFile(
      join(root, "model.shacl.ttl"),
      `${prefixes} ex:bad a t:ShapesGraph . ex:s a sh:NodeShape; sh:targetClass ex:Thing; sh:sparql [ sh:select ${JSON.stringify(query)} ] .`,
    );
    const result = await inspectProject({
      project: root,
      command: "validate",
      selector: "model.ttl",
    });
    assert.equal(result.status, "invalid", query);
    assert.equal(result.data?.validationComplete, false, query);
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === "SHACL_QUERY_REJECTED" && d.file === "model.shacl.ttl",
      ),
      JSON.stringify(result),
    );
    assert.ok(
      result.diagnostics.some((d) => d.code === "SHACL_RESULT" && d.shacl?.selector === "good.ttl"),
      query,
    );
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === "CHECK_SKIPPED" && d.check?.blockedBy.includes("model.shacl.ttl"),
      ),
      query,
    );
  }
});

test("schema removal previews lost vocabulary and publishes only confirmed revision-bound bytes", async () => {
  const root = await project();
  await writeFile(
    join(root, "schema.ttl"),
    `${prefixes} ex:schema a t:ConceptualDataModel; t:modelType "data" . ex:Thing a owl:Class . ex:friend a owl:ObjectProperty .`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:alice a ex:Thing; ex:friend <http://127.0.0.1:1/unavailable>, [ a ex:Thing ] .`,
  );
  const added = await authorResource({
    project: root,
    command: "model.schema.add",
    path: "model.ttl",
    source: "schema.ttl",
  });
  assert.equal(added.status, "ok", JSON.stringify(added));
  assert.equal(
    (await inspectProject({ project: root, command: "validate", selector: "model.ttl" })).status,
    "ok",
  );
  const bytes = await readFile(join(root, "model.ttl"));
  const removed = await authorResource({
    project: root,
    command: "model.schema.remove",
    path: "model.ttl",
    source: "schema.ttl",
  });
  assert.equal(removed.status, "preview", JSON.stringify(removed));
  assert.deepEqual(await readFile(join(root, "model.ttl")), bytes);
  assert.ok(removed.diagnostics.some((d) => d.code === "VOCABULARY_UNKNOWN"));
  const preview = removed.data?.preview as {
    fingerprint: string;
    arguments: { removedVocabulary: unknown[]; affectedReferences: unknown[] };
  };
  assert.equal(preview.arguments.removedVocabulary.length, 2);
  assert.equal(preview.arguments.affectedReferences.length, 4);
  const accepted = await authorResource({
    project: root,
    command: "model.schema.remove",
    path: "model.ttl",
    source: "schema.ttl",
    confirm: true,
    acceptedPreview: preview.fingerprint,
  });
  assert.equal(accepted.status, "ok", JSON.stringify(accepted));
  assert.equal(accepted.data?.projectValidity, "invalid");
  assert.deepEqual(accepted.data?.validation, { validity: "invalid", validationComplete: true });
  assert.equal(
    (await inspectProject({ project: root, command: "validate", selector: "model.ttl" })).status,
    "invalid",
  );
});

test("associated shapes creation lists its source and rejects occupied and stale destinations", async () => {
  const root = await project();
  await authorResource({ project: root, command: "model.create", path: "model.ttl", type: "data" });
  const prepared = await prepareResource({
    project: root,
    command: "shapes.create",
    path: "model.ttl",
  });
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:changed a t:ConceptualDataModel; t:modelType "data" .`,
  );
  assert.equal((await publishResource(prepared)).status, "conflict");
  const created = await authorResource({
    project: root,
    command: "shapes.create",
    path: "model.ttl",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  assert.equal(
    created.data?.resource && (created.data.resource as { selector: string }).selector,
    "model.shacl.ttl",
  );
  const listed = await inspectProject({
    project: root,
    command: "shapes.list",
    selector: "model.ttl",
  });
  assert.deepEqual(
    listed.data?.items?.map((r) => r.selector),
    ["model.shacl.ttl"],
  );
  assert.equal(
    (await authorResource({ project: root, command: "shapes.create", path: "model.ttl" })).status,
    "conflict",
  );
});

test("effective vocabulary supplies only hierarchy triples to each target's SHACL dataset", async () => {
  const root = await project();
  await writeFile(
    join(root, "schema.ttl"),
    `${prefixes} ex:schema a t:ConceptualDataModel; t:modelType "data" . ex:Parent a owl:Class . ex:Child a owl:Class; rdfs:subClassOf ex:Parent . ex:p a owl:ObjectProperty . ex:secret ex:p "other schema data" .`,
  );
  await writeFile(
    join(root, "schema.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:s a sh:NodeShape; sh:targetClass ex:Parent; sh:sparql [ sh:select "SELECT $this WHERE { <urn:ex:secret> <urn:ex:p> ?v }" ] .`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:schema . ex:item a ex:Child .`,
  );
  const before = await readFile(join(root, "model.ttl"));
  const valid = await inspectProject({ project: root, command: "validate", selector: "model.ttl" });
  assert.equal(valid.status, "ok", JSON.stringify(valid));
  await writeFile(
    join(root, "schema.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:s a sh:NodeShape; sh:targetClass ex:Parent; sh:property [ sh:path rdfs:label; sh:minCount 1 ] .`,
  );
  const invalid = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  assert.equal(invalid.status, "invalid");
  assert.ok(
    invalid.diagnostics.some(
      (d) =>
        d.code === "SHACL_RESULT" &&
        d.shacl?.selector === "schema.shacl.ttl" &&
        d.shacl.focusNode?.value === "urn:ex:item",
    ),
  );
  assert.deepEqual(await readFile(join(root, "model.ttl")), before);
  await writeFile(join(root, "schema.ttl"), "broken schema [");
  const partial = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  assert.equal(partial.data?.validationComplete, false);
  assert.ok(
    partial.diagnostics.some((d) => d.code === "CHECK_SKIPPED" && d.check?.kind === "shacl"),
  );
});

test("declared prefixes and predicate PATH expand before local execution with stable source terms", async () => {
  const root = await project();
  const source = `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:p a owl:DatatypeProperty . ex:item ex:p "bad" .`;
  await writeFile(join(root, "model.ttl"), source);
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . ex:shapes a t:ShapesGraph . ex:prefixes sh:declare [ sh:prefix "ex"; sh:namespace "urn:ex:"^^xsd:anyURI ] . [ a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:p; sh:sparql [ sh:prefixes ex:prefixes; sh:select 'SELECT $this ?value WHERE { $this $PATH ?value . FILTER (?value = "bad") }' ] ] .`,
  );
  const first = await inspectProject({ project: root, command: "validate", selector: "model.ttl" });
  const second = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  assert.equal(first.status, "invalid", JSON.stringify(first));
  const results = first.diagnostics.filter((d) => d.code === "SHACL_RESULT");
  assert.equal(results.length, 1, JSON.stringify(first));
  assert.deepEqual(
    second.diagnostics.filter((d) => d.code === "SHACL_RESULT"),
    results,
  );
  assert.equal(results[0]?.shacl?.path?.value, "urn:ex:p");
  assert.equal(results[0]?.shacl?.sourceShape?.kind, "blank");
  assert.equal(results[0]?.shacl?.sourceShape?.scope, "model.shacl.ttl");
  assert.equal(results[0]?.shacl?.value?.value, "bad");
  assert.equal(await readFile(join(root, "model.ttl"), "utf8"), source);
});

test("ambiguous graph identities and missing imported vocabulary cannot produce clean validation", async () => {
  const root = await project();
  await writeFile(
    join(root, "a.ttl"),
    `${prefixes} ex:schema a t:ConceptualDataModel; t:modelType "data" . ex:Thing a owl:Class .`,
  );
  await writeFile(
    join(root, "b.ttl"),
    `${prefixes} ex:schema a t:ConceptualDataModel; t:modelType "data" . ex:Other a owl:Class .`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:schema . ex:item a ex:Thing .`,
  );
  const result = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  assert.equal(result.status, "invalid", JSON.stringify(result));
  assert.ok(result.diagnostics.some((d) => d.code === "GRAPH_IRI_COLLISION"));
});

test("Core nested paths and Core plus SPARQL property constraints both inspect the actual path values", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:p a owl:ObjectProperty . ex:q a owl:ObjectProperty . ex:item ex:p ex:middle . ex:middle ex:q ex:end .`,
  );
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:nested a sh:PropertyShape; sh:targetNode ex:end; sh:path [ sh:inversePath (ex:p ex:q) ]; sh:hasValue ex:item . ex:mixed a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:q; sh:minCount 1; sh:sparql [ sh:select "SELECT $this WHERE { FILTER(false) }" ] .`,
  );
  const result = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  const results = result.diagnostics.filter((d) => d.code === "SHACL_RESULT");
  assert.equal(results.length, 1, JSON.stringify(result));
  assert.equal(results[0]?.shacl?.sourceShape?.value, "urn:ex:mixed");
  assert.equal(
    results[0]?.shacl?.constraintComponent?.value,
    "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
  );
});

test("view tuple membership and finite appearance conversion have separate diagnostics", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:p a owl:ObjectProperty . ex:a ex:p ex:b .`,
  );
  await writeFile(
    join(root, "view.ttl"),
    `${prefixes} @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> . ex:view a t:ViewModel; t:sourceGraph ex:model; t:member ex:a, ex:b; t:relationship [ rdf:subject ex:b; rdf:predicate ex:p; rdf:object ex:a ] .`,
  );
  const view = await inspectProject({ project: root, command: "validate", selector: "view.ttl" });
  assert.equal(view.status, "invalid", JSON.stringify(view));
  assert.ok(view.diagnostics.some((d) => d.code === "VIEW_INVALID" && d.check?.kind === "view"));
  await writeFile(
    join(root, "design.ttl"),
    `${prefixes} @prefix xsd: <http://www.w3.org/2001/XMLSchema#> . ex:design a t:VisualDesignModel; t:rule ex:r . ex:r a t:NodeVisualRule; t:targetConcept owl:Class; t:fontSize "INF"^^xsd:double .`,
  );
  const design = await inspectProject({
    project: root,
    command: "validate",
    selector: "design.ttl",
  });
  assert.equal(design.status, "invalid", JSON.stringify(design));
  assert.ok(design.diagnostics.some((d) => d.code === "PRESENTATION_INVALID"));
});

test("locked external models retain source bindings and selected validation excludes unused snapshots", async () => {
  const root = await project();
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const original = lock.dependencies["tbspec-process"];
  assert.ok(original);
  const dep = structuredClone(original);
  lock.dependencies["source-model"] = dep;
  dep.snapshot_path = ".tbspec/dependencies/source-model";
  await cp(join(root, original.snapshot_path), join(root, dep.snapshot_path), { recursive: true });
  for (const file of dep.files)
    if (file.identity === "generated")
      file.graph_iri = `urn:tbspec:graph:${digest(`dep:source-model/${file.key}`).slice(7)}`;
  assert.ok(dep);
  const primary = dep.files.find((file) => file.key === dep.primary);
  assert.ok(primary);
  primary.graph_iri = "urn:external-model";
  const bytes = Buffer.from(
    `${prefixes} @prefix p: <http://purl.org/net/p-plan#> . <${primary.graph_iri}> a t:ProcessModel, p:Plan; t:modelType "data" . ex:step a p:Step; p:isStepOfPlan <${primary.graph_iri}> .`,
  );
  dep.kind = "model";
  primary.kind = "process-model";
  primary.byte_digest = digest(bytes);
  primary.byte_length = bytes.length;
  primary.graph_signature = graphSignature(primary);
  dep.bindings = [
    {
      context: primary.context,
      resource: dep.primary,
      ontologies: ["source/p-plan.owl"],
      schemas: [],
    },
  ];
  dep.interpretation_signature = interpretationSignature(dep);
  parseLock(writeToml(lock));
  await writeFile(join(root, dep.snapshot_path, dep.primary), bytes);
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  await writeFile(
    join(root, "tbspec.toml"),
    'schema_version = 1\n[model_types.data]\nenabled = true\nontology = "missing.ttl"\n',
  );
  const unused = lock.dependencies["tbspec-state-machine"];
  assert.ok(unused);
  await writeFile(join(root, unused.snapshot_path, unused.primary), "corrupt unused bytes");
  const selected = await inspectProject({
    project: root,
    command: "validate",
    selector: "dep:source-model",
  });
  assert.equal(selected.status, "ok", JSON.stringify(selected));
  const whole = await inspectProject({ project: root, command: "validate" });
  assert.equal(whole.status, "invalid");
  assert.ok(whole.diagnostics.some((d) => d.code === "SNAPSHOT_INTEGRITY"));
});

test("production validation executes bundled process and state constraints on valid and invalid descriptions", async () => {
  const root = await project();
  const p =
    "@prefix p: <http://purl.org/net/p-plan#> . @prefix proc: <https://talby.ai/ontology/process#> . @prefix sm: <https://talby.ai/ontology/state-machine#> .";
  const cases: [string, boolean, string][] = [
    [
      "process",
      true,
      "ex:step a p:Step; p:isStepOfPlan ex:model, ex:other . ex:other a p:Plan . ex:decision a proc:Decision; p:isStepOfPlan ex:model . ex:v a p:Variable; p:isVariableOfPlan ex:model; p:isInputVarOf ex:decision; p:isOutputVarOf ex:step . ex:step p:hasOutputVar ex:v . ex:flow a proc:Flow; proc:inPlan ex:model; proc:source ex:step; proc:target ex:decision .",
    ],
    [
      "process",
      false,
      "ex:step a p:Step; p:isStepOfPlan ex:model; p:hasInputVar ex:v . ex:other a p:Plan . ex:v a p:Variable; p:isVariableOfPlan ex:other .",
    ],
    [
      "process",
      false,
      "ex:a a p:Step; p:isStepOfPlan ex:model . ex:b a p:Step; p:isStepOfPlan ex:model . ex:v a p:Variable; p:isVariableOfPlan ex:model; p:isOutputVarOf ex:a, ex:b .",
    ],
    [
      "process",
      false,
      "ex:other a p:Plan . ex:a a p:Step; p:isStepOfPlan ex:model . ex:b a p:Step; p:isStepOfPlan ex:other . ex:f a proc:Flow; proc:inPlan ex:model; proc:source ex:a; proc:target ex:b .",
    ],
    [
      "state-machine",
      true,
      "ex:a a sm:InitialState; sm:inMachine ex:model . ex:b a sm:State; sm:inMachine ex:model . ex:ab a sm:Transition; sm:inMachine ex:model; sm:source ex:a; sm:target ex:b . ex:ba a sm:Transition; sm:inMachine ex:model; sm:source ex:b; sm:target ex:a .",
    ],
    ["state-machine", true, "ex:a a sm:InitialState, sm:FinalState; sm:inMachine ex:model ."],
    [
      "state-machine",
      false,
      "ex:a a sm:InitialState; sm:inMachine ex:model . ex:b a sm:InitialState; sm:inMachine ex:model .",
    ],
    [
      "state-machine",
      false,
      "ex:a a sm:FinalState; sm:inMachine ex:model . ex:t a sm:Transition; sm:inMachine ex:model; sm:source ex:a; sm:target ex:a .",
    ],
    [
      "state-machine",
      false,
      "ex:other a sm:StateMachine . ex:a a sm:State; sm:inMachine ex:model . ex:b a sm:State; sm:inMachine ex:other . ex:t a sm:Transition; sm:inMachine ex:model; sm:source ex:a; sm:target ex:b .",
    ],
    ["state-machine", false, "ex:a sm:inMachine ex:model ."],
  ];
  for (const [type, valid, source] of cases) {
    const declaration =
      type === "process" ? "t:ProcessModel, p:Plan" : "t:StateMachineModel, sm:StateMachine";
    await writeFile(
      join(root, "case.ttl"),
      `${prefixes} ${p} ex:model a ${declaration}; t:modelType "${type}" . ${source}`,
    );
    const result = await inspectProject({
      project: root,
      command: "validate",
      selector: "case.ttl",
    });
    assert.equal(result.status, valid ? "ok" : "invalid", JSON.stringify({ source, result }));
    assert.equal(result.data?.validationComplete, true);
    if (!valid) assert.ok(result.diagnostics.some((d) => d.code === "SHACL_RESULT"));
  }
});

test("bundled metadata and design guards diagnose every authored invalid fixture category", async () => {
  const root = await project();
  const cases = [
    'ex:model a t:Model; t:modelType "" .',
    'ex:model a t:ConceptualDataModel; t:modelType "data"; t:schema ex:schema .',
    "ex:view a t:ViewModel; t:sourceGraph ex:source; t:member ex:a; t:relationship [ <http://www.w3.org/1999/02/22-rdf-syntax-ns#subject> ex:a; <http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate> ex:p; <http://www.w3.org/1999/02/22-rdf-syntax-ns#object> ex:b ] .",
    "ex:p a t:PresentationGraph; t:forView ex:view; t:nodePresentation [ t:element ex:a; t:x 1 ] .",
    "ex:p a t:PresentationGraph; t:forView ex:view; t:nodePresentation [ t:element ex:a ], [ t:element ex:a ] .",
    'ex:r a t:NodeVisualRule; t:targetConcept owl:Class; t:edgeRouting "bezier" .',
    'ex:r a t:EdgeVisualRule; t:targetConcept <http://www.w3.org/1999/02/22-rdf-syntax-ns#type>; t:fillColor "#FFFFFF" .',
    'ex:r a t:NodeVisualRule; t:targetConcept owl:Class; t:labelMode "text" .',
    'ex:r a t:NodeVisualRule; t:targetConcept owl:Class; t:fontSize 0; t:strokeWidth -1; t:fillColor "red" .',
    'ex:design a t:VisualDesignModel; t:rule ex:r . ex:r a t:NodeVisualRule; t:targetConcept owl:Class; t:fontSize "INF"^^<http://www.w3.org/2001/XMLSchema#double> .',
  ];
  for (const source of cases) {
    await writeFile(join(root, "case.ttl"), `${prefixes} ${source}`);
    const result = await inspectProject({
      project: root,
      command: "validate",
      selector: "case.ttl",
    });
    assert.equal(result.status, "invalid", JSON.stringify({ source, result }));
    assert.ok(
      result.diagnostics.some(
        (d) =>
          d.code === "SHACL_RESULT" ||
          d.code === "PRESENTATION_INVALID" ||
          (source.includes("t:schema") && d.code === "ASSOCIATION_BROKEN"),
      ),
      JSON.stringify({ source, result }),
    );
  }
});

test("Core alternative, recursive, optional and inverse literal paths preserve original result paths", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:p a owl:ObjectProperty . ex:q a owl:ObjectProperty . ex:a ex:p ex:b . ex:b ex:p ex:a; ex:q "end" .`,
  );
  const cases: [string, string, string, boolean][] = [
    ["ex:a", "[ sh:alternativePath (ex:p ex:q) ]", "ex:b", true],
    ["ex:a", "[ sh:zeroOrMorePath ex:p ]", "ex:a", true],
    ["ex:a", "[ sh:oneOrMorePath ex:p ]", "ex:a", true],
    ["ex:a", "[ sh:zeroOrOnePath ex:q ]", "ex:a", true],
    ['"end"', "[ sh:inversePath ex:q ]", "ex:b", true],
    ["ex:a", "(ex:p ex:q)", "ex:missing", false],
  ];
  for (const [focus, path, value, valid] of cases) {
    await writeFile(
      join(root, "model.shacl.ttl"),
      `${prefixes} ex:shapes a t:ShapesGraph . ex:s a sh:PropertyShape; sh:targetNode ${focus}; sh:path ${path}; sh:hasValue ${value} .`,
    );
    const result = await inspectProject({
      project: root,
      command: "validate",
      selector: "model.ttl",
    });
    assert.equal(result.status, valid ? "ok" : "invalid", JSON.stringify({ path, result }));
    if (!valid) {
      assert.equal(
        result.diagnostics.find((d) => d.code === "SHACL_RESULT")?.shacl?.path?.kind,
        "blank",
      );
      assert.equal(
        result.diagnostics.find((d) => d.code === "SHACL_RESULT")?.shacl?.path?.scope,
        "model.shacl.ttl",
      );
    }
  }
});

test("selected malformed lock and ambiguous prerequisite roots retain actionable partial diagnostics", async () => {
  const root = await project();
  await writeFile(
    join(root, "schema.ttl"),
    `${prefixes} ex:a a t:ConceptualDataModel . ex:b a t:ConceptualDataModel .`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:a .`,
  );
  const result = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.data?.validationComplete, false);
  assert.ok(result.diagnostics.some((d) => d.code === "CHECK_SKIPPED"));
  await writeFile(join(root, "tbspec.lock"), "invalid = [");
  const broken = await inspectProject({
    project: root,
    command: "validate",
    selector: "dep:tbspec-process",
  });
  assert.equal(broken.status, "invalid");
  assert.ok(broken.diagnostics.some((d) => d.code === "LOCK_INVALID"));
});

test("Core pattern flags reject JavaScript state and support XPath whitespace mode", async () => {
  const root = await project();
  for (const [flags, pattern, values, valid] of [
    ["ix", "^ a b $", ["ab", "AB"], true],
    ["ii", "^ab$", ["ab", "AB"], true],
    ["x", "^a[ ]b$", ["a b"], true],
    ["x", "^a[ ]b$", ["ab"], false],
    ["x", "^a#b$", ["a#b"], true],
    ["x", "^a\\ sb$", ["a b"], true],
    ["x", "^a\\ sb$", ["ab"], false],
    ["", "^\\d+$", ["١", "𝟠"], true],
    ["", "^\\D+$", ["١"], false],
    ["", "^\\p{Nd}+$", ["١"], true],
    ["", "^\\w+$", ["café", "€"], true],
    ["", "^[\\w]+$", ["café"], true],
    ["", "^\\w+$", ["_"], false],
    ["", "^\\W+$", ["_"], true],
    ["", "^[\\W]+$", ["café"], false],
    ["", "^\\s+$", ["\u00a0"], false],
    ["", "^[\\S]+$", ["\u00a0"], true],
    ["", "^\\\\d$", ["\\d"], true],
    ["", "^\\-$", ["-"], true],
    ["g", "ab", ["ab", "AB"], false],
    ["y", "ab", ["ab", "AB"], false],
  ] as const) {
    await writeFile(
      join(root, "model.ttl"),
      `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:p a owl:DatatypeProperty . ex:item ex:p ${values.map((value) => JSON.stringify(value)).join(", ")} .`,
    );
    await writeFile(
      join(root, "model.shacl.ttl"),
      `${prefixes} ex:shapes a t:ShapesGraph . ex:s a sh:PropertyShape; sh:targetNode ex:item; sh:path ex:p; sh:pattern ${JSON.stringify(pattern)}; sh:flags "${flags}" .`,
    );
    const result = await inspectProject({
      project: root,
      command: "validate",
      selector: "model.ttl",
    });
    assert.equal(result.status, valid ? "ok" : "invalid", JSON.stringify({ flags, result }));
    if (flags === "g" || flags === "y") {
      assert.ok(result.diagnostics.some((d) => d.code === "SHACL_GRAPH_INVALID"));
      assert.equal(result.data?.validationComplete, false);
    } else {
      assert.equal(result.data?.validationComplete, true);
      if (!valid) assert.ok(result.diagnostics.some((d) => d.code === "SHACL_RESULT"));
    }
  }
});

test("whole validation keeps independently source-bound vocabulary versions out of consumer conflicts", async () => {
  const root = await project();
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const original = lock.dependencies["tbspec-process"];
  assert.ok(original);
  for (const id of ["source-one", "source-two"]) {
    const dep = structuredClone(original);
    dep.kind = "model";
    dep.snapshot_path = `.tbspec/dependencies/${id}`;
    await cp(join(root, original.snapshot_path), join(root, dep.snapshot_path), {
      recursive: true,
    });
    for (const file of dep.files)
      if (file.identity === "generated")
        file.graph_iri = `urn:tbspec:graph:${digest(`dep:${id}/${file.key}`).slice(7)}`;
    const primary = dep.files.find((file) => file.key === dep.primary);
    assert.ok(primary);
    primary.kind = "concrete-data-model";
    primary.graph_iri = `urn:${id}:model`;
    const bytes = Buffer.from(
      `${prefixes} <${primary.graph_iri}> a t:ConcreteDataModel; t:modelType "data" . ex:item a ex:Thing .`,
    );
    primary.byte_digest = digest(bytes);
    primary.byte_length = bytes.length;
    primary.graph_signature = graphSignature(primary);
    await writeFile(join(root, dep.snapshot_path, dep.primary), bytes);
    const vocabulary = Buffer.from(
      `${prefixes} ex:vocabulary a owl:Ontology; rdfs:label "${id}" . ex:Thing a owl:Class .`,
    );
    const file = {
      ...primary,
      key: "source/vocabulary.ttl",
      source_resource: "vocabulary.ttl",
      roles: ["vocabulary"],
      kind: "ontology",
      graph_iri: "urn:ex:vocabulary",
      source_graph_iri: "urn:ex:vocabulary",
      byte_digest: digest(vocabulary),
      byte_length: vocabulary.length,
    };
    file.graph_signature = graphSignature(file);
    dep.files.push(file);
    dep.edges = [
      { context: primary.context, from: primary.key, relation: "vocabulary", to: file.key },
    ];
    dep.bindings = [
      { context: primary.context, resource: primary.key, ontologies: [file.key], schemas: [] },
    ];
    dep.interpretation_signature = interpretationSignature(dep);
    lock.dependencies[id] = dep;
    await writeFile(join(root, dep.snapshot_path, file.key), vocabulary);
  }
  parseLock(writeToml(lock));
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  for (const id of ["source-one", "source-two"])
    assert.equal(
      (await inspectProject({ project: root, command: "validate", selector: `dep:${id}` })).status,
      "ok",
    );
  await writeFile(
    join(root, "tbspec.toml"),
    `${await readFile(join(root, "tbspec.toml"), "utf8")}\n[ontology_choices]\n"urn:ex:vocabulary" = "source-two"\n`,
  );
  for (const id of ["source-one", "source-two"])
    assert.equal(
      (await inspectProject({ project: root, command: "validate", selector: `dep:${id}` })).status,
      "ok",
    );
  const whole = await inspectProject({ project: root, command: "validate" });
  assert.equal(whole.status, "ok", JSON.stringify(whole.diagnostics));
});
