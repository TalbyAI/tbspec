import { pathToFileURL } from "node:url";
import type { Quad as RdfjsQuad } from "@rdfjs/types";
import { DataFactory, type Quad, type Quad_Object, type Quad_Subject, Store, Writer } from "n3";
import type { PreparedResource } from "./authoring.ts";
import { publishResource } from "./authoring.ts";
import { digest, utf8Compare } from "./canonical.ts";
import { equalRevision, fileBytes, type Revision, revision, verifyReads } from "./filesystem.ts";
import {
  captureInspection,
  type InspectionData,
  inspectSnapshot,
  type Resource,
} from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { absoluteIri, portablePath, safePath } from "./paths.ts";
import { discoverProject, projectDiscoveryScope } from "./project.ts";
import { parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import {
  editManifestView,
  parseLock,
  parseManifest,
  type Row,
  selector as validSelector,
} from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { preparePlan, type Snapshot, withPlanImpact } from "./transactions.ts";

const t = "https://talby.ai/ontology/tbspec#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const xsd = "http://www.w3.org/2001/XMLSchema#";
const { namedNode, blankNode, literal, quad } = DataFactory;

export interface ViewTuple {
  subject: string;
  predicate: string;
  object: string;
}
export interface ViewPosition {
  element: string;
  x: string;
  y: string;
}
export type ViewAppearancePatch = Record<string, unknown>;
export interface SynchronizedStatementRemoval {
  file: string;
  statement: RdfjsQuad;
}
export interface ViewOptions {
  project?: string;
  cwd?: string;
  action: "create" | "edit" | "remove";
  path?: string;
  selector?: string;
  source?: string;
  protocol?: string;
  sourceRevision?: Revision;
  viewRevision?: Revision;
  presentationRevision?: Revision;
  members?: string[];
  relationships?: ViewTuple[];
  positions?: ViewPosition[];
  nodeAppearances?: ViewAppearancePatch[];
  relationshipAppearances?: ViewAppearancePatch[];
  confirm?: boolean;
  acceptedPreview?: string;
}
interface ViewWorkspace {
  root: string;
  snapshot: Snapshot & { ownedPaths: string[]; target?: string };
  manifest: Row;
  manifestText: string;
  views: Row[];
  resources: Resource[];
  diagnostics: Result["diagnostics"];
}
interface ViewData extends Record<string, unknown> {
  resource: Resource;
  source: string;
  sourceRevision: Revision;
  members: string[];
  relationships: ViewTuple[];
  presentation: { selector: string; resource: Resource; triples: InspectionData["triples"] };
  protocol?: string;
}
interface ParsedGraph {
  resource: Resource;
  store: Store;
  triples: InspectionData["triples"];
  diagnostics: Result["diagnostics"];
}

function viewFailure(message: string, code = "VIEW_INVALID", file: string | null = null): never {
  throw new ProjectError("invalid", code, message, file);
}

function selectorFor(value: string, workspace: ViewWorkspace): string {
  if (!value.startsWith("dep:")) return portablePath(value);
  const [id, ...key] = value.slice(4).split("/");
  const dependency = parseLock(workspace.snapshot.files["tbspec.lock"]?.toString("utf8") ?? "")
    .dependencies[id ?? ""];
  if (!dependency)
    throw new ProjectError(
      "unavailable",
      "RESOURCE_MISSING",
      "Dependency selector is unavailable.",
    );
  const selected = key.join("/") || dependency.primary;
  return validSelector(`dep:${id}/${selected}`);
}

async function workspace(
  options: { project?: string; cwd?: string },
  extraPaths: string[] = [],
): Promise<ViewWorkspace> {
  const root = await discoverProject(options);
  const graphBytes = new Map<string, Buffer>();
  const snapshot = await captureInspection(
    root,
    "status",
    undefined,
    extraPaths,
    async (path, bytes) => {
      graphBytes.set(path, bytes);
    },
  );
  for (const [path, bytes] of graphBytes) snapshot.files[path] = bytes;
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  for (const dependency of Object.values(lock.dependencies))
    for (const file of dependency.files) {
      const path = `${dependency.snapshot_path}/${file.key}`;
      const bytes = await fileBytes(root, path);
      const captured = snapshot.reads.find((read) => read.kind === "file" && read.path === path);
      if (!captured || !equalRevision(captured.revision, revision(bytes)))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Locked source changed during view inspection.",
          path,
        );
      snapshot.files[path] = bytes;
    }
  await verifyReads(root, snapshot.reads);
  const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
  const manifest = parseManifest(manifestText);
  const views = (manifest.views ?? []) as Row[];
  const listed = await inspectSnapshot(root, snapshot, { project: root, command: "graph.list" });
  return {
    root,
    snapshot,
    manifest,
    manifestText,
    views,
    resources: (listed.data?.items as Resource[] | undefined) ?? [],
    diagnostics: listed.diagnostics,
  };
}

export async function captureViewSnapshot(project: string) {
  return (await workspace({ project })).snapshot;
}

async function graphAt(workspace: ViewWorkspace, selected: string): Promise<ParsedGraph> {
  const result = await inspectSnapshot(workspace.root, workspace.snapshot, {
    project: workspace.root,
    command: "graph.show",
    selector: selected,
  });
  const data = result.data;
  if (!data?.resource)
    throw new ProjectError(
      result.status === "ok" ? "unavailable" : result.status,
      result.diagnostics[0]?.code ?? "RESOURCE_MISSING",
      result.diagnostics[0]?.message ?? "Graph selector is unavailable.",
      selected,
    );
  const resource = data.resource;
  const bytes = workspace.snapshot.files[resource.file];
  if (!bytes || resource.graphIri === null)
    throw new ProjectError(
      "invalid",
      "RDF_SYNTAX",
      "Graph source is unavailable or malformed.",
      resource.file,
    );
  const lock = parseLock(workspace.snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const lockedFile = resource.dependencyId
    ? lock.dependencies[resource.dependencyId]?.files.find(
        (file) => `dep:${resource.dependencyId}/${file.key}` === resource.selector,
      )
    : undefined;
  const store = lockedFile
    ? await parseGraph(bytes, lockedFile, (await loadStarters()).vettedDigest, resource.selector)
    : await parseRdf(
        bytes,
        rdfFormats[resource.file.slice(resource.file.lastIndexOf(".")).toLowerCase()] ??
          "text/turtle",
        pathToFileURL(await safePath(workspace.root, resource.file)).href,
        false,
        resource.selector,
      );
  return {
    resource,
    store,
    triples: data.triples,
    diagnostics: result.diagnostics,
  };
}

function association(workspace: ViewWorkspace, path: string): Row {
  const matches = workspace.views.filter((row) => row.view === path);
  if (matches.length !== 1)
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "View must have exactly one manifest association.",
      path,
    );
  return matches[0] as Row;
}

