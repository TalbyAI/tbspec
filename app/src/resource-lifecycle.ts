import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Quad, Term } from "@rdfjs/types";
import { type Store, Writer } from "n3";
import { utf8Compare } from "./canonical.ts";
import { compareDiagnosticImpact } from "./diagnostic-impact.ts";
import { equalRevision, fileBytes, revision, verifyReads } from "./filesystem.ts";
import {
  captureInspection,
  type InspectionData,
  inspectSnapshot,
  type Resource,
  rdfTerm,
} from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { portablePath, safePath } from "./paths.ts";
import { discoverProject } from "./project.ts";
import { classifyGraph, parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import {
  editManifestSelectors,
  type Lock,
  parseLock,
  parseManifest,
  type Row,
  removeModelType,
} from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import {
  type Plan,
  preparePlan,
  previewFingerprint,
  publishPlan,
  type Snapshot,
  type Write,
} from "./transactions.ts";

export type LifecycleResourceKind = "ontology" | "model" | "design" | "shapes" | "model-type";

export interface LifecycleOptions {
  project?: string;
  cwd?: string;
  kind?: LifecycleResourceKind;
  selector: string;
  destination?: string;
  confirm?: boolean;
  apply?: boolean;
  acceptedPreview?: string;
}

export interface PreparedResourceLifecycle {
  lifecycle: true;
  root: string;
  plan: Plan;
  diagnostics: Result["diagnostics"];
  resource?: Resource;
  modelType?: { name: string; removed: true };
  affectedModels: { selector: string; file: string }[];
  projectValidity: "valid" | "invalid" | "unchecked";
  validationComplete: boolean;
}

interface ImpactOccurrence {
  file: string;
  selector?: string;
  configurationPath?: string;
  position: "subject" | "predicate" | "object" | "configuration";
  targetIri: string;
  targetSelector?: string;
  subject?: Record<string, unknown>;
  predicate?: Record<string, unknown>;
  object?: Record<string, unknown>;
}

interface ImpactInspection extends Record<string, unknown> {
  kind: LifecycleResourceKind;
  selector: string;
  items: ImpactOccurrence[];
  affectedFiles: string[];
  targetIris: string[];
  affectedModels: { selector: string; file: string }[];
  resource?: Resource;
}

const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const owl = "http://www.w3.org/2002/07/owl#";
const rdfs = "http://www.w3.org/2000/01/rdf-schema#";
const entityTypes = new Set([
  `${owl}Class`,
  `${rdfs}Class`,
  `${rdfs}Datatype`,
  `${rdf}Property`,
  `${owl}ObjectProperty`,
  `${owl}DatatypeProperty`,
  `${owl}AnnotationProperty`,
  `${owl}OntologyProperty`,
  `${owl}NamedIndividual`,
  "https://talby.ai/ontology/tbspec#VisualRule",
  "https://talby.ai/ontology/tbspec#NodeVisualRule",
  "https://talby.ai/ontology/tbspec#EdgeVisualRule",
]);

function requireData<T extends Record<string, unknown>>(result: Result<T>, operation: string): T {
  if (!result.data || ["conflict", "unavailable", "invalid_arguments"].includes(result.status))
    throw new ProjectError(
      result.status,
      result.diagnostics[0]?.code ?? "IO_FAILURE",
      result.diagnostics[0]?.message ?? `${operation} could not capture its inputs.`,
      result.diagnostics[0]?.file ?? null,
    );
  return result.data;
}

async function parseOwnedGraph(root: string, path: string, bytes: Buffer): Promise<Store> {
  try {
    const format = rdfFormats[extname(path).toLowerCase()];
    if (!format)
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "The selected graph format cannot be rewritten safely.",
        path,
      );
    return await parseRdf(
      bytes,
      format,
      pathToFileURL(await safePath(root, path)).href,
      false,
      path,
    );
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError(
      "invalid",
      "RDF_SYNTAX",
      "Required graph is malformed and must be repaired before a lifecycle operation.",
      path,
    );
  }
}

