import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { DataFactory, Store, Writer } from "n3";
import type { AuthoringOptions, PreparedResource } from "./authoring.ts";
import { canonical, digest, utf8Compare } from "./canonical.ts";
import { fileBytes, revision, verifyReads } from "./filesystem.ts";
import {
  captureInspection,
  type InspectionCommand,
  type InspectionData,
  inspectSnapshot,
  type Resource,
} from "./inspection.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { portablePath, safePath } from "./paths.ts";
import { discoverProject, projectDiscoveryScope } from "./project.ts";
import { classifyGraph, parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import { parseLock, parseManifest } from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { preparePlan, previewFingerprint } from "./transactions.ts";

const t = "https://talby.ai/ontology/tbspec#";
export async function listSupport(options: {
  project?: string;
  cwd?: string;
  command: InspectionCommand;
  selector?: string;
}): Promise<Result<InspectionData>> {
  try {
    const root = await discoverProject(options);
    const snapshot = await captureInspection(root, "graph.list");
    const listed = await inspectSnapshot(root, snapshot, { command: "graph.list" });
    const items = listed.data?.items ?? [];
    const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    for (const [id, dep] of Object.entries(lock.dependencies))
      for (const file of dep.files)
        if (["shapes", "conceptual-data-model"].includes(file.kind))
          items.push({
            selector: `dep:${id}/${file.key}`,
            file: `${dep.snapshot_path}/${file.key}`,
            graphIri: file.graph_iri,
            identity: file.identity as Resource["identity"],
            kind: file.kind,
            classification: file.classification,
            ownership: "dependency",
            dependencyId: id,
            revision: { state: "absent" },
            associations: [],
          });
    if (!options.selector && options.command === "model.schema.list")
      throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Select a concrete model.");
    let selected = items;
    let sourceResource: Resource | undefined;
    if (options.selector) {
      const path = portablePath(options.selector);
      const source = items.find((r) => r.selector === path);
      sourceResource = source;
      if (
        !source ||
        (options.command === "model.schema.list" && source.kind !== "concrete-data-model")
      )
        throw new ProjectError(
          "invalid",
          "GRAPH_CLASSIFICATION",
          "Source is missing or wrongly classified.",
          path,
        );
      selected =
        options.command === "model.schema.list"
          ? items.filter(
              (r) =>
                source.schemaIris?.includes(r.graphIri ?? "") && r.kind === "conceptual-data-model",
            )
          : items.filter((r) =>
              source.associations.some((a) => a.role === "shacl" && a.selector === r.selector),
            );
    } else selected = items.filter((r) => r.kind === "shapes" || r.file.endsWith(".shacl.ttl"));
    const diagnostics = [...listed.diagnostics];
    for (const iri of options.command === "model.schema.list"
      ? (sourceResource?.schemaIris ?? [])
      : [])
      if (!selected.some((r) => r.graphIri === iri))
        diagnostics.push({
          code: "ASSOCIATION_BROKEN",
          severity: "error",
          message: "Referenced conceptual schema is unavailable or wrongly classified.",
          file: sourceResource?.file ?? null,
          selector: sourceResource?.selector,
          details: {
            identity: {
              kind: "association",
              owner: sourceResource?.graphIri ?? "",
              role: `${t}schema`,
              target: iri,
            },
          },
        });
    for (const resource of selected.filter((r) => r.ownership === "dependency")) {
      const bytes = await fileBytes(root, resource.file);
      resource.revision = revision(bytes);
      snapshot.reads.push({ kind: "file", path: resource.file, revision: resource.revision });
      const record = lock.dependencies[resource.dependencyId ?? ""]?.files.find(
        (f) => `dep:${resource.dependencyId}/${f.key}` === resource.selector,
      );
      if (
        !bytes ||
        !record ||
        record.byte_digest !== digest(bytes) ||
        record.byte_length !== bytes.length
      )
        diagnostics.push({
          code: "SNAPSHOT_INTEGRITY",
          severity: "error",
          message: "Listed locked graph bytes differ from their inventory.",
          file: resource.file,
          selector: resource.selector,
          details: { identity: { kind: "file" } },
        });
    }
    await verifyReads(root, snapshot.reads);
    return {
      ...ok(
        {
          items: selected.sort((a, b) => utf8Compare(a.selector, b.selector)),
        },
        diagnostics,
      ),
      status: diagnostics.some((d) => d.severity === "error") ? "invalid" : listed.status,
    };
  } catch (error) {
    return failure(error);
  }
}
export async function prepareSupport(options: AuthoringOptions): Promise<PreparedResource> {
  const root = await discoverProject(options);
  const path = portablePath(options.path);
  if (
    projectDiscoveryScope.excluded.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  )
    throw new ProjectError(
      "invalid_arguments",
      "PATH_UNSAFE",
      "Select a discoverable owned source graph.",
      path,
    );
  const shapes = options.command === "shapes.create";
  if (
    options.iri ||
    options.type ||
    options.profile ||
    options.schemas?.length ||
    (shapes && options.source)
  )
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Schema and shapes operations do not accept model creation/import fields.",
    );
  const destination = path.replace(/\.[^.]+$/, ".shacl.ttl");
  const snapshot = await captureInspection(
    root,
    "graph.list",
    undefined,
    shapes ? [destination] : [],
  );
  parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const shown = await inspectSnapshot(root, snapshot, { command: "graph.list" });
  const target = shown.data?.items?.find((r) => r.selector === path);
  if (!target || !snapshot.files[path])
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "Source is not an available owned graph.",
      path,
    );
  const bytes = snapshot.files[path];
  let store: Store;
  try {
    store = await parseRdf(
      bytes,
      rdfFormats[extname(path).toLowerCase()] ?? "text/turtle",
      pathToFileURL(await safePath(root, path)).href,
      false,
      path,
    );
    classifyGraph(store, path);
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError(
      "invalid",
      "RDF_SYNTAX",
      "Required rewritten/source graph is malformed.",
      path,
    );
  }
  const baseline = shapes
    ? undefined
    : await inspectSnapshot(root, snapshot, { command: "validate", selector: path });
  let selectedSchema: Resource | undefined;
  if (shapes) {
    if (shown.status !== "ok")
      throw new ProjectError(
        shown.status,
        shown.diagnostics[0]?.code ?? "RDF_SYNTAX",
        "Owned graph identity checks are incomplete.",
        shown.diagnostics[0]?.file ?? null,
      );
    if (target.kind !== "ontology" && !target.kind.endsWith("model"))
      throw new ProjectError(
        "invalid",
        "GRAPH_CLASSIFICATION",
        "Shapes require an ontology or domain model source.",
        path,
      );
    if (destination === path || snapshot.files[destination] !== null)
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Shapes destination is occupied.",
        destination,
      );
    store = new Store();
    if (
      shown.data?.items?.some((r) => r.graphIri === `${target.graphIri}/shapes`) ||
      Object.values(lock.dependencies).some((dep) =>
        dep.files.some((f) => f.graph_iri === `${target.graphIri}/shapes`),
      )
    )
      throw new ProjectError(
        "conflict",
        "GRAPH_IRI_COLLISION",
        "Derived shapes graph identity already exists.",
        destination,
      );
    store.addQuad(
      DataFactory.namedNode(`${target.graphIri}/shapes`),
      DataFactory.namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
      DataFactory.namedNode(`${t}ShapesGraph`),
    );
  } else {
    if (target.kind !== "concrete-data-model" || !options.source)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Schema association changes require a concrete model and conceptual schema selector.",
      );
    let source = options.source.startsWith("dep:") ? options.source : portablePath(options.source);
    if (source.startsWith("dep:") && !source.includes("/"))
      source = `${source}/${lock.dependencies[source.slice(4)]?.primary ?? ""}`;
    if (source.startsWith("dep:")) {
      const captured = await captureInspection(root, "graph.show", source);
      for (const [file, bytes] of Object.entries(captured.files))
        if (file !== "tbspec.toml" && file !== "tbspec.lock") snapshot.files[file] = bytes;
      snapshot.reads.push(
        ...captured.reads.filter(
          (read) =>
            !snapshot.reads.some(
              (existing) => existing.kind === read.kind && existing.path === read.path,
            ),
        ),
      );
    }
    const schema = await inspectSnapshot(root, snapshot, {
      command: "graph.show",
      selector: source,
    });
    selectedSchema = schema.data?.resource;
    if (
      schema.status !== "ok" ||
      selectedSchema?.kind !== "conceptual-data-model" ||
      !selectedSchema.graphIri
    )
      throw new ProjectError(
        "invalid",
        "ASSOCIATION_BROKEN",
        "Schema must resolve to one conceptual data model.",
        options.source,
      );
    // Bind the selected dependency's exact bytes in the same plan as the owned rewrite.
    if (selectedSchema.ownership === "dependency") {
      const dep = lock.dependencies[selectedSchema.dependencyId ?? ""];
      const record = dep?.files.find(
        (f) => `dep:${selectedSchema?.dependencyId}/${f.key}` === selectedSchema?.selector,
      );
      if (!record)
        throw new ProjectError("invalid", "ASSOCIATION_BROKEN", "Schema record is unavailable.");
      const content = snapshot.files[selectedSchema.file];
      if (!content)
        throw new ProjectError("invalid", "RESOURCE_MISSING", "Schema graph is missing.");
      await parseGraph(content, record, (await loadStarters()).vettedDigest);
    }
    const predicate = DataFactory.namedNode(`${t}schema`);
    const object = DataFactory.namedNode(selectedSchema.graphIri);
    if (options.command === "model.schema.add")
      store.addQuad(DataFactory.namedNode(target.graphIri ?? ""), predicate, object);
    else store.removeQuads(store.getQuads(target.graphIri, predicate, object, null));
  }
  const file = shapes ? destination : path;
  const text = await new Promise<string>((resolve, reject) => {
    const writer = new Writer();
    writer.addQuads([...store]);
    writer.end((error, text) => (error ? reject(error) : resolve(text)));
  });
  const writes = [{ file, bytes: Buffer.from(text) }];
  if (shapes && !path.endsWith(".ttl")) {
    const manifest = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
    const newline = manifest.includes("\r\n") ? "\r\n" : "\n";
    writes.push({
      file: "tbspec.toml",
      bytes: Buffer.from(
        `${manifest}${newline}[[associations]]${newline}resource = ${JSON.stringify(path)}${newline}support = ${JSON.stringify(file)}${newline}role = "shacl"${newline}`,
      ),
    });
  }
  const proposed = {
    ...snapshot,
    files: { ...snapshot.files },
    ownedPaths: [...new Set([...snapshot.ownedPaths, file])],
  };
  for (const write of writes) proposed.files[write.file] = write.bytes;
  const validated = await inspectSnapshot(root, proposed, { command: "validate", selector: path });
  if (["conflict", "unavailable", "invalid_arguments"].includes(validated.status))
    throw new ProjectError(
      validated.status,
      validated.diagnostics[0]?.code ?? "IO_FAILURE",
      validated.diagnostics[0]?.message ?? "Cannot assess proposed graph.",
    );
  const plan = preparePlan(snapshot, options.command, writes, {
    path,
    schema: selectedSchema?.selector ?? null,
  });
  if (options.command === "model.schema.remove") {
    plan.preview.impact.acceptance = ["confirm"];
    plan.preview.impact.baselineErrors =
      baseline?.diagnostics.filter((d) => d.severity === "error") ?? [];
    const unassessable = (d: import("./output.ts").Diagnostic) =>
      d.shacl &&
      [d.shacl.focusNode, d.shacl.value].some(
        (term) => term?.kind === "blank" && term.scope === path,
      );
    const identity = (d: import("./output.ts").Diagnostic) =>
      canonical([
        d.selector ?? d.file,
        d.code,
        d.check?.kind ?? null,
        d.shacl
          ? [
              d.shacl.selector,
              d.shacl.focusNode ?? null,
              d.shacl.sourceShape ?? null,
              d.shacl.constraintComponent ?? null,
              d.shacl.path ?? null,
              d.shacl.value ?? null,
            ]
          : (d.details?.identity ?? null),
      ]);
    const remaining = [...(baseline?.diagnostics ?? [])];
    for (const diagnostic of validated.diagnostics.filter((d) => d.severity === "error")) {
      if (unassessable(diagnostic)) continue;
      const same = remaining.findIndex(
        (d) => identity(d) === identity(diagnostic) && d.severity === "error",
      );
      if (same >= 0) {
        remaining.splice(same, 1);
        continue;
      }
      const previous = remaining.findIndex((d) => identity(d) === identity(diagnostic));
      if (previous >= 0) {
        remaining.splice(previous, 1);
        plan.preview.impact.worsenedErrors.push(diagnostic);
      } else plan.preview.impact.introducedErrors.push(diagnostic);
    }
    plan.preview.impact.skippedChecks = validated.diagnostics.filter(
      (d) => d.code === "CHECK_SKIPPED",
    );
    const schemaTriples = selectedSchema
      ? (
          await inspectSnapshot(root, snapshot, {
            command: "graph.show",
            selector: selectedSchema.selector,
          })
        ).data?.triples
      : [];
    plan.preview.arguments.removedVocabulary =
      schemaTriples
        ?.filter(
          (q) =>
            q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
            [
              "Class",
              "ObjectProperty",
              "DatatypeProperty",
              "AnnotationProperty",
              "Property",
              "Datatype",
            ].some((name) => String(q.object.value).endsWith(`#${name}`)),
        )
        .map((q) => q.subject) ?? [];
    const removed = plan.preview.arguments.removedVocabulary as import("./schemas.ts").Row[];
    plan.preview.arguments.removedVocabulary = [
      ...new Map(removed.map((term) => [canonical(term), term])).values(),
    ].sort((a, b) => utf8Compare(canonical(a), canonical(b)));
    plan.preview.arguments.affectedReferences =
      (
        await inspectSnapshot(root, snapshot, { command: "graph.show", selector: path })
      ).data?.triples?.filter((q) =>
        removed.some((term) =>
          [q.subject, q.predicate, q.object].some((value) => canonical(value) === canonical(term)),
        ),
      ) ?? [];
    if ([...(baseline?.diagnostics ?? []), ...validated.diagnostics].some(unassessable)) {
      plan.preview.impact.skippedChecks.push({
        code: "CHECK_SKIPPED",
        severity: "error",
        message:
          "Impact comparison involving anonymous target nodes is unassessable after rewriting the target graph.",
        file: path,
        selector: path,
        check: { kind: "shacl", state: "skipped", blockedBy: [path] },
        details: { reason: "impact_identity_unassessable", identity: { kind: "file" } },
      });
    }
    const { fingerprint: _fingerprint, ...body } = plan.preview;
    plan.preview.fingerprint = previewFingerprint(body);
  }
  const resource: Resource = shapes
    ? {
        selector: file,
        file,
        ...classifyGraph(store, file),
        ownership: "project",
        revision: revision(Buffer.from(text)),
        associations: [],
      }
    : {
        ...target,
        revision: revision(Buffer.from(text)),
        schemaIris: store.getObjects(target.graphIri, `${t}schema`, null).map((term) => term.value),
        associations: target.associations
          .filter((a) => a.role !== "schema" || a.selector !== selectedSchema?.selector)
          .concat(
            options.command === "model.schema.add" && selectedSchema
              ? [{ role: "schema", selector: selectedSchema.selector }]
              : [],
          ),
      };
  return {
    root,
    plan,
    resource,
    diagnostics: validated.diagnostics,
    validation: {
      validity: validated.data?.validity as "valid" | "invalid",
      validationComplete: validated.data?.validationComplete === true,
    },
  };
}