function tupleFrom(record: Quad_Object, store: Store, file: string): ViewTuple {
  if (record.termType === "Literal")
    viewFailure("Relationship descriptors must be RDF resources.", "VIEW_INVALID", file);
  const values = ["subject", "predicate", "object"].map((field) =>
    store.getObjects(record as Quad_Subject, `${rdf}${field}`, null),
  );
  if (values.some((items) => items.length !== 1 || items[0]?.termType !== "NamedNode"))
    viewFailure(
      "Relationship descriptors must contain one IRI subject, predicate and object.",
      "VIEW_INVALID",
      file,
    );
  return {
    subject: values[0]?.[0]?.value ?? "",
    predicate: values[1]?.[0]?.value ?? "",
    object: values[2]?.[0]?.value ?? "",
  };
}

function tupleKey(value: ViewTuple) {
  return JSON.stringify([value.subject, value.predicate, value.object]);
}

function asSubject(term: Quad_Object, file: string): Quad_Subject {
  if (term.termType === "Literal")
    viewFailure("Relationship descriptors must be RDF resources.", "VIEW_INVALID", file);
  return term;
}

function relationships(store: Store, graph: string, file: string): ViewTuple[] {
  const tuples = store
    .getObjects(graph, `${t}relationship`, null)
    .map((record) => tupleFrom(record, store, file));
  if (new Set(tuples.map(tupleKey)).size !== tuples.length)
    viewFailure("View contains duplicate relationship tuples.", "VIEW_INVALID", file);
  return tuples.sort((left, right) => utf8Compare(tupleKey(left), tupleKey(right)));
}

async function showViewFrom(
  workspace: ViewWorkspace,
  path: string,
): Promise<{ data: ViewData; diagnostics: Result["diagnostics"] }> {
  const row = association(workspace, path);
  const selected = workspace.resources.find((resource) => resource.selector === path);
  if (selected?.kind !== "view")
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      "Selector is not a project-owned view.",
      path,
    );
  const view = await graphAt(workspace, path);
  if (view.resource.kind !== "view" || !view.resource.graphIri)
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      "Selector is not a view model.",
      path,
    );
  const sourceSelector = selectorFor(String(row.source), workspace);
  const source = await graphAt(workspace, sourceSelector);
  if (
    ![
      "ontology",
      "model",
      "conceptual-data-model",
      "concrete-data-model",
      "process-model",
      "state-machine-model",
    ].includes(source.resource.kind)
  )
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "View source is not an ontology or model.",
      source.resource.file,
    );
  const sourceIri = view.store.getObjects(view.resource.graphIri, `${t}sourceGraph`, null);
  if (
    sourceIri.length !== 1 ||
    sourceIri[0]?.termType !== "NamedNode" ||
    sourceIri[0].value !== source.resource.graphIri
  )
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "View source association contradicts its RDF.",
      path,
    );
  const presentationPath = String(row.presentation);
  const presentation = await graphAt(workspace, presentationPath);
  if (presentation.resource.kind !== "presentation" || !presentation.resource.graphIri)
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "View presentation graph is unavailable.",
      presentationPath,
    );
  const targetView = presentation.store.getObjects(
    presentation.resource.graphIri,
    `${t}forView`,
    null,
  );
  if (
    targetView.length !== 1 ||
    targetView[0]?.termType !== "NamedNode" ||
    targetView[0].value !== view.resource.graphIri
  )
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "Presentation link contradicts its view.",
      presentationPath,
    );
  const members = view.store
    .getObjects(view.resource.graphIri, `${t}member`, null)
    .map((member) => {
      if (member.termType !== "NamedNode")
        viewFailure("View members must be IRIs.", "VIEW_INVALID", path);
      return member.value;
    })
    .sort(utf8Compare);
  const data: ViewData = {
    resource: view.resource,
    source: sourceSelector,
    sourceRevision: source.resource.revision,
    members,
    relationships: relationships(view.store, view.resource.graphIri, path),
    presentation: {
      selector: presentation.resource.selector,
      resource: presentation.resource,
      triples: presentation.triples,
    },
    ...(typeof row.protocol === "string" ? { protocol: String(row.protocol) } : {}),
  };
  return {
    data,
    diagnostics: [
      ...workspace.diagnostics,
      ...view.diagnostics,
      ...source.diagnostics,
      ...presentation.diagnostics,
    ],
  };
}

