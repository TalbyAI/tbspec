import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource } from "../src/authoring.ts";
import { editGraph, showEditor } from "../src/editing.ts";
import { initializeProject } from "../src/project.ts";

const sm = "https://talby.ai/ontology/state-machine#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

test("state-machine forms recognize exact types and fixed fields without a selected design", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-state-forms-"));
  await initializeProject({ directory: root, baseIri: "urn:state-machine:/" });
  await writeFile(
    join(root, "tbspec.toml"),
    'schema_version = 1\nbase_iri = "urn:state-machine:/"\n\n[model_types.state-machine]\nontology = "dep:tbspec-state-machine"\n',
  );
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "machine.ttl",
    type: "state-machine",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));

  const before = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(before.data, JSON.stringify(before));
  assert.equal(before.data.resource.kind, "state-machine-model");
  assert.equal(
    before.data.resource.associations.some(({ role }) => role === "design"),
    false,
  );
  const terms = `
@prefix sm: <${sm}> .
@prefix rdf: <${rdfType.slice(0, rdfType.lastIndexOf("type"))}> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix alias: <https://example.test/state-machine#> .

<urn:machine> a sm:StateMachine; rdfs:label "Orders"@en .
<urn:plain> a sm:State; sm:inMachine <urn:machine>; rdfs:label "Ready"@en .
<urn:initial-final> a sm:InitialState, sm:FinalState, <urn:ExtraType>;
  sm:inMachine <urn:machine>; rdfs:label "Terminal start"@en .
<urn:initial-only> a sm:InitialState; sm:inMachine <urn:machine> .
<urn:transition> a sm:Transition; sm:inMachine <urn:machine>;
  sm:source <urn:plain>; sm:target <urn:initial-final>;
  sm:event "open"@en, "OPEN"^^xsd:string; <urn:unknown> "preserve" .
<urn:alias> a alias:State .
`;
  await writeFile(join(root, "machine.ttl"), `${before.data.sourceText}\n${terms}`);
  const viewDirectory = join(root, "views");
  await mkdir(viewDirectory);
  const viewPath = join(viewDirectory, "state-view.ttl");
  const presentationPath = join(viewDirectory, "state-presentation.ttl");
  await writeFile(
    viewPath,
    `<urn:state-view> a <https://talby.ai/ontology/tbspec#ViewModel>; <https://talby.ai/ontology/tbspec#sourceGraph> <${before.data.resource.graphIri}>; <https://talby.ai/ontology/tbspec#member> <urn:plain> .\n`,
  );
  await writeFile(
    presentationPath,
    `<urn:state-presentation> a <https://talby.ai/ontology/tbspec#PresentationGraph>; <https://talby.ai/ontology/tbspec#forView> <urn:state-view>; <https://talby.ai/ontology/tbspec#nodePresentation> [ <https://talby.ai/ontology/tbspec#element> <urn:plain>; <https://talby.ai/ontology/tbspec#x> 25; <https://talby.ai/ontology/tbspec#y> 40 ] .\n`,
  );
  const viewBytes = await readFile(viewPath);
  const presentationBytes = await readFile(presentationPath);

  const shown = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(shown.data, JSON.stringify(shown));
  const fields = (type: string) => shown.data?.sections.find((item) => item.type === type)?.fields;
  const stateFields = [
    "http://www.w3.org/2000/01/rdf-schema#label",
    "http://www.w3.org/2000/01/rdf-schema#comment",
    `${sm}inMachine`,
  ];
  assert.deepEqual(fields(`${sm}State`), stateFields);
  assert.deepEqual(fields(`${sm}InitialState`), stateFields);
  assert.deepEqual(fields(`${sm}FinalState`), stateFields);
  assert.deepEqual(fields(`${sm}Transition`), [
    ...stateFields,
    `${sm}source`,
    `${sm}target`,
    `${sm}event`,
    `${sm}condition`,
    `${sm}action`,
  ]);
  assert.equal(
    shown.data.sections.some((section) => section.type === "urn:ExtraType"),
    false,
  );
  assert.equal(
    shown.data.sections.some(
      (section) => section.type === "https://example.test/state-machine#State",
    ),
    false,
  );
  assert.equal(
    shown.data.sections.some(
      (section) =>
        section.type === `${sm}State` &&
        section.subjects.some((subject) => subject.value === "urn:initial-only"),
    ),
    false,
  );
  assert.ok(
    shown.data.sections
      .find((section) => section.type === `${sm}InitialState`)
      ?.subjects.some((subject) => subject.value === "urn:initial-final"),
  );
  assert.ok(
    shown.data.sections
      .find((section) => section.type === `${sm}FinalState`)
      ?.subjects.some((subject) => subject.value === "urn:initial-final"),
  );
  assert.ok(shown.data.triples.some((triple) => triple.object.language === "en"));
  assert.ok(
    shown.data.triples.some(
      (triple) => triple.object.datatype === "http://www.w3.org/2001/XMLSchema#string",
    ),
  );
  assert.ok(shown.data.triples.some((triple) => triple.predicate.value === "urn:unknown"));

  const plainLabel = shown.data.triples.find(
    (triple) =>
      triple.subject.value === "urn:plain" &&
      triple.predicate.value === "http://www.w3.org/2000/01/rdf-schema#label",
  );
  assert.ok(plainLabel);
  const unrelatedEdit = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: shown.data.resource.revision,
    edits: [
      {
        action: "replace",
        before: plainLabel,
        after: { ...plainLabel, object: { ...plainLabel.object, value: "Ready to ship" } },
      },
    ],
  });
  assert.equal(unrelatedEdit.status, "ok", JSON.stringify(unrelatedEdit));
  assert.deepEqual(await readFile(viewPath), viewBytes);
  assert.deepEqual(await readFile(presentationPath), presentationBytes);
  const preserved = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(preserved.data, JSON.stringify(preserved));
  const transitionValues = preserved.data.triples.filter(
    (triple) =>
      triple.subject.value === "urn:transition" && triple.predicate.value === `${sm}event`,
  );
  assert.deepEqual(
    transitionValues
      .map((triple) => [
        triple.object.value,
        triple.object.language ?? "",
        triple.object.datatype ?? "",
      ])
      .sort(),
    [
      ["OPEN", "", "http://www.w3.org/2001/XMLSchema#string"],
      ["open", "en", ""],
    ].sort(),
  );
  assert.ok(
    preserved.data.triples.some(
      (triple) =>
        triple.subject.value === "urn:transition" &&
        triple.predicate.value === "urn:unknown" &&
        triple.object.value === "preserve",
    ),
  );
  assert.ok(
    preserved.data.triples.some(
      (triple) =>
        triple.subject.value === "urn:plain" &&
        triple.predicate.value === "http://www.w3.org/2000/01/rdf-schema#label" &&
        triple.object.value === "Ready to ship" &&
        triple.object.language === "en",
    ),
  );
});