async function parseSnapshotGraph(
  root: string,
  snapshot: Snapshot & { ownedPaths: string[] },
  path: string,
  lock: Lock,
) {
  const bytes = await capturedBytes(root, snapshot, path);
  if (!bytes)
    throw new ProjectError("invalid", "RESOURCE_MISSING", "Required graph is missing.", path);
  const locked = Object.entries(lock.dependencies).flatMap(([id, dependency]) =>
    dependency.files
      .filter((record) => `${dependency.snapshot_path}/${record.key}` === path)
      .map((record) => ({ id, record })),
  )[0];
  if (locked) return parseGraph(bytes, locked.record, (await loadStarters()).vettedDigest, path);
  return parseOwnedGraph(root, path, bytes);
}

async function capturedBytes(
  root: string,
  snapshot: Snapshot & { ownedPaths: string[] },
  path: string,
) {
  if (snapshot.files[path] !== undefined) return snapshot.files[path];
  const bytes = await fileBytes(root, path);
  const captured = snapshot.reads.find((read) => read.kind === "file" && read.path === path);
  if (!captured || !equalRevision(captured.revision, revision(bytes)))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Graph changed after coherent lifecycle capture.",
      path,
    );
  snapshot.files[path] = bytes;
  return bytes;
}

function validateResourceKind(
  resource: Resource,
  kind: Exclude<LifecycleResourceKind, "model-type">,
) {
  const matches =
    kind === "ontology"
      ? resource.kind === "ontology"
      : kind === "design"
        ? resource.kind === "design"
        : kind === "shapes"
          ? resource.kind === "shapes"
          : resource.kind === "model" || resource.kind.endsWith("-model");
  if (!matches)
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      `Selected resource is not a project-owned ${kind} graph.`,
      resource.file,
    );
}

function stringOccurrences(
  value: unknown,
  target: string,
  file: string,
  path = "",
): { file: string; selector?: string; position: "configuration"; targetIri: string }[] {
  if (typeof value === "string")
    return value === target
      ? [
          {
            file,
            ...(path ? { selector: path } : {}),
            position: "configuration",
            targetIri: target,
          },
        ]
      : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      stringOccurrences(item, target, file, `${path}[${index}]`),
    );
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      stringOccurrences(item, target, file, path ? `${path}.${key}` : key),
    );
  return [];
}

function selectorOccurrences(
  value: unknown,
  target: string,
  file: string,
  path = "",
): ImpactOccurrence[] {
  if (typeof value === "string")
    return value === target
      ? [
          {
            file,
            position: "configuration",
            targetIri: target,
            targetSelector: target,
            configurationPath: path,
          },
        ]
      : [];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      selectorOccurrences(item, target, file, `${path}[${index}]`),
    );
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      selectorOccurrences(item, target, file, path ? `${path}.${key}` : key),
    );
  return [];
}

function namedPositions(quad: Quad, target: string) {
  const positions: { position: "subject" | "predicate" | "object"; term: Term }[] = [];
  if (quad.subject.termType === "NamedNode" && quad.subject.value === target)
    positions.push({ position: "subject", term: quad.subject });
  if (quad.predicate.value === target)
    positions.push({ position: "predicate", term: quad.predicate });
  if (quad.object.termType === "NamedNode" && quad.object.value === target)
    positions.push({ position: "object", term: quad.object });
  return positions;
}

function referencedEntities(store: Store, graphIri: string | null): string[] {
  const found = new Set<string>();
  if (graphIri) found.add(graphIri);
  for (const quad of store)
    if (
      quad.subject.termType === "NamedNode" &&
      quad.predicate.value === rdfType &&
      quad.object.termType === "NamedNode" &&
      entityTypes.has(quad.object.value)
    )
      found.add(quad.subject.value);
  return [...found].sort(utf8Compare);
}

