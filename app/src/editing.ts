import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, type Store, Writer } from "n3";
import type { PreparedResource } from "./authoring.ts";
import { publishResource } from "./authoring.ts";
import { canonical, digest } from "./canonical.ts";
import { equalRevision, type Revision, revision, verifyReads } from "./filesystem.ts";
import { captureInspection, inspectSnapshot, type Resource, rdfTerm } from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { absoluteIri, portablePath, safePath } from "./paths.ts";
import { discoverProject, projectDiscoveryScope } from "./project.ts";
import { parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import { parseLock, parseManifest } from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { preparePlan } from "./transactions.ts";
import { vocabularyTypes } from "./validation.ts";

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
}
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const rdfs = "http://www.w3.org/2000/01/rdf-schema#";
const owl = "http://www.w3.org/2002/07/owl#";
const { namedNode, blankNode, literal, quad } = DataFactory;
const labels = [`${rdfs}label`, `${rdfs}comment`];
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

function applicable(kind: string) {
  return kind === "ontology"
    ? bindings
    : kind === "conceptual-data-model"
      ? bindings.filter((b) => b.type !== `${owl}NamedIndividual`)
      : [];
}
function encode(q: Quad, scope: string): Triple {
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
  const creationTypes = blocked
    ? []
    : applicable(resource.kind)
        .filter((b) =>
          vocabularyTypes.class.some((type) =>
            available?.countQuads(b.type, `${rdf}type`, type, null),
          ),
        )
        .map(({ type, label }) => ({ type, label }));
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

export async function prepareEdit(options: EditingOptions): Promise<PreparedResource> {
  const loaded = await loadEditor(options);
  const { root, snapshot, data, store, scope } = loaded;
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
  let bytes = Buffer.from(data.sourceText);
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
    }
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
  const checked = await inspectSnapshot(
    root,
    { ...snapshot, files: { ...snapshot.files, [resource.file]: bytes } },
    { command: "validate", selector: resource.selector },
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
    equalRevision(resource.revision, revision(bytes)) ? [] : [{ file: resource.file, bytes }],
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
