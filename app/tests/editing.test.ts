import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource, publishResource } from "../src/authoring.ts";
import { editGraph, prepareEdit, showEditor } from "../src/editing.ts";
import { initializeProject } from "../src/project.ts";
import { parseLock } from "../src/schemas.ts";

test("exact RDF editing preserves unknown, multiple, language and datatype values", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-edit-"));
  await initializeProject({ directory: root });
  await writeFile(
    join(root, "data.ttl"),
    `
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
<urn:ontology> a owl:Ontology .
<urn:Class> a owl:Class; rdfs:label "Uno"@es, "One"@en;
  <urn:unknown> "007"^^<http://www.w3.org/2001/XMLSchema#integer>;
  rdfs:subClassOf [ a owl:Restriction; owl:onProperty <urn:property> ] .
`,
  );
  const shown = await showEditor({ project: root, selector: "data.ttl" });
  assert.ok(shown.data);
  const original = shown.data.triples.find((q) => q.object.value === "Uno");
  assert.ok(original);
  const saved = await editGraph({
    project: root,
    selector: "data.ttl",
    revision: shown.data.resource.revision,
    edits: [
      {
        action: "replace",
        before: original,
        after: { ...original, object: { ...original.object, value: "Dos" } },
      },
    ],
  });
  assert.equal(saved.status, "ok", JSON.stringify(saved));
  const current = await showEditor({ project: root, selector: "data.ttl" });
  assert.ok(current.data);
  assert.ok(
    current.data.triples.some((q) => q.object.value === "Dos" && q.object.language === "es"),
  );
  for (const value of ["One", "007", "http://www.w3.org/2002/07/owl#Restriction"])
    assert.ok(current.data.triples.some((q) => q.object.value === value));
  assert.equal(current.data.triples.length, shown.data.triples.length);
  assert.equal(
    current.data.sections.find((s) => s.type === "http://www.w3.org/2002/07/owl#Class")?.subjects[0]
      ?.value,
    "urn:Class",
  );
  const bytes = await readFile(join(root, "data.ttl"));
  const label = current.data.triples.find((q) => q.object.value === "Dos");
  assert.ok(label);
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "data.ttl",
        revision: current.data.resource.revision,
        edits: [{ action: "replace", before: label, after: label }],
      })
    ).status,
    "ok",
  );
  assert.deepEqual(await readFile(join(root, "data.ttl")), bytes);
});