async function referencesFor(
  root: string,
  snapshot: Snapshot & { ownedPaths: string[] },
  lock: Lock,
  targets: string[],
  targetSelectors: string[] = [],
) {
  const references: {
    file: string;
    selector?: string;
    configurationPath?: string;
    position: "subject" | "predicate" | "object" | "configuration";
    targetIri: string;
    targetSelector?: string;
    subject?: ReturnType<typeof rdfTerm>;
    predicate?: ReturnType<typeof rdfTerm>;
    object?: ReturnType<typeof rdfTerm>;
  }[] = [];
  const graphPaths = snapshot.reads
    .filter((read) => read.kind === "file" && rdfFormats[extname(read.path).toLowerCase()])
    .map((read) => read.path);
  for (const path of [...new Set(graphPaths)].sort(utf8Compare)) {
    if (!rdfFormats[extname(path).toLowerCase()] || !(await capturedBytes(root, snapshot, path)))
      continue;
    let store: Store;
    try {
      store = await parseSnapshotGraph(root, snapshot, path, lock);
    } catch {
      continue;
    }
    const selector = Object.entries(lock.dependencies).flatMap(([id, dependency]) =>
      dependency.files
        .filter((record) => `${dependency.snapshot_path}/${record.key}` === path)
        .map((record) => `dep:${id}/${record.key}`),
    )[0];
    for (const target of targets)
      for (const quad of store)
        for (const { position } of namedPositions(quad, target)) {
          references.push({
            file: path,
            ...(selector ? { selector } : {}),
            position,
            targetIri: target,
            subject: rdfTerm(quad.subject, selector ?? path),
            predicate: rdfTerm(quad.predicate, selector ?? path),
            object: rdfTerm(quad.object, selector ?? path),
          });
        }
  }
  for (const file of ["tbspec.toml", "tbspec.lock"] as const) {
    const value = snapshot.files[file]?.toString("utf8") ?? "";
    try {
      const parsed = file === "tbspec.toml" ? parseManifest(value) : parseLock(value);
      for (const target of targets) references.push(...stringOccurrences(parsed, target, file));
      for (const target of targetSelectors)
        references.push(...selectorOccurrences(parsed, target, file));
    } catch {
      // The operation's validation diagnostics report malformed configuration separately.
    }
  }
  return references.sort(
    (a, b) =>
      utf8Compare(a.file, b.file) ||
      utf8Compare(a.targetIri, b.targetIri) ||
      utf8Compare(a.targetSelector ?? "", b.targetSelector ?? "") ||
      utf8Compare(a.position, b.position) ||
      utf8Compare(a.selector ?? "", b.selector ?? ""),
  );
}

function resourceRelations(
  resources: Resource[],
  selector: string,
  graphIri: string | null,
  manifest?: Row,
) {
  const viewReferences = new Set<string>();
  for (const configured of (manifest?.views ?? []) as Row[]) {
    if (configured.source === selector) {
      viewReferences.add(String(configured.view));
      viewReferences.add(String(configured.presentation));
    }
    if (configured.view === selector) viewReferences.add(String(configured.presentation));
    if (configured.presentation === selector) viewReferences.add(String(configured.view));
  }
  return resources.filter(
    (resource) =>
      resource.selector === selector ||
      viewReferences.has(resource.selector) ||
      resource.associations.some((association) => association.selector === selector) ||
      (!!graphIri && resource.schemaIris?.includes(graphIri)),
  );
}

