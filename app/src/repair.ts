import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Term } from "@rdfjs/types";
import { DataFactory, Writer as N3Writer, Store } from "n3";
import { utf8Compare } from "./canonical.ts";
import { compareDiagnosticImpact } from "./diagnostic-impact.ts";
import {
  equalRevision,
  type FileSystem,
  fileBytes,
  nativeFileSystem,
  revision,
  verifyReads,
} from "./filesystem.ts";
import { captureInspection, type InspectionData, inspectSnapshot, rdfTerm } from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { absoluteIri, portablePath, safePath } from "./paths.ts";
import { discoverProject } from "./project.ts";
import { classifyGraph, parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import {
  editManifestIri,
  editManifestView,
  type Lock,
  parseLock,
  parseManifest,
  type Row,
  removeManifestIriChoice,
  removeManifestSupportAssociations,
} from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import {
  type Plan,
  preparePlan,
  publishPlan,
  type Snapshot,
  withPlanImpact,
} from "./transactions.ts";
import { vocabularyUses } from "./validation.ts";

const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const metadata = "https://talby.ai/ontology/tbspec#";
const imports = "http://www.w3.org/2002/07/owl#imports";

export interface ReferenceOccurrence extends Record<string, unknown> {
  file: string;
  position: "subject" | "predicate" | "object" | "configuration";
  targetIri: string;
  selector?: string;
  configurationPath?: string;
  subject?: ReturnType<typeof rdfTerm>;
  predicate?: ReturnType<typeof rdfTerm>;
  object?: ReturnType<typeof rdfTerm>;
}

export interface PreparedRepair {
  root: string;
  plan: Plan;
  diagnostics: Result["diagnostics"];
  projectValidity: string;
  validationComplete: boolean;
}

export type RepairRequest =
  | { operation: "refactor"; oldIri: string; newIri: string }
  | { operation: "redirect"; targetIri: string; newIri: string; files?: string[]; all?: boolean }
  | { operation: "remove"; targetIri: string; files?: string[]; all?: boolean }
  | { operation: "gc"; resources?: string[]; all?: boolean };

export async function prepareRepair(
  request: RepairRequest,
  project: string,
): Promise<{ prepared: PreparedRepair; candidates?: SupportCandidate[] }> {
  if (request.operation === "refactor")
    return {
      prepared: await prepareRefactorIri({
        project,
        oldIri: request.oldIri,
        newIri: request.newIri,
      }),
    };
  if (request.operation === "redirect")
    return {
      prepared: await prepareReferenceRepair({
        project,
        operation: "redirect",
        targetIri: request.targetIri,
        newIri: request.newIri,
        files: request.files,
        all: request.all,
      }),
    };
  if (request.operation === "remove")
    return {
      prepared: await prepareReferenceRepair({
        project,
        operation: "remove",
        targetIri: request.targetIri,
        files: request.files,
        all: request.all,
      }),
    };
  const gc = await prepareGarbageCollection({
    project,
    resources: request.resources,
    all: request.all,
  });
  const { candidates, ...prepared } = gc;
  return { prepared, candidates };
}

interface CapturedRepair extends Snapshot {
  ownedPaths: string[];
  stores: Map<string, Store>;
  lock: Lock;
  manifest: Row;
  vettedDigest?: Promise<string>;
}

function lockedGraph(lock: Lock, file: string) {
  for (const [id, dependency] of Object.entries(lock.dependencies)) {
    const record = dependency.files.find(
      (candidate) => `${dependency.snapshot_path}/${candidate.key}` === file,
    );
    if (record) return { id, record, selector: `dep:${id}/${record.key}` };
  }
  return undefined;
}

async function capturedBytes(root: string, snapshot: Snapshot, path: string) {
  if (Object.hasOwn(snapshot.files, path)) return snapshot.files[path] ?? null;
  const expected = snapshot.reads.find((read) => read.kind === "file" && read.path === path);
  const bytes = await fileBytes(root, path);
  if (!expected || !equalRevision(expected.revision, revision(bytes)))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Project changed after coherent reference capture.",
      path,
    );
  snapshot.files[path] = bytes;
  return bytes;
}

async function parseCapturedGraph(snapshot: CapturedRepair, path: string): Promise<Store | null> {
  const bytes = await capturedBytes(snapshot.projectRoot, snapshot, path);
  if (!bytes) return null;
  const locked = lockedGraph(snapshot.lock, path);
  if (locked) {
    snapshot.vettedDigest ??= loadStarters().then((starters) => starters.vettedDigest);
    return parseGraph(bytes, locked.record, await snapshot.vettedDigest, path);
  }
  const format = rdfFormats[extname(path).toLowerCase()];
  if (!format) return null;
  return parseRdf(
    bytes,
    format,
    pathToFileURL(await safePath(snapshot.projectRoot, path)).href,
    false,
    path,
  );
}