export async function listViews(options: {
  project?: string;
  cwd?: string;
  source?: string;
}): Promise<Result> {
  try {
    const current = await workspace(options);
    const source = options.source ? selectorFor(options.source, current) : undefined;
    const items = current.views
      .filter((row) => !source || selectorFor(String(row.source), current) === source)
      .map((row) => ({
        selector: String(row.view),
        source: selectorFor(String(row.source), current),
        presentation: String(row.presentation),
        ...(typeof row.protocol === "string" ? { protocol: row.protocol } : {}),
      }))
      .sort((left, right) => utf8Compare(left.selector, right.selector));
    return {
      ...ok({ items }, current.diagnostics),
      status: current.diagnostics.some((d) => d.severity === "error") ? "invalid" : "ok",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function showView(options: {
  project?: string;
  cwd?: string;
  selector: string;
}): Promise<Result<ViewData>> {
  try {
    const path = portablePath(options.selector);
    const current = await workspace(options);
    const shown = await showViewFrom(current, path);
    return {
      ...ok(shown.data, shown.diagnostics),
      status: shown.diagnostics.some((d) => d.severity === "error") ? "invalid" : "ok",
    };
  } catch (error) {
    return failure(error) as Result<ViewData>;
  }
}

async function rdfBytes(store: Store): Promise<Buffer> {
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...store]);
  return Buffer.from(
    await new Promise<string>((resolve, reject) =>
      writer.end((error, text) => (error ? reject(error) : resolve(text))),
    ),
  );
}

function rowIRI(base: string | undefined, kind: string, path: string) {
  const prefix = base ?? "urn:tbspec:project:";
  return `${prefix}${kind}/${digest(path).slice(7)}`;
}

async function createView(options: ViewOptions): Promise<PreparedResource> {
  if (typeof options.path !== "string" || typeof options.source !== "string")
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "View creation requires a path and source selector.",
    );
  const path = portablePath(options.path);
  if (
    !path.endsWith(".ttl") ||
    path.startsWith(".tbspec/") ||
    projectDiscoveryScope.excluded.some((part) => path === part || path.startsWith(`${part}/`))
  )
    throw new ProjectError(
      "invalid_arguments",
      "PATH_UNSAFE",
      "Views require a discoverable owned Turtle path.",
      path,
    );
  const presentationPath = path.replace(/\.ttl$/i, ".presentation.ttl");
  if (presentationPath === path)
    throw new ProjectError(
      "invalid_arguments",
      "PATH_UNSAFE",
      "Views require a Turtle path.",
      path,
    );
  const current = await workspace(options, [path, presentationPath]);
  await safePath(current.root, path, true);
  await safePath(current.root, presentationPath, true);
  if (current.snapshot.files[path] !== null || current.snapshot.files[presentationPath] !== null)
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "View or presentation destination is occupied.",
      path,
    );
  const sourceSelector = selectorFor(options.source, current);
  const source = await graphAt(current, sourceSelector);
  if (
    !source.resource.graphIri ||
    ![
      "ontology",
      "model",
      "conceptual-data-model",
      "concrete-data-model",
      "process-model",
      "state-machine-model",
    ].includes(source.resource.kind)
  )
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "A view source must be a project-owned or locked ontology/model.",
      source.resource.file,
    );
  const protocol = options.protocol ? selectorFor(options.protocol, current) : undefined;
  if (protocol && (await graphAt(current, protocol)).resource.kind !== "ontology")
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "A view protocol must select a project-supplied ontology.",
      protocol,
    );
  if (current.views.some((row) => row.view === path || row.presentation === presentationPath))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "View or presentation path is already associated.",
      path,
    );
  const viewIri = rowIRI(
    typeof current.manifest.base_iri === "string" ? current.manifest.base_iri : undefined,
    "view",
    path,
  );
  const presentationIri = rowIRI(
    typeof current.manifest.base_iri === "string" ? current.manifest.base_iri : undefined,
    "presentation",
    path,
  );
  if (
    current.resources.some((resource) =>
      [viewIri, presentationIri].includes(resource.graphIri ?? ""),
    )
  )
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Generated view identity already exists.",
      path,
    );
  const viewStore = new Store([
    quad(namedNode(viewIri), namedNode(`${rdf}type`), namedNode(`${t}ViewModel`)),
    quad(namedNode(viewIri), namedNode(`${t}sourceGraph`), namedNode(source.resource.graphIri)),
  ]);
  const presentationStore = new Store([
    quad(namedNode(presentationIri), namedNode(`${rdf}type`), namedNode(`${t}PresentationGraph`)),
    quad(namedNode(presentationIri), namedNode(`${t}forView`), namedNode(viewIri)),
  ]);
  const manifest = editManifestView(current.manifestText, {
    view: path,
    presentation: presentationPath,
    source: sourceSelector,
    ...(protocol ? { protocol } : {}),
  });
  const viewBytes = await rdfBytes(viewStore);
  const presentationBytes = await rdfBytes(presentationStore);
  const proposed = {
    ...current.snapshot,
    files: {
      ...current.snapshot.files,
      [path]: viewBytes,
      [presentationPath]: presentationBytes,
      "tbspec.toml": Buffer.from(manifest),
    },
    ownedPaths: [...current.snapshot.ownedPaths, path, presentationPath],
  };
  const checked = await inspectSnapshot(current.root, proposed, {
    project: current.root,
    command: "graph.show",
    selector: path,
  });
  const viewResource = checked.data?.resource;
  if (!viewResource)
    throw new ProjectError(
      "invalid",
      checked.diagnostics[0]?.code ?? "VIEW_INVALID",
      checked.diagnostics[0]?.message ?? "View could not be validated.",
      path,
    );
  const writes = [
    { file: path, bytes: viewBytes },
    { file: presentationPath, bytes: presentationBytes },
    { file: "tbspec.toml", bytes: Buffer.from(manifest) },
  ];
  const plan = preparePlan(current.snapshot, "view.create", writes, {
    view: path,
    source: sourceSelector,
    presentation: presentationPath,
    protocol: protocol ?? null,
  });
  return {
    root: current.root,
    plan,
    resource: viewResource,
    diagnostics: checked.diagnostics,
    validation: {
      validity: checked.diagnostics.some((d) => d.severity === "error") ? "invalid" : "valid",
      validationComplete: checked.data?.validationComplete === true,
    },
  };
}

function assertRevision(value: unknown, expected: Revision, file: string) {
  if (!value || typeof value !== "object" || !equalRevision(value as Revision, expected))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Source, view, or presentation changed. Review current selections.",
      file,
    );
}

function tupleQuad(value: ViewTuple, source: Store): Quad {
  if (
    !value ||
    Object.keys(value).some((key) => !["subject", "predicate", "object"].includes(key)) ||
    !absoluteIri(value.subject) ||
    !absoluteIri(value.predicate) ||
    !absoluteIri(value.object)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Relationships require exact IRI subject, predicate and object values.",
    );
  const result = quad(
    namedNode(value.subject),
    namedNode(value.predicate),
    namedNode(value.object),
  );
  if (!source.has(result))
    throw new ProjectError(
      "invalid_arguments",
      "VIEW_INVALID",
      "Selected relationship does not exist in the source graph.",
    );
  return result;
}

function addRecord(store: Store, root: string, predicate: string, value: ViewTuple) {
  const record = blankNode();
  store.addQuad(namedNode(root), namedNode(predicate), record);
  store.addQuad(record, namedNode(`${rdf}subject`), namedNode(value.subject));
  store.addQuad(record, namedNode(`${rdf}predicate`), namedNode(value.predicate));
  store.addQuad(record, namedNode(`${rdf}object`), namedNode(value.object));
}

function removeRecord(store: Store, root: string, predicate: string, record: Quad_Object) {
  store.removeQuad(quad(namedNode(root), namedNode(predicate), record));
  for (const statement of store.getQuads(record, null, null, null)) store.removeQuad(statement);
}

