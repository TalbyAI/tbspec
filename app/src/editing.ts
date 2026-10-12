import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Term as RdfjsTerm, Quad as RdfQuad } from "@rdfjs/types";
import { DataFactory, type Quad, type Store, type Term, Writer } from "n3";
import type { PreparedResource } from "./authoring.ts";
import { publishResource } from "./authoring.ts";
import { canonical, digest, sortedSet, utf8Compare } from "./canonical.ts";
import { equalRevision, type Revision, revision, verifyReads } from "./filesystem.ts";
import { captureInspection, inspectSnapshot, type Resource, rdfTerm } from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { absoluteIri, portablePath, safePath } from "./paths.ts";
import {
  processAssociations as collectProcessAssociations,
  type ProcessAssociation,
  type ProcessElements,
  pPlan,
  proc,
  processBindings,
  processCreationRequirements,
  processElements,
} from "./process.ts";
import { discoverProject, projectDiscoveryScope } from "./project.ts";
import { parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import { parseLock, parseManifest } from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { preparePlan, withPlanImpact } from "./transactions.ts";
import { vocabularyTypes } from "./validation.ts";
import { captureViewSnapshot, syncViewSourceEdits } from "./views.ts";

export interface EditorTerm {
  kind: "iri" | "blank" | "literal";
  value: string;
  scope?: string;
  language?: string;
  datatype?: string;
}
export interface Triple {
  subject: EditorTerm;
  predicate: EditorTerm;
  object: EditorTerm;
}
export type Edit =
  | { action: "add"; after: Triple }
  | { action: "remove"; before: Triple }
  | { action: "replace"; before: Triple; after: Triple };
interface EditorOptions {
  project?: string;
  cwd?: string;
  selector: string;
}
export interface EditingOptions extends EditorOptions {
  revision: Revision;
  edits?: Edit[];
  sourceText?: string;
  creation?: { iri: string; type: string };
}
export interface ElementDeletionOptions extends EditorOptions {
  revision: Revision;
  element: EditorTerm;
}
export interface Section {
  type: string;
  label: string;
  fields: string[];
  subjects: EditorTerm[];
}
export interface EditorData extends Record<string, unknown> {
  resource: Resource;
  sourceText: string;
  triples: Triple[];
  parseable: boolean;
  sections: Section[];
  creationTypes: { type: string; label: string }[];
  creationFields: string[];
  creationClasses: string[];
  processAssociations: ProcessAssociation[];
  processElements: ProcessElements;
}
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const rdfs = "http://www.w3.org/2000/01/rdf-schema#";
const owl = "http://www.w3.org/2002/07/owl#";
const sm = "https://talby.ai/ontology/state-machine#";
const { namedNode, blankNode, literal, quad } = DataFactory;
const stateMachineCreationRequirements: Record<string, string[]> = {
  [`${sm}StateMachine`]: [],
  [`${sm}State`]: [`${sm}inMachine`],
  [`${sm}InitialState`]: [`${sm}inMachine`],
  [`${sm}FinalState`]: [`${sm}inMachine`],
  [`${sm}Transition`]: [`${sm}inMachine`, `${sm}source`, `${sm}target`],
};
const labels = [`${rdfs}label`, `${rdfs}comment`];
const stateFields = [...labels, `${sm}inMachine`];
const bindings = [
  {
    type: `${owl}Class`,
    label: "Class / conceptual entity",
    fields: [...labels, `${rdfs}subClassOf`],
  },
  { type: `${rdfs}Class`, label: "RDFS class", fields: [...labels, `${rdfs}subClassOf`] },
  { type: `${rdfs}Datatype`, label: "Datatype", fields: labels },
  ...[`${rdf}Property`, `${owl}ObjectProperty`, `${owl}DatatypeProperty`].map((type) => ({
    type,
    label:
      type === `${owl}ObjectProperty`
        ? "Relationship / object property"
        : type === `${owl}DatatypeProperty`
          ? "Attribute / datatype property"
          : "Property",
    fields: [...labels, `${rdfs}subPropertyOf`, `${rdfs}domain`, `${rdfs}range`],
  })),
  {
    type: `${owl}NamedIndividual`,
    label: "Ontology individual",
    fields: [...labels, `${rdf}type`],
  },
];
const stateMachineBindings = [
  { type: `${sm}StateMachine`, label: "State machine", fields: labels },
  { type: `${sm}State`, label: "State", fields: stateFields },
  { type: `${sm}InitialState`, label: "Initial state", fields: stateFields },
  { type: `${sm}FinalState`, label: "Final state", fields: stateFields },
  {
    type: `${sm}Transition`,
    label: "Transition",
    fields: [
      ...stateFields,
      `${sm}source`,
      `${sm}target`,
      `${sm}event`,
      `${sm}condition`,
      `${sm}action`,
    ],
  },
];

function applicable(kind: string) {
  return kind === "process-model"
    ? processBindings
    : kind === "ontology"
      ? bindings
      : kind === "conceptual-data-model"
        ? bindings.filter((b) => b.type !== `${owl}NamedIndividual`)
        : kind === "state-machine-model"
          ? stateMachineBindings
          : [];
}
function encode(q: RdfQuad, scope: string): Triple {
  return {
    subject: rdfTerm(q.subject, scope) as unknown as EditorTerm,
    predicate: rdfTerm(q.predicate, scope) as unknown as EditorTerm,
    object: rdfTerm(q.object, scope) as unknown as EditorTerm,
  };
}

async function loadEditor(options: EditorOptions) {
  const root = await discoverProject(options);
  const selected = options.selector.startsWith("dep:")
    ? options.selector
    : portablePath(options.selector);
  const snapshot = await captureInspection(
    root,
    selected.startsWith("dep:") ? "graph.show" : "validate",
    selected,
  );
  parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const shown = await inspectSnapshot(root, snapshot, {
    command: "graph.show",
    selector: selected,
  });
  const resource = shown.data?.resource;
  if (!resource)
    throw new ProjectError(
      shown.status === "ok" ? "unavailable" : shown.status,
      shown.diagnostics[0]?.code ?? "RESOURCE_MISSING",
      shown.diagnostics[0]?.message ?? "Graph is unavailable.",
      selected,
    );
  const bytes = snapshot.files[resource.file];
  if (!bytes)
    throw new ProjectError("unavailable", "RESOURCE_MISSING", "Graph is unavailable.", selected);
  const scope = `${resource.selector}@${digest(bytes)}`;
  const locked =
    resource.ownership === "dependency"
      ? lock.dependencies[resource.dependencyId ?? ""]?.files.find(
          (f) => `dep:${resource.dependencyId}/${f.key}` === resource.selector,
        )
      : undefined;
  const vettedDigest = locked ? (await loadStarters()).vettedDigest : undefined;
  const baseIri = pathToFileURL(await safePath(root, resource.file)).href;
  let store: Store | undefined;
  try {
    store = locked
      ? await parseGraph(bytes, locked, vettedDigest, scope)
      : await parseRdf(
          bytes,
          rdfFormats[extname(resource.file).toLowerCase()] ?? "text/turtle",
          baseIri,
          false,
          scope,
        );
  } catch {
    /* Inspection reports malformed or unsupported source; source repair remains available. */
  }
  const triples = store ? Array.from(store, (q) => encode(q, scope)) : [];
  const sections = applicable(resource.kind).flatMap((binding) => {
    const subjects = triples
      .filter(
        (q) =>
          q.predicate.value === `${rdf}type` &&
          q.object.kind === "iri" &&
          q.object.value === binding.type,
      )
      .map((q) => q.subject);
    return subjects.length ? [{ ...binding, subjects }] : [];
  });
  let available: Store | undefined;
  let blocked = true;
  const checked =
    resource.ownership === "project"
      ? await inspectSnapshot(
          root,
          snapshot,
          { command: "validate", selector: selected },
          {
            onVocabulary: (r, vocabulary, blockers) => {
              if (r.selector === selected) {
                available = vocabulary;
                blocked = blockers.length > 0;
              }
            },
          },
        )
      : shown;
  const creationFields =
    blocked || !applicable(resource.kind).length
      ? []
      : [
          ...new Set(
            vocabularyTypes.property.flatMap((type) =>
              (available?.getQuads(null, `${rdf}type`, type, null) ?? [])
                .filter((q) => q.subject.termType === "NamedNode")
                .map((q) => q.subject.value),
            ),
          ),
        ];
  const creationClasses = blocked
    ? []
    : [
        ...new Set(
          vocabularyTypes.class.flatMap((type) =>
            (available?.getQuads(null, `${rdf}type`, type, null) ?? [])
              .filter((q) => q.subject.termType === "NamedNode")
              .map((q) => q.subject.value),
          ),
        ),
      ];
  const creationTypes = blocked
    ? []
    : applicable(resource.kind)
        .filter((b) =>
          vocabularyTypes.class.some((type) =>
            available?.countQuads(b.type, `${rdf}type`, type, null),
          ),
        )
        .filter(({ type }) => {
          const requiredFields =
            resource.kind === "process-model"
              ? processCreationRequirements[type]
              : resource.kind === "state-machine-model"
                ? stateMachineCreationRequirements[type]
                : undefined;
          return !requiredFields || requiredFields.every((field) => creationFields.includes(field));
        })
        .map(({ type, label }) => ({ type, label }));
  await verifyReads(root, snapshot.reads);
  return {
    root,
    snapshot,
    store,
    scope,
    data: {
      resource,
      sourceText: bytes.toString("utf8"),
      triples,
      parseable: !!store,
      sections,
      creationTypes,
      creationFields,
      creationClasses,
      processAssociations:
        resource.kind === "process-model" ? collectProcessAssociations(triples) : [],
      processElements:
        resource.kind === "process-model"
          ? processElements(triples)
          : { plans: [], steps: [], variables: [], flows: [] },
    } satisfies EditorData,
    diagnostics: [
      ...shown.diagnostics,
      ...checked.diagnostics.filter(
        (d) => !shown.diagnostics.some((s) => canonical(s) === canonical(d)),
      ),
    ],
  };
}
export async function showEditor(options: EditorOptions): Promise<Result<EditorData>> {
  try {
    const loaded = await loadEditor(options);
    return ok(loaded.data, loaded.diagnostics);
  } catch (error) {
    return failure(error) as Result<EditorData>;
  }
}

function decode(value: EditorTerm, scope: string, store: Store, create = false): Term {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.value !== "string" ||
    !value.value.isWellFormed() ||
    Object.keys(value).some(
      (key) => !["kind", "value", "scope", "language", "datatype"].includes(key),
    )
  )
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Invalid RDF term.");
  if (
    value.kind === "iri" &&
    absoluteIri(value.value) &&
    Object.keys(value).every((k) => ["kind", "value"].includes(k))
  )
    return namedNode(value.value);
  if (
    value.kind === "blank" &&
    value.scope === scope &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(value.value) &&
    Object.keys(value).every((k) => ["kind", "value", "scope"].includes(k))
  ) {
    const term = blankNode(`tb_${digest(scope).slice(7, 23)}_${value.value}`);
    if (
      create ||
      store.countQuads(term, null, null, null) ||
      store.countQuads(null, null, term, null)
    )
      return term;
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Blank node is absent from this graph revision.",
    );
  }
  if (
    value.kind === "literal" &&
    Object.keys(value).length === 3 &&
    Object.keys(value).every((k) =>
      ["kind", "value", value.language !== undefined ? "language" : "datatype"].includes(k),
    ) &&
    (value.language
      ? typeof value.language === "string" && /^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/.test(value.language)
      : absoluteIri(value.datatype) && value.datatype !== `${rdf}langString`)
  )
    return literal(value.value, value.language || namedNode(value.datatype ?? ""));
  throw new ProjectError(
    "invalid_arguments",
    "ARGUMENT_INVALID",
    "Use an absolute IRI, a current graph-scoped blank node, or a language/datatype literal.",
  );
}
function statement(value: Triple, scope: string, store: Store, create = false): Quad {
  if (!value || Object.keys(value).some((k) => !["subject", "predicate", "object"].includes(k)))
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Invalid triple.");
  const subject = decode(value.subject, scope, store, create),
    predicate = decode(value.predicate, scope, store),
    object = decode(value.object, scope, store, create);
  if (!["NamedNode", "BlankNode"].includes(subject.termType) || predicate.termType !== "NamedNode")
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Subjects must be resources and predicates must be IRIs.",
    );
  return quad(subject as Quad["subject"], predicate as Quad["predicate"], object as Quad["object"]);
}

