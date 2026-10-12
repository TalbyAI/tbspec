import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource } from "../src/authoring.ts";
import { inspectProject } from "../src/inspection.ts";
import { initializeProject } from "../src/project.ts";
import type { Preview } from "../src/transactions.ts";

const prefixes = `@prefix t: <https://talby.ai/ontology/tbspec#> . @prefix ex: <urn:ex:> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> . @prefix sh: <http://www.w3.org/ns/shacl#> .`;

async function project() {
  const root = await mkdtemp(join(tmpdir(), "tb-schema-impact-"));
  assert.equal((await initializeProject({ directory: root })).status, "ok");
  await writeFile(
    join(root, "schema.ttl"),
    `${prefixes} ex:schema a t:ConceptualDataModel; t:modelType "data" . ex:Thing a owl:Class . ex:p a owl:ObjectProperty .`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:schema . ex:a a ex:Thing; ex:p ex:b .`,
  );
  return root;
}

async function preview(root: string) {
  const result = await authorResource({
    project: root,
    command: "model.schema.remove",
    path: "model.ttl",
    source: "schema.ttl",
  });
  assert.equal(result.status, "preview", JSON.stringify(result));
  return result.data?.preview as Preview;
}

test("removal reports only vocabulary roles lost from the effective remaining context", async () => {
  for (const provider of ["schema", "target"]) {
    const root = await project();
    if (provider === "schema") {
      await writeFile(
        join(root, "other.ttl"),
        `${prefixes} ex:other a t:ConceptualDataModel; t:modelType "data" . ex:Thing a owl:Class . ex:p a owl:ObjectProperty .`,
      );
      await writeFile(
        join(root, "model.ttl"),
        `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:schema, ex:other . ex:a a ex:Thing; ex:p ex:b .`,
      );
    } else {
      await writeFile(
        join(root, "model.ttl"),
        `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:schema . ex:Thing a owl:Class . ex:p a owl:ObjectProperty . ex:a a ex:Thing; ex:p ex:b .`,
      );
    }
    const plan = await preview(root);
    assert.deepEqual(plan.arguments.removedVocabulary, [], provider);
    assert.deepEqual(plan.arguments.affectedReferences, [], provider);
    assert.deepEqual(plan.impact.introducedErrors, [], provider);
  }
});

test("removal compares dependent views and transitively affected presentations", async () => {
  const root = await project();
  await writeFile(
    join(root, "view.ttl"),
    `${prefixes} ex:view a t:ViewModel; t:sourceGraph ex:model; t:member ex:model, ex:schema; t:relationship [ rdf:subject ex:model; rdf:predicate t:schema; rdf:object ex:schema ] .`,
  );
  await writeFile(
    join(root, "presentation.ttl"),
    `${prefixes} ex:presentation a t:PresentationGraph; t:forView ex:view .`,
  );
  await writeFile(
    join(root, "unrelated.ttl"),
    `${prefixes} ex:other a t:ConcreteDataModel; t:modelType "data" . ex:item a ex:Unknown .`,
  );
  assert.equal(
    (await inspectProject({ project: root, command: "validate", selector: "view.ttl" })).status,
    "ok",
  );
  const bytes = await readFile(join(root, "model.ttl"));
  const plan = await preview(root);
  assert.ok(
    plan.impact.introducedErrors.some(
      (d) => d.code === "VIEW_INVALID" && d.selector === "view.ttl",
    ),
  );
  assert.ok(plan.impact.affectedFiles.includes("view.ttl"));
  assert.ok(plan.impact.affectedFiles.includes("presentation.ttl"));
  assert.ok(!plan.impact.affectedFiles.includes("unrelated.ttl"));
  assert.ok(!plan.impact.baselineErrors.some((d) => d.selector === "unrelated.ttl"));
  assert.deepEqual(await readFile(join(root, "model.ttl")), bytes);
  const selected = await inspectProject({
    project: root,
    command: "validate",
    selector: "model.ttl",
  });
  assert.ok(
    !selected.data?.resources?.some(
      (resource: { selector: string }) => resource.selector === "view.ttl",
    ),
  );
});

test("retained property uses are unaffected when the same IRI loses its class role", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:schema . ex:Thing a owl:ObjectProperty . ex:a a ex:Thing; ex:Thing ex:b .`,
  );
  const plan = await preview(root);
  const references = plan.arguments.affectedReferences as { predicate: { value: string } }[];
  assert.equal(
    references.filter((reference) => reference.predicate.value === "urn:ex:Thing").length,
    0,
  );
  assert.equal(
    references.filter(
      (reference) =>
        reference.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
    ).length,
    1,
  );
});