test("known state-machine data stays editable when replacement vocabulary lacks exact terms", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-state-vocabulary-"));
  await initializeProject({ directory: root, baseIri: "urn:state-vocabulary:/" });
  await writeFile(
    join(root, "tbspec.toml"),
    'schema_version = 1\nbase_iri = "urn:state-vocabulary:/"\n\n[model_types.state-machine]\nontology = "dep:tbspec-state-machine"\n',
  );
  const authored = await authorResource({
    project: root,
    command: "model.create",
    path: "machine.ttl",
    type: "state-machine",
  });
  assert.equal(authored.status, "ok", JSON.stringify(authored));
  const initial = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(initial.data, JSON.stringify(initial));
  await writeFile(
    join(root, "machine.ttl"),
    `${initial.data.sourceText}\n<urn:existing-state> a <${sm}InitialState>; <${sm}inMachine> <${initial.data.resource.graphIri}>; <http://www.w3.org/2000/01/rdf-schema#label> "Start"@en .\n`,
  );
  await writeFile(
    join(root, "replacement.ttl"),
    `<urn:replacement> a <http://www.w3.org/2002/07/owl#Ontology> .
<${sm}StateMachine> a <http://www.w3.org/2002/07/owl#Class> .
<${sm}State> a <http://www.w3.org/2002/07/owl#Class> .
<${sm}InitialState> a <http://www.w3.org/2002/07/owl#Class> .
<${sm}FinalState> a <http://www.w3.org/2002/07/owl#Class> .
<${sm}Transition> a <http://www.w3.org/2002/07/owl#Class> .
<urn:ReplacementClass> a <http://www.w3.org/2002/07/owl#Class> .`,
  );
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    manifest.replace('ontology = "dep:tbspec-state-machine"', 'ontology = "replacement.ttl"'),
  );

  const shown = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(shown.data, JSON.stringify(shown));
  assert.ok(shown.data.sections.some((section) => section.type === `${sm}InitialState`));
  assert.ok(
    shown.data.creationTypes.some((type) => type.type === `${sm}StateMachine`),
    JSON.stringify({
      creationTypes: shown.data.creationTypes,
      creationFields: shown.data.creationFields,
      diagnostics: shown.diagnostics,
    }),
  );
  assert.ok(!shown.data.creationTypes.some((type) => type.type === `${sm}State`));
  assert.ok(!shown.data.creationTypes.some((type) => type.type === `${sm}InitialState`));
  assert.ok(!shown.data.creationTypes.some((type) => type.type === `${sm}FinalState`));
  assert.ok(!shown.data.creationTypes.some((type) => type.type === `${sm}Transition`));
  assert.ok(shown.diagnostics.some((diagnostic) => diagnostic.severity === "error"));
  const label = shown.data.triples.find(
    (triple) => triple.subject.value === "urn:existing-state" && triple.object.value === "Start",
  );
  assert.ok(label);
  const edited = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: shown.data.resource.revision,
    edits: [
      {
        action: "replace",
        before: label,
        after: { ...label, object: { ...label.object, value: "Begin" } },
      },
    ],
  });
  assert.equal(edited.status, "ok", JSON.stringify(edited));
  const afterEdit = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(afterEdit.data, JSON.stringify(afterEdit));
  assert.ok(
    afterEdit.data.triples.some(
      (triple) =>
        triple.subject.value === "urn:existing-state" &&
        triple.predicate.value === "http://www.w3.org/2000/01/rdf-schema#label" &&
        triple.object.value === "Begin" &&
        triple.object.language === "en",
    ),
  );
});