export async function inspectImpact(options: {
  project?: string;
  cwd?: string;
  kind: LifecycleResourceKind;
  selector: string;
}): Promise<Result<ImpactInspection>> {
  try {
    const root = await discoverProject(options);
    const selected =
      options.kind === "model-type" ? options.selector : portablePath(options.selector);
    const snapshot = await captureInspection(root, "status");
    const manifest = parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
    const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    const listed = requireData(
      await inspectSnapshot(root, snapshot, { command: "graph.list" }),
      "Impact inspection",
    );
    const resources = listed.items ?? [];
    let targets: string[] = [];
    let affectedResources: Resource[] = [];
    let resource: Resource | undefined;
    if (options.kind === "model-type") {
      const defaults = lock.starters.model_types;
      const overrides = (manifest.model_types ?? {}) as Record<string, unknown>;
      if (!Object.hasOwn({ ...defaults, ...overrides }, selected))
        throw new ProjectError(
          "invalid_arguments",
          "MODEL_TYPE_UNUSABLE",
          "Model type does not exist.",
        );
      affectedResources = resources.filter((item) => item.modelType === selected);
    } else {
      resource = resources.find((item) => item.selector === selected);
      if (resource?.ownership !== "project")
        throw new ProjectError(
          "invalid",
          "RESOURCE_MISSING",
          "Selected owned resource is unavailable.",
          selected,
        );
      validateResourceKind(resource, options.kind);
      const store = await parseSnapshotGraph(root, snapshot, resource.file, lock);
      targets = referencedEntities(store, resource.graphIri);
      affectedResources = resourceRelations(
        resources,
        resource.selector,
        resource.graphIri,
        manifest,
      );
    }
    const references = await referencesFor(
      root,
      snapshot,
      lock,
      targets,
      options.kind === "design" ? [selected] : [],
    );
    const affectedFiles = [
      ...new Set([
        ...affectedResources.map((item) => item.file),
        ...references.map((item) => item.file),
        ...(options.kind === "model-type" ? ["tbspec.toml"] : []),
      ]),
    ].sort(utf8Compare);
    await verifyReads(root, snapshot.reads);
    return ok<ImpactInspection>({
      kind: options.kind,
      selector: selected,
      items: references,
      affectedFiles,
      targetIris: targets,
      affectedModels: affectedResources
        .filter((item) => options.kind === "model-type" || item.selector !== selected)
        .map((item) => ({ selector: item.selector, file: item.file })),
      ...(resource ? { resource } : {}),
    });
  } catch (error) {
    return failure(error) as Result<ImpactInspection>;
  }
}

async function inventory(root: string, snapshot: Snapshot & { ownedPaths: string[] }) {
  return (
    requireData(
      await inspectSnapshot(root, snapshot, { command: "graph.list" }),
      "Resource inventory",
    ).items ?? []
  );
}

async function fullStatus(root: string, snapshot: Snapshot & { ownedPaths: string[] }) {
  return await inspectSnapshot(root, snapshot, { command: "status" });
}

function statusFacts(result: Result<InspectionData>) {
  const data = result.data;
  return {
    diagnostics: result.diagnostics,
    validity: (data?.project?.validity ??
      "unchecked") as PreparedResourceLifecycle["projectValidity"],
    validationComplete: data?.project?.validationComplete ?? false,
  };
}

function makeImpactPlan(
  snapshot: Snapshot,
  operation: string,
  writes: Write[],
  args: Record<string, unknown>,
  baseline: Result<InspectionData>,
  proposed: Result<InspectionData>,
  affectedFiles: string[],
  changedGraphs: string[],
): Plan {
  const plan = preparePlan(snapshot, operation, writes, args);
  const comparison = compareDiagnosticImpact(
    baseline.diagnostics,
    proposed.diagnostics,
    changedGraphs,
  );
  const preview = {
    ...plan.preview,
    impact: {
      ...plan.preview.impact,
      baselineErrors: comparison.baselineErrors,
      introducedErrors: comparison.introducedErrors,
      worsenedErrors: comparison.worsenedErrors,
      skippedChecks: comparison.skippedChecks,
      affectedFiles: [...new Set(affectedFiles)].sort(utf8Compare),
      acceptance: operation.endsWith(".remove") ? ["confirm"] : [],
    },
  };
  const { fingerprint: _fingerprint, ...body } = preview;
  return { ...plan, preview: { ...preview, fingerprint: requirePreviewFingerprint(body) } };
}

function requirePreviewFingerprint(body: Omit<Plan["preview"], "fingerprint">) {
  // Keep the transaction module as the only fingerprint implementation.
  return previewFingerprint(body);
}

