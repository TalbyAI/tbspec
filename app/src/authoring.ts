import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DataFactory, Store, Writer } from "n3";
import { digest, graphSignature } from "./canonical.ts";
import { equalRevision, fileBytes, revision, verifyReads } from "./filesystem.ts";
import { captureInspection, type Resource } from "./inspection.ts";
import { type Diagnostic, failure, hasCode, ok, ProjectError, type Result } from "./output.ts";
import { absoluteIri, portablePath, safePath } from "./paths.ts";
import { discoverProject, projectDiscoveryScope } from "./project.ts";
import { classifyGraph, rdfFormats as formats, parseGraph, parseRdf } from "./rdf.ts";
import { type ModelType, parseLock, parseManifest, selector } from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { prepareSupport } from "./support.ts";
import { type Plan, preparePlan, publishPlan } from "./transactions.ts";

export interface AuthoringOptions {
  project?: string;
  cwd?: string;
  command:
    | "ontology.create"
    | "ontology.import"
    | "model.create"
    | "model.import"
    | "shapes.create"
    | "model.schema.add"
    | "model.schema.remove";
  path: string;
  iri?: string;
  type?: string;
  profile?: "conceptual" | "concrete";
  schemas?: string[];
  source?: string;
  acceptedPreview?: string;
  confirm?: boolean;
}
export interface PreparedResource {
  root: string;
  plan: Plan;
  resource: Resource;
  diagnostics: Diagnostic[];
  externalSource?: { path: string; digest: string };
  validation?: { validity: "valid" | "invalid"; validationComplete: boolean };
}
const { namedNode, literal, quad } = DataFactory;
const metadata = "https://talby.ai/ontology/tbspec#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const owlOntology = "http://www.w3.org/2002/07/owl#Ontology";
const modelDeclarations: Record<string, string> = {
  model: "Model",
  "conceptual-data-model": "ConceptualDataModel",
  "concrete-data-model": "ConcreteDataModel",
  "process-model": "ProcessModel",
  "state-machine-model": "StateMachineModel",
};
const builtInTypes: Record<string, { kinds: string[]; businessType?: string }> = {
  data: { kinds: ["conceptual-data-model", "concrete-data-model"] },
  process: { kinds: ["process-model"], businessType: "http://purl.org/net/p-plan#Plan" },
  "state-machine": {
    kinds: ["state-machine-model"],
    businessType: "https://talby.ai/ontology/state-machine#StateMachine",
  },
};