test("state and transition creation requires an explicit local machine and selected endpoints", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-state-create-"));
  await initializeProject({ directory: root, baseIri: "urn:state-create:/" });
  await writeFile(
    join(root, "tbspec.toml"),
    'schema_version = 1\nbase_iri = "urn:state-create:/"\n\n[model_types.state-machine]\nontology = "dep:tbspec-state-machine"\n',
  );
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "machine.ttl",
    type: "state-machine",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const shown = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(shown.data, JSON.stringify(shown));
  const stateType = `${sm}State`;
  const transitionType = `${sm}Transition`;
  const machineType = `${sm}StateMachine`;
  const make = (subject: string, predicate: string, value: string) => ({
    action: "add" as const,
    after: {
      subject: { kind: "iri" as const, value: subject },
      predicate: { kind: "iri" as const, value: predicate },
      object: { kind: "iri" as const, value },
    },
  });
  const before = await readFile(join(root, "machine.ttl"));
  const missingMembership = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: shown.data.resource.revision,
    creation: { iri: "urn:state", type: stateType },
    edits: [],
  });
  assert.equal(missingMembership.status, "invalid_arguments", JSON.stringify(missingMembership));
  assert.deepEqual(await readFile(join(root, "machine.ttl")), before);

  const localMachine = shown.data.resource.graphIri;
  assert.ok(localMachine);
  const missingEndpoints = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: shown.data.resource.revision,
    creation: { iri: "urn:transition", type: transitionType },
    edits: [make("urn:transition", `${sm}inMachine`, localMachine)],
  });
  assert.equal(missingEndpoints.status, "invalid_arguments", JSON.stringify(missingEndpoints));
  assert.deepEqual(await readFile(join(root, "machine.ttl")), before);

  assert.ok(shown.data.creationTypes.some((type) => type.type === machineType));
  assert.ok(shown.data.creationTypes.some((type) => type.type === stateType));
  assert.ok(shown.data.creationTypes.some((type) => type.type === transitionType));

  const machine = { kind: "iri" as const, value: "urn:new-machine" };
  const addedMachine = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: shown.data.resource.revision,
    creation: { iri: machine.value, type: machineType },
    edits: [],
  });
  assert.equal(addedMachine.status, "ok", JSON.stringify(addedMachine));
  let current = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(current.data, JSON.stringify(current));
  const initialType = `${sm}InitialState`;
  const initialState = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: current.data.resource.revision,
    creation: { iri: "urn:new-initial", type: initialType },
    edits: [make("urn:new-initial", `${sm}inMachine`, machine.value)],
  });
  assert.equal(initialState.status, "ok", JSON.stringify(initialState));
  current = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(current.data, JSON.stringify(current));
  const otherMachine = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: current.data.resource.revision,
    creation: { iri: "urn:other-machine", type: machineType },
    edits: [],
  });
  assert.equal(otherMachine.status, "ok", JSON.stringify(otherMachine));
  current = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(current.data, JSON.stringify(current));
  const otherState = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: current.data.resource.revision,
    creation: { iri: "urn:other-state", type: stateType },
    edits: [make("urn:other-state", `${sm}inMachine`, "urn:other-machine")],
  });
  assert.equal(otherState.status, "ok", JSON.stringify(otherState));
  current = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(current.data, JSON.stringify(current));
  const wrongMachineEndpoints = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: current.data.resource.revision,
    creation: { iri: "urn:wrong-machine-transition", type: transitionType },
    edits: [
      make("urn:wrong-machine-transition", `${sm}inMachine`, machine.value),
      make("urn:wrong-machine-transition", `${sm}source`, "urn:new-initial"),
      make("urn:wrong-machine-transition", `${sm}target`, "urn:other-state"),
    ],
  });
  assert.equal(
    wrongMachineEndpoints.status,
    "invalid_arguments",
    JSON.stringify(wrongMachineEndpoints),
  );
  assert.ok(
    current.data.triples.every((triple) => triple.subject.value !== "urn:wrong-machine-transition"),
  );
  const transition = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: current.data.resource.revision,
    creation: { iri: "urn:new-transition", type: transitionType },
    edits: [
      make("urn:new-transition", `${sm}inMachine`, machine.value),
      make("urn:new-transition", `${sm}source`, "urn:new-initial"),
      make("urn:new-transition", `${sm}target`, "urn:new-initial"),
    ],
  });
  assert.equal(transition.status, "ok", JSON.stringify(transition));
  current = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(current.data, JSON.stringify(current));
  const newInitialTypes = current.data.triples
    .filter(
      (triple) => triple.subject.value === "urn:new-initial" && triple.predicate.value === rdfType,
    )
    .map((triple) => triple.object.value);
  assert.deepEqual(newInitialTypes, [initialType]);
  const newTransition = current.data.triples.filter(
    (triple) => triple.subject.value === "urn:new-transition",
  );
  assert.deepEqual(
    newTransition.map((triple) => [triple.predicate.value, triple.object.value]).sort(),
    [
      [rdfType, transitionType],
      [`${sm}inMachine`, machine.value],
      [`${sm}source`, "urn:new-initial"],
      [`${sm}target`, "urn:new-initial"],
    ].sort(),
  );
});

