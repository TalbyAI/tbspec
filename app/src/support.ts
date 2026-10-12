import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Quad } from "@rdfjs/types";
import { DataFactory, Store, Writer } from "n3";
import type { AuthoringOptions, PreparedResource } from "./authoring.ts";
import { canonical, digest, utf8Compare } from "./canonical.ts";
import { equalRevision, fileBytes, revision, verifyReads } from "./filesystem.ts";
import {
  captureInspection,
  type InspectionCommand,
  type InspectionData,
  inspectSnapshot,
  type Resource,
  rdfTerm,
} from "./inspection.ts";
import { type Diagnostic, failure, ok, ProjectError, type Result } from "./output.ts";
import { portablePath, safePath } from "./paths.ts";
import { discoverProject, projectDiscoveryScope } from "./project.ts";
import { classifyGraph, parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import { parseLock, parseManifest, type Row } from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { preparePlan, previewFingerprint } from "./transactions.ts";
import { vocabularyTypes, vocabularyUses } from "./validation.ts";

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
    "validate",
    path,
    shapes ? [path, destination] : [path],
  );
  // The capture pins the model's bytes; subsequent inspections select their own graph.
  delete snapshot.target;
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
    else {
      const statements = store.getQuads(target.graphIri, predicate, object, null);
      if (!statements.length)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "Selected schema is not associated with this model; source bytes were preserved.",
          path,
        );
      store.removeQuads(statements);
    }
  }
  const file = shapes ? destination : path;
  const text = await new Promise<string>((resolve, reject) => {
    // shortcut: serialization normalizes source formatting, use source edits when preservation is required.
    const writer = new Writer();
    const labels = new Map<string, string>();
    function localTerm(term: Quad["subject"] | Quad["object"]) {
      if (term.termType !== "BlankNode") return term;
      if (!labels.has(term.value)) labels.set(term.value, `b${labels.size}`);
      return DataFactory.blankNode(labels.get(term.value));
    }
    for (const q of store)
      writer.addQuad(
        localTerm(q.subject) as Quad["subject"],
        q.predicate,
        localTerm(q.object) as Quad["object"],
      );
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
  const removing = options.command === "model.schema.remove";
  const affected = new Set([path]);
  if (removing) {
    const resources = shown.data?.items ?? [];
    const dependencies = new Map(
      resources.map((resource) => [
        resource.selector,
        resource.associations.map((a) => a.selector),
      ]),
    );
    for (const resource of resources.filter((r) => ["view", "presentation"].includes(r.kind))) {
      const bytes = snapshot.files[resource.file] ?? (await fileBytes(root, resource.file));
      const read = snapshot.reads.find((r) => r.kind === "file" && r.path === resource.file);
      if (!bytes || !read || !equalRevision(read.revision, revision(bytes)))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Dependent graph changed after capture.",
          resource.file,
        );
      const graph = await parseRdf(
        bytes,
        rdfFormats[extname(resource.file).toLowerCase()] ?? "text/turtle",
        pathToFileURL(await safePath(root, resource.file)).href,
      );
      const references = ["sourceGraph", "forView"].flatMap((predicate) =>
        graph.getObjects(resource.graphIri, `${t}${predicate}`, null),
      );
      dependencies
        .get(resource.selector)
        ?.push(
          ...resources
            .filter((candidate) => references.some((iri) => iri.value === candidate.graphIri))
            .map((candidate) => candidate.selector),
        );
    }
    for (const configured of (parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "")
      .views ?? []) as Row[]) {
      dependencies.get(String(configured.view))?.push(String(configured.source));
      if (configured.presentation)
        dependencies.get(String(configured.presentation))?.push(String(configured.view));
    }
    for (const selected of affected)
      for (const [owner, prerequisites] of dependencies)
        if (prerequisites.includes(selected)) affected.add(owner);
  }
  type Roles = Map<string, Set<keyof typeof vocabularyTypes>>;
  let beforeVocabulary: Roles | undefined;
  let afterVocabulary: Roles | undefined;
  function vocabulary(resource: Resource, available: Store, blockers: string[]): Roles | undefined {
    if (resource.selector !== path || blockers.length) return undefined;
    const result: Roles = new Map();
    for (const [role, types] of Object.entries(vocabularyTypes))
      for (const type of types)
        for (const term of available.getSubjects(
          "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
          type,
          null,
        ))
          if (term.termType === "NamedNode") {
            const roles = result.get(term.value) ?? new Set<keyof typeof vocabularyTypes>();
            roles.add(role as keyof typeof vocabularyTypes);
            result.set(term.value, roles);
          }
    return result;
  }
  const baseline = removing
    ? await inspectSnapshot(
        root,
        snapshot,
        { command: "validate" },
        {
          targets: [...affected],
          onVocabulary(resource, available, blockers) {
            if (resource.selector === path)
              beforeVocabulary = vocabulary(resource, available, blockers);
          },
        },
      )
    : undefined;
  const validated = await inspectSnapshot(
    root,
    proposed,
    { command: "validate", ...(removing ? {} : { selector: path }) },
    {
      ...(removing ? { targets: [...affected] } : {}),
      onVocabulary(resource, available, blockers) {
        if (resource.selector === path) afterVocabulary = vocabulary(resource, available, blockers);
      },
    },
  );
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
  if (removing) {
    if (baseline && ["conflict", "unavailable", "invalid_arguments"].includes(baseline.status))
      throw new ProjectError(
        baseline.status,
        baseline.diagnostics[0]?.code ?? "IO_FAILURE",
        "Cannot assess baseline graph.",
      );
    plan.preview.impact.acceptance = ["confirm"];
    plan.preview.impact.affectedFiles = [...affected].sort(utf8Compare);
    plan.preview.impact.baselineErrors =
      baseline?.diagnostics.filter((d) => d.severity === "error") ?? [];
    function anonymous(value: unknown): boolean {
      if (!value || typeof value !== "object") return false;
      const term = value as Row;
      if (term.kind === "blank") return term.scope === path || !/^b\d+$/.test(String(term.value));
      return Object.values(term).some(anonymous);
    }
    const unassessable = (d: Diagnostic) =>
      (!d.selector && !d.file) ||
      (!d.shacl && !d.details?.identity) ||
      anonymous(d.shacl) ||
      anonymous(d.details?.identity);
    const identity = (d: Diagnostic) =>
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
    const comparableBaseline = baseline?.diagnostics.filter((d) => !unassessable(d)) ?? [];
    const remaining = [...comparableBaseline];
    const baselineKeys = new Set(comparableBaseline.map(identity));
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
      } else if (baselineKeys.has(identity(diagnostic)))
        plan.preview.impact.worsenedErrors.push(diagnostic);
      else plan.preview.impact.introducedErrors.push(diagnostic);
    }
    plan.preview.impact.skippedChecks = validated.diagnostics.filter(
      (d) => d.code === "CHECK_SKIPPED",
    );
    const lost: Roles = new Map();
    if (beforeVocabulary && afterVocabulary)
      for (const [term, roles] of beforeVocabulary) {
        const removed = new Set(
          [...roles].filter((role) => !afterVocabulary?.get(term)?.has(role)),
        );
        if (removed.size) lost.set(term, removed);
      }
    plan.preview.arguments.removedVocabulary = [...lost.keys()]
      .sort(utf8Compare)
      .map((value) => ({ kind: "iri", value }));
    plan.preview.arguments.removedVocabularyRoles = [...lost]
      .sort(([a], [b]) => utf8Compare(a, b))
      .map(([value, roles]) => ({
        term: { kind: "iri", value },
        roles: [...roles].sort(utf8Compare),
      }));
    const original = await parseRdf(
      bytes,
      rdfFormats[extname(path).toLowerCase()] ?? "text/turtle",
      pathToFileURL(await safePath(root, path)).href,
      false,
      path,
    );
    plan.preview.arguments.affectedReferences = [...original]
      .filter((q) => vocabularyUses(q).some((use) => lost.get(use.term.value)?.has(use.role)))
      .map((q) => ({
        subject: rdfTerm(q.subject, path),
        predicate: rdfTerm(q.predicate, path),
        object: rdfTerm(q.object, path),
      }));
    const coverage = (result: typeof baseline) =>
      result?.data?.resources?.flatMap((resource) =>
        resource.checks.map((check) => ({ target: resource.selector, ...check })),
      ) ?? [];
    const beforeChecks = coverage(baseline);
    const afterChecks = coverage(validated);
    const checkKey = (check: { target: string; kind: string; shapesSelector?: string }) =>
      canonical([check.target, check.kind, check.shapesSelector ?? null]);
    const afterKeys = new Set(afterChecks.map(checkKey));
    plan.preview.arguments.deactivatedChecks = beforeChecks
      .filter((check) => check.shapesSelector && !afterKeys.has(checkKey(check)))
      .map(({ target, kind, shapesSelector }) => ({ target, kind, shapesSelector }));
    const unassessableChecks = new Map<
      string,
      { target: string; kind: string; shapesSelector?: string; blockedBy: string[] }
    >();
    for (const check of [...beforeChecks, ...afterChecks])
      if (check.state === "skipped" && afterKeys.has(checkKey(check)))
        unassessableChecks.set(checkKey(check), check);
    for (const diagnostic of [...(baseline?.diagnostics ?? []), ...validated.diagnostics])
      if (unassessable(diagnostic) && diagnostic.code !== "CHECK_SKIPPED") {
        const check = {
          target: diagnostic.selector ?? path,
          kind: diagnostic.check?.kind ?? "shacl",
          ...(diagnostic.shacl ? { shapesSelector: diagnostic.shacl.selector } : {}),
          blockedBy: [path],
        };
        unassessableChecks.set(checkKey(check), check);
      }
    if (!beforeVocabulary || !afterVocabulary) {
      const check = { target: path, kind: "vocabulary", blockedBy: [path] };
      unassessableChecks.set(checkKey(check), check);
    }
    for (const check of unassessableChecks.values()) {
      const source = [...(baseline?.diagnostics ?? []), ...validated.diagnostics].find(
        (d) => d.shacl?.selector === check.shapesSelector,
      )?.shacl;
      plan.preview.impact.skippedChecks.push({
        code: "CHECK_SKIPPED",
        severity: "error",
        message:
          "Affected impact cannot be compared because a required check is blocked or its diagnostic identity is unstable.",
        file: check.target,
        selector: check.target,
        check: { kind: check.kind, state: "skipped", blockedBy: check.blockedBy },
        ...(source ? { shacl: { graphIri: source.graphIri, selector: source.selector } } : {}),
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