export function rdfGraphsAreIsomorphic(left: Store, right: Store): boolean {
  const leftQuads = left.getQuads(null, null, null, null);
  const rightQuads = right.getQuads(null, null, null, null);
  if (leftQuads.length !== rightQuads.length) return false;

  const blankNodes = (quads: typeof leftQuads) =>
    [
      ...new Set(
        quads.flatMap((quad) =>
          [quad.subject, quad.object]
            .filter((term) => term.termType === "BlankNode")
            .map((term) => term.value),
        ),
      ),
    ].sort(utf8Compare);
  const leftNodes = blankNodes(leftQuads);
  const rightNodes = blankNodes(rightQuads);
  if (leftNodes.length !== rightNodes.length) return false;
  const exactIdentity = (quads: typeof leftQuads) =>
    quads
      .map((quad) => JSON.stringify([quad.subject, quad.predicate, quad.object]))
      .sort(utf8Compare);
  const leftExact = exactIdentity(leftQuads);
  const rightExact = exactIdentity(rightQuads);
  if (leftExact.every((quad, index) => quad === rightExact[index])) return true;
  if (!leftNodes.length) return false;

  const encodeTerm = (term: Term, mapping: Map<string, string>) =>
    term.termType === "BlankNode"
      ? [term.termType, mapping.get(term.value)]
      : term.termType === "Literal"
        ? [term.termType, term.value, term.language, term.datatype.value]
        : [term.termType, term.value];
  const identity = (quads: typeof leftQuads, mapping: Map<string, string>) =>
    quads
      .map((quad) =>
        JSON.stringify([
          encodeTerm(quad.subject, mapping),
          encodeTerm(quad.predicate, mapping),
          encodeTerm(quad.object, mapping),
        ]),
      )
      .sort(utf8Compare);
  type Edge = { position: "subject" | "object"; predicate: string; other: Term };
  const adjacency = (quads: typeof leftQuads) => {
    const indexed = new Map<string, Edge[]>();
    const add = (node: string, edge: Edge) => {
      let edges = indexed.get(node);
      if (!edges) {
        edges = [];
        indexed.set(node, edges);
      }
      edges.push(edge);
    };
    for (const quad of quads) {
      const predicate = quad.predicate.value;
      if (quad.subject.termType === "BlankNode")
        add(quad.subject.value, { position: "subject", predicate, other: quad.object });
      if (quad.object.termType === "BlankNode")
        add(quad.object.value, { position: "object", predicate, other: quad.subject });
    }
    return indexed;
  };
  const leftEdges = adjacency(leftQuads);
  const rightEdges = adjacency(rightQuads);
  const refine = (leftMarks: Map<string, string>, rightMarks: Map<string, string>) => {
    let leftColors = new Map(leftNodes.map((node) => [node, leftMarks.get(node) ?? "_"]));
    let rightColors = new Map(rightNodes.map((node) => [node, rightMarks.get(node) ?? "_"]));
    while (true) {
      const descriptions = (
        node: string,
        colors: Map<string, string>,
        edges: Map<string, Edge[]>,
      ) => {
        const nearby = (edges.get(node) ?? []).map((edge) =>
          JSON.stringify([edge.position, edge.predicate, encodeTerm(edge.other, colors)]),
        );
        return JSON.stringify([colors.get(node), nearby.sort(utf8Compare)]);
      };
      const leftDescriptions = leftNodes.map((node) => descriptions(node, leftColors, leftEdges));
      const rightDescriptions = rightNodes.map((node) =>
        descriptions(node, rightColors, rightEdges),
      );
      const allDescriptions = [...new Set([...leftDescriptions, ...rightDescriptions])].sort(
        utf8Compare,
      );
      const colorByDescription = new Map(
        allDescriptions.map((description, index) => [description, `c${index}`]),
      );
      const nextLeft = new Map(
        leftNodes.map((node, index) => [
          node,
          colorByDescription.get(leftDescriptions[index] ?? "") ?? "",
        ]),
      );
      const nextRight = new Map(
        rightNodes.map((node, index) => [
          node,
          colorByDescription.get(rightDescriptions[index] ?? "") ?? "",
        ]),
      );
      const counts = (colors: Map<string, string>) => {
        const result = new Map<string, number>();
        for (const color of colors.values()) result.set(color, (result.get(color) ?? 0) + 1);
        return result;
      };
      const leftCounts = counts(nextLeft);
      const rightCounts = counts(nextRight);
      if (
        leftCounts.size !== rightCounts.size ||
        [...leftCounts].some(([color, count]) => rightCounts.get(color) !== count)
      )
        return undefined;
      if (leftCounts.size === new Set([...leftColors.values(), ...rightColors.values()]).size)
        return { left: nextLeft, right: nextRight };
      leftColors = nextLeft;
      rightColors = nextRight;
    }
  };

  const search = (leftMarks: Map<string, string>, rightMarks: Map<string, string>): boolean => {
    const colors = refine(leftMarks, rightMarks);
    if (!colors) return false;
    const members = (mapping: Map<string, string>) => {
      const result = new Map<string, string[]>();
      for (const [node, color] of mapping) result.set(color, [...(result.get(color) ?? []), node]);
      return result;
    };
    const leftByColor = members(colors.left);
    const rightByColor = members(colors.right);
    const ambiguous = [...leftByColor]
      .filter(([, nodes]) => nodes.length > 1)
      .sort((leftClass, rightClass) => leftClass[1].length - rightClass[1].length)[0];
    if (!ambiguous) {
      const leftIdentity = identity(leftQuads, colors.left);
      const rightIdentity = identity(rightQuads, colors.right);
      return leftIdentity.every((quad, index) => quad === rightIdentity[index]);
    }

    const [color, nodes] = ambiguous;
    const leftNode = nodes[0];
    if (!leftNode) return false;
    const candidates = rightByColor.get(color) ?? [];
    for (const rightNode of candidates) {
      const marker = `m${leftMarks.size}`;
      const nextLeft = new Map(leftMarks);
      const nextRight = new Map(rightMarks);
      nextLeft.set(leftNode, marker);
      nextRight.set(rightNode, marker);
      if (search(nextLeft, nextRight)) return true;
    }
    return false;
  };

  return search(new Map(), new Map());
}

async function writeStore(
  store: Store,
  extension: string,
  root: string,
  file: string,
): Promise<Buffer> {
  let bytes: Buffer;
  if (extension === ".rdf" || extension === ".owl") bytes = writeRdfXml(store);
  else
    bytes = await new Promise((resolve, reject) => {
      const output = new N3Writer({ format: extension === ".nt" ? "N-Triples" : "text/turtle" });
      output.addQuads(store.getQuads(null, null, null, null));
      output.end((error, text) => (error ? reject(error) : resolve(Buffer.from(text))));
    });
  const format = rdfFormats[extension];
  if (!format)
    throw new ProjectError(
      "invalid",
      "RDF_FORMAT_UNSUPPORTED",
      "RDF format cannot be rewritten.",
      file,
    );
  const parsed = await parseRdf(
    bytes,
    format,
    pathToFileURL(await safePath(root, file)).href,
    false,
    file,
  );
  if (!rdfGraphsAreIsomorphic(parsed, store))
    throw new ProjectError(
      "invalid",
      "RDF_ROUNDTRIP",
      "Serialized graph does not preserve its RDF terms.",
      file,
    );
  return bytes;
}

function xml(value: string): string {
  if (
    [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return !(
        point === 0x9 ||
        point === 0xa ||
        point === 0xd ||
        (point >= 0x20 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      );
    })
  )
    throw new ProjectError(
      "invalid",
      "RDF_FORMAT_UNSUPPORTED",
      "The RDF/XML format cannot represent this XML character.",
    );
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function writeRdfXml(store: Store): Buffer {
  const predicates = [
    ...new Set(store.getQuads(null, null, null, null).map((quad) => quad.predicate.value)),
  ].sort(utf8Compare);
  const splitPredicate = (predicate: string) => {
    const candidates = [...predicate]
      .map((_, index) => index)
      .filter((index) => [":", "/", "#"].includes(predicate[index] ?? ""))
      .reverse();
    for (const index of candidates) {
      const namespace = predicate.slice(0, index + 1);
      const local = predicate.slice(index + 1);
      if (/^[A-Za-z_][A-Za-z0-9._-]*$/.test(local) && absoluteIri(namespace))
        return { namespace, local };
    }
    throw new ProjectError(
      "invalid",
      "RDF_FORMAT_UNSUPPORTED",
      "Predicate <" + predicate + "> cannot be represented safely as an RDF/XML QName.",
    );
  };
  const names = new Map(
    predicates.map((predicate, index) => {
      const split = splitPredicate(predicate);
      return [predicate, { prefix: "p" + index, ...split }];
    }),
  );
  const declarations = predicates
    .map((predicate) => {
      const name = names.get(predicate);
      if (!name) throw new Error("Missing predicate QName.");
      return " xmlns:" + name.prefix + '="' + xml(name.namespace) + '"';
    })
    .join("");
  const body: string[] = [];
  const statements = store
    .getQuads(null, null, null, null)
    .sort((left, right) =>
      utf8Compare(
        JSON.stringify([left.subject, left.predicate, left.object]),
        JSON.stringify([right.subject, right.predicate, right.object]),
      ),
    );
  for (const statement of statements) {
    if (statement.subject.termType !== "NamedNode" && statement.subject.termType !== "BlankNode")
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "An RDF/XML subject term cannot be represented safely.",
      );
    if (statement.predicate.termType !== "NamedNode")
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "An RDF/XML predicate term cannot be represented safely.",
      );
    if (!["NamedNode", "BlankNode", "Literal"].includes(statement.object.termType))
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "An RDF/XML object term cannot be represented safely.",
      );
    if (
      statement.subject.termType === "BlankNode" &&
      !/^[A-Za-z_][A-Za-z0-9._-]*$/.test(statement.subject.value)
    )
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "A blank node identifier cannot be represented safely as an RDF/XML nodeID.",
      );
    const subject =
      statement.subject.termType === "NamedNode"
        ? 'rdf:about="' + xml(statement.subject.value) + '"'
        : 'rdf:nodeID="' + xml(statement.subject.value) + '"';
    if (
      statement.object.termType === "BlankNode" &&
      !/^[A-Za-z_][A-Za-z0-9._-]*$/.test(statement.object.value)
    )
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "A blank node identifier cannot be represented safely as an RDF/XML nodeID.",
      );
    const name = names.get(statement.predicate.value);
    if (!name) throw new Error("Missing predicate QName.");
    const element = name.prefix + ":" + name.local;
    const property =
      statement.object.termType === "NamedNode"
        ? "<" + element + ' rdf:resource="' + xml(statement.object.value) + '"/>'
        : statement.object.termType === "BlankNode"
          ? "<" + element + ' rdf:nodeID="' + xml(statement.object.value) + '"/>'
          : statement.object.termType === "Literal"
            ? "<" +
              element +
              (statement.object.language
                ? ' xml:lang="' + xml(statement.object.language) + '"'
                : statement.object.datatype.value !== "http://www.w3.org/2001/XMLSchema#string"
                  ? ' rdf:datatype="' + xml(statement.object.datatype.value) + '"'
                  : "") +
              ">" +
              xml(statement.object.value) +
              "</" +
              element +
              ">"
            : "";
    body.push("  <rdf:Description " + subject + ">" + property + "</rdf:Description>");
  }
  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"' +
      declarations +
      ">\n" +
      body.join("\n") +
      "\n</rdf:RDF>\n",
  );
}
function replaceIri(store: Store, oldIri: string, newIri: string): Store {
  return new Store(
    store.getQuads(null, null, null, null).map((quad) =>
      DataFactory.quad(
        quad.subject.termType === "NamedNode" && quad.subject.value === oldIri
          ? DataFactory.namedNode(newIri)
          : quad.subject,
        quad.predicate.value === oldIri ? DataFactory.namedNode(newIri) : quad.predicate,
        quad.object.termType === "NamedNode" && quad.object.value === oldIri
          ? DataFactory.namedNode(newIri)
          : quad.object.termType === "Literal" && quad.object.datatype.value === oldIri
            ? quad.object.language
              ? (() => {
                  throw new ProjectError(
                    "invalid",
                    "RDF_REFACTOR_UNREPRESENTABLE",
                    "A language-tagged literal has the fixed rdf:langString datatype and cannot preserve its language tag under this IRI refactor.",
                  );
                })()
              : DataFactory.literal(quad.object.value, DataFactory.namedNode(newIri))
            : quad.object,
      ),
    ),
  );
}