function setRelationships(store: Store, root: string, selected: ViewTuple[], file: string) {
  const wanted = new Set(selected.map(tupleKey));
  for (const record of store.getObjects(root, `${t}relationship`, null)) {
    const tuple = tupleFrom(record, store, file);
    if (!wanted.has(tupleKey(tuple))) removeRecord(store, root, `${t}relationship`, record);
  }
  const current = relationships(store, root, file);
  const has = new Set(current.map(tupleKey));
  for (const tuple of selected)
    if (!has.has(tupleKey(tuple))) addRecord(store, root, `${t}relationship`, tuple);
}

function setViewMembers(store: Store, root: string, members: Set<string>) {
  for (const member of store.getObjects(root, `${t}member`, null))
    if (member.termType !== "NamedNode" || !members.has(member.value))
      store.removeQuad(quad(namedNode(root), namedNode(`${t}member`), member));
  const current = new Set(store.getObjects(root, `${t}member`, null).map((member) => member.value));
  for (const member of members)
    if (!current.has(member))
      store.addQuad(namedNode(root), namedNode(`${t}member`), namedNode(member));
}

function positionValue(value: string, file: string) {
  if (!value) return undefined;
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ||
    !Number.isFinite(Number(value))
  )
    throw new ProjectError(
      "invalid_arguments",
      "PRESENTATION_INVALID",
      "Coordinates must be finite numeric values.",
      file,
    );
  return literal(value, namedNode(`${xsd}double`));
}

function updatePositions(
  store: Store,
  root: string,
  members: Set<string>,
  removed: Set<string>,
  positions: ViewPosition[],
  file: string,
) {
  const nodeRecords = store.getObjects(root, `${t}nodePresentation`, null);
  for (const record of nodeRecords) {
    if (record.termType === "Literal")
      viewFailure("Node presentation records must be RDF resources.", "PRESENTATION_INVALID", file);
    const elements = store.getObjects(record as Quad_Subject, `${t}element`, null);
    if (elements.length !== 1 || elements[0]?.termType !== "NamedNode")
      viewFailure(
        "Node presentation must identify exactly one IRI element.",
        "PRESENTATION_INVALID",
        file,
      );
    if (removed.has(elements[0].value)) removeRecord(store, root, `${t}nodePresentation`, record);
  }
  const seen = new Set<string>();
  for (const position of positions) {
    if (
      !position ||
      Object.keys(position).some((key) => !["element", "x", "y"].includes(key)) ||
      !absoluteIri(position.element) ||
      typeof position.x !== "string" ||
      typeof position.y !== "string" ||
      (position.x === "") !== (position.y === "") ||
      !members.has(position.element) ||
      seen.has(position.element)
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Positions require one selected IRI and a finite x/y pair.",
        file,
      );
    seen.add(position.element);
    const x = positionValue(position.x, file);
    const y = positionValue(position.y, file);
    const records = store
      .getObjects(root, `${t}nodePresentation`, null)
      .filter(
        (record) =>
          record.termType !== "Literal" &&
          store
            .getObjects(record as Quad_Subject, `${t}element`, null)
            .some((term) => term.termType === "NamedNode" && term.value === position.element),
      );
    let record = records[0] as Quad_Subject | undefined;
    if (!record && x && y) {
      record = blankNode();
      store.addQuad(namedNode(root), namedNode(`${t}nodePresentation`), record);
      store.addQuad(record, namedNode(`${t}element`), namedNode(position.element));
    }
    if (!record) continue;
    for (const coordinate of ["x", "y"])
      for (const statement of store.getQuads(record, `${t}${coordinate}`, null, null))
        store.removeQuad(statement);
    if (x && y) {
      store.addQuad(record, namedNode(`${t}x`), x);
      store.addQuad(record, namedNode(`${t}y`), y);
    }
  }
  if ([...removed].some((element) => members.has(element)))
    viewFailure(
      "Removed members cannot retain presentation records.",
      "PRESENTATION_INVALID",
      file,
    );
}

const nodeAppearanceFields = new Set([
  "nodeShape",
  "fillColor",
  "strokeColor",
  "textColor",
  "strokeWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineStyle",
  "labelMode",
  "labelProperty",
  "labelText",
  "chosenRule",
  "group",
]);
const relationshipAppearanceFields = new Set([
  "strokeColor",
  "textColor",
  "strokeWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineStyle",
  "edgeRouting",
  "arrowHead",
  "labelMode",
  "labelProperty",
  "labelText",
  "chosenRule",
]);
const appearanceEnums: Record<string, string[]> = {
  nodeShape: ["rectangle", "rounded-rectangle", "ellipse", "diamond"],
  fontFamily: ["system-ui", "sans-serif", "serif", "monospace"],
  fontStyle: ["normal", "italic"],
  lineStyle: ["solid", "dashed", "dotted"],
  edgeRouting: ["straight", "bezier", "step"],
  arrowHead: ["none", "arrow"],
  labelMode: ["property", "local-name", "iri", "text", "none"],
};
const colorPattern = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;
const numericPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function appearanceTerm(field: string, value: unknown, file: string): Quad_Object | null {
  if (value === null) return null;
  if (field === "chosenRule" || field === "labelProperty") {
    if (typeof value !== "string" || !absoluteIri(value))
      throw new ProjectError(
        "invalid_arguments",
        "PRESENTATION_INVALID",
        `${field} must be an absolute IRI.`,
        file,
      );
    return namedNode(value);
  }
  if (field === "labelText" && value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    if (
      Object.keys(candidate).some((key) => !["value", "language"].includes(key)) ||
      typeof candidate.value !== "string" ||
      (candidate.language !== undefined && typeof candidate.language !== "string")
    )
      throw new ProjectError(
        "invalid_arguments",
        "PRESENTATION_INVALID",
        "labelText requires a string value and optional language.",
        file,
      );
    if (candidate.language !== undefined) {
      try {
        Intl.getCanonicalLocales(candidate.language);
      } catch {
        throw new ProjectError(
          "invalid_arguments",
          "PRESENTATION_INVALID",
          "labelText language must be a valid language tag.",
          file,
        );
      }
      return literal(candidate.value, candidate.language);
    }
    return literal(candidate.value, namedNode(`${xsd}string`));
  }
  if (typeof value !== "string")
    throw new ProjectError(
      "invalid_arguments",
      "PRESENTATION_INVALID",
      `${field} must be a string or null.`,
      file,
    );
  if (appearanceEnums[field] && !appearanceEnums[field]?.includes(value))
    throw new ProjectError(
      "invalid_arguments",
      "PRESENTATION_INVALID",
      `${field} has an unsupported value.`,
      file,
    );
  if (["fillColor", "strokeColor", "textColor"].includes(field) && !colorPattern.test(value))
    throw new ProjectError(
      "invalid_arguments",
      "PRESENTATION_INVALID",
      `${field} must be a hexadecimal color.`,
      file,
    );
  if (["strokeWidth", "fontSize", "fontWeight"].includes(field)) {
    const numeric = Number(value);
    const valid =
      numericPattern.test(value) &&
      Number.isFinite(numeric) &&
      (field !== "fontWeight" || /^[+-]?\d+$/.test(value));
    if (
      !valid ||
      (field === "strokeWidth" && numeric < 0) ||
      (field === "fontSize" && numeric <= 0) ||
      (field === "fontWeight" && ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(numeric))
    )
      throw new ProjectError(
        "invalid_arguments",
        "PRESENTATION_INVALID",
        `${field} is outside its supported numeric range.`,
        file,
      );
    return literal(value, namedNode(`${xsd}${field === "fontWeight" ? "integer" : "double"}`));
  }
  if (field === "group" && !value.trim())
    throw new ProjectError(
      "invalid_arguments",
      "PRESENTATION_INVALID",
      "group must be nonempty.",
      file,
    );
  return literal(value, namedNode(`${xsd}string`));
}