async function validateSelected(
  root: string,
  snapshot: Snapshot & { ownedPaths: string[] },
  selector: string,
) {
  const selected = await capturedBytes(root, snapshot, selector);
  if (!selected)
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "Selected resource is unavailable.",
      selector,
    );
  return selected;
}

async function prepareRemoval(options: LifecycleOptions): Promise<PreparedResourceLifecycle> {
  const root = await discoverProject(options);
  if (options.kind === "model-type") {
    const name = options.selector;
    const snapshot = await captureInspection(root, "status");
    const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
    const manifest = parseManifest(manifestText);
    const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    if (Object.hasOwn(lock.starters.model_types, name))
      throw new ProjectError(
        "invalid_arguments",
        "MODEL_TYPE_UNUSABLE",
        "Built-in model types cannot be removed; disable them instead.",
      );
    if (!Object.hasOwn((manifest.model_types ?? {}) as object, name))
      throw new ProjectError(
        "invalid_arguments",
        "MODEL_TYPE_UNUSABLE",
        "Custom model type does not exist.",
      );
    const before = await fullStatus(root, snapshot);
    const owned = await inventory(root, snapshot);
    const affectedModels = owned.filter((resource) => resource.modelType === name);
    const nextManifest = removeModelType(manifestText, name);
    const proposed = {
      ...snapshot,
      files: { ...snapshot.files, "tbspec.toml": Buffer.from(nextManifest) },
    };
    const after = await fullStatus(root, proposed);
    const facts = statusFacts(after);
    const writes = [{ file: "tbspec.toml", bytes: Buffer.from(nextManifest) }];
    const plan = makeImpactPlan(
      snapshot,
      "config.model-type.remove",
      writes,
      { name, affectedModels: affectedModels.map(({ selector, file }) => ({ selector, file })) },
      before,
      after,
      ["tbspec.toml", ...affectedModels.map((resource) => resource.file)],
      affectedModels.map((resource) => resource.selector),
    );
    plan.preview.impact.acceptance = ["confirm"];
    reseal(plan);
    return {
      lifecycle: true,
      root,
      plan,
      diagnostics: facts.diagnostics,
      modelType: { name, removed: true },
      affectedModels: affectedModels.map(({ selector, file }) => ({ selector, file })),
      projectValidity: facts.validity,
      validationComplete: facts.validationComplete,
    };
  }
  if (!options.kind)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Select a resource kind for removal.",
    );
  const selected = portablePath(options.selector);
  const snapshot = await captureInspection(root, "status", undefined, [selected]);
  const resources = await inventory(root, snapshot);
  const resource = resources.find((item) => item.selector === selected);
  if (resource?.ownership !== "project")
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "Selected owned resource is unavailable.",
      selected,
    );
  validateResourceKind(resource, options.kind);
  const bytes = await validateSelected(root, snapshot, resource.file);
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const store = await parseSnapshotGraph(root, snapshot, resource.file, lock);
  const targets = referencedEntities(store, resource.graphIri);
  const references = await referencesFor(
    root,
    snapshot,
    lock,
    targets,
    options.kind === "design" ? [selected] : [],
  );
  const manifest = parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
  const related = resourceRelations(resources, selected, resource.graphIri, manifest);
  const baseline = await fullStatus(root, snapshot);
  const proposed = {
    ...snapshot,
    files: { ...snapshot.files, [resource.file]: null },
    ownedPaths: snapshot.ownedPaths.filter((path) => path !== resource.file),
  };
  const after = await fullStatus(root, proposed);
  const facts = statusFacts(after);
  const affectedFiles = [
    ...new Set([
      resource.file,
      ...related.map((item) => item.file),
      ...references.map((item) => item.file),
    ]),
  ];
  const plan = makeImpactPlan(
    snapshot,
    `${options.kind}.remove`,
    [{ file: resource.file, bytes: null }],
    { kind: options.kind, selector: selected, targetIris: targets, references },
    baseline,
    after,
    affectedFiles,
    [resource.file],
  );
  return {
    lifecycle: true,
    root,
    plan,
    diagnostics: facts.diagnostics,
    resource: { ...resource, revision: revision(bytes) },
    affectedModels: related.map(({ selector, file }) => ({ selector, file })),
    projectValidity: facts.validity,
    validationComplete: facts.validationComplete,
  };
}