export async function prepareRefactorIri(options: {
  project?: string;
  cwd?: string;
  oldIri: string;
  newIri: string;
}): Promise<PreparedRepair> {
  if (!absoluteIri(options.oldIri) || !absoluteIri(options.newIri))
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "IRIs must be absolute.");
  if (options.oldIri === options.newIri)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Old and new IRIs must differ.",
    );
  const snapshot = await captureRepair(options);
  const baseline = await inspectSnapshot(snapshot.projectRoot, snapshot, { command: "status" });
  const { occurrences, stores } = await allOccurrences(snapshot);
  // A project-wide rename must understand every owned RDF file before it can decide whether to edit it.
  for (const path of snapshot.ownedPaths.filter(
    (candidate) => rdfFormats[extname(candidate).toLowerCase()],
  )) {
    try {
      const store = stores.get(path) ?? (await parseCapturedGraph(snapshot, path));
      if (!store)
        throw new ProjectError("invalid", "RDF_SYNTAX", "Required graph is unavailable.", path);
      stores.set(path, store);
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      throw new ProjectError(
        "invalid",
        "RDF_SYNTAX",
        "Repair the malformed project graph in source before refactoring IRIs.",
        path,
      );
    }
  }
  for (const [path, store] of stores) {
    if (lockedGraph(snapshot.lock, path)) continue;
    const declaration = classifyGraph(store, path);
    const graphCollision =
      declaration.identity === "declared" &&
      declaration.graphIri === options.newIri &&
      declaration.graphIri !== options.oldIri;
    // Imported declarations and graph roots count; an ordinary occurrence does not declare an IRI.
    const termCollision = store.countQuads(options.newIri, rdfType, null, null) > 0;
    if (graphCollision || termCollision)
      throw new ProjectError(
        "conflict",
        graphCollision ? "GRAPH_IRI_COLLISION" : "TERM_IRI_COLLISION",
        `Target IRI <${options.newIri}> is already declared by another owned resource.`,
        path,
      );
  }

  const writes: { file: string; bytes: Buffer }[] = [];
  const proposedFiles = { ...snapshot.files };
  for (const [path, store] of [...stores].sort(([left], [right]) => utf8Compare(left, right))) {
    if (lockedGraph(snapshot.lock, path)) continue;
    const hasReference = store
      .getQuads(null, null, null, null)
      .some(
        (quad) =>
          [quad.subject, quad.predicate, quad.object].some(
            (term) => term.termType === "NamedNode" && term.value === options.oldIri,
          ) ||
          (quad.object.termType === "Literal" && quad.object.datatype.value === options.oldIri),
      );
    if (!hasReference) continue;
    const bytes = await writeStore(
      replaceIri(store, options.oldIri, options.newIri),
      extname(path).toLowerCase(),
      snapshot.projectRoot,
      path,
    );
    writes.push({ file: path, bytes });
    proposedFiles[path] = bytes;
  }
  const manifestBytes = await capturedBytes(snapshot.projectRoot, snapshot, "tbspec.toml");
  if (!manifestBytes)
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Project configuration is unavailable.",
      "tbspec.toml",
    );
  const originalManifest = manifestBytes.toString("utf8");
  const changedManifest = editManifestIri(originalManifest, options.oldIri, options.newIri);
  if (changedManifest !== originalManifest) {
    const bytes = Buffer.from(changedManifest);
    writes.push({ file: "tbspec.toml", bytes });
    proposedFiles["tbspec.toml"] = bytes;
  }
  for (const read of snapshot.reads)
    if (read.kind === "file" && !Object.hasOwn(proposedFiles, read.path))
      proposedFiles[read.path] =
        (await capturedBytes(snapshot.projectRoot, snapshot, read.path)) ?? null;
  const candidateSnapshot = { ...snapshot, files: proposedFiles };
  const proposed = await inspectSnapshot(snapshot.projectRoot, candidateSnapshot, {
    command: "status",
  });
  await verifyReads(snapshot.projectRoot, snapshot.reads);
  const changedGraphs = writes
    .map(({ file }) => file)
    .filter((file) => rdfFormats[extname(file).toLowerCase()]);
  const impact = compareDiagnosticImpact(baseline.diagnostics, proposed.diagnostics, changedGraphs);
  const basePlan = preparePlan(snapshot, "refactor.iri", writes, {
    oldIri: options.oldIri,
    newIri: options.newIri,
    references: occurrences.filter((item) => item.targetIri === options.oldIri),
  });
  const plan = withPlanImpact(basePlan, {
    arguments: {
      projectValidity: proposed.data?.project?.validity ?? "unchecked",
      validationComplete: proposed.data?.project?.validationComplete ?? false,
    },
    impact: {
      baselineErrors: impact.baselineErrors,
      introducedErrors: impact.introducedErrors,
      worsenedErrors: impact.worsenedErrors,
      skippedChecks: impact.skippedChecks,
      affectedFiles: writes.map(({ file }) => file),
    },
  });
  return {
    root: snapshot.projectRoot,
    plan,
    diagnostics: proposed.diagnostics,
    projectValidity: proposed.data?.project?.validity ?? "unchecked",
    validationComplete: proposed.data?.project?.validationComplete ?? false,
  };
}