function applyAppearancePatch(
  store: Store,
  record: Quad_Subject,
  patch: ViewAppearancePatch,
  allowed: Set<string>,
  file: string,
) {
  for (const [field, value] of Object.entries(patch)) {
    if (["element", "subject", "predicate", "object"].includes(field)) continue;
    if (!allowed.has(field))
      throw new ProjectError(
        "invalid_arguments",
        "PRESENTATION_INVALID",
        `Appearance field ${field} is not supported here.`,
        file,
      );
    const term = appearanceTerm(field, value, file);
    for (const statement of store.getQuads(record, `${t}${field}`, null, null))
      store.removeQuad(statement);
    if (term) store.addQuad(record, namedNode(`${t}${field}`), term);
  }
}

function updateNodeAppearances(
  store: Store,
  root: string,
  members: Set<string>,
  appearances: ViewAppearancePatch[] | undefined,
  file: string,
) {
  const seen = new Set<string>();
  for (const appearance of appearances ?? []) {
    if (
      !appearance ||
      typeof appearance !== "object" ||
      Array.isArray(appearance) ||
      typeof appearance.element !== "string" ||
      !absoluteIri(appearance.element) ||
      !members.has(appearance.element) ||
      seen.has(appearance.element)
    )
      throw new ProjectError(
        "invalid_arguments",
        "PRESENTATION_INVALID",
        "Node appearance requires a unique selected element IRI.",
        file,
      );
    seen.add(appearance.element);
    const records = store
      .getObjects(root, `${t}nodePresentation`, null)
      .filter(
        (value) =>
          value.termType !== "Literal" &&
          store
            .getObjects(value as Quad_Subject, `${t}element`, null)
            .some(
              (element) => element.termType === "NamedNode" && element.value === appearance.element,
            ),
      );
    if (records.length > 1)
      viewFailure("Node has duplicate presentation records.", "PRESENTATION_INVALID", file);
    const changes = Object.keys(appearance).some((key) => key !== "element");
    if (!records.length && !changes) continue;
    let record = records[0] as Quad_Subject | undefined;
    if (!record) {
      record = blankNode();
      store.addQuad(namedNode(root), namedNode(`${t}nodePresentation`), record);
      store.addQuad(record, namedNode(`${t}element`), namedNode(appearance.element));
    }
    applyAppearancePatch(store, record, appearance, nodeAppearanceFields, file);
  }
}

function updateRelationshipAppearances(
  store: Store,
  root: string,
  selected: Set<string>,
  appearances: ViewAppearancePatch[] | undefined,
  file: string,
) {
  const seen = new Set<string>();
  for (const appearance of appearances ?? []) {
    const tuple = {
      subject: appearance?.subject,
      predicate: appearance?.predicate,
      object: appearance?.object,
    };
    const key = tupleKey(tuple as ViewTuple);
    if (
      !appearance ||
      typeof appearance !== "object" ||
      Array.isArray(appearance) ||
      !absoluteIri(String(tuple.subject ?? "")) ||
      !absoluteIri(String(tuple.predicate ?? "")) ||
      !absoluteIri(String(tuple.object ?? "")) ||
      !selected.has(key) ||
      seen.has(key)
    )
      throw new ProjectError(
        "invalid_arguments",
        "PRESENTATION_INVALID",
        "Relationship appearance must identify one selected exact tuple.",
        file,
      );
    seen.add(key);
    const records = store
      .getObjects(root, `${t}relationshipPresentation`, null)
      .filter(
        (value) => value.termType !== "Literal" && tupleKey(tupleFrom(value, store, file)) === key,
      );
    if (records.length > 1)
      viewFailure("Relationship has duplicate presentation records.", "PRESENTATION_INVALID", file);
    const changes = Object.keys(appearance).some(
      (field) => !["subject", "predicate", "object"].includes(field),
    );
    if (!records.length && !changes) continue;
    let record = records[0] as Quad_Subject | undefined;
    if (!record) {
      addRecord(store, root, `${t}relationshipPresentation`, tuple as ViewTuple);
      record = store
        .getObjects(root, `${t}relationshipPresentation`, null)
        .find(
          (value) =>
            value.termType !== "Literal" && tupleKey(tupleFrom(value, store, file)) === key,
        ) as Quad_Subject | undefined;
    }
    if (!record) throw new Error("Relationship appearance record was not created.");
    applyAppearancePatch(store, record, appearance, relationshipAppearanceFields, file);
  }
}

function setRelationshipPresentation(
  store: Store,
  root: string,
  selected: Set<string>,
  file: string,
) {
  for (const record of store.getObjects(root, `${t}relationshipPresentation`, null)) {
    const tuple = tupleFrom(record, store, file);
    if (!selected.has(tupleKey(tuple)))
      removeRecord(store, root, `${t}relationshipPresentation`, record);
  }
}