function validateStateMachineCreation(
  creation: NonNullable<EditingOptions["creation"]>,
  store: Store,
) {
  const subject = namedNode(creation.iri);
  const oneResource = (predicate: string, label: string): Quad["subject"] => {
    const values = store.getObjects(subject, predicate, null);
    const value = values[0];
    if (values.length !== 1 || !value || !["NamedNode", "BlankNode"].includes(value.termType))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        `State-machine ${creation.type === `${sm}Transition` ? "transition" : "state"} creation requires exactly one ${label}.`,
      );
    return value as Quad["subject"];
  };
  const hasType = (resource: Term, type: string) =>
    store.countQuads(resource, `${rdf}type`, type, null) > 0;
  if ([`${sm}State`, `${sm}InitialState`, `${sm}FinalState`].includes(creation.type)) {
    const machine = oneResource(`${sm}inMachine`, "machine selection");
    if (!hasType(machine, `${sm}StateMachine`))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "State creation requires a selected local state machine.",
      );
  } else if (creation.type === `${sm}Transition`) {
    const machine = oneResource(`${sm}inMachine`, "machine selection");
    if (!hasType(machine, `${sm}StateMachine`))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Transition creation requires a selected local state machine.",
      );
    for (const [predicate, label] of [
      [`${sm}source`, "source state"],
      [`${sm}target`, "target state"],
    ] as const) {
      const state = oneResource(predicate, label);
      if (
        ![`${sm}State`, `${sm}InitialState`, `${sm}FinalState`].some((type) =>
          hasType(state, type),
        ) ||
        !store.has(quad(state, namedNode(`${sm}inMachine`), machine))
      )
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          `Transition creation requires a ${label} explicitly associated with its selected machine.`,
        );
    }
  }
}