export async function publishRepair(
  prepared: PreparedRepair,
  fs: FileSystem = nativeFileSystem,
): Promise<Result> {
  try {
    const diagnostics = await publishPlan(prepared.root, prepared.plan, fs);
    return ok(
      {
        applied: true,
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

export async function refactorIri(options: {
  project?: string;
  cwd?: string;
  oldIri: string;
  newIri: string;
  apply?: boolean;
  acceptedPreview?: string;
}): Promise<Result> {
  try {
    const prepared = await prepareRefactorIri(options);
    if (options.acceptedPreview && options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return {
        ...failure(
          new ProjectError(
            "conflict",
            "PREVIEW_CHANGED",
            "The accepted preview changed; review the current plan.",
          ),
        ),
        data: { applied: false, preview: prepared.plan.preview },
      };
    if (!options.apply)
      return {
        ...ok({ applied: false, preview: prepared.plan.preview }, prepared.diagnostics),
        status: "preview",
      };
    return await publishRepair(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function prepareReferenceRepair(options: {
  project?: string;
  cwd?: string;
  operation: "redirect" | "remove";
  targetIri: string;
  newIri?: string;
  files?: string[];
  all?: boolean;
}): Promise<PreparedRepair> {
  if (!absoluteIri(options.targetIri))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Target must be an absolute IRI.",
    );
  if (options.operation === "redirect" && (!options.newIri || !absoluteIri(options.newIri)))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Redirect target must be an absolute IRI.",
    );
  if (options.operation === "redirect" && options.targetIri === options.newIri)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Old and new IRIs must differ.",
    );
  const all = options.all === true;
  const files = (options.files ?? []).map((file) => portablePath(file));
  if (all === files.length > 0)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Choose --all or one or more --file paths.",
    );
  if (new Set(files).size !== files.length)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "A repair file may be selected only once.",
    );
  const snapshot = await captureRepair(options);
  const selectedFiles = all ? [...snapshot.ownedPaths, "tbspec.toml"].sort(utf8Compare) : files;
  const allowed = new Set([...snapshot.ownedPaths, "tbspec.toml"]);
  for (const file of selectedFiles) {
    await safePath(snapshot.projectRoot, file);
    if (!allowed.has(file))
      throw new ProjectError(
        "invalid_arguments",
        "RESOURCE_MISSING",
        "Repair scope must name an owned graph or tbspec.toml.",
        file,
      );
  }
  const baseline = await inspectSnapshot(snapshot.projectRoot, snapshot, { command: "status" });
  const { occurrences, stores } = await allOccurrences(snapshot);
  for (const file of selectedFiles.filter((path) => rdfFormats[extname(path).toLowerCase()])) {
    try {
      const store = stores.get(file) ?? (await parseCapturedGraph(snapshot, file));
      if (!store) throw new Error("Graph is unavailable.");
      stores.set(file, store);
    } catch {
      throw new ProjectError(
        "invalid",
        "RDF_SYNTAX",
        "Repair the selected malformed graph in source before changing references.",
        file,
      );
    }
  }
  const eligible = managedDangling(baseline.diagnostics, occurrences, stores).filter(
    (item) => item.targetIri === options.targetIri && selectedFiles.includes(item.file),
  );
  if (!eligible.length)
    throw new ProjectError(
      "invalid_arguments",
      "REFERENCE_NOT_DANGLING",
      "The selected scope contains no currently demonstrable managed reference to this target.",
    );
  if (eligible.some((item) => lockedGraph(snapshot.lock, item.file)))
    throw new ProjectError(
      "conflict",
      "LOCKED_RESOURCE",
      "Locked dependency references cannot be repaired.",
    );

  const eligibleKeys = new Set(eligible.map(referenceKey));
  const grouped = new Map<
    string,
    Map<string, { item: ReferenceOccurrence; positions: Set<string> }>
  >();
  for (const item of eligible) {
    if (item.position === "configuration") continue;
    const key = JSON.stringify([item.subject, item.predicate, item.object]);
    const byStatement = grouped.get(item.file) ?? new Map();
    const current = byStatement.get(key) ?? { item, positions: new Set<string>() };
    current.positions.add(item.position);
    byStatement.set(key, current);
    grouped.set(item.file, byStatement);
  }
  const proposedFiles = { ...snapshot.files };
  const writes: { file: string; bytes: Buffer | null }[] = [];
  for (const [file, statements] of grouped) {
    const store = stores.get(file);
    if (!store)
      throw new ProjectError("invalid", "RDF_SYNTAX", "Selected graph is unavailable.", file);
    const output = new Store();
    const records = [...statements.values()];
    for (const quad of store) {
      const record = records.find(
        (candidate) =>
          sameTerm(candidate.item.subject, rdfTerm(quad.subject, file)) &&
          sameTerm(candidate.item.predicate, rdfTerm(quad.predicate, file)) &&
          sameTerm(candidate.item.object, rdfTerm(quad.object, file)),
      );
      if (record && options.operation === "remove") continue;
      if (record && options.operation === "redirect") {
        output.addQuad(
          DataFactory.quad(
            record.positions.has("subject") &&
              quad.subject.termType === "NamedNode" &&
              quad.subject.value === options.targetIri
              ? DataFactory.namedNode(options.newIri as string)
              : quad.subject,
            record.positions.has("predicate") && quad.predicate.value === options.targetIri
              ? DataFactory.namedNode(options.newIri as string)
              : quad.predicate,
            record.positions.has("object") &&
              quad.object.termType === "NamedNode" &&
              quad.object.value === options.targetIri
              ? DataFactory.namedNode(options.newIri as string)
              : record.positions.has("object") &&
                  quad.object.termType === "Literal" &&
                  quad.object.datatype.value === options.targetIri
                ? quad.object.language
                  ? (() => {
                      throw new ProjectError(
                        "invalid",
                        "RDF_REPAIR_UNREPRESENTABLE",
                        "A language-tagged literal's rdf:langString datatype cannot be redirected while preserving its language tag.",
                        file,
                      );
                    })()
                  : DataFactory.literal(
                      quad.object.value,
                      DataFactory.namedNode(options.newIri as string),
                    )
                : quad.object,
          ),
        );
      } else output.addQuad(quad);
    }
    const bytes = await writeStore(output, extname(file).toLowerCase(), snapshot.projectRoot, file);
    writes.push({ file, bytes });
    proposedFiles[file] = bytes;
  }
  const config = eligible.filter((item) => item.position === "configuration");
  if (config.length) {
    const everyConfigTargetOccurrenceIsEligible = occurrences
      .filter((item) => item.file === "tbspec.toml" && item.targetIri === options.targetIri)
      .every((item) => eligibleKeys.has(referenceKey(item)));
    if (!everyConfigTargetOccurrenceIsEligible)
      throw new ProjectError(
        "conflict",
        "REPAIR_CONFIG_SCOPE",
        "Configuration contains unreviewed occurrences of this IRI; repair those exact fields separately.",
        "tbspec.toml",
      );
    const text = (await capturedBytes(snapshot.projectRoot, snapshot, "tbspec.toml"))?.toString(
      "utf8",
    );
    if (text === undefined)
      throw new ProjectError(
        "invalid",
        "MANIFEST_INVALID",
        "Project configuration is unavailable.",
        "tbspec.toml",
      );
    let changed = text;
    if (options.operation === "redirect") {
      changed = editManifestIri(text, options.targetIri, options.newIri as string);
    } else {
      const tables = new Set(config.map((item) => item.configurationPath?.split(".")[0] ?? ""));
      if (
        tables.size !== 1 ||
        !["ontology_choices", "design_choices"].includes([...tables][0] ?? "")
      )
        throw new ProjectError(
          "invalid",
          "REPAIR_CONFIG_UNSUPPORTED",
          "The selected configuration reference is not a safely removable IRI-keyed choice.",
          "tbspec.toml",
        );
      changed = removeManifestIriChoice(
        text,
        [...tables][0] as "ontology_choices" | "design_choices",
        options.targetIri,
      );
    }
    const bytes = Buffer.from(changed);
    writes.push({ file: "tbspec.toml", bytes });
    proposedFiles["tbspec.toml"] = bytes;
  }
  for (const read of snapshot.reads)
    if (read.kind === "file" && !Object.hasOwn(proposedFiles, read.path))
      proposedFiles[read.path] =
        (await capturedBytes(snapshot.projectRoot, snapshot, read.path)) ?? null;
  const candidateSnapshot = { ...snapshot, files: proposedFiles };
  const proposed = await inspectSnapshot(snapshot.projectRoot, candidateSnapshot, {
    command: "status",
  });
  if (options.operation === "redirect") {
    const blocked = proposed.diagnostics.find((diagnostic) => {
      const identity = diagnostic.details?.identity as Record<string, unknown> | undefined;
      const term = termValue(identity?.term);
      return (
        (diagnostic.code === "VOCABULARY_UNKNOWN" && term === options.newIri) ||
        (diagnostic.code === "ASSOCIATION_BROKEN" && identity?.target === options.newIri) ||
        (diagnostic.code === "ONTOLOGY_CONFLICT" &&
          termValue(identity?.iri) === options.newIri &&
          diagnostic.message.includes(
            "Configured ontology choice has no matching dependency candidate.",
          ))
      );
    });
    if (blocked)
      throw new ProjectError(
        "invalid",
        "REDIRECT_TARGET_UNAVAILABLE",
        "Redirect target is not available in the required managed position.",
        blocked.file,
      );
  }
  await verifyReads(snapshot.projectRoot, snapshot.reads);
  const changedGraphs = writes
    .map(({ file }) => file)
    .filter((file) => rdfFormats[extname(file).toLowerCase()]);
  const impact = compareDiagnosticImpact(baseline.diagnostics, proposed.diagnostics, changedGraphs);
  const plan = withPlanImpact(
    preparePlan(snapshot, `references.${options.operation}`, writes, {
      targetIri: options.targetIri,
      newIri: options.newIri ?? null,
      scope: all ? "all" : "selected",
      files: selectedFiles,
      references: eligible,
    }),
    {
      arguments: {
        projectValidity: proposed.data?.project?.validity ?? "unchecked",
        validationComplete: proposed.data?.project?.validationComplete ?? false,
      },
      impact: {
        baselineErrors: impact.baselineErrors,
        introducedErrors: impact.introducedErrors,
        worsenedErrors: impact.worsenedErrors,
        skippedChecks: impact.skippedChecks,
        affectedFiles: writes.map(({ file }) => file),
      },
    },
  );
  return {
    root: snapshot.projectRoot,
    plan,
    diagnostics: proposed.diagnostics,
    projectValidity: proposed.data?.project?.validity ?? "unchecked",
    validationComplete: proposed.data?.project?.validationComplete ?? false,
  };
}

export async function referencesRepair(options: {
  project?: string;
  cwd?: string;
  operation: "redirect" | "remove";
  targetIri: string;
  newIri?: string;
  files?: string[];
  all?: boolean;
  apply?: boolean;
  acceptedPreview?: string;
}): Promise<Result> {
  try {
    const prepared = await prepareReferenceRepair(options);
    if (options.acceptedPreview && options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return {
        ...failure(
          new ProjectError(
            "conflict",
            "PREVIEW_CHANGED",
            "The accepted preview changed; review the current plan.",
          ),
        ),
        data: { applied: false, preview: prepared.plan.preview },
      };
    if (!options.apply)
      return {
        ...ok({ applied: false, preview: prepared.plan.preview }, prepared.diagnostics),
        status: "preview",
      };
    return await publishRepair(prepared);
  } catch (error) {
    return failure(error);
  }
}

export function redirectReferences(
  options: Omit<Parameters<typeof referencesRepair>[0], "operation">,
) {
  return referencesRepair({ ...options, operation: "redirect" });
}

export function removeReferences(
  options: Omit<Parameters<typeof referencesRepair>[0], "operation" | "newIri">,
) {
  return referencesRepair({ ...options, operation: "remove" });
}

export interface SupportCandidate extends Record<string, unknown> {
  resource: string;
  file: string;
  files: string[];
  role: "shacl" | "view";
  sources: string[];
  reasons: string[];
}

export async function prepareGarbageCollection(options: {
  project?: string;
  cwd?: string;
  resources?: string[];
  all?: boolean;
}): Promise<PreparedRepair & { candidates: SupportCandidate[] }> {
  const all = options.all === true;
  const requested = (options.resources ?? []).map((path) => portablePath(path));
  if (all && requested.length > 0)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Choose --all or one or more --resource paths.",
    );
  if (new Set(requested).size !== requested.length)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "A resource candidate may be named only once.",
    );
  const snapshot = await captureRepair(options);
  const status = await inspectSnapshot(snapshot.projectRoot, snapshot, { command: "status" });
  const inventory = await inspectSnapshot(snapshot.projectRoot, snapshot, {
    command: "graph.list",
  });
  const resources = inventory.data?.items ?? [];
  const knownSelectors = new Set(resources.map((resource) => resource.selector));
  const knownGraphIris = new Set(
    resources.flatMap((resource) => (resource.graphIri ? [resource.graphIri] : [])),
  );
  const sourceExists = (selector: string) => {
    if (selector.startsWith("dep:")) {
      const selectorPath = selector.slice("dep:".length);
      const separator = selectorPath.indexOf("/");
      const id = separator < 0 ? selectorPath : selectorPath.slice(0, separator);
      const file = separator < 0 ? undefined : selectorPath.slice(separator + 1);
      const dependency = snapshot.lock.dependencies[id];
      if (!dependency) return false;
      return file === undefined
        ? Boolean(dependency.primary)
        : file.length > 0 && dependency.files.some((candidate) => candidate.key === file);
    }
    if (knownSelectors.has(selector) || snapshot.ownedPaths.includes(selector)) return true;
    if (absoluteIri(selector) && knownGraphIris.has(selector)) return true;
    for (const dependency of Object.values(snapshot.lock.dependencies))
      if (dependency.files.some((file) => file.graph_iri === selector)) return true;
    return false;
  };
  const hasExistingAssociation = (support: string) =>
    ((snapshot.manifest.associations ?? []) as Row[]).some(
      (association) =>
        association.support === support &&
        typeof association.resource === "string" &&
        sourceExists(association.resource),
    );
  const candidates = new Map<string, SupportCandidate>();
  const add = (
    file: string,
    source: string,
    reason: string,
    role: SupportCandidate["role"],
    files = [file],
  ) => {
    if (!snapshot.ownedPaths.includes(file)) return;
    if (resources.some((resource) => resource.file === file && resource.kind === "design")) return;
    const current = candidates.get(file) ?? {
      resource: file,
      file,
      files,
      role,
      sources: [],
      reasons: [],
    };
    if (!current.sources.includes(source)) current.sources.push(source);
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    current.files = [...new Set([...current.files, ...files])].sort(utf8Compare);
    candidates.set(file, current);
  };
  for (const association of (snapshot.manifest.associations ?? []) as Row[]) {
    if (
      association.role !== "shacl" ||
      typeof association.support !== "string" ||
      typeof association.resource !== "string"
    )
      continue;
    const support = association.support;
    if (!snapshot.ownedPaths.includes(support) || sourceExists(association.resource)) continue;
    if (hasExistingAssociation(support)) continue;
    if (
      (snapshot.manifest.associations as Row[]).some(
        (other) => other.support === support && other.role === "design",
      )
    )
      continue;
    const supportKind = resources.find((resource) => resource.file === support)?.kind;
    if (supportKind !== "shapes" && supportKind !== "unclassified") continue;
    add(support, association.resource, "manual-association-source-missing", "shacl");
  }
  for (const path of snapshot.ownedPaths.filter((candidate) => /\.shacl\.ttl$/i.test(candidate))) {
    const source = path.replace(/\.shacl\.ttl$/i, ".ttl");
    const kind = resources.find((resource) => resource.file === path)?.kind;
    if (
      !snapshot.ownedPaths.includes(source) &&
      !sourceExists(source) &&
      !hasExistingAssociation(path) &&
      ["shapes", "unclassified"].includes(kind ?? "")
    )
      add(path, source, "convention-source-missing", "shacl");
  }
  for (const row of (snapshot.manifest.views ?? []) as Row[]) {
    if (
      typeof row.view !== "string" ||
      typeof row.presentation !== "string" ||
      typeof row.source !== "string"
    )
      continue;
    if (sourceExists(row.source)) continue;
    const view = resources.find((resource) => resource.file === row.view);
    const presentation = resources.find((resource) => resource.file === row.presentation);
    if (view?.kind !== "view" || presentation?.kind !== "presentation") continue;
    add(row.view, row.source, "view-source-missing", "view", [row.view, row.presentation]);
  }
  const available = [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      sources: candidate.sources.sort(utf8Compare),
      reasons: candidate.reasons.sort(utf8Compare),
    }))
    .sort((left, right) => utf8Compare(left.resource, right.resource));
  for (const path of requested)
    if (![...candidates.values()].some((candidate) => candidate.files.includes(path)))
      throw new ProjectError(
        "invalid_arguments",
        "GC_CANDIDATE_INELIGIBLE",
        "Selected file is not orphaned project-owned SHACL support.",
        path,
      );
  const selected =
    all || requested.length === 0
      ? available
      : [
          ...new Map(
            requested.map((path) => {
              const candidate = available.find((entry) => entry.files.includes(path));
              return [candidate?.file ?? path, candidate] as const;
            }),
          ).values(),
        ].filter((item): item is SupportCandidate => item !== undefined);
  const manifestBytes = await capturedBytes(snapshot.projectRoot, snapshot, "tbspec.toml");
  if (!manifestBytes)
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Project configuration is unavailable.",
      "tbspec.toml",
    );
  const beforeManifest = manifestBytes.toString("utf8");
  let afterManifest = removeManifestSupportAssociations(
    beforeManifest,
    selected.filter((candidate) => candidate.role === "shacl").map((candidate) => candidate.file),
  );
  for (const candidate of selected.filter((item) => item.role === "view")) {
    const manifest = parseManifest(afterManifest);
    const row = ((manifest.views ?? []) as Row[]).find((item) => item.view === candidate.file);
    if (!row)
      throw new ProjectError(
        "invalid",
        "MANIFEST_INVALID",
        "Cannot locate the selected orphaned view association.",
        "tbspec.toml",
      );
    afterManifest = editManifestView(afterManifest, row, true);
  }
  const writes: { file: string; bytes: null | Buffer }[] = [
    ...new Set(selected.flatMap((candidate) => candidate.files)),
  ]
    .sort(utf8Compare)
    .map((file) => ({ file, bytes: null }));
  for (const file of writes.map((write) => write.file))
    if (!(await capturedBytes(snapshot.projectRoot, snapshot, file)))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "A selected support candidate is no longer present.",
        file,
      );
  const deletedFiles = new Set(writes.map((write) => write.file));
  const proposedFiles = Object.fromEntries(
    Object.entries(snapshot.files).filter(([path]) => !deletedFiles.has(path)),
  );
  if (afterManifest !== beforeManifest) {
    const bytes = Buffer.from(afterManifest);
    writes.push({ file: "tbspec.toml", bytes });
    proposedFiles["tbspec.toml"] = bytes;
  }
  for (const read of snapshot.reads)
    if (
      read.kind === "file" &&
      !deletedFiles.has(read.path) &&
      !Object.hasOwn(proposedFiles, read.path)
    )
      proposedFiles[read.path] =
        (await capturedBytes(snapshot.projectRoot, snapshot, read.path)) ?? null;
  const proposed = await inspectSnapshot(
    snapshot.projectRoot,
    {
      ...snapshot,
      ownedPaths: snapshot.ownedPaths.filter((path) => !deletedFiles.has(path)),
      reads: snapshot.reads.filter((read) => read.kind !== "file" || !deletedFiles.has(read.path)),
      files: proposedFiles,
    },
    { command: "status" },
  );
  await verifyReads(snapshot.projectRoot, snapshot.reads);
  const impact = compareDiagnosticImpact(status.diagnostics, proposed.diagnostics, []);
  const plan = withPlanImpact(
    preparePlan(snapshot, "gc", writes, {
      scope: all ? "all" : "selected",
      candidates: selected,
      resources: selected.map((candidate) => candidate.resource),
    }),
    {
      arguments: {
        projectValidity: proposed.data?.project?.validity ?? "unchecked",
        validationComplete: proposed.data?.project?.validationComplete ?? false,
      },
      impact: {
        baselineErrors: impact.baselineErrors,
        introducedErrors: impact.introducedErrors,
        worsenedErrors: impact.worsenedErrors,
        skippedChecks: impact.skippedChecks,
        affectedFiles: writes.map(({ file }) => file),
        acceptance: ["confirm"],
      },
    },
  );
  return {
    root: snapshot.projectRoot,
    plan,
    diagnostics: proposed.diagnostics,
    projectValidity: proposed.data?.project?.validity ?? "unchecked",
    validationComplete: proposed.data?.project?.validationComplete ?? false,
    candidates: selected,
  };
}