async function editView(options: ViewOptions): Promise<PreparedResource> {
  if (
    typeof options.selector !== "string" ||
    !Array.isArray(options.members) ||
    !Array.isArray(options.relationships) ||
    !Array.isArray(options.positions)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "View editing requires a selector, members, relationships and positions.",
    );
  const path = portablePath(options.selector);
  const current = await workspace(options);
  const shown = await showViewFrom(current, path);
  assertRevision(options.viewRevision, shown.data.resource.revision, path);
  assertRevision(
    options.presentationRevision,
    shown.data.presentation.resource.revision,
    String(shown.data.presentation.resource.file),
  );
  const source = await graphAt(current, shown.data.source);
  assertRevision(options.sourceRevision, source.resource.revision, String(source.resource.file));
  const sourceStore = source.store;
  const viewStore = (await graphAt(current, path)).store;
  const presentationPath = String(shown.data.presentation.resource.selector);
  const presentationStore = (await graphAt(current, presentationPath)).store;
  const viewRoot = shown.data.resource.graphIri;
  const presentationRoot = shown.data.presentation.resource.graphIri;
  if (!viewRoot || !presentationRoot)
    throw new ProjectError("invalid", "GRAPH_CLASSIFICATION", "View pair is not classified.", path);
  const currentMembers = new Set(shown.data.members);
  const requested = new Set<string>();
  for (const member of options.members) {
    if (!absoluteIri(member) || requested.has(member))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "View members must be unique absolute IRIs.",
        path,
      );
    requested.add(member);
  }
  for (const member of requested)
    if (
      !sourceStore.countQuads(namedNode(member), null, null, null) &&
      !sourceStore.countQuads(null, null, namedNode(member), null)
    )
      throw new ProjectError(
        "invalid_arguments",
        "VIEW_INVALID",
        "View member is absent from the source graph.",
        path,
      );
  const removedMembers = new Set([...currentMembers].filter((member) => !requested.has(member)));
  const tuples = options.relationships.map((tuple) => {
    const parsed = tupleQuad(tuple, sourceStore);
    return {
      subject: parsed.subject.value,
      predicate: parsed.predicate.value,
      object: parsed.object.value,
    };
  });
  if (new Set(tuples.map(tupleKey)).size !== tuples.length)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Relationship tuples must be unique.",
      path,
    );
  const selected = tuples.filter(
    (tuple) => !removedMembers.has(tuple.subject) && !removedMembers.has(tuple.object),
  );
  const selectedKeys = new Set(selected.map(tupleKey));
  const currentRelationshipKeys = new Set(shown.data.relationships.map(tupleKey));
  const priorMembers = new Set(currentMembers);
  for (const member of options.members)
    if (!currentMembers.has(member)) {
      for (const statement of sourceStore) {
        if (statement.subject.termType !== "NamedNode" || statement.object.termType !== "NamedNode")
          continue;
        if (
          (statement.subject.value === member &&
            (statement.object.value === member || priorMembers.has(statement.object.value))) ||
          (statement.object.value === member &&
            (statement.subject.value === member || priorMembers.has(statement.subject.value)))
        ) {
          const tuple = {
            subject: statement.subject.value,
            predicate: statement.predicate.value,
            object: statement.object.value,
          };
          if (!selectedKeys.has(tupleKey(tuple))) {
            selected.push(tuple);
            selectedKeys.add(tupleKey(tuple));
          }
        }
      }
      priorMembers.add(member);
    }
  for (const tuple of selected) {
    requested.add(tuple.subject);
    requested.add(tuple.object);
  }
  const removed = new Set([...currentMembers].filter((member) => !requested.has(member)));
  const beforeViews = current.snapshot.files[path];
  const beforePresentation = current.snapshot.files[String(shown.data.presentation.resource.file)];
  if (!beforeViews || !beforePresentation)
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "View or presentation bytes are unavailable.",
      path,
    );
  setViewMembers(viewStore, viewRoot, requested);
  setRelationships(viewStore, viewRoot, selected, path);
  updatePositions(
    presentationStore,
    presentationRoot,
    requested,
    removed,
    options.positions,
    presentationPath,
  );
  updateNodeAppearances(
    presentationStore,
    presentationRoot,
    requested,
    options.nodeAppearances,
    presentationPath,
  );
  setRelationshipPresentation(presentationStore, presentationRoot, selectedKeys, presentationPath);
  updateRelationshipAppearances(
    presentationStore,
    presentationRoot,
    selectedKeys,
    options.relationshipAppearances,
    presentationPath,
  );
  const unchangedSelection =
    currentMembers.size === requested.size &&
    [...currentMembers].every((member) => requested.has(member)) &&
    currentRelationshipKeys.size === selectedKeys.size &&
    [...currentRelationshipKeys].every((relationship) => selectedKeys.has(relationship));
  const viewBytes = unchangedSelection ? beforeViews : await rdfBytes(viewStore);
  const presentationBytes = await rdfBytes(presentationStore);
  const proposed = {
    ...current.snapshot,
    files: {
      ...current.snapshot.files,
      [path]: viewBytes,
      [String(shown.data.presentation.resource.file)]: presentationBytes,
    },
  };
  const after = await inspectSnapshot(current.root, proposed, {
    project: current.root,
    command: "status",
  });
  const affectedFiles = new Set([path, String(shown.data.presentation.resource.file)]);
  const errors = after.diagnostics.filter(
    (diagnostic) => affectedFiles.has(diagnostic.file ?? "") && diagnostic.severity === "error",
  );
  if (errors.length) {
    const first = errors[0];
    throw new ProjectError(
      "invalid",
      first?.code ?? "VIEW_INVALID",
      first?.message ?? "Edited view is invalid.",
      first?.file ?? path,
    );
  }
  const writes = [
    ...(unchangedSelection ? [] : [{ file: path, bytes: viewBytes }]),
    { file: String(shown.data.presentation.resource.file), bytes: presentationBytes },
  ];
  const plan = preparePlan(current.snapshot, "view.edit", writes, {
    view: path,
    members: [...requested].sort(utf8Compare),
    relationships: [...selected].sort((left, right) =>
      utf8Compare(tupleKey(left), tupleKey(right)),
    ),
    positions: options.positions,
    nodeAppearances: options.nodeAppearances ?? [],
    relationshipAppearances: options.relationshipAppearances ?? [],
    viewRevision: options.viewRevision,
    presentationRevision: options.presentationRevision,
    sourceRevision: options.sourceRevision,
  });
  return {
    root: current.root,
    plan,
    resource: { ...shown.data.resource, revision: revision(viewBytes) },
    diagnostics: after.diagnostics,
    validation: {
      validity: errors.length ? "invalid" : "valid",
      validationComplete:
        (after.data?.validation as { validationComplete?: boolean } | undefined)
          ?.validationComplete === true,
    },
  };
}