function requireProcessCreationSelection(iri: string, type: string, store: Store) {
  const subject = namedNode(iri);
  const resource = (term: Term) => term.termType === "NamedNode" || term.termType === "BlankNode";
  const hasType = (term: Term, expected: string) =>
    resource(term) &&
    store.countQuads(term, namedNode(`${rdf}type`), namedNode(expected), null) > 0;
  const reject = (message: string) =>
    new ProjectError("invalid_arguments", "PROCESS_SELECTION_REQUIRED", message);

  if (type === `${pPlan}Step` || type === `${proc}Decision` || type === `${pPlan}Variable`) {
    const predicate =
      type === `${pPlan}Variable` ? `${pPlan}isVariableOfPlan` : `${pPlan}isStepOfPlan`;
    const plans = store.getObjects(subject, predicate, null);
    if (!plans.length || plans.some((plan) => !hasType(plan, `${pPlan}Plan`)))
      throw reject("Step and Variable creation requires an explicitly selected local Plan.");
  }
  if (type === `${proc}Flow`) {
    for (const [predicate, expected, label] of [
      [`${proc}inPlan`, `${pPlan}Plan`, "Plan"],
      [`${proc}source`, "step", "source Step"],
      [`${proc}target`, "step", "target Step"],
    ] as const) {
      const values = store.getObjects(subject, predicate, null);
      const matches = (term: Term) =>
        expected === "step"
          ? hasType(term, `${pPlan}Step`) || hasType(term, `${proc}Decision`)
          : hasType(term, expected);
      if (values.length !== 1 || !values[0] || !resource(values[0]) || !matches(values[0]))
        throw reject(`Flow creation requires exactly one explicitly selected ${label}.`);
    }
    const conditions = store.getObjects(subject, `${proc}condition`, null);
    if (
      conditions.length > 1 ||
      conditions.some(
        (condition) =>
          condition.termType !== "Literal" ||
          ![
            "http://www.w3.org/2001/XMLSchema#string",
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
          ].includes(condition.datatype.value),
      )
    )
      throw reject("A Flow condition must be one optional string or language-tagged literal.");
  }
}

