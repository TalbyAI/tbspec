import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { digest, graphSignature, utf8Compare } from "./canonical.ts";
import { equalRevision, fileBytes, revision, verifyReads } from "./filesystem.ts";
import type { Check, Resource, Validation } from "./inspection.ts";
import { rdfTerm as encodeTerm } from "./inspection.ts";
import { dependencyDistances, resolveOntologyCandidates } from "./ontology-resolution.ts";
import { type Diagnostic, failure, ok, ProjectError, type Result } from "./output.ts";
import { safePath } from "./paths.ts";
import { classifyGraph, parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import type { Lock, ModelType, Row } from "./schemas.ts";
import { runShapes } from "./shacl-execution.ts";
import { prepareShapes } from "./shacl-profile.ts";
import { loadStarters } from "./starters.ts";
import type { Snapshot } from "./transactions.ts";

const t = "https://talby.ai/ontology/tbspec#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const rdfs = "http://www.w3.org/2000/01/rdf-schema#";
const owl = "http://www.w3.org/2002/07/owl#";
const sh = "http://www.w3.org/ns/shacl#";
const classTypes = [`${owl}Class`, `${rdfs}Class`, `${rdfs}Datatype`];
const propertyTypes = [
  `${rdf}Property`,
  ...["ObjectProperty", "DatatypeProperty", "AnnotationProperty", "OntologyProperty"].map(
    (name) => `${owl}${name}`,
  ),
];
export const vocabularyTypes = { class: classTypes, property: propertyTypes, datatype: classTypes };

function dependencyDistanceFrom(
  dependency: NonNullable<Lock>["dependencies"][string],
  start: string,
  target: string,
): number {
  const distances = new Map<string, number>([[start, 0]]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    const distance = distances.get(current) ?? 0;
    if (current === target) return distance;
    const context = dependency.files.find((file) => file.key === current)?.context;
    const neighbors = new Set<string>();
    for (const edge of dependency.edges)
      if (edge.from === current && edge.context === context && typeof edge.to === "string")
        neighbors.add(edge.to);
    for (const binding of dependency.bindings)
      if (binding.resource === current && binding.context === context)
        for (const key of [
          ...((binding.ontologies as string[] | undefined) ?? []),
          ...((binding.schemas as string[] | undefined) ?? []),
        ])
          neighbors.add(key);
    for (const association of dependency.associations)
      if (association.resource === current && association.context === context && association.active)
        neighbors.add(String(association.support));
    for (const neighbor of neighbors)
      if (!distances.has(neighbor)) {
        distances.set(neighbor, distance + 1);
        queue.push(neighbor);
      }
  }
  return Infinity;
}
export function vocabularyUses(statement: Quad) {
  const uses: { term: Term; role: keyof typeof vocabularyTypes; position: string }[] = [
    { term: statement.predicate, role: "property", position: "predicate" },
  ];
  if (
    [
      `${rdf}type`,
      `${rdfs}subClassOf`,
      `${rdfs}domain`,
      `${rdfs}range`,
      `${owl}equivalentClass`,
      `${owl}disjointWith`,
      `${owl}onClass`,
    ].includes(statement.predicate.value) &&
    statement.object.termType === "NamedNode"
  )
    uses.push({ term: statement.object, role: "class", position: "type" });
  if (
    [
      `${rdfs}subPropertyOf`,
      `${owl}equivalentProperty`,
      `${owl}inverseOf`,
      `${owl}onProperty`,
    ].includes(statement.predicate.value) &&
    statement.object.termType === "NamedNode"
  )
    uses.push({ term: statement.object, role: "property", position: "predicate" });
  if (statement.object.termType === "Literal")
    uses.push({ term: statement.object.datatype, role: "datatype", position: "datatype" });
  return uses;
}

export async function validateInspection(input: {
  root: string;
  snapshot: Snapshot & { ownedPaths: string[] };
  manifest?: Row;
  lock?: Lock;
  resources: Resource[];
  stores: Map<string, Store>;
  validation: Validation;
  diagnostics: Diagnostic[];
  target?: string;
  targets?: string[];
  onVocabulary?: (resource: Resource, available: Store, blockers: string[]) => void;
}): Promise<Result<Validation>> {
  const { root, snapshot, manifest, lock, resources, stores, validation, diagnostics } = input;
  const expand = (value: string) =>
    value.startsWith("dep:") && !value.includes("/")
      ? `${value}/${lock?.dependencies[value.slice(4)]?.primary ?? ""}`
      : value;
  const target = input.target ? expand(input.target) : undefined;
  const selection = target
    ? new Set([target])
    : input.targets
      ? new Set(input.targets.map(expand))
      : undefined;
  const bundle = await loadStarters();
  const records = new Map<string, Lock["dependencies"][string]["files"][number]>();
  if (lock)
    for (const [id, dep] of Object.entries(lock.dependencies))
      for (const file of dep.files) {
        const selector = `dep:${id}/${file.key}`;
        records.set(selector, file);
        if (!resources.some((r) => r.selector === selector))
          resources.push({
            selector,
            file: `${dep.snapshot_path}/${file.key}`,
            graphIri: file.graph_iri,
            kind: file.kind,
            classification: file.classification,
            identity: file.identity as Resource["identity"],
            ownership: "dependency",
            dependencyId: id,
            sourceGraphIri: file.source_graph_iri,
            revision: { state: "absent" },
            associations: [],
          });
      }
  const scopePrefixes = new Map(
    resources.map((resource) => [digest(resource.selector).slice(7, 23), resource.selector]),
  );
  function rdfTerm(term: Term, scope: string) {
    if (term.termType === "BlankNode") {
      const prefix = /^tb_([a-f0-9]{16})_/.exec(term.value)?.[1];
      if (prefix) scope = scopePrefixes.get(prefix) ?? scope;
    }
    return encodeTerm(term, scope);
  }
  for (const selected of selection ?? [])
    if (!resources.some((r) => r.selector === selected))
      throw new ProjectError(
        "unavailable",
        "RESOURCE_MISSING",
        "Selected graph is unavailable.",
        selected,
      );
  const rows = new Map(validation.resources.map((row) => [row.selector, row]));
  const capturedDiagnostics = [...diagnostics];
  const active = new Set<string>();
  const shapeGraphs = new Map<string, Store | null>();
  if (selection) {
    diagnostics.splice(
      0,
      diagnostics.length,
      ...diagnostics.filter(
        (d) =>
          selection.has(d.selector ?? "") || ["tbspec.toml", "tbspec.lock"].includes(d.file ?? ""),
      ),
    );
    validation.resources = validation.resources.filter((row) => selection.has(row.selector));
  }
  const diagnosticIdentityKey = (selector: string, code: string, identity: unknown) =>
    JSON.stringify([selector, code, identity]);
  const knownDiagnosticIdentities = new Set(
    diagnostics.flatMap((diagnostic) =>
      diagnostic.selector === undefined
        ? []
        : [
            diagnosticIdentityKey(
              diagnostic.selector,
              diagnostic.code,
              diagnostic.details?.identity,
            ),
          ],
    ),
  );
  function rowFor(resource: Resource) {
    let row = rows.get(resource.selector);
    if (!row) {
      row = { selector: resource.selector, state: "partial", checks: [] };
      rows.set(resource.selector, row);
    }
    if (!validation.resources.includes(row)) validation.resources.push(row);
    return row;
  }
  function emit(
    resource: Resource,
    code: string,
    kind: string,
    message: string,
    identity: Row = { kind: "file" },
  ) {
    const identityKey = diagnosticIdentityKey(resource.selector, code, identity);
    if (
      ["file", "setting", "association", "collision"].includes(String(identity.kind)) &&
      knownDiagnosticIdentities.has(identityKey) &&
      diagnostics.some(
        (diagnostic) =>
          diagnostic.selector === resource.selector &&
          diagnostic.code === code &&
          diagnostic.check?.kind === kind &&
          JSON.stringify(diagnostic.details?.identity) === JSON.stringify(identity),
      )
    )
      return;
    knownDiagnosticIdentities.add(identityKey);
    diagnostics.push({
      code,
      severity: "error",
      message,
      file: resource.file,
      selector: resource.selector,
      check: { kind, state: "failed", blockedBy: [] },
      details: { identity },
    });
    for (const existing of rowFor(resource).checks)
      if (existing.kind === kind && existing.state === "passed") existing.state = "failed";
  }
  function warn(resource: Resource, code: string, message: string, identity: Row) {
    const identityKey = diagnosticIdentityKey(resource.selector, code, identity);
    if (knownDiagnosticIdentities.has(identityKey)) return;
    knownDiagnosticIdentities.add(identityKey);
    diagnostics.push({
      code,
      severity: "warning",
      message,
      file: resource.file,
      selector: resource.selector,
      details: { identity },
    });
  }
  function check(
    resource: Resource,
    kind: string,
    blockers: string[] = [],
    shapesSelector?: string,
  ) {
    const failed = diagnostics.some(
      (d) =>
        d.selector === resource.selector &&
        d.check?.kind === kind &&
        d.severity === "error" &&
        (!shapesSelector || d.shacl?.selector === shapesSelector),
    );
    const state: Check["state"] = blockers.length ? "skipped" : failed ? "failed" : "passed";
    const record: Check = {
      kind,
      state,
      blockedBy: [...new Set(blockers)].sort(utf8Compare),
      ...(shapesSelector ? { shapesSelector } : {}),
    };
    const existing = rowFor(resource).checks.find(
      (check) => check.kind === kind && check.shapesSelector === shapesSelector,
    );
    if (existing) Object.assign(existing, record);
    else rowFor(resource).checks.push(record);
    if (
      blockers.length &&
      !diagnostics.some(
        (d) =>
          d.selector === resource.selector &&
          d.code === "CHECK_SKIPPED" &&
          d.check?.kind === kind &&
          d.shacl?.selector === shapesSelector &&
          JSON.stringify(d.check.blockedBy) === JSON.stringify(record.blockedBy),
      )
    )
      diagnostics.push({
        code: "CHECK_SKIPPED",
        severity: "error",
        message: `Cannot run ${kind} with unavailable prerequisites.`,
        file: resource.file,
        selector: resource.selector,
        check: { kind, state: "skipped", blockedBy: [...new Set(blockers)].sort(utf8Compare) },
        ...(shapesSelector && resources.find((r) => r.selector === shapesSelector)?.graphIri
          ? {
              shacl: {
                graphIri: resources.find((r) => r.selector === shapesSelector)?.graphIri ?? "",
                selector: shapesSelector,
              },
            }
          : {}),
        details: { identity: { kind: "file" } },
      });
  }
  async function load(resource: Resource): Promise<Store | undefined> {
    if (active.has(resource.selector))
      return rowFor(resource).checks.some(
        (c) => c.kind === "classification" && c.state === "failed",
      )
        ? undefined
        : stores.get(resource.selector);
    active.add(resource.selector);
    rowFor(resource);
    for (const problem of capturedDiagnostics.filter((d) => d.selector === resource.selector))
      if (!diagnostics.includes(problem)) diagnostics.push(problem);
    let store = stores.get(resource.selector);
    if (
      !store &&
      !rows
        .get(resource.selector)
        ?.checks.some((c) => ["syntax", "classification"].includes(c.kind) && c.state === "failed")
    ) {
      const captured = snapshot.reads.find((r) => r.kind === "file" && r.path === resource.file);
      const supplied = Object.hasOwn(snapshot.files, resource.file);
      const bytes = supplied
        ? (snapshot.files[resource.file] ?? null)
        : await fileBytes(root, resource.file);
      if (!supplied && captured && !equalRevision(captured.revision, revision(bytes)))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Graph changed after inspection capture.",
          resource.file,
        );
      if (!captured) {
        snapshot.reads.push({ kind: "file", path: resource.file, revision: revision(bytes) });
      }
      resource.revision = revision(bytes);
      const record = records.get(resource.selector);
      const baseIri = record?.base_iri ?? pathToFileURL(await safePath(root, resource.file)).href;
      try {
        if (!bytes)
          throw new ProjectError(
            "invalid",
            "RESOURCE_MISSING",
            "Required graph is missing.",
            resource.file,
          );
        store = record
          ? await parseGraph(bytes, record, bundle.vettedDigest, resource.selector)
          : await parseRdf(
              bytes,
              rdfFormats[extname(resource.file).toLowerCase()] ?? "text/turtle",
              baseIri,
              false,
              resource.selector,
            );
        stores.set(resource.selector, store);
        if (!record) Object.assign(resource, classifyGraph(store, resource.selector));
        for (const kind of ["syntax", "classification"])
          if (!rowFor(resource).checks.some((check) => check.kind === kind))
            rowFor(resource).checks.push({ kind, state: "passed", blockedBy: [] });
      } catch (error) {
        if (error instanceof ProjectError && error.status === "conflict") throw error;
        const problem =
          error instanceof ProjectError
            ? error
            : new ProjectError(
                "invalid",
                "RDF_SYNTAX",
                "Cannot parse required RDF.",
                resource.file,
              );
        diagnostics.push(
          ...failure(problem).diagnostics.map((d) => ({
            ...d,
            file: resource.file,
            selector: resource.selector,
            details: { ...d.details, identity: { kind: "file" } },
          })),
        );
        rowFor(resource).checks.push({
          kind: problem.diagnostic.code === "GRAPH_CLASSIFICATION" ? "classification" : "syntax",
          state: "failed",
          blockedBy: [],
        });
      }
    }
    return rowFor(resource).checks.some((c) => c.kind === "classification" && c.state === "failed")
      ? undefined
      : store;
  }
  function associations(resource: Resource): Resource["associations"] {
    const result = [...resource.associations];
    if (resource.dependencyId && lock) {
      const dep = lock.dependencies[resource.dependencyId];
      const key = records.get(resource.selector)?.key;
      for (const a of dep?.associations ?? [])
        if (a.resource === key && a.active)
          result.push({
            role: String(a.role),
            selector: `dep:${resource.dependencyId}/${a.support}`,
          });
      for (const binding of dep?.bindings ?? [])
        if (binding.resource === key)
          for (const [role, field] of [
            ["ontology", "ontologies"],
            ["schema", "schemas"],
          ] as const)
            for (const value of (binding[field] ?? []) as string[])
              result.push({ role, selector: `dep:${resource.dependencyId}/${value}` });
    } else {
      const store = stores.get(resource.selector);
      const typeNames = store?.getObjects(resource.graphIri, `${t}modelType`, null) ?? [];
      const types = {
        ...lock?.starters.model_types,
        ...(manifest?.model_types as Record<string, ModelType> | undefined),
      };
      if (typeNames.length === 1 && typeNames[0]?.termType === "Literal") {
        const type = Object.hasOwn(types, typeNames[0].value)
          ? types[typeNames[0].value]
          : undefined;
        if (type) {
          result.push({ role: "ontology", selector: type.ontology });
          if (type.design) result.push({ role: "design", selector: type.design });
        } else
          emit(
            resource,
            "ASSOCIATION_BROKEN",
            "association",
            "Model type binding is unavailable.",
            { kind: "setting", path: `model_types.${typeNames[0].value}` },
          );
      }
      for (const a of (manifest?.associations ?? []) as Row[])
        if (a.resource === resource.selector)
          result.push({ role: String(a.role), selector: String(a.support) });
      const sibling = resource.file.replace(/\.ttl$/i, ".shacl.ttl");
      if (sibling !== resource.file && snapshot.ownedPaths.includes(sibling))
        result.push({ role: "shacl", selector: sibling });
    }
    return [
      ...new Map(
        result.map((a) => {
          const item = { ...a, selector: expand(a.selector) };
          return [`${item.role}:${item.selector}`, item];
        }),
      ).values(),
    ];
  }
  const schemaCandidates = (iri: string, owner: Resource) =>
    resources.filter(
      (r) => r.graphIri === iri && (!owner.dependencyId || r.dependencyId === owner.dependencyId),
    );
  const signature = (resource: Resource) =>
    records.get(resource.selector)?.graph_signature ??
    graphSignature({
      byte_digest: Object.hasOwn(snapshot.files, resource.file)
        ? digest(snapshot.files[resource.file] ?? "")
        : resource.revision.state === "present"
          ? resource.revision.digest
          : digest(""),
      media_type: rdfFormats[extname(resource.file).toLowerCase()] ?? "text/turtle",
      base_iri: pathToFileURL(`${root}/${resource.file}`).href,
      parser_profile:
        extname(resource.file).toLowerCase() === ".ttl"
          ? "turtle-strict-v1"
          : extname(resource.file).toLowerCase() === ".nt"
            ? "ntriples-strict-v1"
            : "rdfxml-no-dtd-v1",
    });
  const distances = new Map<string, number>();
  if (lock)
    for (const [id, dependency] of Object.entries(lock.dependencies))
      for (const [key, distance] of dependencyDistances(dependency, 1))
        distances.set(`dep:${id}/${key}`, distance);
  function ontologyCandidates(iri: string, owner: Resource) {
    let candidates = resources.filter((r) => r.graphIri === iri && r.kind === "ontology");
    const configured = manifest?.ontology_choices as Record<string, string> | undefined;
    candidates = candidates.filter((r) => {
      if (!r.dependencyId || !lock) return true;
      if (!distances.has(r.selector)) return false;
      const dep = lock.dependencies[r.dependencyId];
      const sourceChoice = dep?.choices.find(
        (c) =>
          c.kind === "ontology" &&
          c.target_iri === iri &&
          c.context === records.get(r.selector)?.context,
      );
      const selectedIsReachable =
        sourceChoice !== undefined &&
        distances.has(`dep:${r.dependencyId}/${String(sourceChoice.selected)}`);
      return !selectedIsReachable || sourceChoice?.selected === records.get(r.selector)?.key;
    });
    const ranked = candidates.map((candidate) => ({
      selector: candidate.selector,
      graphIri: iri,
      signature: signature(candidate),
      rank: candidate.ownership === "project" ? 0 : (distances.get(candidate.selector) ?? Infinity),
      ...(candidate.dependencyId ? { dependencyId: candidate.dependencyId } : {}),
      resource: candidate,
    }));
    const resolution = resolveOntologyCandidates(
      iri,
      ranked,
      owner.ownership === "project" ? (configured ?? {}) : {},
    );
    if (resolution.state !== "resolved" && resolution.state !== "none") {
      emit(
        owner,
        "ONTOLOGY_CONFLICT",
        "association",
        resolution.state === "broken-choice"
          ? "Configured ontology choice has no matching dependency candidate."
          : resolution.state === "ambiguous-choice"
            ? "Configured dependency contains multiple different versions of this ontology."
            : "Effective ontology candidates have different content at the winning priority.",
        {
          kind: "collision",
          iri: { kind: "iri", value: iri },
          candidates: resolution.conflicted
            .map((candidate) => candidate.selector)
            .sort(utf8Compare),
        },
      );
      return [];
    }
    return resolution.effective.flatMap((candidate) => {
      const resource = ranked.find((item) => item.selector === candidate.selector)?.resource;
      return resource ? [resource] : [];
    });
  }
  async function supportedShapes(resource: Resource) {
    if (shapeGraphs.has(resource.selector)) return shapeGraphs.get(resource.selector);
    const source = await load(resource);
    let prepared: Store | null = null;
    if (source)
      try {
        prepared = prepareShapes(source);
      } catch (error) {
        const problem =
          error instanceof ProjectError
            ? error
            : new ProjectError(
                "invalid",
                "SHACL_GRAPH_INVALID",
                "Shapes graph cannot be compiled.",
              );
        emit(resource, problem.diagnostic.code, "shacl", problem.message);
      }
    shapeGraphs.set(resource.selector, prepared);
    if (source) check(resource, "shacl");
    return prepared;
  }
  async function validate(resource: Resource) {
    const store = await load(resource);
    if (
      !store ||
      rowFor(resource).checks.some((c) => c.kind === "classification" && c.state === "failed")
    ) {
      for (const kind of ["vocabulary", "association", "shacl"])
        check(resource, kind, [resource.file]);
      return;
    }
    const blockers: string[] =
      !manifest || !lock ? [!manifest ? "tbspec.toml" : "tbspec.lock"] : [];
    if (resource.kind !== "ontology" && resource.graphIri) {
      const candidates = resources.filter((r) => r.graphIri === resource.graphIri);
      if (new Set(candidates.map(signature)).size > 1)
        emit(
          resource,
          "GRAPH_IRI_COLLISION",
          "classification",
          "Distinct resources declare the same non-ontology graph IRI.",
          {
            kind: "collision",
            iri: { kind: "iri", value: resource.graphIri },
            candidates: candidates.map((r) => r.selector).sort(utf8Compare),
          },
        );
    }
    const vocabulary = new Map<string, Resource>();
    const shapes = new Map<string, Resource>();
    const seen = new Set<string>();
    async function include(selected: string, role: string, owner: Resource, bound = false) {
      let linked = resources.find((r) => r.selector === expand(selected));
      let sameContentCandidates: Resource[] = [];
      if (
        linked?.kind === "ontology" &&
        !bound &&
        resource.ownership === "project" &&
        linked.selector !== resource.selector
      ) {
        const candidates = ontologyCandidates(linked.graphIri ?? "", resource);
        if (!candidates.length) {
          emit(
            resource,
            "ASSOCIATION_BROKEN",
            "association",
            "Effective ontology is unavailable or ambiguous.",
            {
              kind: "association",
              owner: owner.graphIri ?? owner.selector,
              role: "ontology",
              target: selected,
            },
          );
          blockers.push(selected);
          return;
        }
        const sorted = [...candidates].sort((left, right) =>
          utf8Compare(left.selector, right.selector),
        );
        linked = sorted[0];
        sameContentCandidates = sorted.slice(1);
      }
      const allowed =
        role === "schema"
          ? ["conceptual-data-model"]
          : role === "shacl"
            ? ["shapes", "unclassified"]
            : role === "design"
              ? ["design"]
              : ["ontology", "unclassified"];
      const identity = {
        kind: "association",
        owner: owner.graphIri ?? owner.selector,
        role,
        target: expand(selected),
      };
      if (!linked || !allowed.includes(linked.kind)) {
        emit(
          resource,
          "ASSOCIATION_BROKEN",
          "association",
          `Required ${role} association is missing or wrongly classified.`,
          identity,
        );
        if (["ontology", "schema"].includes(role)) blockers.push(linked?.file ?? selected);
        return;
      }
      if (role === "shacl") {
        if (
          ![...shapes.values()].some(
            (s) => s.graphIri === linked?.graphIri && signature(s) === signature(linked),
          )
        )
          shapes.set(linked.selector, linked);
        return;
      }
      if (role === "design") {
        await load(linked);
        return;
      }
      if (seen.has(linked.selector)) return;
      seen.add(linked.selector);
      const graph = await load(linked);
      if (!graph) {
        blockers.push(linked.file);
        return;
      }
      vocabulary.set(linked.selector, linked);
      for (const a of associations(linked))
        if (["ontology", "schema", "shacl"].includes(a.role))
          await include(a.selector, a.role, linked, bound);
      if (linked.dependencyId && lock) {
        const dep = lock.dependencies[linked.dependencyId];
        const record = records.get(linked.selector);
        for (const edge of dep?.edges ?? [])
          if (
            edge.from === record?.key &&
            edge.context === record?.context &&
            ["import", "vocabulary", "schema"].includes(String(edge.relation))
          ) {
            if (edge.to)
              await include(
                `dep:${linked.dependencyId}/${edge.to}`,
                edge.relation === "schema" ? "schema" : "ontology",
                linked,
                bound,
              );
            else {
              emit(
                resource,
                "ASSOCIATION_BROKEN",
                "association",
                "Recorded interpretation edge is unresolved.",
                {
                  kind: "association",
                  owner: linked.graphIri ?? linked.selector,
                  role:
                    edge.relation === "import"
                      ? `${owl}imports`
                      : edge.relation === "schema"
                        ? `${t}schema`
                        : "ontology",
                  target: edge.target_iri,
                },
              );
              blockers.push(linked.file);
            }
          }
      } else
        for (const iri of graph.getObjects(linked.graphIri, `${owl}imports`, null)) {
          const selected = ontologyCandidates(iri.value, resource);
          if (selected.length) await include(selected[0]?.selector ?? "", "ontology", linked);
          else {
            emit(resource, "ASSOCIATION_BROKEN", "association", "Ontology import is unavailable.", {
              kind: "association",
              owner: linked.graphIri ?? linked.selector,
              role: `${owl}imports`,
              target: iri.value,
            });
            blockers.push(linked.file);
          }
        }
      for (const candidate of sameContentCandidates)
        await include(candidate.selector, "ontology", linked, true);
    }
    if (lock) await include(lock.starters.common_contract, "ontology", resource, true);
    if (resource.kind === "design" && lock) {
      const types =
        resource.ownership === "dependency"
          ? lock.starters.model_types
          : {
              ...lock.starters.model_types,
              ...(manifest?.model_types as Record<string, ModelType> | undefined),
            };
      for (const type of Object.values(types))
        if (type.design && expand(type.design) === resource.selector)
          await include(type.ontology, "ontology", resource);
      for (const a of (manifest?.associations ?? []) as Row[])
        if (a.role === "design" && expand(String(a.support)) === resource.selector)
          await include(String(a.resource), "ontology", resource);
    }
    for (const a of associations(resource))
      if (["ontology", "schema", "shacl", "design"].includes(a.role))
        await include(a.selector, a.role, resource);
    for (const schema of store.getObjects(resource.graphIri, `${t}schema`, null)) {
      const candidates = schemaCandidates(schema.value, resource).filter(
        (r) => r.kind === "conceptual-data-model",
      );
      if (
        resource.kind !== "concrete-data-model" ||
        schema.termType !== "NamedNode" ||
        !candidates.length
      ) {
        emit(
          resource,
          "ASSOCIATION_BROKEN",
          "association",
          "Schema requires a concrete model and an available conceptual model.",
          {
            kind: "association",
            owner: resource.graphIri ?? resource.selector,
            role: `${t}schema`,
            target: schema.value,
          },
        );
        blockers.push(schema.value);
      } else if (new Set(candidates.map(signature)).size > 1) {
        emit(
          resource,
          "GRAPH_IRI_COLLISION",
          "association",
          "Conceptual schema graph identity is ambiguous.",
          {
            kind: "collision",
            iri: rdfTerm(schema, resource.selector),
            candidates: candidates.map((r) => r.selector).sort(utf8Compare),
          },
        );
        blockers.push(...candidates.map((r) => r.file));
      } else
        for (const candidate of candidates) await include(candidate.selector, "schema", resource);
    }
    if (resource.kind === "ontology") {
      if (resource.ownership === "project" && resource.graphIri)
        ontologyCandidates(resource.graphIri, resource);
      await include(resource.selector, "ontology", resource);
    }
    const statementIdentity = (subject: Term, predicate: string, object: Term) => ({
      kind: "statement",
      subject: rdfTerm(subject, resource.selector),
      predicate: { kind: "iri", value: predicate },
      object: rdfTerm(object, resource.selector),
    });
    async function requiredGraph(iri: Term | undefined, role: string, kinds: string[]) {
      const matches =
        iri?.termType === "NamedNode"
          ? schemaCandidates(iri.value, resource).filter((r) => kinds.includes(r.kind))
          : [];
      if (!matches.length || new Set(matches.map(signature)).size !== 1) {
        emit(
          resource,
          "ASSOCIATION_BROKEN",
          "association",
          `Required ${role} graph is missing, ambiguous or wrongly classified.`,
          {
            kind: "association",
            owner: resource.graphIri ?? resource.selector,
            role,
            target: iri?.value ?? role,
          },
        );
        return undefined;
      }
      const selected = matches[0];
      if (!selected) return undefined;
      const graph = await load(selected);
      return graph ? { resource: selected, graph } : undefined;
    }
    type VisualRule = { iri: string; targetConcept: string; design: Resource; store: Store };
    async function rulesForDesign(
      design: Resource,
      targetIri: string,
      kind: "node" | "edge",
    ): Promise<VisualRule[]> {
      const graph = await load(design);
      if (!graph || !design.graphIri) return [];
      const expectedType = `${t}${kind === "node" ? "NodeVisualRule" : "EdgeVisualRule"}`;
      const rules: VisualRule[] = [];
      for (const rule of graph.getObjects(design.graphIri, `${t}rule`, null)) {
        if (rule.termType !== "NamedNode") continue;
        const types = graph.getObjects(rule, `${rdf}type`, null);
        const targets = graph.getObjects(rule, `${t}targetConcept`, null);
        if (
          types.length === 1 &&
          types[0]?.termType === "NamedNode" &&
          types[0].value === expectedType &&
          targets.length === 1 &&
          targets[0]?.termType === "NamedNode" &&
          targets[0].value === targetIri
        )
          rules.push({ iri: rule.value, targetConcept: targetIri, design, store: graph });
      }
      return rules;
    }
    async function winningDesignRules(
      owner: Resource,
      targetIri: string,
      kind: "node" | "edge",
      diagnosticOwner: Resource = owner,
    ): Promise<{ rules: VisualRule[]; conflict: boolean }> {
      const bySelector = new Map<string, { design: Resource; rank: number }>();
      const add = (design: Resource | undefined, rank: number) => {
        if (design?.kind !== "design") return;
        const previous = bySelector.get(design.selector);
        if (!previous || rank < previous.rank) bySelector.set(design.selector, { design, rank });
      };
      const explicit = (manifest?.design_choices as Record<string, string> | undefined)?.[
        targetIri
      ];
      if (explicit !== undefined) {
        const selected = resources.find((candidate) => candidate.selector === expand(explicit));
        if (selected?.kind !== "design") {
          emit(
            diagnosticOwner,
            "DESIGN_CONFLICT",
            "association",
            "Configured design choice is unavailable or is not a visual design.",
            { kind: "setting", path: `design_choices.${targetIri}` },
          );
          return { rules: [], conflict: true };
        }
        const rules = await rulesForDesign(selected, targetIri, kind);
        if (!rules.length) {
          emit(
            diagnosticOwner,
            "DESIGN_CONFLICT",
            "association",
            "Configured design has no linked exact-type rule for its target concept.",
            { kind: "setting", path: `design_choices.${targetIri}` },
          );
          return { rules: [], conflict: true };
        }
        return { rules, conflict: false };
      }

      if (owner.dependencyId && lock) {
        const dependency = lock.dependencies[owner.dependencyId];
        const ownerFile = records.get(owner.selector);
        const sourceChoice = dependency?.choices.find(
          (choice) =>
            choice.kind === "design" &&
            choice.target_iri === targetIri &&
            choice.context === ownerFile?.context,
        );
        if (sourceChoice) {
          const selected = resources.find(
            (candidate) =>
              candidate.selector === `dep:${owner.dependencyId}/${sourceChoice.selected}`,
          );
          if (selected?.kind !== "design") {
            emit(
              diagnosticOwner,
              "DESIGN_CONFLICT",
              "association",
              "Recorded source design choice is unavailable in its locked context.",
              {
                kind: "association",
                owner: owner.graphIri ?? owner.selector,
                role: "design",
                target: targetIri,
              },
            );
            return { rules: [], conflict: true };
          }
          const rules = await rulesForDesign(selected, targetIri, kind);
          if (!rules.length) {
            emit(
              diagnosticOwner,
              "DESIGN_CONFLICT",
              "association",
              "Recorded source design has no linked exact-type rule for its target concept.",
              {
                kind: "association",
                owner: owner.graphIri ?? owner.selector,
                role: "design",
                target: targetIri,
              },
            );
            return { rules: [], conflict: true };
          }
          return { rules, conflict: false };
        }
      }

      if (owner.ownership === "project")
        for (const design of resources.filter((candidate) => candidate.kind === "design"))
          if (design.ownership === "project") add(design, 0);

      for (const association of associations(owner))
        if (association.role === "design")
          add(
            resources.find((candidate) => candidate.selector === association.selector),
            1,
          );

      for (const ontologyAssociation of associations(owner))
        if (ontologyAssociation.role === "ontology") {
          const linked = resources.find(
            (candidate) => candidate.selector === ontologyAssociation.selector,
          );
          if (linked?.kind !== "ontology" || !linked.graphIri) continue;
          const effective =
            owner.ownership === "project" ? ontologyCandidates(linked.graphIri, owner) : [linked];
          for (const ontology of effective)
            for (const association of associations(ontology))
              if (association.role === "design")
                add(
                  resources.find((candidate) => candidate.selector === association.selector),
                  1,
                );
        }

      if (owner.dependencyId && lock) {
        const dependency = lock.dependencies[owner.dependencyId];
        const ownerKey = records.get(owner.selector)?.key;
        for (const design of resources.filter(
          (candidate) =>
            candidate.kind === "design" && candidate.dependencyId === owner.dependencyId,
        )) {
          const key = records.get(design.selector)?.key;
          if (dependency && ownerKey && key) {
            const distance = dependencyDistanceFrom(dependency, ownerKey, key);
            if (Number.isFinite(distance)) add(design, 2 + distance);
          }
        }
      } else if (owner.ownership === "project") {
        for (const design of resources.filter(
          (candidate) => candidate.kind === "design" && candidate.dependencyId,
        )) {
          const distance = distances.get(design.selector);
          if (distance !== undefined) add(design, 2 + distance);
        }
      }

      const ranked = (
        await Promise.all(
          [...bySelector.values()].map(async (entry) => ({
            ...entry,
            rules: await rulesForDesign(entry.design, targetIri, kind),
          })),
        )
      ).filter((entry) => entry.rules.length);
      if (!ranked.length) return { rules: [], conflict: false };
      const bestRank = Math.min(...ranked.map((entry) => entry.rank));
      const winners = ranked.filter((entry) => entry.rank === bestRank);
      const signatures = new Set(winners.map((entry) => signature(entry.design)));
      if (signatures.size > 1) {
        emit(
          diagnosticOwner,
          "DESIGN_CONFLICT",
          "association",
          "Visual designs tied at the winning precedence for this exact target concept.",
          {
            kind: "collision",
            iri: { kind: "iri", value: targetIri },
            candidates: winners.map((entry) => entry.design.selector).sort(utf8Compare),
          },
        );
        return { rules: [], conflict: true };
      }
      return {
        rules: winners.flatMap((entry) => entry.rules),
        conflict: false,
      };
    }
    function effectiveRule(rule: VisualRule, fields: string[]) {
      return {
        iri: rule.iri,
        appearance: Object.fromEntries(
          fields.flatMap((field) => {
            const value = rule.store.getObjects(rule.iri, `${t}${field}`, null)[0];
            return value ? [[field, rdfTerm(value, rule.design.selector)]] : [];
          }),
        ),
      };
    }
    function ruleOption(rule: VisualRule, fields: string[]) {
      return { ...effectiveRule(rule, fields), targetConcept: rule.targetConcept };
    }
    if (resource.kind === "view") {
      const sourceIri = store.getObjects(resource.graphIri, `${t}sourceGraph`, null)[0];
      const source = await requiredGraph(sourceIri, `${t}sourceGraph`, [
        "ontology",
        "model",
        "conceptual-data-model",
        "concrete-data-model",
        "process-model",
        "state-machine-model",
      ]);
      if (source) {
        for (const member of store.getObjects(resource.graphIri, `${t}member`, null))
          if (
            !source.graph.countQuads(member, null, null, null) &&
            !source.graph.countQuads(null, null, member, null)
          )
            emit(
              resource,
              "VIEW_INVALID",
              "view",
              "View member does not exist as a node in the selected source.",
              statementIdentity(
                DataFactory.namedNode(resource.graphIri ?? ""),
                `${t}member`,
                member,
              ),
            );
        for (const descriptor of store.getObjects(resource.graphIri, `${t}relationship`, null)) {
          const subject = store.getObjects(descriptor, `${rdf}subject`, null)[0];
          const predicate = store.getObjects(descriptor, `${rdf}predicate`, null)[0];
          const object = store.getObjects(descriptor, `${rdf}object`, null)[0];
          if (
            subject &&
            predicate &&
            object &&
            !source.graph.countQuads(subject, predicate, object, null)
          )
            emit(
              resource,
              "VIEW_INVALID",
              "view",
              "Selected relationship tuple is absent from the selected source.",
              statementIdentity(subject, predicate.value, object),
            );
        }
      }
      check(resource, "view", source ? [] : [sourceIri?.value ?? resource.file]);
      for (const configured of (manifest?.views ?? []) as Row[])
        if (
          configured.view === resource.selector &&
          source &&
          expand(String(configured.source)) !== source.resource.selector
        )
          emit(
            resource,
            "ASSOCIATION_BROKEN",
            "association",
            "Manifest view source contradicts RDF.",
            { kind: "setting", path: `views.${resource.selector}.source` },
          );
    }
    if (resource.kind === "presentation") {
      const effectivePresentation = validation.effectivePresentation ?? {
        nodes: {},
        relationships: {},
      };
      validation.effectivePresentation = effectivePresentation;
      const designRuleOptions = validation.designRuleOptions ?? {
        nodes: {},
        relationships: {},
      };
      validation.designRuleOptions = designRuleOptions;
      const viewIri = store.getObjects(resource.graphIri, `${t}forView`, null)[0];
      const view = await requiredGraph(viewIri, `${t}forView`, ["view"]);
      if (view) {
        for (const element of store.getQuads(null, `${t}element`, null, null))
          if (!view.graph.countQuads(view.resource.graphIri, `${t}member`, element.object, null))
            emit(
              resource,
              "PRESENTATION_INVALID",
              "presentation",
              "Presentation element is not selected in its view.",
              statementIdentity(element.subject, element.predicate.value, element.object),
            );
        for (const configured of (manifest?.views ?? []) as Row[])
          if (
            configured.presentation === resource.selector &&
            configured.view !== view.resource.selector
          )
            emit(
              resource,
              "ASSOCIATION_BROKEN",
              "association",
              "Manifest presentation association contradicts RDF.",
              { kind: "setting", path: `views.${configured.view}.presentation` },
            );
        const sourceIri = view.graph.getObjects(view.resource.graphIri, `${t}sourceGraph`, null)[0];
        const source = await requiredGraph(sourceIri, `${t}sourceGraph`, [
          "ontology",
          "model",
          "conceptual-data-model",
          "concrete-data-model",
          "process-model",
          "state-machine-model",
        ]);
        if (source) {
          const appearanceFields = [
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
            "edgeRouting",
            "arrowHead",
            "labelMode",
            "labelProperty",
            "labelText",
          ];
          const validateLabelChoice = (
            record: Term,
            candidates: VisualRule[],
            chosen: VisualRule | undefined,
          ) => {
            if (record.termType === "Literal") return;
            const local = new Map(
              appearanceFields.map((field) => [
                field,
                store.getObjects(record, `${t}${field}`, null),
              ]),
            );
            const ruleTerms = (field: string) =>
              chosen?.store.getObjects(chosen.iri, `${t}${field}`, null) ?? [];
            const localMode = local.get("labelMode")?.[0];
            const inheritedMode = ruleTerms("labelMode")[0];
            const modeChanged =
              localMode?.termType === "Literal" &&
              localMode.value !==
                (inheritedMode?.termType === "Literal" ? inheritedMode.value : "property");
            const mode =
              localMode?.termType === "Literal"
                ? localMode.value
                : inheritedMode?.termType === "Literal"
                  ? inheritedMode.value
                  : "property";
            const localProperty = local.get("labelProperty")?.[0];
            const localText = local.get("labelText")?.[0];
            const property =
              localProperty ?? (modeChanged ? undefined : ruleTerms("labelProperty")[0]);
            const text = localText ?? (modeChanged ? undefined : ruleTerms("labelText")[0]);
            const issue = (field: "labelMode" | "labelProperty" | "labelText", message: string) => {
              const value = local.get(field)?.[0];
              emit(
                resource,
                "PRESENTATION_INVALID",
                "presentation",
                message,
                value
                  ? statementIdentity(record as Term, `${t}${field}`, value)
                  : { kind: "term", term: rdfTerm(record, resource.selector) },
              );
            };
            if (localProperty && mode !== "property")
              issue(
                "labelProperty",
                "A local labelProperty requires the effective property label mode.",
              );
            if (localText && mode !== "text")
              issue("labelText", "A local labelText requires the effective text label mode.");
            if (mode === "text" && text?.termType !== "Literal")
              issue("labelText", "The effective text label mode requires one literal labelText.");
            if (mode === "property" && property && property.termType !== "NamedNode")
              issue(
                "labelProperty",
                "The effective property label mode requires an IRI labelProperty.",
              );
            if (candidates.length > 1 && !chosen)
              warn(
                resource,
                "DESIGN_RULE_AMBIGUOUS",
                "Several exact-type visual rules apply; this element uses generic appearance until a rule is chosen.",
                { kind: "term", term: rdfTerm(record, resource.selector) },
              );
          };

          for (const record of store.getObjects(resource.graphIri, `${t}nodePresentation`, null)) {
            if (record.termType === "Literal") continue;
            const element = store.getObjects(record, `${t}element`, null)[0];
            if (element?.termType !== "NamedNode") continue;
            const exactTypes = source.graph
              .getObjects(element, `${rdf}type`, null)
              .filter((type) => type.termType === "NamedNode");
            const applicable: VisualRule[] = [];
            for (const type of exactTypes) {
              const resolved = await winningDesignRules(
                source.resource,
                type.value,
                "node",
                resource,
              );
              applicable.push(...resolved.rules);
            }
            const deduplicated = [...new Map(applicable.map((rule) => [rule.iri, rule])).values()];
            designRuleOptions.nodes[element.value] = deduplicated.map((rule) =>
              ruleOption(rule, [
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
              ]),
            );
            const selectedRule = store.getObjects(record, `${t}chosenRule`, null)[0];
            let chosen: VisualRule | undefined;
            if (selectedRule) {
              chosen =
                selectedRule.termType === "NamedNode"
                  ? deduplicated.find((rule) => rule.iri === selectedRule.value)
                  : undefined;
              if (!chosen)
                emit(
                  resource,
                  "PRESENTATION_INVALID",
                  "presentation",
                  "Saved chosenRule is unavailable, belongs to a losing design, or does not apply to an exact explicit type.",
                  statementIdentity(record, `${t}chosenRule`, selectedRule),
                );
            } else if (deduplicated.length === 1) chosen = deduplicated[0];
            if (chosen)
              effectivePresentation.nodes[element.value] = effectiveRule(chosen, [
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
              ]);
            if (deduplicated.length === 0)
              warn(
                resource,
                "DESIGN_RULE_UNCOVERED",
                "No winning exact-type visual rule covers this node; it uses generic appearance.",
                { kind: "term", term: rdfTerm(element, source.resource.selector) },
              );
            validateLabelChoice(record, deduplicated, chosen);
          }

          for (const record of store.getObjects(
            resource.graphIri,
            `${t}relationshipPresentation`,
            null,
          )) {
            if (record.termType === "Literal") continue;
            const predicate = store.getObjects(record, `${rdf}predicate`, null)[0];
            if (predicate?.termType !== "NamedNode") continue;
            const resolved = await winningDesignRules(
              source.resource,
              predicate.value,
              "edge",
              resource,
            );
            if (!resolved.rules.length && !resolved.conflict)
              warn(
                resource,
                "DESIGN_RULE_UNCOVERED",
                "No winning exact-predicate visual rule covers this edge; it uses generic appearance.",
                { kind: "term", term: rdfTerm(predicate, source.resource.selector) },
              );
            const rules = [...new Map(resolved.rules.map((rule) => [rule.iri, rule])).values()];
            const subject = store.getObjects(record, `${rdf}subject`, null)[0];
            const object = store.getObjects(record, `${rdf}object`, null)[0];
            const tuple =
              subject?.termType === "NamedNode" && object?.termType === "NamedNode"
                ? JSON.stringify([subject.value, predicate.value, object.value])
                : undefined;
            if (tuple)
              designRuleOptions.relationships[tuple] = rules.map((rule) =>
                ruleOption(rule, [
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
                ]),
              );
            const selectedRule = store.getObjects(record, `${t}chosenRule`, null)[0];
            let chosen: VisualRule | undefined;
            if (selectedRule) {
              chosen =
                selectedRule.termType === "NamedNode"
                  ? rules.find((rule) => rule.iri === selectedRule.value)
                  : undefined;
              if (!chosen)
                emit(
                  resource,
                  "PRESENTATION_INVALID",
                  "presentation",
                  "Saved chosenRule is unavailable or belongs to a losing design for this exact predicate.",
                  statementIdentity(record, `${t}chosenRule`, selectedRule),
                );
            } else if (rules.length === 1) chosen = rules[0];
            if (chosen) {
              if (tuple) {
                effectivePresentation.relationships[tuple] = effectiveRule(chosen, [
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
                ]);
              }
            }
            validateLabelChoice(record, rules, chosen);
          }
        }
      }
      check(resource, "presentation", view ? [] : [viewIri?.value ?? resource.file]);
    }
    if (
      selection?.has(resource.selector) &&
      !["design", "presentation", "view", "shapes"].includes(resource.kind)
    ) {
      const effectivePresentation = validation.effectivePresentation ?? {
        nodes: {},
        relationships: {},
      };
      validation.effectivePresentation = effectivePresentation;
      const designRuleOptions = validation.designRuleOptions ?? {
        nodes: {},
        relationships: {},
      };
      validation.designRuleOptions = designRuleOptions;
      const nodeFields = [
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
      ];
      const edgeFields = [
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
      ];
      const nodes = new Set<string>();
      for (const statement of store) {
        if (statement.subject.termType === "NamedNode") nodes.add(statement.subject.value);
        if (statement.object.termType === "NamedNode") nodes.add(statement.object.value);
      }
      for (const iri of [...nodes].sort(utf8Compare)) {
        const element = DataFactory.namedNode(iri);
        const types = store
          .getObjects(element, `${rdf}type`, null)
          .filter((type) => type.termType === "NamedNode");
        const rules: VisualRule[] = [];
        let conflict = false;
        for (const type of types) {
          const resolved = await winningDesignRules(resource, type.value, "node");
          rules.push(...resolved.rules);
          conflict ||= resolved.conflict;
        }
        const applicable = [...new Map(rules.map((rule) => [rule.iri, rule])).values()].sort(
          (left, right) =>
            utf8Compare(left.targetConcept, right.targetConcept) ||
            utf8Compare(left.iri, right.iri),
        );
        const options = applicable.map((rule) => ruleOption(rule, nodeFields));
        designRuleOptions.nodes[iri] = options;
        if (applicable.length === 1) {
          const selected = applicable[0];
          if (selected) effectivePresentation.nodes[iri] = effectiveRule(selected, nodeFields);
        } else if (applicable.length > 1)
          warn(
            resource,
            "DESIGN_RULE_AMBIGUOUS",
            "Several exact-type visual rules apply; this element uses generic appearance until a rule is chosen.",
            { kind: "term", term: rdfTerm(element, resource.selector) },
          );
        else {
          warn(
            resource,
            "DESIGN_RULE_UNCOVERED",
            conflict
              ? "No rule wins for this exact type because its designs conflict; the node uses generic appearance."
              : "No winning exact-type visual rule covers this node; it uses generic appearance.",
            { kind: "term", term: rdfTerm(element, resource.selector) },
          );
        }
      }
      for (const statement of store) {
        if (
          statement.predicate.termType !== "NamedNode" ||
          statement.object.termType === "Literal" ||
          !["NamedNode", "BlankNode"].includes(statement.subject.termType)
        )
          continue;
        const resolved = await winningDesignRules(resource, statement.predicate.value, "edge");
        const applicable = [
          ...new Map(resolved.rules.map((rule) => [rule.iri, rule])).values(),
        ].sort(
          (left, right) =>
            utf8Compare(left.targetConcept, right.targetConcept) ||
            utf8Compare(left.iri, right.iri),
        );
        const endpoint = (term: Term) =>
          term.termType === "NamedNode" ? term.value : rdfTerm(term, resource.selector);
        const tuple = JSON.stringify([
          endpoint(statement.subject),
          statement.predicate.value,
          endpoint(statement.object),
        ]);
        designRuleOptions.relationships[tuple] = applicable.map((rule) =>
          ruleOption(rule, edgeFields),
        );
        if (applicable.length === 1) {
          const selected = applicable[0];
          if (selected)
            effectivePresentation.relationships[tuple] = effectiveRule(selected, edgeFields);
        } else if (applicable.length > 1)
          warn(
            resource,
            "DESIGN_RULE_AMBIGUOUS",
            "Several exact-predicate visual rules apply; this relationship uses generic appearance until a rule is chosen.",
            { kind: "term", term: rdfTerm(statement.subject, resource.selector) },
          );
        else if (!resolved.conflict)
          warn(
            resource,
            "DESIGN_RULE_UNCOVERED",
            "No winning exact-predicate visual rule covers this edge; it uses generic appearance.",
            { kind: "term", term: rdfTerm(statement.predicate, resource.selector) },
          );
      }
    }
    if (["design", "presentation"].includes(resource.kind)) {
      for (const statement of store)
        if (
          ["x", "y", "fontSize", "strokeWidth"].some(
            (name) => statement.predicate.value === `${t}${name}`,
          ) &&
          statement.object.termType === "Literal" &&
          !Number.isFinite(Number(statement.object.value))
        )
          emit(
            resource,
            "PRESENTATION_INVALID",
            "presentation",
            "Numeric appearance or coordinate cannot be represented as a finite renderer value.",
            statementIdentity(statement.subject, statement.predicate.value, statement.object),
          );
      if (resource.kind === "design") check(resource, "presentation");
    }
    check(resource, "association", !manifest || !lock ? blockers : []);
    const available = new Store([...store]);
    const data = new Store([...store]);
    const hierarchy = new Store();
    for (const selected of vocabulary.values())
      for (const statement of stores.get(selected.selector) ?? []) {
        available.addQuad(statement);
        if ([`${rdfs}subClassOf`, `${rdfs}subPropertyOf`].includes(statement.predicate.value)) {
          hierarchy.addQuad(statement);
          data.addQuad(statement);
        }
      }
    input.onVocabulary?.(resource, available, blockers);
    if (resource.kind === "design" && !blockers.length)
      for (const statement of store.getQuads(null, `${t}targetConcept`, null, null)) {
        const types = store.countQuads(statement.subject, `${rdf}type`, `${t}EdgeVisualRule`, null)
          ? propertyTypes
          : classTypes;
        if (!types.some((type) => available.countQuads(statement.object, `${rdf}type`, type, null)))
          emit(
            resource,
            "VOCABULARY_UNKNOWN",
            "vocabulary",
            "Visual rule target has no available declaration of the required kind.",
            {
              kind: "term",
              term: rdfTerm(statement.object, resource.selector),
              position: types === propertyTypes ? "predicate" : "type",
            },
          );
      }
    if (
      [
        "model",
        "conceptual-data-model",
        "concrete-data-model",
        "process-model",
        "state-machine-model",
      ].includes(resource.kind) &&
      !blockers.length
    ) {
      for (const statement of store) {
        for (const use of vocabularyUses(statement)) {
          if (
            [
              "http://www.w3.org/ns/prov#wasDerivedFrom",
              "http://purl.org/dc/terms/source",
            ].includes(use.term.value)
          )
            continue;
          const types = vocabularyTypes[use.role];
          if (!types.some((type) => available.countQuads(use.term, `${rdf}type`, type, null)))
            emit(
              resource,
              "VOCABULARY_UNKNOWN",
              "vocabulary",
              `Unavailable ${use.role} <${use.term.value}>.`,
              { kind: "term", term: rdfTerm(use.term, resource.selector), position: use.position },
            );
        }
      }
    }
    check(resource, "vocabulary", blockers);
    if (resource.kind === "shapes" || resource.file.endsWith(".shacl.ttl")) {
      await supportedShapes(resource);
      return;
    }
    for (const source of shapes.values()) {
      const graph = await supportedShapes(source);
      if (blockers.length || !graph) {
        check(resource, "shacl", [...blockers, ...(!graph ? [source.file] : [])], source.selector);
        continue;
      }
      try {
        const report = await runShapes(new Store([...graph, ...hierarchy]), data);
        for (const result of report.results) {
          const severity =
            result.severity?.value === `${sh}Warning`
              ? "warning"
              : result.severity?.value === `${sh}Info`
                ? "info"
                : "error";
          const path =
            result.args?.path ??
            stores.get(source.selector)?.getObjects(result.shape.ptr.term, `${sh}path`, null)[0];
          diagnostics.push({
            code: "SHACL_RESULT",
            severity,
            message: result.message.map((m) => m.value).join("; ") || "Constraint violation.",
            file: resource.file,
            selector: resource.selector,
            check: { kind: "shacl", state: "failed", blockedBy: [] },
            shacl: {
              graphIri: source.graphIri ?? "",
              selector: source.selector,
              focusNode: rdfTerm(result.focusNode.term, resource.selector),
              sourceShape: rdfTerm(result.shape.ptr.term, source.selector),
              constraintComponent: rdfTerm(result.constraintComponent, source.selector),
              ...(path ? { path: rdfTerm(path, source.selector) } : {}),
              ...(result.value?.term
                ? { value: rdfTerm(result.value.term, resource.selector) }
                : {}),
              messages: result.message.map((m) => rdfTerm(m, source.selector)),
            },
          });
        }
        check(resource, "shacl", [], source.selector);
      } catch {
        emit(source, "SHACL_GRAPH_INVALID", "shacl", "Cannot evaluate shapes graph.");
        check(resource, "shacl", [source.file], source.selector);
      }
    }
    if (!shapes.size) check(resource, "shacl", blockers);
  }
  const capturedFiles = new Set(
    snapshot.reads.flatMap((read) => (read.kind === "file" ? [read.path] : [])),
  );
  const targets = resources.filter((r) =>
    selection
      ? selection.has(r.selector)
      : Object.hasOwn(snapshot.files, r.file) || capturedFiles.has(r.file),
  );
  for (const resource of targets) {
    try {
      await validate(resource);
    } finally {
      stores.clear();
      active.clear();
      shapeGraphs.clear();
    }
  }
  await verifyReads(root, snapshot.reads);
  for (const row of validation.resources)
    row.state = row.checks.some((c) => c.state === "skipped")
      ? "partial"
      : row.checks.some((c) => c.state === "failed")
        ? "failed"
        : "passed";
  validation.resources.sort((a, b) => utf8Compare(a.selector, b.selector));
  validation.validationComplete =
    !!manifest &&
    !!lock &&
    !validation.resources.some((r) => r.checks.some((c) => c.state === "skipped"));
  validation.validity =
    diagnostics.some((d) => d.severity === "error") || !validation.validationComplete
      ? "invalid"
      : "valid";
  return {
    ...ok(validation, diagnostics),
    status: validation.validity === "valid" ? "ok" : "invalid",
  };
}