test("form recognition uses explicit exact types while creation uses resolved available vocabulary", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-forms-"));
  await initializeProject({ directory: root, baseIri: "urn:forms:/" });
  assert.equal(
    (
      await authorResource({
        project: root,
        command: "model.create",
        path: "concepts.ttl",
        type: "data",
        profile: "conceptual",
      })
    ).status,
    "ok",
  );
  let shown = (await showEditor({ project: root, selector: "concepts.ttl" })).data;
  assert.ok(shown);
  const classType = "http://www.w3.org/2002/07/owl#Class";
  assert.ok(shown.creationTypes.some((t) => t.type === classType));
  const created = await editGraph({
    project: root,
    selector: "concepts.ttl",
    revision: shown.resource.revision,
    creation: { iri: "urn:Entity", type: classType },
    edits: [
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: "urn:Entity" },
          predicate: { kind: "iri", value: "http://www.w3.org/2000/01/rdf-schema#label" },
          object: { kind: "literal", value: "Created together", language: "en" },
        },
      },
    ],
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  shown = (await showEditor({ project: root, selector: "concepts.ttl" })).data;
  assert.ok(shown);
  assert.equal(shown.triples.filter((q) => q.subject.value === "urn:Entity").length, 2);
  assert.ok(
    shown.triples.some(
      (q) =>
        q.subject.value === "urn:Entity" &&
        q.object.value === "Created together" &&
        q.object.language === "en",
    ),
  );
  assert.equal(shown.sections.find((s) => s.type === classType)?.subjects[0]?.value, "urn:Entity");
  const beforeCreation = await readFile(join(root, "concepts.ttl"));
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "concepts.ttl",
        revision: shown.resource.revision,
        creation: { iri: "urn:WithUnavailableType", type: classType },
        edits: [
          {
            action: "add",
            after: {
              subject: { kind: "iri", value: "urn:WithUnavailableType" },
              predicate: { kind: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
              object: { kind: "iri", value: "urn:Unavailable" },
            },
          },
        ],
      })
    ).status,
    "invalid_arguments",
  );
  assert.deepEqual(await readFile(join(root, "concepts.ttl")), beforeCreation);
  const invalid = await editGraph({
    project: root,
    selector: "concepts.ttl",
    revision: shown.resource.revision,
    edits: [
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: "urn:Entity" },
          predicate: { kind: "iri", value: "http://www.w3.org/2000/01/rdf-schema#label" },
          object: { kind: "iri", value: "urn:unexpected-label-kind" },
        },
      },
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: "urn:Entity" },
          predicate: { kind: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" },
          object: { kind: "iri", value: "urn:MissingType" },
        },
      },
    ],
  });
  assert.equal(invalid.status, "ok", JSON.stringify(invalid));
  assert.ok(invalid.data);
  assert.equal((invalid.data.validation as { validity: string }).validity, "invalid");
  assert.equal(
    (await showEditor({ project: root, selector: "concepts.ttl" })).data?.parseable,
    true,
  );
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "replacement.ttl"),
    "<urn:replacement> a <http://www.w3.org/2002/07/owl#Ontology> . <urn:Other> a <http://www.w3.org/2002/07/owl#Class> .",
  );
  await writeFile(
    join(root, "tbspec.toml"),
    manifest.replace('ontology = "dep:tbspec-metadata"', 'ontology = "replacement.ttl"'),
  );
  let replaced = await showEditor({ project: root, selector: "concepts.ttl" });
  assert.ok(replaced.data, JSON.stringify(replaced));
  assert.ok(replaced.data.sections.some((s) => s.type === classType));
  assert.equal(
    replaced.data.creationTypes.some((t) => t.type === "urn:Other"),
    false,
  );
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const common = lock.dependencies["tbspec-metadata"];
  assert.ok(common);
  await writeFile(join(root, common.snapshot_path, common.primary), "missing required vocabulary");
  replaced = await showEditor({ project: root, selector: "concepts.ttl" });
  assert.ok(replaced.data);
  assert.ok(replaced.data.sections.some((s) => s.type === classType));
  assert.equal(replaced.data.creationTypes.length, 0);
  assert.ok(replaced.diagnostics.some((d) => d.severity === "error"));
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "concepts.ttl",
        revision: replaced.data.resource.revision,
        creation: { iri: "urn:Unavailable", type: classType },
        edits: [],
      })
    ).status,
    "invalid_arguments",
  );
  const label = replaced.data.triples.find((q) => q.object.value === "urn:unexpected-label-kind");
  assert.ok(label);
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "concepts.ttl",
        revision: replaced.data.resource.revision,
        edits: [
          {
            action: "replace",
            before: label,
            after: { ...label, object: { kind: "literal", value: "Repaired", language: "en" } },
          },
        ],
      })
    ).status,
    "ok",
  );
});

test("typed creation offers declared custom properties and rejects unavailable initial predicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-create-fields-"));
  await initializeProject({ directory: root });
  await writeFile(
    join(root, "ontology.ttl"),
    `
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
<urn:ontology> a owl:Ontology .
owl:NamedIndividual a owl:Class .
<urn:custom> a owl:DatatypeProperty .
<urn:relation> a rdf:Property .
`,
  );
  const shown = (await showEditor({ project: root, selector: "ontology.ttl" })).data;
  assert.ok(shown);
  assert.ok(shown.creationFields.includes("urn:custom"));
  assert.ok(shown.creationFields.includes("urn:relation"));
  const bytes = await readFile(join(root, "ontology.ttl"));
  const options = {
    project: root,
    selector: "ontology.ttl",
    revision: shown.resource.revision,
    creation: { iri: "urn:individual", type: "http://www.w3.org/2002/07/owl#NamedIndividual" },
  };
  const edit = {
    action: "add" as const,
    after: {
      subject: { kind: "iri" as const, value: "urn:individual" },
      predicate: { kind: "iri" as const, value: "urn:unavailable" },
      object: { kind: "literal" as const, value: "valor", language: "es" },
    },
  };
  const rejected = await editGraph({ ...options, edits: [edit] });
  assert.equal(rejected.status, "invalid_arguments");
  assert.ok(rejected.diagnostics.some((d) => d.code === "VOCABULARY_UNKNOWN"));
  assert.deepEqual(await readFile(join(root, "ontology.ttl")), bytes);
  const saved = await editGraph({
    ...options,
    edits: [
      {
        ...edit,
        after: { ...edit.after, predicate: { kind: "iri", value: "urn:custom" } },
      },
    ],
  });
  assert.equal(saved.status, "ok", JSON.stringify(saved));
  const current = (await showEditor({ project: root, selector: "ontology.ttl" })).data;
  assert.equal(current?.triples.filter((q) => q.subject.value === "urn:individual").length, 2);
  assert.ok(
    current?.triples.some((q) => q.predicate.value === "urn:custom" && q.object.language === "es"),
  );
});