export async function prepareEdit(options: EditingOptions): Promise<PreparedResource> {
  const loaded = await loadEditor(options);
  const { root, data, store, scope } = loaded;
  let snapshot = loaded.snapshot;
  const { resource } = data;
  if (
    resource.ownership !== "project" ||
    !resource.file.endsWith(".ttl") ||
    projectDiscoveryScope.excluded.some(
      (p) => resource.file === p || resource.file.startsWith(`${p}/`),
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "READ_ONLY",
      "Only discoverable owned Turtle graphs are editable. Import a locked snapshot to edit it.",
      resource.file,
    );
  if (
    options.revision?.state !== "present" ||
    !/^sha256:[0-9a-f]{64}$/.test(options.revision.digest)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Supply the captured source revision.",
    );
  if (!equalRevision(resource.revision, options.revision))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Source changed. Retain the draft, inspect current source and explicitly reconcile before saving.",
      resource.file,
    );
  if (
    (options.sourceText !== undefined &&
      (typeof options.sourceText !== "string" ||
        options.edits !== undefined ||
        options.creation !== undefined)) ||
    (options.sourceText === undefined &&
      (!Array.isArray(options.edits) || (!options.edits.length && !options.creation)))
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Supply source text or exact RDF edits.",
    );
  snapshot = await captureViewSnapshot(root);
  const currentSource = snapshot.files[resource.file];
  if (!currentSource || !equalRevision(revision(currentSource), options.revision))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Source changed while preparing the shared view transaction. Review current selections.",
      resource.file,
    );
  let bytes = Buffer.from(data.sourceText);
  const sourceChanges: { before: Quad; after?: Quad }[] = [];
  if (options.sourceText !== undefined) {
    if (!options.sourceText.isWellFormed())
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Source must be valid Unicode text.",
      );
    bytes = Buffer.from(options.sourceText);
  } else {
    if (!store)
      throw new ProjectError(
        "invalid",
        "RDF_SYNTAX",
        "Repair source syntax before using graph or form edits.",
        resource.file,
      );
    let changed = false;
    if (options.creation) {
      if (
        Object.keys(options.creation).some((k) => !["iri", "type"].includes(k)) ||
        !absoluteIri(options.creation.iri) ||
        !data.creationTypes.some((b) => b.type === options.creation?.type)
      )
        throw new ProjectError(
          "invalid_arguments",
          "VOCABULARY_UNKNOWN",
          "Creation requires an available exact form type and an absolute resource IRI.",
        );
      const subject = namedNode(options.creation.iri);
      if (store.countQuads(subject, null, null, null))
        throw new ProjectError("conflict", "RESOURCE_EXISTS", "Resource already has statements.");
      store.addQuad(subject, namedNode(`${rdf}type`), namedNode(options.creation.type));
      changed = true;
    }
    for (const edit of options.edits ?? []) {
      if (
        !edit ||
        !["add", "remove", "replace"].includes(edit.action) ||
        Object.keys(edit).some(
          (k) =>
            !(
              edit.action === "add"
                ? ["action", "after"]
                : edit.action === "remove"
                  ? ["action", "before"]
                  : ["action", "before", "after"]
            ).includes(k),
        )
      )
        throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Invalid exact RDF edit.");
      const before = edit.action !== "add" ? statement(edit.before, scope, store) : undefined;
      const after =
        edit.action !== "remove" ? statement(edit.after, scope, store, true) : undefined;
      if (
        options.creation &&
        after?.subject.value === options.creation.iri &&
        !data.creationFields.includes(after.predicate.value)
      )
        throw new ProjectError(
          "invalid_arguments",
          "VOCABULARY_UNKNOWN",
          "Initial properties require available exact property terms.",
        );
      if (
        options.creation &&
        after?.subject.value === options.creation.iri &&
        after.predicate.value === `${rdf}type` &&
        (after.object.termType !== "NamedNode" ||
          !data.creationClasses.includes(after.object.value))
      )
        throw new ProjectError(
          "invalid_arguments",
          "VOCABULARY_UNKNOWN",
          "Initial types require available exact class terms.",
        );
      if (before && !store.has(before))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "The selected exact statement no longer exists.",
        );
      if (before && after?.equals(before)) continue;
      if (before) {
        store.removeQuad(before);
        changed = true;
      }
      if (after && !store.has(after)) {
        store.addQuad(after);
        changed = true;
      }
      if (before && (edit.action === "remove" || after))
        sourceChanges.push({ before, ...(after ? { after } : {}) });
    }
    if (options.creation && resource.kind === "state-machine-model")
      validateStateMachineCreation(options.creation, store);
    if (options.creation && resource.kind === "process-model")
      requireProcessCreationSelection(options.creation.iri, options.creation.type, store);
    if (changed) {
      const writer = new Writer();
      writer.addQuads([...store]);
      bytes = Buffer.from(
        await new Promise<string>((resolve, reject) =>
          writer.end((error, text) => (error ? reject(error) : resolve(text))),
        ),
      );
    }
  }
  let syncWrites: { file: string; bytes: Buffer }[] = [];
  if (options.sourceText === undefined && sourceChanges.length && store) {
    const synchronized = await syncViewSourceEdits(root, snapshot, resource, sourceChanges, store);
    syncWrites = synchronized.writes;
  }
  const proposedSnapshot = {
    ...snapshot,
    files: { ...snapshot.files, [resource.file]: bytes },
  };
  for (const write of syncWrites) proposedSnapshot.files[write.file] = write.bytes;
  const checked = await inspectSnapshot(
    root,
    proposedSnapshot,
    options.sourceText !== undefined
      ? { command: "status" }
      : { command: "validate", selector: resource.selector },
  );
  if (checked.status === "unavailable" || checked.status === "conflict")
    throw new ProjectError(
      checked.status,
      checked.diagnostics[0]?.code ?? "IO_FAILURE",
      checked.diagnostics[0]?.message ?? "Cannot assess proposed source.",
    );
  const plan = preparePlan(
    snapshot,
    options.sourceText !== undefined ? "graph.source.save" : "graph.edit",
    [
      ...(equalRevision(resource.revision, revision(bytes))
        ? []
        : [{ file: resource.file, bytes }]),
      ...syncWrites,
    ],
    { selector: resource.selector, revision: options.revision },
  );
  await verifyReads(root, snapshot.reads);
  return {
    root,
    plan,
    resource: { ...resource, revision: revision(bytes) },
    diagnostics: checked.diagnostics,
    validation: {
      validity: checked.diagnostics.some((d) => d.severity === "error") ? "invalid" : "valid",
      validationComplete: checked.data?.validationComplete === true,
    },
  };
}
export async function editGraph(options: EditingOptions): Promise<Result> {
  try {
    return await publishResource(await prepareEdit(options));
  } catch (error) {
    return failure(error);
  }
}

