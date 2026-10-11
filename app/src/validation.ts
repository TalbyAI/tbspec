import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { digest, graphSignature, utf8Compare } from "./canonical.ts";
import { equalRevision, fileBytes, revision, verifyReads } from "./filesystem.ts";
import type { Check, Resource, Validation } from "./inspection.ts";
import { rdfTerm as encodeTerm } from "./inspection.ts";
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
  function rdfTerm(term: Term, scope: string) {
    if (term.termType === "BlankNode")
      scope =
        resources.find((r) => term.value.startsWith(`tb_${digest(r.selector).slice(7, 23)}_`))
          ?.selector ?? scope;
    return encodeTerm(term, scope);
  }
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
    if (
      ["file", "setting", "association", "collision"].includes(String(identity.kind)) &&
      diagnostics.some(
        (d) =>
          d.selector === resource.selector &&
          d.code === code &&
          d.check?.kind === kind &&
          JSON.stringify(d.details?.identity) === JSON.stringify(identity),
      )
    )
      return;
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
        if (type) result.push({ role: "ontology", selector: type.ontology });
        else
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
    for (const [id, dep] of Object.entries(lock.dependencies)) {
      const queue = [{ key: dep.primary, distance: 1 }];
      for (const { key, distance } of queue) {
        const selector = `dep:${id}/${key}`;
        if ((distances.get(selector) ?? Infinity) <= distance) continue;
        distances.set(selector, distance);
        for (const edge of dep.edges)
          if (
            edge.from === key &&
            edge.context === records.get(selector)?.context &&
            typeof edge.to === "string"
          )
            queue.push({ key: edge.to, distance: distance + 1 });
      }
    }
  function ontologyCandidates(iri: string, owner: Resource) {
    let candidates = resources.filter((r) => r.graphIri === iri && r.kind === "ontology");
    const configured = manifest?.ontology_choices as Record<string, string> | undefined;
    const choice = configured && Object.hasOwn(configured, iri) ? configured[iri] : undefined;
    candidates = candidates.filter((r) => {
      if (!r.dependencyId || !lock) return !choice;
      if (choice && r.dependencyId !== choice) return false;
      const dep = lock.dependencies[r.dependencyId];
      const sourceChoice = dep?.choices.find(
        (c) =>
          c.kind === "ontology" &&
          c.target_iri === iri &&
          c.context === records.get(`dep:${r.dependencyId}/${dep.primary}`)?.context,
      );
      return !sourceChoice || sourceChoice.selected === records.get(r.selector)?.key;
    });
    const rank = (r: Resource) =>
      r.ownership === "project" ? 0 : (distances.get(r.selector) ?? Infinity);
    const best = candidates.reduce((value, r) => Math.min(value, rank(r)), Infinity);
    if (!choice) candidates = candidates.filter((r) => rank(r) === best && best !== Infinity);
    if (new Set(candidates.map(signature)).size > 1) {
      emit(
        owner,
        "ONTOLOGY_CONFLICT",
        "association",
        "Effective ontology candidates have different content at the winning priority.",
        {
          kind: "collision",
          iri: { kind: "iri", value: iri },
          candidates: candidates.map((r) => r.selector).sort(utf8Compare),
        },
      );
      return [];
    }
    return candidates;
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
        linked = candidates[0];
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
      }
      check(resource, "presentation", view ? [] : [viewIri?.value ?? resource.file]);
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