test("source drafts retain exact text, reject repeated conflicts, and repair malformed graphs", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-draft-"));
  await initializeProject({ directory: root });
  const file = join(root, "draft.ttl");
  const original = '<urn:s> <urn:p> "first" .\n';
  await writeFile(file, original);
  const shown = await showEditor({ project: root, selector: "draft.ttl" });
  assert.ok(shown.data);
  await writeFile(file, `${original}# concurrent comment\n`);
  const stale = await editGraph({
    project: root,
    selector: "draft.ttl",
    revision: shown.data.resource.revision,
    sourceText: "broken",
  });
  assert.equal(stale.status, "conflict");
  assert.equal(stale.diagnostics[0]?.code, "REVISION_CONFLICT");
  const reconciled = await showEditor({ project: root, selector: "draft.ttl" });
  assert.ok(reconciled.data);
  const prepared = await prepareEdit({
    project: root,
    selector: "draft.ttl",
    revision: reconciled.data.resource.revision,
    sourceText: "broken",
  });
  await writeFile(file, `${original}# second change\n`);
  assert.equal((await publishResource(prepared)).status, "conflict");
  const fresh = await showEditor({ project: root, selector: "draft.ttl" });
  assert.ok(fresh.data);
  const invalid = await editGraph({
    project: root,
    selector: "draft.ttl",
    revision: fresh.data.resource.revision,
    sourceText: "broken\n# preserved exactly\n",
  });
  assert.equal(invalid.status, "ok", JSON.stringify(invalid));
  assert.ok(invalid.diagnostics.some((d) => d.code === "RDF_SYNTAX"));
  assert.equal(await readFile(file, "utf8"), "broken\n# preserved exactly\n");
  const malformed = await showEditor({ project: root, selector: "draft.ttl" });
  assert.ok(malformed.data);
  assert.equal(malformed.data.parseable, false);
  const firstTriple = shown.data.triples[0];
  assert.ok(firstTriple);
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "draft.ttl",
        revision: malformed.data.resource.revision,
        edits: [{ action: "add", after: firstTriple }],
      })
    ).status,
    "invalid",
  );
  const repaired = await editGraph({
    project: root,
    selector: "draft.ttl",
    revision: malformed.data.resource.revision,
    sourceText: original,
  });
  assert.equal(repaired.status, "ok");
  assert.equal((await showEditor({ project: root, selector: "draft.ttl" })).data?.parseable, true);
});