type ExternalReference = {
  file: string;
  selector: string;
  position: "subject" | "predicate" | "object" | "configuration";
  targetIri: string;
  disposition: "unchanged" | "synchronized";
  configurationRole?: "key" | "value";
  subject?: EditorTerm;
  predicate?: EditorTerm;
  object?: EditorTerm;
};

function statementIdentity(statement: RdfQuad) {
  const termIdentity = (term: RdfjsTerm) =>
    term.termType === "Literal"
      ? [term.termType, term.value, term.language, term.datatype.value]
      : [term.termType, term.value];
  return canonical([
    termIdentity(statement.subject),
    termIdentity(statement.predicate),
    termIdentity(statement.object),
  ]);
}

function configurationReferences(
  value: unknown,
  target: string,
  file: string,
  path = "",
  role: "key" | "value" = "value",
): ExternalReference[] {
  if (typeof value === "string")
    return value === target
      ? [
          {
            file,
            selector: path,
            position: "configuration",
            targetIri: target,
            disposition: "unchanged",
            configurationRole: role,
          },
        ]
      : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      configurationReferences(item, target, file, `${path}[${index}]`, "value"),
    );
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) => [
      ...(key === target
        ? [
            {
              file,
              selector: path ? `${path}.${key}` : key,
              position: "configuration" as const,
              targetIri: target,
              disposition: "unchanged" as const,
              configurationRole: "key" as const,
            },
          ]
        : []),
      ...configurationReferences(item, target, file, path ? `${path}.${key}` : key, "value"),
    ]);
  return [];
}