export async function collectGarbage(options: {
  project?: string;
  cwd?: string;
  resources?: string[];
  all?: boolean;
  apply?: boolean;
  confirm?: boolean;
  acceptedPreview?: string;
}): Promise<Result> {
  try {
    if (options.confirm && !options.apply)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--confirm requires --apply.",
      );
    if (options.apply && !options.confirm)
      throw new ProjectError(
        "invalid_arguments",
        "GC_CONFIRM_REQUIRED",
        "GC application requires both --apply and --confirm.",
      );
    if (options.apply && options.all !== true && !options.resources?.length)
      throw new ProjectError(
        "invalid_arguments",
        "GC_SCOPE_REQUIRED",
        "GC application requires explicit --resource paths or --all.",
      );
    const prepared = await prepareGarbageCollection(options);
    if (options.apply && !prepared.candidates.length)
      throw new ProjectError(
        "invalid_arguments",
        "GC_CANDIDATE_EMPTY",
        "No orphaned support candidates are available to collect.",
      );
    if (options.acceptedPreview && options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return {
        ...failure(
          new ProjectError(
            "conflict",
            "PREVIEW_CHANGED",
            "The accepted preview changed; review the current plan.",
          ),
        ),
        data: { applied: false, preview: prepared.plan.preview },
      };
    if (!options.apply)
      return {
        ...ok(
          { applied: false, candidates: prepared.candidates, preview: prepared.plan.preview },
          prepared.diagnostics,
        ),
        status: "preview",
      };
    return await publishRepair(prepared);
  } catch (error) {
    return failure(error);
  }
}