test("blank nodes are scoped to graph revisions and ambiguous graphs retain generic editing", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-blank-"));
  await initializeProject({ directory: root });
  const source = `@prefix owl: <http://www.w3.org/2002/07/owl#> .
<urn:o> a owl:Ontology . <urn:c> a owl:Class, owl:DatatypeProperty; owl:unknown [ <urn:p> "keep" ] .`;
  await writeFile(join(root, "a.ttl"), source);
  await writeFile(join(root, "b.ttl"), source);
  const a = (await showEditor({ project: root, selector: "a.ttl" })).data;
  const b = (await showEditor({ project: root, selector: "b.ttl" })).data;
  assert.ok(a && b);
  assert.equal(a.sections.filter((s) => s.subjects.some((t) => t.value === "urn:c")).length, 2);
  const blankValue = a.triples.find((q) => q.subject.kind === "blank");
  assert.ok(blankValue);
  const rejected = await editGraph({
    project: root,
    selector: "b.ttl",
    revision: b.resource.revision,
    edits: [{ action: "remove", before: blankValue }],
  });
  assert.equal(rejected.status, "invalid_arguments");
  const updated = await editGraph({
    project: root,
    selector: "a.ttl",
    revision: a.resource.revision,
    edits: [
      {
        action: "replace",
        before: blankValue,
        after: { ...blankValue, object: { ...blankValue.object, value: "changed" } },
      },
    ],
  });
  assert.equal(updated.status, "ok", JSON.stringify(updated));
  const current = (await showEditor({ project: root, selector: "a.ttl" })).data;
  assert.ok(current);
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "a.ttl",
        revision: current.resource.revision,
        edits: [{ action: "remove", before: blankValue }],
      })
    ).status,
    "invalid_arguments",
  );
  await writeFile(join(root, "ambiguous.ttl"), `${source}\n<urn:other> a owl:Ontology .`);
  const ambiguous = (await showEditor({ project: root, selector: "ambiguous.ttl" })).data;
  assert.ok(ambiguous);
  assert.equal(ambiguous.parseable, true);
  assert.equal(ambiguous.sections.length, 0);
  assert.ok(ambiguous.triples.length);
  const locked = (await showEditor({ project: root, selector: "dep:tbspec-state-machine" })).data;
  assert.ok(locked);
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: locked.resource.selector,
        revision: locked.resource.revision,
        sourceText: source,
      })
    ).diagnostics[0]?.code,
    "READ_ONLY",
  );
  const pplan = await showEditor({
    project: root,
    selector: "dep:tbspec-process/source/p-plan.owl",
  });
  assert.equal(pplan.data?.parseable, true, JSON.stringify(pplan));
});

test("generic adds and exact removals preserve parallel predicates, self loops and trust boundaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-exact-"));
  await initializeProject({ directory: root });
  const file = join(root, "generic.ttl");
  await writeFile(file, "<urn:s> <urn:p> <urn:s>; <urn:parallel> <urn:s> .");
  const shown = (await showEditor({ project: root, selector: "generic.ttl" })).data;
  assert.ok(shown);
  const scope = `${shown.resource.selector}@${shown.resource.revision.state === "present" ? shown.resource.revision.digest : ""}`;
  const addition = {
    subject: { kind: "blank" as const, value: "newNode", scope },
    predicate: { kind: "iri" as const, value: "urn:unknown" },
    object: {
      kind: "literal" as const,
      value: "",
      datatype: "http://www.w3.org/2001/XMLSchema#string",
    },
  };
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "generic.ttl",
        revision: shown.resource.revision,
        edits: [{ action: "add", after: addition }],
      })
    ).status,
    "ok",
  );
  const current = (await showEditor({ project: root, selector: "generic.ttl" })).data;
  assert.ok(current);
  assert.ok(current.triples.some((q) => q.subject.kind === "blank" && q.object.value === ""));
  const selected = current.triples.find((q) => q.predicate.value === "urn:p");
  assert.ok(selected);
  const original = await readFile(file);
  for (const object of [
    { kind: "iri", value: "relative" },
    { kind: "iri", value: "urn:iri", datatype: "urn:extra" },
    { kind: "literal", value: "x", language: "en", datatype: "urn:type" },
    {
      kind: "literal",
      value: "x",
      datatype: "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
    },
  ]) {
    const result = await editGraph({
      project: root,
      selector: "generic.ttl",
      revision: current.resource.revision,
      edits: [
        {
          action: "replace",
          before: selected,
          after: { ...selected, object: object as typeof selected.object },
        },
      ],
    });
    assert.equal(result.status, "invalid_arguments", JSON.stringify(result));
    assert.deepEqual(await readFile(file), original);
  }
  assert.equal(
    (
      await editGraph({
        project: root,
        selector: "generic.ttl",
        revision: current.resource.revision,
        edits: [{ action: "remove", before: selected }],
      })
    ).status,
    "ok",
  );
  const removed = (await showEditor({ project: root, selector: "generic.ttl" })).data;
  assert.ok(removed);
  assert.ok(!removed.triples.some((q) => q.predicate.value === "urn:p"));
  assert.ok(
    removed.triples.some(
      (q) => q.predicate.value === "urn:parallel" && q.subject.value === q.object.value,
    ),
  );
});