async function externalReferences(
  root: string,
  snapshot: Awaited<ReturnType<typeof captureViewSnapshot>>,
  source: Resource,
  target: string,
  synchronizedStatements: Awaited<ReturnType<typeof syncViewSourceEdits>>["removedStatements"],
) {
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const manifest = parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
  const listed = await inspectSnapshot(root, snapshot, { project: root, command: "graph.list" });
  if (!listed.data?.items)
    throw new ProjectError(
      listed.status,
      listed.diagnostics[0]?.code ?? "IO_FAILURE",
      listed.diagnostics[0]?.message ?? "Cannot inspect project references.",
    );
  const resources = listed.data.items as Resource[];
  const byFile = new Map(resources.map((resource) => [resource.file, resource]));
  const synchronizedKeys = new Set(
    synchronizedStatements.map(({ file, statement }) => `${file}\0${statementIdentity(statement)}`),
  );
  const references: ExternalReference[] = [];
  const addGraph = async (file: string, selector: string, bytes: Buffer, store: Store) => {
    if (file === source.file) return;
    const scope = `${selector}@${digest(bytes)}`;
    for (const statement of store) {
      const encoded = encode(statement, scope);
      const disposition = synchronizedKeys.has(`${file}\0${statementIdentity(statement)}`)
        ? "synchronized"
        : "unchanged";
      for (const [position, term] of [
        ["subject", statement.subject],
        ["predicate", statement.predicate],
        ["object", statement.object],
      ] as const)
        if (term.termType === "NamedNode" && term.value === target)
          references.push({
            file,
            selector,
            position,
            targetIri: target,
            disposition,
            subject: encoded.subject,
            predicate: encoded.predicate,
            object: encoded.object,
          });
    }
  };
  for (const file of snapshot.ownedPaths) {
    if (file === source.file) continue;
    const bytes = snapshot.files[file];
    const mediaType = rdfFormats[extname(file).toLowerCase()];
    if (!bytes || !mediaType) continue;
    try {
      const store = await parseRdf(
        bytes,
        mediaType,
        pathToFileURL(await safePath(root, file)).href,
        false,
        file,
      );
      await addGraph(file, byFile.get(file)?.selector ?? file, bytes, store);
    } catch {
      throw new ProjectError(
        "invalid",
        "RDF_SYNTAX",
        "A project graph needed for deletion impact is malformed and must be repaired first.",
        file,
      );
    }
  }
  const vettedDigest = (await loadStarters()).vettedDigest;
  for (const [id, dependency] of Object.entries(lock.dependencies))
    for (const record of dependency.files) {
      const file = `${dependency.snapshot_path}/${record.key}`;
      const bytes = snapshot.files[file];
      if (!bytes)
        throw new ProjectError(
          "invalid",
          "RESOURCE_MISSING",
          "A locked graph needed for deletion impact is unavailable.",
          file,
        );
      try {
        await addGraph(
          file,
          `dep:${id}/${record.key}`,
          bytes,
          await parseGraph(bytes, record, vettedDigest, file),
        );
      } catch (error) {
        if (error instanceof ProjectError) throw error;
        throw new ProjectError(
          "invalid",
          "RDF_SYNTAX",
          "A locked graph needed for deletion impact is malformed.",
          file,
        );
      }
    }
  for (const [file, value] of [
    ["tbspec.toml", manifest],
    ["tbspec.lock", lock],
  ] as const)
    references.push(...configurationReferences(value, target, file));
  return references.sort(
    (left, right) =>
      utf8Compare(left.file, right.file) ||
      utf8Compare(left.position, right.position) ||
      utf8Compare(left.selector, right.selector) ||
      utf8Compare(
        canonical([left.subject ?? null, left.predicate ?? null, left.object ?? null]),
        canonical([right.subject ?? null, right.predicate ?? null, right.object ?? null]),
      ),
  );
}