export async function prepareResource(options: AuthoringOptions): Promise<PreparedResource> {
  if (options.command === "shapes.create" || options.command.startsWith("model.schema."))
    return prepareSupport(options);
  const root = await discoverProject(options);
  const path = portablePath(options.path);
  if (
    !path.endsWith(".ttl") ||
    path.startsWith(".tbspec/") ||
    projectDiscoveryScope.excluded.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "PATH_UNSAFE",
      "Owned resources require a discoverable .ttl path outside internal directories.",
      path,
    );
  await safePath(root, path, true);
  try {
    await lstat(await safePath(root, path, true));
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Destination is occupied; existing content was preserved.",
      path,
    );
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const graphs = new Map<
    string,
    {
      kind: string;
      graphIri: string;
      file: string;
      context?: string;
      signature: string;
    }
  >();
  const snapshot = await captureInspection(
    root,
    "graph.list",
    undefined,
    [path],
    async (file, bytes) => {
      if (file === path) return;
      const store = await parseOwned(file, bytes);
      graphs.set(file, {
        ...classifyGraph(store, file),
        file,
        signature: graphSignature({
          byte_digest: digest(bytes),
          media_type: formats[extname(file).toLowerCase()] ?? "text/turtle",
          base_iri: pathToFileURL(await safePath(root, file)).href,
          parser_profile:
            extname(file).toLowerCase() === ".ttl"
              ? "turtle-strict-v1"
              : extname(file).toLowerCase() === ".nt"
                ? "ntriples-strict-v1"
                : "rdfxml-no-dtd-v1",
        }),
      });
    },
  );
  if (snapshot.files[path] !== null)
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Destination is occupied; existing content was preserved.",
      path,
    );
  const manifest = parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const iri =
    options.iri ??
    (manifest.base_iri
      ? `${manifest.base_iri}${encodeURIComponent(basename(path, ".ttl"))}`
      : undefined);
  if (!absoluteIri(iri))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Supply an absolute --iri or configure base_iri.",
    );
  const bundle = await loadStarters();
  for (const [id, dep] of Object.entries(lock.dependencies))
    for (const record of dep.files)
      graphs.set(`dep:${id}/${record.key}`, {
        kind: record.kind,
        graphIri: record.graph_iri,
        file: `${dep.snapshot_path}/${record.key}`,
        signature: record.graph_signature,
        context: record.context,
      });
  for (const graph of graphs.values())
    if (graph.graphIri === iri)
      throw new ProjectError(
        "conflict",
        "GRAPH_IRI_COLLISION",
        "Graph identity already exists.",
        graph.file,
      );
  async function parseOwned(file: string, bytes: Buffer) {
    try {
      return await parseRdf(
        bytes,
        formats[extname(file).toLowerCase()] ?? "text/turtle",
        pathToFileURL(await safePath(root, file)).href,
      );
    } catch (error) {
      if (error instanceof ProjectError) throw error;
      throw new ProjectError(
        "invalid",
        "RDF_SYNTAX",
        "Cannot parse a graph required for identity checks.",
        file,
      );
    }
  }
  async function readGraph(file: string) {
    const bytes = await fileBytes(root, file);
    const before = snapshot.reads.find((read) => read.kind === "file" && read.path === file);
    const current = revision(bytes);
    if (before && !equalRevision(before.revision, current))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Graph changed after identity capture.",
        file,
      );
    if (!before) snapshot.reads.push({ kind: "file", path: file, revision: current });
    if (!bytes)
      throw new ProjectError("invalid", "RESOURCE_MISSING", "Required graph is missing.", file);
    return bytes;
  }
  async function resolveGraph(value: string) {
    const selected = selector(value.startsWith("dep:") ? value : portablePath(value));
    const expanded =
      selected.startsWith("dep:") && !selected.includes("/")
        ? `${selected}/${lock.dependencies[selected.slice(4)]?.primary ?? ""}`
        : selected;
    const graph = graphs.get(expanded);
    if (!graph)
      throw new ProjectError(
        "invalid",
        "ASSOCIATION_BROKEN",
        "Selected resource is missing.",
        selected,
      );
    const bytes = await readGraph(graph.file);
    const [id, ...key] = expanded.slice(4).split("/");
    const record = expanded.startsWith("dep:")
      ? lock.dependencies[id ?? ""]?.files.find((record) => record.key === key.join("/"))
      : undefined;
    const store = record
      ? await parseGraph(bytes, record, bundle.vettedDigest)
      : await parseOwned(graph.file, bytes);
    return { ...graph, store, selector: expanded };
  }
  const model = options.command.startsWith("model.");
  const family = Object.hasOwn(builtInTypes, options.type ?? "")
    ? builtInTypes[options.type ?? ""]
    : undefined;
  if (model && !options.type)
    throw new ProjectError(
      "invalid_arguments",
      "MODEL_TYPE_UNUSABLE",
      "Select an enabled receiving model type with --type.",
    );
  if (!model && (options.type || options.profile || options.schemas?.length))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Model options do not apply to ontologies.",
    );
  const importRequested = options.command.endsWith(".import");
  if ((!importRequested && options.source) || (importRequested && !options.source))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Import requires a source selector; create has no source.",
    );
  if (
    options.profile !== undefined &&
    (!model ||
      options.type !== "data" ||
      importRequested ||
      !["conceptual", "concrete"].includes(options.profile))
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--profile applies only to data model creation.",
    );
  let declaration = owlOntology;
  const available = new Store();
  const associations: Resource["associations"] = [];
  if (model) {
    const types = {
      ...lock.starters.model_types,
      ...(manifest.model_types as Record<string, ModelType> | undefined),
    };
    const type = Object.hasOwn(types, options.type ?? "") ? types[options.type ?? ""] : undefined;
    if (!type || type.enabled === false)
      throw new ProjectError(
        "invalid_arguments",
        "MODEL_TYPE_UNUSABLE",
        "The receiving model type is missing or disabled.",
      );
    const ontology = await resolveGraph(type.ontology);
    if (ontology.kind !== "ontology")
      throw new ProjectError(
        "invalid",
        "MODEL_TYPE_UNUSABLE",
        "The selected model-type ontology is not an ontology.",
        ontology.file,
      );
    available.addQuads(ontology.store.getQuads(null, null, null, null));
    associations.push({ role: "ontology", selector: ontology.selector });
    if (type.design) associations.push({ role: "design", selector: type.design });
    // Follow only this ontology's local imports; do not borrow unrelated project vocabulary.
    const sourceChoice = (id: string, iri: string) => {
      const dependency = lock.dependencies[id];
      const context = dependency?.files.find((file) => file.key === dependency.primary)?.context;
      return dependency?.choices.find(
        (choice) =>
          choice.context === context && choice.kind === "ontology" && choice.target_iri === iri,
      );
    };
    const distances = new Map<string, number>();
    for (const [id, dependency] of Object.entries(lock.dependencies)) {
      const queue = [{ key: dependency.primary, distance: 1 }];
      for (const { key, distance } of queue) {
        const selected = `dep:${id}/${key}`;
        if ((distances.get(selected) ?? Infinity) <= distance) continue;
        distances.set(selected, distance);
        const context = dependency.files.find((file) => file.key === key)?.context;
        for (const edge of dependency.edges)
          if (edge.from === key && edge.context === context && typeof edge.to === "string")
            queue.push({ key: edge.to, distance: distance + 1 });
      }
    }
    const visited = new Set<string>();
    const includeImports = async (graph: Awaited<ReturnType<typeof resolveGraph>>) => {
      if (visited.has(graph.selector)) return;
      visited.add(graph.selector);
      const [dependencyId, ...fileKey] = graph.selector.slice(4).split("/");
      const dependency = graph.selector.startsWith("dep:")
        ? lock.dependencies[dependencyId ?? ""]
        : undefined;
      const edges =
        dependency?.edges.filter(
          (edge) =>
            edge.from === fileKey.join("/") &&
            edge.context === graph.context &&
            ["import", "vocabulary"].includes(String(edge.relation)),
        ) ?? [];
      if (edges.some((edge) => edge.target_iri))
        throw new ProjectError(
          "invalid",
          "ASSOCIATION_BROKEN",
          "Recorded vocabulary closure has an unresolved import.",
          graph.file,
        );
      const targets = edges
        .filter((edge) => typeof edge.to === "string")
        .map((edge) => `dep:${dependencyId}/${edge.to}`);
      for (const target of targets ?? []) {
        const linked = await resolveGraph(target);
        if (
          linked.kind !== "ontology" &&
          edges.some(
            (edge) => edge.relation === "import" && target === `dep:${dependencyId}/${edge.to}`,
          )
        )
          throw new ProjectError(
            "invalid",
            "ASSOCIATION_BROKEN",
            "Required ontology import has the wrong kind.",
            linked.file,
          );
        available.addQuads(linked.store.getQuads(null, null, null, null));
        await includeImports(linked);
      }
      // Locked edges define the acquired source closure; raw upstream imports never authorize rebinding.
      if (dependency) return;
      for (const term of graph.store.getObjects(
        graph.graphIri,
        "http://www.w3.org/2002/07/owl#imports",
        null,
      )) {
        let candidates = [...graphs.entries()].filter(
          ([, candidate]) => candidate.kind === "ontology" && candidate.graphIri === term.value,
        );
        const choices = manifest.ontology_choices as Record<string, string> | undefined;
        const winner =
          choices && Object.hasOwn(choices, term.value) ? choices[term.value] : undefined;
        if (winner) {
          const choice = sourceChoice(winner, term.value);
          candidates = candidates.filter(([key]) =>
            choice ? key === `dep:${winner}/${choice.selected}` : key.startsWith(`dep:${winner}/`),
          );
          if (new Set(candidates.map(([, graph]) => graph.signature)).size > 1)
            throw new ProjectError(
              "conflict",
              "GRAPH_IRI_COLLISION",
              "Selected dependency needs an unambiguous recorded source winner.",
              graph.file,
              { target: term.value },
            );
        } else {
          candidates = candidates.filter(([key]) => {
            if (!key.startsWith("dep:")) return true;
            const id = key.slice(4).split("/")[0] ?? "";
            const choice = sourceChoice(id, term.value);
            return !choice || key === `dep:${id}/${choice.selected}`;
          });
          const rank = (key: string) =>
            key.startsWith("dep:") ? (distances.get(key) ?? Infinity) : 0;
          const best = candidates.reduce((best, [key]) => Math.min(best, rank(key)), Infinity);
          candidates = candidates.filter(([key]) => rank(key) === best && best !== Infinity);
        }
        if (!candidates.length)
          throw new ProjectError(
            "invalid",
            "ASSOCIATION_BROKEN",
            "Required ontology import is unavailable.",
            graph.file,
            { target: term.value },
          );
        const candidate = candidates[0];
        if (!candidate) continue;
        if (candidates.some(([, other]) => other.signature !== candidate[1].signature))
          throw new ProjectError(
            "conflict",
            "GRAPH_IRI_COLLISION",
            "Required ontology import is ambiguous.",
            graph.file,
            { target: term.value },
          );
        for (const [key] of candidates) {
          const selected = await resolveGraph(key);
          available.addQuads(selected.store.getQuads(null, null, null, null));
          await includeImports(selected);
        }
      }
    };
    await includeImports(ontology);
    const common = await resolveGraph(lock.starters.common_contract);
    available.addQuads(common.store.getQuads(null, null, null, null));
    await includeImports(common);
    declaration = `${metadata}${modelDeclarations[family?.kinds[options.profile === "concrete" ? 1 : 0] ?? "model"]}`;
  }
  if (
    options.schemas?.length &&
    (importRequested || declaration !== `${metadata}ConcreteDataModel`)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "--schema applies only to concrete data model creation.",
    );
  const diagnostics: Diagnostic[] = [];
  let externalSource: PreparedResource["externalSource"];
  let store = new Store();
  let provenance: Resource["provenance"];
  if (importRequested && options.source) {
    let source: { store: Store; graphIri: string; kind: string; selector: string };
    if (options.source.startsWith("dep:")) source = await resolveGraph(options.source);
    else {
      if (/^https?:/i.test(options.source))
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Acquire remote content as a dependency before editable import.",
        );
      const absolute = resolve(options.cwd ?? root, options.source);
      const local = relative(root, absolute).replaceAll("\\", "/");
      const withinProject =
        local && !local.startsWith("../") && local !== ".." && !/^[A-Za-z]:/.test(local);
      const acquisition = manifest.acquisition as Record<string, number> | undefined;
      const limit = acquisition?.max_graph_bytes ?? 67108864;
      let bytes: Buffer;
      let sourceSelector = options.source;
      if (withinProject) {
        await safePath(root, local);
        if (!graphs.has(local))
          throw new ProjectError(
            "invalid",
            "RESOURCE_MISSING",
            "Import source is not a captured project graph.",
            local,
          );
        bytes = await readGraph(local);
        sourceSelector = local;
      } else {
        const info = await lstat(absolute);
        if (!info.isFile() || info.isSymbolicLink())
          throw new ProjectError(
            "invalid_arguments",
            "PATH_UNSAFE",
            "Local import requires a regular file.",
          );
        if (info.size > limit)
          throw new ProjectError(
            "invalid_arguments",
            "ACQUISITION_LIMIT",
            "Import source exceeds maxGraphBytes.",
            null,
            { maxGraphBytes: limit },
          );
        const actual = await realpath(absolute);
        bytes = await readFile(actual);
        externalSource = { path: actual, digest: digest(bytes) };
        sourceSelector = actual;
      }
      const mediaType = formats[extname(absolute).toLowerCase()];
      if (!mediaType)
        throw new ProjectError(
          "invalid_arguments",
          "RDF_FORMAT_UNSUPPORTED",
          "Import supports Turtle, N-Triples and strict RDF/XML.",
        );
      if (bytes.length > limit)
        throw new ProjectError(
          "invalid_arguments",
          "ACQUISITION_LIMIT",
          "Import source exceeds maxGraphBytes.",
          null,
          { maxGraphBytes: limit },
        );
      try {
        const parsed = await parseRdf(bytes, mediaType, pathToFileURL(absolute).href);
        source = {
          store: parsed,
          ...classifyGraph(parsed, sourceSelector),
          selector: sourceSelector,
        };
      } catch (error) {
        if (error instanceof ProjectError) throw error;
        throw new ProjectError("invalid", "RDF_SYNTAX", "Cannot parse editable import source.");
      }
    }
    if (source.graphIri === iri)
      throw new ProjectError(
        "conflict",
        "GRAPH_IRI_COLLISION",
        "Editable import requires a new graph identity.",
      );
    if (
      source.kind !== "unclassified" &&
      (model ? !source.kind.endsWith("model") : source.kind !== "ontology")
    )
      throw new ProjectError(
        "invalid",
        "GRAPH_CLASSIFICATION",
        "Source kind does not match the requested resource family.",
      );
    if (model && source.kind !== "unclassified") {
      const expected = family?.kinds ?? Object.keys(modelDeclarations);
      if (!expected.includes(source.kind))
        throw new ProjectError(
          "invalid",
          "GRAPH_CLASSIFICATION",
          "Source model kind is incompatible with the receiving type.",
        );
      declaration = `${metadata}${modelDeclarations[source.kind]}`;
    }
    store = new Store(source.store.getQuads(null, null, null, null));
    // Relocate only managed root metadata. Business terms and unknown statements retain their IRIs.
    for (const statement of store.getQuads(source.graphIri, null, null, null)) {
      const managedType =
        statement.predicate.value === rdfType &&
        [
          owlOntology,
          ...Object.values(modelDeclarations).map((kind) => `${metadata}${kind}`),
          `${metadata}DataModel`,
        ].includes(statement.object.value);
      const binding = statement.predicate.value === `${metadata}modelType`;
      const association = ["http://www.w3.org/2002/07/owl#imports", `${metadata}schema`].includes(
        statement.predicate.value,
      );
      if (managedType || binding || association) store.removeQuad(statement);
      if (association) store.addQuad(namedNode(iri), statement.predicate, statement.object);
    }
    store.addQuad(
      namedNode(iri),
      namedNode("http://www.w3.org/ns/prov#wasDerivedFrom"),
      namedNode(source.graphIri),
    );
    store.addQuad(
      namedNode(iri),
      namedNode("http://purl.org/dc/terms/source"),
      literal(source.selector),
    );
    provenance = [{ sourceGraphIri: source.graphIri, sourceSelector: source.selector }];
    for (const [key, graph] of graphs) {
      if (key.startsWith("dep:") || key === source.selector) continue;
      const owned = await parseOwned(graph.file, await readGraph(graph.file));
      const collided = new Set(
        store
          .getQuads(null, rdfType, null, null)
          .filter(
            (q) =>
              q.subject.termType === "NamedNode" &&
              owned.countQuads(q.subject, rdfType, null, null),
          )
          .map((q) => q.subject.value),
      );
      for (const term of collided)
        diagnostics.push({
          code: "TERM_IRI_COLLISION",
          severity: "warning",
          file: path,
          message:
            "Imported term also has a declaration in an existing owned resource; terms were preserved.",
          details: { iri: term, existingSelector: key },
        });
    }
  }
  store.addQuad(quad(namedNode(iri), namedNode(rdfType), namedNode(declaration)));
  if (model)
    store.addQuad(namedNode(iri), namedNode(`${metadata}modelType`), literal(options.type ?? ""));
  const businessType = family?.businessType;
  if (
    businessType &&
    available.countQuads(businessType, rdfType, "http://www.w3.org/2002/07/owl#Class", null)
  )
    store.addQuad(namedNode(iri), namedNode(rdfType), namedNode(businessType));
  for (const schema of new Set(options.schemas ?? [])) {
    const graph = await resolveGraph(schema);
    if (graph.kind !== "conceptual-data-model")
      throw new ProjectError(
        "invalid",
        "ASSOCIATION_BROKEN",
        "Schema must be a conceptual data model.",
        graph.file,
      );
    store.addQuad(namedNode(iri), namedNode(`${metadata}schema`), namedNode(graph.graphIri));
    associations.push({ role: "schema", selector: graph.selector });
  }
  for (const target of store.getObjects(iri, `${metadata}schema`, null)) {
    const candidates = [...graphs.entries()].filter(
      ([, graph]) => graph.graphIri === target.value && graph.kind === "conceptual-data-model",
    );
    if (new Set(candidates.map(([, graph]) => graph.signature)).size > 1)
      throw new ProjectError(
        "conflict",
        "GRAPH_IRI_COLLISION",
        "Conceptual schema identity is ambiguous.",
        path,
        { target: target.value },
      );
    if (!candidates.length)
      diagnostics.push({
        code: "ASSOCIATION_BROKEN",
        severity: "error",
        file: path,
        message: "Imported conceptual schema is unavailable; the association was preserved.",
        details: { target: target.value },
      });
    else
      for (const [key] of candidates) {
        const graph = await resolveGraph(key);
        available.addQuads(graph.store.getQuads(null, null, null, null));
      }
    for (const [key] of candidates)
      if (!associations.some((a) => a.role === "schema" && a.selector === key))
        associations.push({ role: "schema", selector: key });
  }
  if (model && importRequested) {
    available.addQuads(store.getQuads(null, null, null, null));
    const classTypes = [
      "http://www.w3.org/2002/07/owl#Class",
      "http://www.w3.org/2000/01/rdf-schema#Class",
      "http://www.w3.org/2000/01/rdf-schema#Datatype",
    ];
    const propertyTypes = [
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property",
      "http://www.w3.org/2002/07/owl#ObjectProperty",
      "http://www.w3.org/2002/07/owl#DatatypeProperty",
      "http://www.w3.org/2002/07/owl#AnnotationProperty",
      "http://www.w3.org/2002/07/owl#OntologyProperty",
    ];
    const missing = new Map<string, string>();
    for (const statement of store) {
      if (
        !["http://www.w3.org/ns/prov#wasDerivedFrom", "http://purl.org/dc/terms/source"].includes(
          statement.predicate.value,
        ) &&
        !propertyTypes.some((type) =>
          available.countQuads(statement.predicate, rdfType, type, null),
        )
      )
        missing.set(statement.predicate.value, "property");
      if (
        statement.predicate.value === rdfType &&
        statement.object.termType === "NamedNode" &&
        !classTypes.some((type) => available.countQuads(statement.object, rdfType, type, null))
      )
        missing.set(statement.object.value, "class");
    }
    for (const [term, kind] of missing)
      diagnostics.push({
        code: "VOCABULARY_UNKNOWN",
        severity: "error",
        file: path,
        message: `Imported ${kind} <${term}> is absent from the receiving vocabulary and local declarations; its IRI was preserved.`,
        details: { iri: term, kind },
      });
  }
  const text = await new Promise<string>((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads(store.getQuads(null, null, null, null));
    writer.end((error, text) => (error ? reject(error) : resolve(text)));
  });
  await verifyReads(root, snapshot.reads);
  const plan = preparePlan(snapshot, options.command, [{ file: path, bytes: Buffer.from(text) }], {
    path,
    iri,
    type: options.type ?? null,
    profile: options.profile ?? null,
    schemas: options.schemas ?? [],
    source: provenance ?? null,
    sourceByteDigest: externalSource?.digest ?? null,
  });
  const resource: Resource = {
    selector: path,
    file: path,
    ...classifyGraph(store, path),
    ownership: "project",
    revision: revision(Buffer.from(text)),
    associations,
    schemaIris: store
      .getObjects(iri, `${metadata}schema`, null)
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value),
    ...(model ? { modelType: options.type } : {}),
    ...(provenance ? { provenance } : {}),
  };
  return { root, plan, resource, diagnostics, ...(externalSource ? { externalSource } : {}) };
}