async function removeView(options: ViewOptions): Promise<PreparedResource> {
  if (typeof options.selector !== "string")
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Select a view to remove.");
  const path = portablePath(options.selector);
  const current = await workspace(options);
  const row = association(current, path);
  const view = await graphAt(current, path);
  if (view.resource.kind !== "view")
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      "Selector is not a view model.",
      path,
    );
  const presentationPath = String(row.presentation);
  if (!current.snapshot.reads.some((read) => read.kind === "file" && read.path === path))
    throw new ProjectError("invalid", "RESOURCE_MISSING", "View bytes are unavailable.", path);
  const manifest = editManifestView(current.manifestText, row, true);
  const presentation = current.snapshot.files[presentationPath];
  if (presentation === undefined || presentation === null)
    throw new ProjectError(
      "invalid",
      "ASSOCIATION_BROKEN",
      "Paired presentation graph is unavailable.",
      presentationPath,
    );
  const plan = withPlanImpact(
    preparePlan(
      current.snapshot,
      "view.remove",
      [
        { file: path, bytes: null },
        { file: presentationPath, bytes: null },
        { file: "tbspec.toml", bytes: Buffer.from(manifest) },
      ],
      { view: path, presentation: presentationPath },
    ),
    { impact: { acceptance: ["confirm"] } },
  );
  return {
    root: current.root,
    plan,
    resource: view.resource,
    diagnostics: current.diagnostics,
    validation: { validity: "valid", validationComplete: true },
  };
}

function tupleKeyForQuad(statement: Quad): string | undefined {
  if (statement.subject.termType !== "NamedNode" || statement.object.termType !== "NamedNode")
    return undefined;
  return tupleKey({
    subject: statement.subject.value,
    predicate: statement.predicate.value,
    object: statement.object.value,
  });
}

function updateSynchronizedView(
  view: Store,
  presentation: Store,
  viewRoot: string,
  presentationRoot: string,
  changes: { before: ViewTuple; after?: ViewTuple }[],
  source: Store,
  viewFile: string,
  presentationFile: string,
  removedMember?: string,
): boolean {
  let changed = false;
  for (const change of changes) {
    const beforeKey = tupleKey(change.before);
    const viewRecordValue = view
      .getObjects(viewRoot, `${t}relationship`, null)
      .find((record) => tupleKey(tupleFrom(record, view, viewFile)) === beforeKey);
    const viewRecord = viewRecordValue ? asSubject(viewRecordValue, viewFile) : undefined;
    if (!viewRecord) continue;
    const afterKey = change.after ? tupleKey(change.after) : undefined;
    const targetExists = Boolean(
      change.after &&
        afterKey &&
        source.has(
          quad(
            namedNode(change.after.subject),
            namedNode(change.after.predicate),
            namedNode(change.after.object),
          ),
        ),
    );
    const existingTarget = targetExists
      ? view
          .getObjects(viewRoot, `${t}relationship`, null)
          .find(
            (record) =>
              record !== viewRecord && tupleKey(tupleFrom(record, view, viewFile)) === afterKey,
          )
      : undefined;
    const presentationRecordValue = presentation
      .getObjects(presentationRoot, `${t}relationshipPresentation`, null)
      .find((record) => tupleKey(tupleFrom(record, presentation, presentationFile)) === beforeKey);
    const presentationRecord = presentationRecordValue
      ? asSubject(presentationRecordValue, presentationFile)
      : undefined;

    if (targetExists && !existingTarget && change.after) {
      for (const field of ["subject", "predicate", "object"] as const)
        for (const statement of view.getQuads(viewRecord, `${rdf}${field}`, null, null))
          view.removeQuad(statement);
      for (const field of ["subject", "predicate", "object"] as const)
        view.addQuad(viewRecord, namedNode(`${rdf}${field}`), namedNode(change.after[field]));
      for (const endpoint of [change.after.subject, change.after.object])
        if (!view.countQuads(viewRoot, `${t}member`, namedNode(endpoint), null))
          view.addQuad(namedNode(viewRoot), namedNode(`${t}member`), namedNode(endpoint));
    } else {
      removeRecord(view, viewRoot, `${t}relationship`, viewRecord);
    }

    if (presentationRecord) {
      if (targetExists && !existingTarget && change.after) {
        for (const field of ["subject", "predicate", "object"] as const)
          for (const statement of presentation.getQuads(
            presentationRecord,
            `${rdf}${field}`,
            null,
            null,
          ))
            presentation.removeQuad(statement);
        for (const field of ["subject", "predicate", "object"] as const)
          presentation.addQuad(
            presentationRecord,
            namedNode(`${rdf}${field}`),
            namedNode(change.after[field]),
          );
      } else {
        removeRecord(
          presentation,
          presentationRoot,
          `${t}relationshipPresentation`,
          presentationRecord,
        );
      }
    }
    changed = true;
  }
  if (removedMember) {
    for (const member of view.getObjects(viewRoot, `${t}member`, null))
      if (member.termType === "NamedNode" && member.value === removedMember) {
        view.removeQuad(quad(namedNode(viewRoot), namedNode(`${t}member`), member));
        changed = true;
      }
    for (const record of presentation.getObjects(presentationRoot, `${t}nodePresentation`, null))
      if (
        record.termType !== "Literal" &&
        presentation
          .getObjects(record as Quad_Subject, `${t}element`, null)
          .some((element) => element.termType === "NamedNode" && element.value === removedMember)
      ) {
        removeRecord(presentation, presentationRoot, `${t}nodePresentation`, record);
        changed = true;
      }
  }
  return changed;
}