test("retained vocabulary does not hide constraints and hierarchy removed with an association", async () => {
  const root = await project();
  await writeFile(
    join(root, "other.ttl"),
    `${prefixes} ex:other a t:ConceptualDataModel; t:modelType "data" . ex:Thing a owl:Class . ex:p a owl:ObjectProperty .`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data"; t:schema ex:schema, ex:other . ex:a a ex:Thing; ex:p ex:b .`,
  );
  await writeFile(
    join(root, "schema.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:check a sh:NodeShape; sh:targetNode ex:a; sh:property [ sh:path ex:p; sh:maxCount 0 ] .`,
  );
  const plan = await preview(root);
  assert.deepEqual(plan.arguments.removedVocabulary, []);
  assert.ok(
    plan.impact.baselineErrors.some(
      (d) => d.code === "SHACL_RESULT" && d.shacl?.selector === "schema.shacl.ttl",
    ),
  );
  assert.deepEqual(plan.impact.skippedChecks, []);
  assert.ok(Array.isArray(plan.arguments.deactivatedChecks));
  assert.ok(
    (plan.arguments.deactivatedChecks as { target: string; shapesSelector: string }[]).some(
      (check) => check.target === "model.ttl" && check.shapesSelector === "schema.shacl.ttl",
    ),
  );
});

test("a blocked affected prerequisite remains explicitly unassessable in removal impact", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:check a sh:NodeShape; sh:targetNode ex:a; sh:sparql [ sh:select "SELECT $this WHERE { SERVICE <urn:remote> { $this ?p ?o } }" ] .`,
  );
  const plan = await preview(root);
  assert.ok(
    plan.impact.skippedChecks.some(
      (d) => d.selector === "model.ttl" && d.details?.reason === "impact_identity_unassessable",
    ),
  );
  assert.deepEqual(plan.impact.acceptance, ["confirm"]);
});

test("additional occurrences of an existing SHACL condition are worsened rather than introduced", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:check a sh:NodeShape; sh:targetNode ex:model; sh:sparql [ sh:select "PREFIX t: <https://talby.ai/ontology/tbspec#> SELECT $this WHERE { { BIND(1 AS ?n) } UNION { FILTER NOT EXISTS { $this t:schema <urn:ex:schema> } BIND(2 AS ?n) } }" ] .`,
  );
  const plan = await preview(root);
  assert.equal(plan.impact.baselineErrors.filter((d) => d.code === "SHACL_RESULT").length, 1);
  assert.equal(plan.impact.worsenedErrors.filter((d) => d.code === "SHACL_RESULT").length, 1);
  assert.equal(plan.impact.introducedErrors.filter((d) => d.code === "SHACL_RESULT").length, 0);
});

test("untraceable query blank nodes produce stable unassessable preview fingerprints", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.shacl.ttl"),
    `${prefixes} ex:shapes a t:ShapesGraph . ex:check a sh:NodeShape; sh:targetNode ex:model; sh:sparql [ sh:select "SELECT $this ?value WHERE { BIND(BNODE() AS ?value) }" ] .`,
  );
  const first = await preview(root);
  const second = await preview(root);
  assert.ok(
    first.impact.skippedChecks.some((d) => d.details?.reason === "impact_identity_unassessable"),
  );
  assert.equal(first.fingerprint, second.fingerprint);
});

test("schema rewrites never publish internal blank-node scope labels", async () => {
  const root = await project();
  await writeFile(
    join(root, "model.ttl"),
    `${prefixes} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:a a ex:Thing; ex:p [ a ex:Thing ] .`,
  );
  for (const command of ["model.schema.add", "model.schema.remove"] as const) {
    const result = await authorResource({
      project: root,
      command,
      path: "model.ttl",
      source: "schema.ttl",
      confirm: true,
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.doesNotMatch(await readFile(join(root, "model.ttl"), "utf8"), /_:tb_[a-f0-9]{16}_/);
  }
});

test("removing an absent schema refuses publication and preserves model bytes", async () => {
  const root = await project();
  const source = `${prefixes}\n# Keep authored content.\nex:model a t:ConcreteDataModel; t:modelType "data" . ex:a ex:p [ a ex:Thing ] .\n`;
  await writeFile(join(root, "model.ttl"), source);
  const result = await authorResource({
    project: root,
    command: "model.schema.remove",
    path: "model.ttl",
    source: "schema.ttl",
    confirm: true,
  });
  assert.equal(result.status, "invalid_arguments", JSON.stringify(result));
  assert.equal(result.diagnostics[0]?.code, "ARGUMENT_INVALID");
  assert.equal(await readFile(join(root, "model.ttl"), "utf8"), source);
});