test("explicit state status changes preserve every other type statement", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-state-status-"));
  await initializeProject({ directory: root, baseIri: "urn:state-status:/" });
  await writeFile(
    join(root, "tbspec.toml"),
    'schema_version = 1\nbase_iri = "urn:state-status:/"\n\n[model_types.state-machine]\nontology = "dep:tbspec-state-machine"\n',
  );
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "machine.ttl",
    type: "state-machine",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const initialRead = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(initialRead.data, JSON.stringify(initialRead));
  await writeFile(
    join(root, "machine.ttl"),
    `${initialRead.data.sourceText}\n<urn:status> a <${sm}State>, <${sm}InitialState>, <${sm}FinalState>, <urn:custom-type>; <${sm}inMachine> <${initialRead.data.resource.graphIri}>; <${sm}event> "opened"@en, "OPEN"^^<http://www.w3.org/2001/XMLSchema#string>; <urn:unknown> "keep this" .\n`,
  );
  let shown = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(shown.data, JSON.stringify(shown));
  const initial = `${sm}InitialState`;
  const final = `${sm}FinalState`;
  const custom = "urn:custom-type";
  const typeTriple = (type: string) =>
    shown.data?.triples.find(
      (triple) =>
        triple.subject.value === "urn:status" &&
        triple.predicate.value === rdfType &&
        triple.object.value === type,
    );
  const initialTriple = typeTriple(initial);
  assert.ok(initialTriple);
  const removed = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: shown.data.resource.revision,
    edits: [{ action: "remove", before: initialTriple }],
  });
  assert.equal(removed.status, "ok", JSON.stringify(removed));
  shown = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(shown.data, JSON.stringify(shown));
  assert.deepEqual(
    shown.data.triples
      .filter(
        (triple) => triple.subject.value === "urn:status" && triple.predicate.value === rdfType,
      )
      .map((triple) => triple.object.value)
      .sort(),
    [`${sm}State`, final, custom].sort(),
  );
  assert.deepEqual(
    shown.data.triples
      .filter(
        (triple) =>
          triple.subject.value === "urn:status" && triple.predicate.value === `${sm}event`,
      )
      .map((triple) => [
        triple.object.value,
        triple.object.language ?? "",
        triple.object.datatype ?? "",
      ])
      .sort(),
    [
      ["OPEN", "", "http://www.w3.org/2001/XMLSchema#string"],
      ["opened", "en", ""],
    ].sort(),
  );
  assert.ok(
    shown.data.triples.some(
      (triple) =>
        triple.subject.value === "urn:status" &&
        triple.predicate.value === "urn:unknown" &&
        triple.object.value === "keep this",
    ),
  );
  const restored = await editGraph({
    project: root,
    selector: "machine.ttl",
    revision: shown.data.resource.revision,
    edits: [
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: "urn:status" },
          predicate: { kind: "iri", value: rdfType },
          object: { kind: "iri", value: initial },
        },
      },
    ],
  });
  assert.equal(restored.status, "ok", JSON.stringify(restored));
  shown = await showEditor({ project: root, selector: "machine.ttl" });
  assert.ok(shown.data, JSON.stringify(shown));
  assert.deepEqual(
    shown.data.triples
      .filter(
        (triple) => triple.subject.value === "urn:status" && triple.predicate.value === rdfType,
      )
      .map((triple) => triple.object.value)
      .sort(),
    [`${sm}State`, initial, final, custom].sort(),
  );
});