export async function publishResource(prepared: PreparedResource): Promise<Result> {
  try {
    const diagnostics = await publishPlan(prepared.root, prepared.plan);
    return ok(
      {
        applied: true,
        resource: prepared.resource,
        changes: prepared.plan.preview.changes,
        projectValidity: prepared.diagnostics.some((d) => d.severity === "error")
          ? "invalid"
          : "unchecked",
        validationComplete: false,
        ...(prepared.validation ? { validation: prepared.validation } : {}),
      },
      [...prepared.diagnostics, ...diagnostics],
    );
  } catch (error) {
    return failure(error);
  }
}
export async function authorResource(options: AuthoringOptions): Promise<Result> {
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
    const prepared = await prepareResource(options);
    if (
      options.acceptedPreview !== undefined &&
      options.acceptedPreview !== prepared.plan.preview.fingerprint
    )
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
    if (prepared.plan.preview.impact.acceptance.includes("confirm") && !options.confirm)
      return {
        ...ok(
          {
            applied: false,
            preview: prepared.plan.preview,
            resource: prepared.resource,
            validation: prepared.validation,
          },
          prepared.diagnostics,
        ),
        status: "preview",
      };
    if (
      prepared.externalSource &&
      digest(await readFile(prepared.externalSource.path)) !== prepared.externalSource.digest
    )
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Import source changed before publication.",
      );
    return await publishResource(prepared);
  } catch (error) {
    return failure(error);
  }
}