async function captureRepair(options: { project?: string; cwd?: string }): Promise<CapturedRepair> {
  const root = await discoverProject(options);
  const snapshot = await captureInspection(root, "status");
  const manifest = parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  return { ...snapshot, manifest, lock, stores: new Map() };
}

function componentOccurrences(
  file: string,
  selector: string | undefined,
  store: Store,
): ReferenceOccurrence[] {
  const occurrences: ReferenceOccurrence[] = [];
  for (const statement of store) {
    const subject = rdfTerm(statement.subject, selector ?? file);
    const predicate = rdfTerm(statement.predicate, selector ?? file);
    const object = rdfTerm(statement.object, selector ?? file);
    if (statement.subject.termType === "NamedNode")
      occurrences.push({
        file,
        ...(selector ? { selector } : {}),
        position: "subject",
        targetIri: statement.subject.value,
        subject,
        predicate,
        object,
      });
    occurrences.push({
      file,
      ...(selector ? { selector } : {}),
      position: "predicate",
      targetIri: statement.predicate.value,
      subject,
      predicate,
      object,
    });
    if (statement.object.termType === "NamedNode")
      occurrences.push({
        file,
        ...(selector ? { selector } : {}),
        position: "object",
        targetIri: statement.object.value,
        subject,
        predicate,
        object,
      });
    else if (statement.object.termType === "Literal")
      occurrences.push({
        file,
        ...(selector ? { selector } : {}),
        position: "object",
        targetIri: statement.object.datatype.value,
        subject,
        predicate,
        object,
      });
  }
  return occurrences;
}