async function writeRdfStore(
  root: string,
  source: string,
  destination: string,
  store: Store,
  original: Buffer,
) {
  const extension = extname(destination).toLowerCase();
  if (extension === ".nt") {
    const writer = new Writer({ format: "N-Triples" });
    writer.addQuads(store.getQuads(null, null, null, null));
    return new Promise<Buffer>((resolve, reject) =>
      writer.end((error, text) => (error ? reject(error) : resolve(Buffer.from(text)))),
    );
  }
  if (extension === ".rdf" || extension === ".owl") {
    const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(original);
    const rootTag = /<([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\s*\/?>/s.exec(sourceText);
    if (!rootTag || rootTag[1]?.includes("?"))
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "RDF/XML cannot be rebased safely for this document.",
        destination,
      );
    await safePath(root, destination, true);
    const rootStart = rootTag[0];
    const baseAttribute = /\bxml:base\s*=\s*(["'])(.*?)\1/s.exec(rootStart);
    const preservedBase = baseAttribute
      ? new URL(baseAttribute[2] ?? "", pathToFileURL(await safePath(root, source)).href).href
      : pathToFileURL(await safePath(root, source)).href;
    const escapedBase = preservedBase.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    const replacement = baseAttribute
      ? rootStart.replace(baseAttribute[0], `xml:base="${escapedBase}"`)
      : rootStart.replace(/\s*\/?>(?:\s*)$/, (suffix) => ` xml:base="${escapedBase}"${suffix}`);
    return Buffer.from(
      sourceText.slice(0, rootTag.index) +
        replacement +
        sourceText.slice(rootTag.index + rootStart.length),
    );
  }
  const writer = new Writer();
  writer.addQuads(store.getQuads(null, null, null, null));
  return new Promise<Buffer>((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(Buffer.from(text)))),
  );
}

async function prepareMove(options: LifecycleOptions): Promise<PreparedResourceLifecycle> {
  if (!options.destination)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Move requires a destination path.",
    );
  const root = await discoverProject(options);
  const source = portablePath(options.selector);
  const destination = portablePath(options.destination);
  if (source === destination)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Source and destination must differ.",
    );
  if (destination.startsWith(".tbspec/"))
    throw new ProjectError(
      "invalid_arguments",
      "PATH_UNSAFE",
      "Owned resources cannot move into internal directories.",
      destination,
    );
  const possibleSupportSource =
    source.endsWith(".ttl") && !source.endsWith(".shacl.ttl")
      ? source.replace(/\.ttl$/i, ".shacl.ttl")
      : undefined;
  const possibleSupportDestination = possibleSupportSource
    ? destination.replace(/\.ttl$/i, ".shacl.ttl")
    : undefined;
  if (possibleSupportSource && !destination.toLowerCase().endsWith(".ttl"))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "A Turtle graph must keep its .ttl extension.",
    );
  const extra = [destination, ...(possibleSupportDestination ? [possibleSupportDestination] : [])];
  const snapshot = await captureInspection(root, "status", undefined, [
    source,
    ...extra,
    ...(possibleSupportSource ? [possibleSupportSource] : []),
  ]);
  const resources = await inventory(root, snapshot);
  const resource = resources.find((item) => item.selector === source);
  if (resource?.ownership !== "project")
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "Selected owned graph is unavailable.",
      source,
    );
  const supportSource = resource.kind === "design" ? undefined : possibleSupportSource;
  const supportDestination = resource.kind === "design" ? undefined : possibleSupportDestination;
  if (
    resource.kind !== "ontology" &&
    resource.kind !== "design" &&
    resource.kind !== "shapes" &&
    resource.kind !== "unclassified" &&
    !resource.kind.endsWith("-model") &&
    resource.kind !== "model"
  )
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      "Selected graph kind cannot be moved.",
      source,
    );
  if (extname(source).toLowerCase() !== extname(destination).toLowerCase())
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Move must preserve the graph file extension.",
    );
  for (const path of [
    source,
    destination,
    ...(supportSource ? [supportSource] : []),
    ...(supportDestination ? [supportDestination] : []),
  ])
    await safePath(root, path, true);
  if (snapshot.files[destination] !== null)
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Move destination is occupied.",
      destination,
    );
  const companion =
    supportSource && snapshot.ownedPaths.includes(supportSource) ? supportSource : undefined;
  if (companion && snapshot.files[supportDestination ?? ""] !== null)
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Linked support destination is occupied.",
      supportDestination,
    );
  if (supportSource && snapshot.files[supportSource] !== null && !companion)
    throw new ProjectError(
      "invalid",
      "GRAPH_CLASSIFICATION",
      "Convention-linked support is not an owned graph.",
      supportSource,
    );
  const moving = [source, ...(companion && supportDestination ? [companion] : [])];
  const writes: Write[] = [];
  const movedResources: Resource[] = [];
  const identityChanges: { selector: string; identity: string; before: string; after: string }[] =
    [];
  for (const path of moving) {
    const bytes = snapshot.files[path];
    if (!bytes)
      throw new ProjectError("invalid", "RESOURCE_MISSING", "Required graph is missing.", path);
    const store = await parseOwnedGraph(root, path, bytes);
    const previous = classifyGraph(store, path);
    const to = path === source ? destination : (supportDestination as string);
    const next = classifyGraph(store, to);
    for (const other of resources)
      if (
        other.selector !== source &&
        other.selector !== companion &&
        other.graphIri === next.graphIri
      )
        throw new ProjectError(
          "conflict",
          "GRAPH_IRI_COLLISION",
          "Move would collide with an existing graph identity.",
          to,
        );
    const rewritten = await writeRdfStore(root, path, to, store, bytes);
    writes.push({ file: path, bytes: rewritten, to });
    const originalResource = resources.find((item) => item.selector === path);
    if (!originalResource)
      throw new ProjectError("invalid", "RESOURCE_MISSING", "Moved graph is unavailable.", path);
    movedResources.push({
      ...originalResource,
      selector: to,
      file: to,
      ...next,
    });
    if (previous.identity === "generated" && previous.graphIri !== next.graphIri)
      identityChanges.push({
        selector: to,
        identity: "generated",
        before: previous.graphIri,
        after: next.graphIri,
      });
  }
  const pathReplacements: Record<string, string> = { [source]: destination };
  if (companion && supportDestination) pathReplacements[companion] = supportDestination;
  const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
  const editedManifest = editManifestSelectors(manifestText, pathReplacements);
  if (editedManifest !== manifestText)
    writes.push({ file: "tbspec.toml", bytes: Buffer.from(editedManifest) });
  const before = await fullStatus(root, snapshot);
  const proposedFiles: Record<string, Buffer | null> = {
    ...snapshot.files,
    "tbspec.toml": Buffer.from(editedManifest),
  };
  const proposedOwnedPaths = snapshot.ownedPaths.filter((path) => !moving.includes(path));
  for (const [index, path] of moving.entries()) {
    const write = writes[index];
    if (!write?.to || !write.bytes) throw new Error("Incomplete move plan.");
    proposedFiles[path] = null;
    proposedFiles[write.to] = write.bytes as Buffer;
    proposedOwnedPaths.push(write.to);
  }
  const afterSnapshot = { ...snapshot, files: proposedFiles, ownedPaths: proposedOwnedPaths };
  const after = await fullStatus(root, afterSnapshot);
  const facts = statusFacts(after);
  const affectedFiles = [
    ...moving,
    ...writes.flatMap((write) => [write.file, ...(write.to ? [write.to] : [])]),
    ...(editedManifest === manifestText ? [] : ["tbspec.toml"]),
  ];
  const plan = makeImpactPlan(
    snapshot,
    "resource.move",
    writes,
    { selector: source, destination, support: companion ?? null, identityChanges },
    before,
    after,
    affectedFiles,
    moving,
  );
  return {
    lifecycle: true,
    root,
    plan,
    diagnostics: facts.diagnostics,
    resource: movedResources[0],
    affectedModels: movedResources.map(({ selector, file }) => ({ selector, file })),
    projectValidity: facts.validity,
    validationComplete: facts.validationComplete,
  };
}