export async function prepareElementDeletion(
  options: ElementDeletionOptions,
): Promise<PreparedResource> {
  const loaded = await loadEditor(options);
  const { root, data, scope, store } = loaded;
  const { resource } = data;
  if (
    resource.ownership !== "project" ||
    !resource.file.endsWith(".ttl") ||
    projectDiscoveryScope.excluded.some(
      (path) => resource.file === path || resource.file.startsWith(`${path}/`),
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "READ_ONLY",
      "Only discoverable owned Turtle graphs are editable. Import a locked snapshot to edit it.",
      resource.file,
    );
  if (!store)
    throw new ProjectError(
      "invalid",
      "RDF_SYNTAX",
      "Repair source syntax before deleting a source element.",
      resource.file,
    );
  if (!equalRevision(resource.revision, options.revision))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Source changed. Review current source before deleting an element.",
      resource.file,
    );
  if (!options.element || !["iri", "blank"].includes(options.element.kind))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Select an IRI or a source-revision-scoped blank node to delete.",
    );
  const element = decode(options.element, scope, store);
  if (
    resource.identity === "declared" &&
    element.termType === "NamedNode" &&
    element.value === resource.graphIri
  )
    throw new ProjectError(
      "invalid_arguments",
      "MANAGED_ROOT_LIFECYCLE",
      "Managed graph roots use resource lifecycle removal.",
      resource.file,
    );

  const snapshot = await captureViewSnapshot(root);
  const sourceBytes = snapshot.files[resource.file];
  if (!sourceBytes || !equalRevision(revision(sourceBytes), options.revision))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Source changed while preparing deletion. Review current source and views.",
      resource.file,
    );
  const statements = [...store]
    .filter(
      (statement) =>
        statement.subject.equals(element) ||
        statement.predicate.equals(element) ||
        statement.object.equals(element),
    )
    .sort((left, right) =>
      utf8Compare(canonical(encode(left, scope)), canonical(encode(right, scope))),
    );
  if (!statements.length)
    throw new ProjectError(
      "invalid_arguments",
      "RESOURCE_MISSING",
      "The selected resource has no statements in this source graph.",
      resource.file,
    );
  const targetIri = element.termType === "NamedNode" ? element.value : undefined;
  for (const statement of statements) store.removeQuad(statement);
  const writer = new Writer();
  writer.addQuads([...store]);
  const bytes = Buffer.from(
    await new Promise<string>((resolve, reject) =>
      writer.end((error, text) => (error ? reject(error) : resolve(text))),
    ),
  );
  const synchronized = await syncViewSourceEdits(
    root,
    snapshot,
    resource,
    statements.map((before) => ({ before: before as unknown as Quad })),
    store,
    targetIri,
  );
  const references = targetIri
    ? await externalReferences(root, snapshot, resource, targetIri, synchronized.removedStatements)
    : [];
  const proposed = { ...snapshot, files: { ...snapshot.files, [resource.file]: bytes } };
  for (const write of synchronized.writes) proposed.files[write.file] = write.bytes;
  const checked = await inspectSnapshot(root, proposed, { project: root, command: "status" });
  if (["unavailable", "conflict"].includes(checked.status))
    throw new ProjectError(
      checked.status,
      checked.diagnostics[0]?.code ?? "IO_FAILURE",
      checked.diagnostics[0]?.message ?? "Cannot assess the proposed deletion.",
    );
  const reviewed = statements.map((statement) => encode(statement, scope));
  const plan = withPlanImpact(
    preparePlan(
      snapshot,
      "graph.element.delete",
      [{ file: resource.file, bytes }, ...synchronized.writes],
      {
        selector: resource.selector,
        element: options.element,
        statements: reviewed,
        references,
        synchronizedViews: sortedSet(synchronized.paths),
      },
    ),
    {
      impact: {
        acceptance: ["confirm"],
        affectedFiles: sortedSet([
          ...new Set([
            resource.file,
            ...synchronized.paths,
            ...references.map((reference) => reference.file),
          ]),
        ]),
      },
    },
  );
  await verifyReads(root, snapshot.reads);
  return {
    root,
    plan,
    resource: { ...resource, revision: revision(bytes) },
    diagnostics: checked.diagnostics,
    validation: {
      validity: checked.diagnostics.some((diagnostic) => diagnostic.severity === "error")
        ? "invalid"
        : "valid",
      validationComplete: checked.data?.validationComplete === true,
    },
  };
}