function configurationOccurrences(value: unknown, file: string, path = ""): ReferenceOccurrence[] {
  const found: ReferenceOccurrence[] = [];
  if (typeof value === "string") {
    if (absoluteIri(value))
      found.push({
        file,
        position: "configuration",
        targetIri: value,
        ...(path ? { configurationPath: path } : {}),
      });
    return found;
  }
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      configurationOccurrences(item, file, `${path}[${index}]`),
    );
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (absoluteIri(key))
      found.push({ file, position: "configuration", targetIri: key, configurationPath: childPath });
    found.push(...configurationOccurrences(child, file, childPath));
  }
  return found;
}

async function allOccurrences(snapshot: CapturedRepair) {
  const occurrences: ReferenceOccurrence[] = [];
  const stores = new Map<string, Store>();
  const unavailable: { file: string; message: string }[] = [];
  const paths = snapshot.reads
    .filter((read) => read.kind === "file" && rdfFormats[extname(read.path).toLowerCase()])
    .map((read) => read.path)
    .sort(utf8Compare);
  for (const path of paths) {
    try {
      const store = await parseCapturedGraph(snapshot, path);
      if (!store) continue;
      stores.set(path, store);
      snapshot.stores.set(path, store);
      occurrences.push(
        ...componentOccurrences(path, lockedGraph(snapshot.lock, path)?.selector, store),
      );
    } catch (error) {
      if (error instanceof ProjectError && error.status === "conflict") throw error;
      unavailable.push({
        file: path,
        message: error instanceof Error ? error.message : "Graph parsing failed.",
      });
    }
  }
  occurrences.push(...configurationOccurrences(snapshot.manifest, "tbspec.toml"));
  occurrences.push(...configurationOccurrences(snapshot.lock, "tbspec.lock"));
  occurrences.sort(
    (a, b) =>
      utf8Compare(a.file, b.file) ||
      utf8Compare(a.selector ?? "", b.selector ?? "") ||
      utf8Compare(a.configurationPath ?? "", b.configurationPath ?? "") ||
      utf8Compare(a.targetIri, b.targetIri) ||
      utf8Compare(a.position, b.position) ||
      utf8Compare(
        JSON.stringify([a.subject, a.predicate, a.object]),
        JSON.stringify([b.subject, b.predicate, b.object]),
      ),
  );
  return { occurrences, stores, unavailable };
}

function termValue(term: unknown): string | undefined {
  if (!term || typeof term !== "object") return undefined;
  const value = term as Record<string, unknown>;
  return value.kind === "iri" && typeof value.value === "string" ? value.value : undefined;
}

type ReferenceTerm = {
  kind: "iri" | "blank" | "literal";
  value: string;
  scope?: string;
};

function referenceTerm(term: unknown): ReferenceTerm | undefined {
  if (!term || typeof term !== "object") return undefined;
  const value = term as Record<string, unknown>;
  if (
    (value.kind === "iri" || value.kind === "blank" || value.kind === "literal") &&
    typeof value.value === "string"
  )
    return {
      kind: value.kind,
      value: value.value,
      ...(typeof value.scope === "string" ? { scope: value.scope } : {}),
    };
  return undefined;
}