async function synchronizeViews(
  current: ViewWorkspace,
  source: Resource,
  changes: { before: Quad; after?: Quad }[],
  sourceStore: Store,
  removedMember?: string,
): Promise<{
  writes: { file: string; bytes: Buffer }[];
  paths: string[];
  removedStatements: SynchronizedStatementRemoval[];
}> {
  if (!source.graphIri || (!changes.length && !removedMember))
    return { writes: [], paths: [], removedStatements: [] };
  const matchSource = (value: string) => selectorFor(value, current) === source.selector;
  const candidates: { row: Row; view: ParsedGraph; presentation: ParsedGraph }[] = [];
  for (const row of current.views) {
    const viewPath = String(row.view);
    const sourceSelected = typeof row.source === "string" && matchSource(row.source);
    if (!sourceSelected && !current.snapshot.files[viewPath]) continue;
    if (!current.snapshot.files[viewPath])
      throw new ProjectError(
        "invalid",
        "RESOURCE_MISSING",
        "Associated view graph is unavailable.",
        viewPath,
      );
    let view: ParsedGraph;
    try {
      view = await graphAt(current, viewPath);
    } catch (error) {
      if (sourceSelected) throw error;
      continue;
    }
    if (view.resource.kind !== "view" || !view.resource.graphIri) {
      if (sourceSelected)
        viewFailure("Associated view graph is malformed.", "VIEW_INVALID", viewPath);
      continue;
    }
    const linkedSource = view.store.getObjects(view.resource.graphIri, `${t}sourceGraph`, null)[0];
    if (
      (!sourceSelected && linkedSource?.termType !== "NamedNode") ||
      (!sourceSelected && linkedSource?.value !== source.graphIri)
    )
      continue;
    if (linkedSource?.termType !== "NamedNode" || linkedSource.value !== source.graphIri)
      viewFailure(
        "View source association contradicts the edited source.",
        "ASSOCIATION_BROKEN",
        viewPath,
      );
    const presentationPath = String(row.presentation);
    if (!current.snapshot.files[presentationPath])
      viewFailure(
        "Associated presentation graph is unavailable.",
        "PRESENTATION_INVALID",
        presentationPath,
      );
    const presentation = await graphAt(current, presentationPath);
    if (presentation.resource.kind !== "presentation" || !presentation.resource.graphIri)
      viewFailure(
        "Associated presentation graph is malformed.",
        "PRESENTATION_INVALID",
        presentationPath,
      );
    candidates.push({ row, view, presentation });
  }
  if (!candidates.length) return { writes: [], paths: [], removedStatements: [] };
  const baseline = await inspectSnapshot(current.root, current.snapshot, {
    project: current.root,
    command: "status",
  });
  const candidateFiles = new Set(
    candidates.flatMap(({ view, presentation }) => [
      view.resource.file,
      presentation.resource.file,
    ]),
  );
  const isWinningDesignTie = (diagnostic: (typeof baseline.diagnostics)[number]) =>
    diagnostic.code === "DESIGN_CONFLICT" &&
    (diagnostic.details?.identity as { kind?: unknown } | undefined)?.kind === "collision";
  const broken = baseline.diagnostics.find(
    (diagnostic) =>
      candidateFiles.has(diagnostic.file ?? "") &&
      diagnostic.severity === "error" &&
      !isWinningDesignTie(diagnostic),
  );
  if (broken)
    throw new ProjectError(
      "invalid",
      broken.code,
      "A saved view or presentation that must be synchronized is malformed or stale.",
      broken.file,
    );
  const normalized = changes.flatMap((change) => {
    const beforeKey = tupleKeyForQuad(change.before);
    if (!beforeKey) return [];
    const afterKey = change.after ? tupleKeyForQuad(change.after) : undefined;
    const after =
      change.after && afterKey
        ? {
            subject: change.after.subject.value,
            predicate: change.after.predicate.value,
            object: change.after.object.value,
          }
        : undefined;
    return [
      {
        before: {
          subject: change.before.subject.value,
          predicate: change.before.predicate.value,
          object: change.before.object.value,
        },
        ...(after ? { after } : {}),
      },
    ];
  });
  const writes: { file: string; bytes: Buffer }[] = [];
  const paths: string[] = [];
  const removedStatements: SynchronizedStatementRemoval[] = [];
  for (const { row, view, presentation } of candidates) {
    const previousView = [...view.store];
    const previousPresentation = [...presentation.store];
    const affected = updateSynchronizedView(
      view.store,
      presentation.store,
      view.resource.graphIri as string,
      presentation.resource.graphIri as string,
      normalized,
      sourceStore,
      view.resource.file,
      presentation.resource.file,
      removedMember,
    );
    if (!affected) continue;
    for (const statement of previousView)
      if (!view.store.has(statement))
        removedStatements.push({ file: view.resource.file, statement });
    for (const statement of previousPresentation)
      if (!presentation.store.has(statement))
        removedStatements.push({ file: presentation.resource.file, statement });
    const pair = await Promise.all([rdfBytes(view.store), rdfBytes(presentation.store)]);
    writes.push(
      { file: view.resource.file, bytes: pair[0] as Buffer },
      { file: presentation.resource.file, bytes: pair[1] as Buffer },
    );
    paths.push(String(row.view), String(row.presentation));
  }
  return { writes, paths, removedStatements };
}

export async function prepareEditWithViews(options: ViewOptions): Promise<PreparedResource> {
  if (options.action === "create") return createView(options);
  if (options.action === "edit") return editView(options);
  return removeView(options);
}

export async function publishView(prepared: PreparedResource): Promise<Result> {
  return publishResource(prepared);
}

export async function viewOperation(options: ViewOptions): Promise<Result> {
  try {
    if (
      options.acceptedPreview !== undefined &&
      !/^sha256:[0-9a-f]{64}$/.test(options.acceptedPreview)
    )
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Accepted preview must be a SHA-256 digest.",
      );
    const prepared = await prepareEditWithViews(options);
    if (options.acceptedPreview && options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return {
        ...failure(
          new ProjectError(
            "conflict",
            "PREVIEW_CHANGED",
            "The view preview changed. Review the current plan.",
          ),
        ),
        data: { applied: false, preview: prepared.plan.preview },
      };
    if (options.action === "remove" && !options.confirm)
      return {
        ...ok(
          { applied: false, resource: prepared.resource, preview: prepared.plan.preview },
          prepared.diagnostics,
        ),
        status: "preview",
      };
    if (prepared.plan.preview.impact.acceptance.includes("confirm") && !options.confirm)
      return {
        ...ok({ applied: false, preview: prepared.plan.preview }, prepared.diagnostics),
        status: "preview",
      };
    return await publishView(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function syncViewSourceEdits(
  root: string,
  snapshot: Snapshot & { ownedPaths: string[]; target?: string },
  resource: Resource,
  changes: { before: Quad; after?: Quad }[],
  sourceStore: Store,
  removedMember?: string,
) {
  const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
  const manifest = parseManifest(manifestText);
  const listed = await inspectSnapshot(root, snapshot, { project: root, command: "graph.list" });
  const current: ViewWorkspace = {
    root,
    snapshot,
    manifest,
    manifestText,
    views: (manifest.views ?? []) as Row[],
    resources: (listed.data?.items as Resource[] | undefined) ?? [],
    diagnostics: listed.diagnostics,
  };
  return synchronizeViews(current, resource, changes, sourceStore, removedMember);
}

export function viewDataForTesting(value: Result<ViewData>) {
  return value;
}