function reseal(plan: Plan) {
  const { fingerprint: _fingerprint, ...body } = plan.preview;
  plan.preview.fingerprint = previewFingerprint(body);
}

export async function prepareResourceLifecycle(
  options: LifecycleOptions & { action: "remove" | "move" },
): Promise<PreparedResourceLifecycle> {
  if (
    options.acceptedPreview !== undefined &&
    !/^sha256:[0-9a-f]{64}$/.test(options.acceptedPreview)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Accepted preview must be a SHA-256 digest.",
    );
  return options.action === "move" ? prepareMove(options) : prepareRemoval(options);
}

export async function publishResourceLifecycle(
  prepared: PreparedResourceLifecycle,
): Promise<Result> {
  try {
    const diagnostics = await publishPlan(prepared.root, prepared.plan);
    return ok(
      {
        applied: true,
        ...(prepared.resource ? { resource: prepared.resource } : {}),
        ...(prepared.modelType ? { modelType: prepared.modelType } : {}),
        affectedModels: prepared.affectedModels,
        changes: prepared.plan.preview.changes,
        projectValidity: prepared.projectValidity,
        validationComplete: prepared.validationComplete,
      },
      [...prepared.diagnostics, ...diagnostics],
    );
  } catch (error) {
    return failure(error);
  }
}