function sameTerm(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function referenceKey(item: ReferenceOccurrence) {
  return JSON.stringify([
    item.file,
    item.selector ?? "",
    item.configurationPath ?? "",
    item.position,
    item.targetIri,
    item.subject,
    item.predicate,
    item.object,
  ]);
}

function pushOccurrence(target: ReferenceOccurrence[], source: ReferenceOccurrence | undefined) {
  if (source && !target.some((item) => referenceKey(item) === referenceKey(source)))
    target.push(source);
}

function managedDangling(
  diagnostics: Result<InspectionData>["diagnostics"],
  occurrences: ReferenceOccurrence[],
  stores: Map<string, Store>,
): ReferenceOccurrence[] {
  const found: ReferenceOccurrence[] = [];
  const graphRoot = (file: string, store: Store) => {
    try {
      return classifyGraph(store, file).graphIri;
    } catch {
      return undefined;
    }
  };
  const occurrenceFor = (file: string, predicate: string, target: string, subject?: string) =>
    occurrences.find(
      (item) =>
        item.file === file &&
        item.position === "object" &&
        item.object?.kind === "iri" &&
        item.targetIri === target &&
        item.predicate?.value === predicate &&
        (subject === undefined || item.subject?.value === subject),
    );
  for (const diagnostic of diagnostics) {
    const identity = diagnostic.details?.identity as Record<string, unknown> | undefined;
    if (!identity) continue;
    if (identity.kind === "term" && diagnostic.code === "VOCABULARY_UNKNOWN") {
      const target = termValue(identity.term);
      const vocabularyPosition = identity.position;
      const store = diagnostic.file ? stores.get(diagnostic.file) : undefined;
      if (
        !target ||
        !store ||
        !["predicate", "type", "datatype"].includes(String(vocabularyPosition))
      )
        continue;
      const position = vocabularyPosition === "predicate" ? "predicate" : "object";
      for (const statement of store) {
        const matchingUse = vocabularyUses(statement).some(
          (use) =>
            use.term.termType !== "BlankNode" &&
            use.term.value === target &&
            use.position === vocabularyPosition,
        );
        if (!matchingUse) continue;
        pushOccurrence(
          found,
          occurrences.find(
            (item) =>
              item.file === diagnostic.file &&
              item.position === position &&
              item.targetIri === target &&
              sameTerm(
                item.subject,
                rdfTerm(statement.subject, item.selector ?? diagnostic.file ?? ""),
              ) &&
              sameTerm(
                item.predicate,
                rdfTerm(statement.predicate, item.selector ?? diagnostic.file ?? ""),
              ) &&
              sameTerm(
                item.object,
                rdfTerm(statement.object, item.selector ?? diagnostic.file ?? ""),
              ),
          ),
        );
      }
      continue;
    }
    if (identity.kind === "association" && diagnostic.code === "ASSOCIATION_BROKEN") {
      const target = typeof identity.target === "string" ? identity.target : undefined;
      if (!target || !absoluteIri(target)) continue;
      const owner = typeof identity.owner === "string" ? identity.owner : undefined;
      const role = typeof identity.role === "string" ? identity.role : "";
      const predicates = absoluteIri(role)
        ? [role]
        : role === "ontology"
          ? [imports]
          : role === "schema"
            ? [metadata + "schema"]
            : role === "shacl"
              ? [metadata + "shapes"]
              : role === "design"
                ? [metadata + "design"]
                : [];
      if (!owner || !predicates.length) continue;
      for (const item of occurrences) {
        if (
          item.targetIri !== target ||
          item.position !== "object" ||
          item.object?.kind !== "iri" ||
          item.subject?.value !== owner ||
          typeof item.predicate?.value !== "string" ||
          !predicates.includes(item.predicate.value)
        )
          continue;
        const store = stores.get(item.file);
        if (!store) continue;
        if (absoluteIri(owner)) {
          if (graphRoot(item.file, store) !== owner) continue;
        } else if (item.file !== owner && item.selector !== owner) continue;
        pushOccurrence(found, item);
      }
      continue;
    }
    if (
      identity.kind === "collision" &&
      diagnostic.code === "ONTOLOGY_CONFLICT" &&
      diagnostic.message === "Configured ontology choice has no matching dependency candidate."
    ) {
      const target = termValue(identity.iri);
      if (!target) continue;
      for (const item of occurrences)
        if (
          item.file === "tbspec.toml" &&
          item.position === "configuration" &&
          item.targetIri === target &&
          item.configurationPath?.startsWith("ontology_choices.")
        )
          pushOccurrence(found, item);
      continue;
    }
    if (identity.kind === "statement") {
      const file = diagnostic.file;
      if (!file) continue;
      const store = stores.get(file);
      if (!store) continue;
      const subject = referenceTerm(identity.subject);
      const predicate = referenceTerm(identity.predicate);
      const object = referenceTerm(identity.object);
      const subjectIri = subject?.kind === "iri" ? subject.value : undefined;
      const predicateIri = predicate?.kind === "iri" ? predicate.value : undefined;
      const target = object?.kind === "iri" ? object.value : undefined;

      if (
        diagnostic.code === "VIEW_INVALID" &&
        predicateIri === metadata + "member" &&
        subjectIri &&
        target &&
        store.countQuads(subjectIri, predicateIri, target, null)
      ) {
        pushOccurrence(found, occurrenceFor(file, predicateIri, target, subjectIri));
        continue;
      }

      const viewRelationshipFailure =
        diagnostic.code === "VIEW_INVALID" &&
        typeof predicateIri === "string" &&
        predicateIri !== metadata + "member" &&
        typeof subjectIri === "string" &&
        typeof target === "string";
      if (viewRelationshipFailure) {
        const viewRoot = graphRoot(file, store);
        if (!viewRoot) continue;
        const sourceIri = store.getObjects(viewRoot, metadata + "sourceGraph", null)[0];
        const source =
          sourceIri?.termType === "NamedNode"
            ? [...stores].find(
                ([sourceFile, sourceStore]) =>
                  graphRoot(sourceFile, sourceStore) === sourceIri.value,
              )
            : undefined;
        if (!source) continue;
        const sourceStore = source[1];
        const tuple = { subject: subjectIri, predicate: predicateIri, object: target };
        const endpointMissing = (iri: string) =>
          !sourceStore.countQuads(iri, null, null, null) &&
          !sourceStore.countQuads(null, null, iri, null);
        const missing = new Set([tuple.subject, tuple.object].filter(endpointMissing));
        if (!missing.size) continue;
        for (const descriptor of store.getObjects(viewRoot, metadata + "relationship", null)) {
          const selected = {
            subject: store.getObjects(descriptor, rdf + "subject", null)[0],
            predicate: store.getObjects(descriptor, rdf + "predicate", null)[0],
            object: store.getObjects(descriptor, rdf + "object", null)[0],
          };
          if (
            selected.subject?.termType !== "NamedNode" ||
            selected.predicate?.termType !== "NamedNode" ||
            selected.object?.termType !== "NamedNode" ||
            selected.subject.value !== tuple.subject ||
            selected.predicate.value !== tuple.predicate ||
            selected.object.value !== tuple.object
          )
            continue;
          for (const field of ["subject", "object"] as const)
            if (missing.has(tuple[field])) {
              const foundOccurrence = occurrences.find(
                (item) =>
                  item.file === file &&
                  item.position === "object" &&
                  item.object?.kind === "iri" &&
                  item.targetIri === tuple[field] &&
                  item.subject?.value === rdfTerm(descriptor, file).value &&
                  item.predicate?.value === rdf + field,
              );
              pushOccurrence(found, foundOccurrence);
            }
        }
        continue;
      }

      if (
        diagnostic.code === "PRESENTATION_INVALID" &&
        predicateIri === metadata + "element" &&
        target
      ) {
        const root = graphRoot(file, store);
        const selectedView = root
          ? store.getObjects(root, metadata + "forView", null)[0]
          : undefined;
        if (selectedView?.termType !== "NamedNode") continue;
        const view = [...stores].find(
          ([viewFile, viewStore]) => graphRoot(viewFile, viewStore) === selectedView.value,
        );
        if (!view) continue;
        const viewRoot = graphRoot(view[0], view[1]);
        if (!viewRoot || view[1].countQuads(viewRoot, metadata + "member", target, null)) continue;
        const record = subject?.kind === "blank" ? subject.value : subject?.value;
        const foundOccurrence = occurrences.find(
          (item) =>
            item.file === file &&
            item.position === "object" &&
            item.object?.kind === "iri" &&
            item.targetIri === target &&
            item.subject?.kind === (subject?.kind ?? "") &&
            item.subject?.value === record &&
            item.predicate?.value === metadata + "element",
        );
        pushOccurrence(found, foundOccurrence);
      }
    }
  }
  return found.sort(
    (a, b) =>
      utf8Compare(a.file, b.file) ||
      utf8Compare(a.targetIri, b.targetIri) ||
      utf8Compare(a.position, b.position),
  );
}

export async function listReferences(options: {
  project?: string;
  cwd?: string;
  target?: string;
  dangling?: boolean;
}): Promise<Result<{ items: ReferenceOccurrence[]; affectedFiles: string[] }>> {
  try {
    if (options.target !== undefined && options.dangling === true)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Choose --target <iri> or --dangling, not both.",
      );
    if (options.target !== undefined && !absoluteIri(options.target))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Target must be an absolute IRI.",
      );
    const snapshot = await captureRepair(options);
    const validation = await inspectSnapshot(snapshot.projectRoot, snapshot, { command: "status" });
    const { occurrences, stores, unavailable } = await allOccurrences(snapshot);
    const items =
      options.dangling === true
        ? managedDangling(validation.diagnostics, occurrences, stores)
        : options.target === undefined
          ? occurrences
          : occurrences.filter((item) => item.targetIri === options.target);
    await verifyReads(snapshot.projectRoot, snapshot.reads);
    const result = ok({
      items,
      affectedFiles: [...new Set(items.map((item) => item.file))].sort(utf8Compare),
    });
    if (unavailable.length) {
      result.status = "invalid";
      result.diagnostics.push(
        ...unavailable.map(({ file, message }) => ({
          code: "REFERENCE_COVERAGE_INCOMPLETE",
          severity: "error" as const,
          message: "Reference listing is partial because this graph could not be parsed.",
          file,
          details: { coverage: "partial", cause: message },
        })),
      );
    }
    return result;
  } catch (error) {
    return failure(error) as Result<{ items: ReferenceOccurrence[]; affectedFiles: string[] }>;
  }
}