async function lifecycleOperation(
  options: LifecycleOptions,
  action: "remove" | "move",
): Promise<Result> {
  try {
    const prepared = await prepareResourceLifecycle({ ...options, action });
    if (options.acceptedPreview && options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return {
        ...failure(
          new ProjectError(
            "conflict",
            "PREVIEW_CHANGED",
            "The accepted preview changed. Review the current plan.",
          ),
        ),
        data: { applied: false, preview: prepared.plan.preview },
      };
    const acceptance = prepared.plan.preview.impact.acceptance;
    if (action === "remove" && !options.confirm)
      return {
        ...ok(
          {
            applied: false,
            ...(prepared.resource ? { resource: prepared.resource } : {}),
            ...(prepared.modelType ? { modelType: prepared.modelType } : {}),
            affectedModels: prepared.affectedModels,
            preview: prepared.plan.preview,
            projectValidity: prepared.projectValidity,
            validationComplete: prepared.validationComplete,
          },
          prepared.diagnostics,
        ),
        status: "preview",
      };
    if (action === "move" && (!options.apply || !options.acceptedPreview))
      return {
        ...ok(
          {
            applied: false,
            resource: prepared.resource,
            affectedModels: prepared.affectedModels,
            preview: prepared.plan.preview,
            projectValidity: prepared.projectValidity,
            validationComplete: prepared.validationComplete,
          },
          prepared.diagnostics,
        ),
        status: "preview",
      };
    if (acceptance.includes("confirm") && !options.confirm)
      return {
        ...ok({ applied: false, preview: prepared.plan.preview }, prepared.diagnostics),
        status: "preview",
      };
    return publishResourceLifecycle(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function removeResource(options: LifecycleOptions): Promise<Result> {
  return lifecycleOperation(options, "remove");
}

export async function moveResource(options: LifecycleOptions): Promise<Result> {
  return lifecycleOperation(options, "move");
}
