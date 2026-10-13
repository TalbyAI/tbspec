import { lstat, readdir } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Term } from "@rdfjs/types";
import type { Store } from "n3";
import { utf8Compare } from "./canonical.ts";
import {
  equalRevision,
  fileBytes,
  inventory,
  type Revision,
  revision,
  verifyReads,
} from "./filesystem.ts";
import { withLock } from "./lock.ts";
import { type Diagnostic, failure, hasCode, ok, ProjectError, type Result } from "./output.ts";
import { portablePath, safePath } from "./paths.ts";
import { discoverProject, projectDiscoveryScope } from "./project.ts";
import { classifyGraph, rdfFormats as formats, parseGraph, parseRdf } from "./rdf.ts";
import {
  type Lock,
  type ModelType,
  parseLock,
  parseManifest,
  type Row,
  selector,
} from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import { listSupport } from "./support.ts";
import type { Snapshot } from "./transactions.ts";

export type InspectionCommand =
  | "editor.show"
  | "status"
  | "validate"
  | "shapes.list"
  | "model.schema.list"
  | "graph.list"
  | "graph.show"
  | "ontology.list"
  | "ontology.show"
  | "model.list"
  | "model.show"
  | "config.show"
  | "config.model-type.list";
export interface Resource {
  selector: string;
  file: string;
  graphIri: string | null;
  identity: "declared" | "generated" | null;
  kind: string;
  classification: string;
  ownership: "project" | "dependency";
  revision: Revision;
  associations: { role: string; selector: string }[];
  dependencyId?: string;
  sourceGraphIri?: string;
  kindOverride?: string;
  modelType?: string;
  provenance?: { sourceGraphIri: string; sourceSelector?: string }[];
  schemaIris?: string[];
}
export interface Check {
  kind: string;
  state: "passed" | "failed" | "skipped";
  blockedBy: string[];
  shapesSelector?: string;
}
export interface Validation extends Record<string, unknown> {
  validity: "valid" | "invalid";
  validationComplete: boolean;
  resources: { selector: string; state: "passed" | "failed" | "partial"; checks: Check[] }[];
  effectivePresentation?: {
    nodes: Record<string, { iri: string; appearance: Record<string, Row> }>;
    relationships: Record<string, { iri: string; appearance: Record<string, Row> }>;
  };
  designRuleOptions?: {
    nodes: Record<
      string,
      { iri: string; targetConcept: string; appearance: Record<string, Row> }[]
    >;
    relationships: Record<
      string,
      { iri: string; targetConcept: string; appearance: Record<string, Row> }[]
    >;
  };
}
export interface InspectionData extends Record<string, unknown> {
  resources?: Validation["resources"];
  effectivePresentation?: Validation["effectivePresentation"];
  designRuleOptions?: Validation["designRuleOptions"];
  items?: Resource[];
  resource?: Resource;
  sourceText?: string;
  triples?: { subject: Row; predicate: Row; object: Row }[];
  project?: { root: string; validity: "valid" | "invalid"; validationComplete: boolean };
  counts?: {
    resources: number;
    dependencies: number;
    errors: number;
    warnings: number;
    information: number;
  };
  validation?: Validation;
}
const metadata = "https://talby.ai/ontology/tbspec#";

export async function captureInspection(
  root: string,
  command: InspectionCommand,
  target?: string,
  extraPaths: string[] = [],
  visitGraph?: (path: string, bytes: Buffer) => Promise<void>,
): Promise<Snapshot & { ownedPaths: string[]; target?: string }> {
  const snapshot = await withLock(root, async () => {
    const scope = {
      ...projectDiscoveryScope,
      excluded: [...projectDiscoveryScope.excluded, ".tbspec/dependencies"],
    };
    const snapshot: Snapshot & { ownedPaths: string[]; target?: string } = {
      projectRoot: root,
      files: {},
      reads: [],
      ownedPaths: [],
      target,
    };
    async function read(path: string) {
      const bytes = await fileBytes(root, path);
      snapshot.reads.push({ kind: "file", path, revision: revision(bytes) });
      if (
        (!visitGraph && !["validate", "status", "graph.list"].includes(command)) ||
        !formats[extname(path).toLowerCase()] ||
        path === target ||
        extraPaths.includes(path) ||
        bytes === null
      )
        snapshot.files[path] = bytes;
    }
    await read("tbspec.toml");
    await read("tbspec.lock");
    let lock: Lock | undefined;
    try {
      lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    } catch {
      /* Report schema failure after coherent capture. */
    }
    const paths: string[] = [];
    async function walk(directory: string) {
      for (const entry of await readdir(directory ? await safePath(root, directory) : root, {
        withFileTypes: true,
      })) {
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (scope.excluded.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
          continue;
        await safePath(root, path);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && formats[extname(path).toLowerCase()]) {
          paths.push(path);
          snapshot.ownedPaths.push(path);
        }
      }
    }
    if (command === "status" || command === "graph.list" || command === "validate") {
      snapshot.reads.push({
        kind: "inventory",
        path: "",
        revision: await inventory(root, scope.path, scope),
        scope: { included: scope.included, excluded: scope.excluded },
      });
      await walk("");
    }
    // Only project-wide status reads every retained dependency, including inactive support.
    if (lock && (command === "status" || (command === "validate" && !target)))
      for (const dep of Object.values(lock.dependencies))
        for (const file of dep.files) paths.push(`${dep.snapshot_path}/${file.key}`);
    async function ownedFile(path: string): Promise<boolean> {
      if (scope.excluded.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)))
        return false;
      try {
        return (await lstat(await safePath(root, path))).isFile();
      } catch (error) {
        if (hasCode(error, "ENOENT")) return false;
        throw error;
      }
    }
    let sibling: string | undefined;
    let siblingPresent = false;
    if (command === "graph.show" && target) {
      if (target.startsWith("dep:")) {
        const [id, ...key] = target.slice(4).split("/");
        const dep = lock?.dependencies[id ?? ""];
        const file = dep?.files.find((file) => file.key === (key.join("/") || dep.primary));
        if (dep && file) {
          snapshot.target = `dep:${id}/${file.key}`;
          paths.push(`${dep.snapshot_path}/${file.key}`);
        }
      } else if (formats[extname(target).toLowerCase()] && (await ownedFile(target))) {
        paths.push(target);
        snapshot.ownedPaths.push(target);
        const path = target.replace(/\.ttl$/i, ".shacl.ttl");
        if (path !== target) {
          sibling = path;
          siblingPresent = await ownedFile(path);
          if (siblingPresent) snapshot.ownedPaths.push(path);
        }
      }
    }
    for (const path of [...new Set([...paths, ...extraPaths])].sort(utf8Compare)) await read(path);
    await verifyReads(root, snapshot.reads);
    // A filename association depends on presence, not on the support graph's bytes.
    if (sibling && siblingPresent !== (await ownedFile(sibling)))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Graph association changed during capture.",
        sibling,
      );
    return snapshot;
  });
  if (visitGraph) {
    parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
    parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    for (const path of snapshot.ownedPaths.sort(utf8Compare)) {
      const bytes = await fileBytes(root, path);
      const captured = snapshot.reads.find((read) => read.kind === "file" && read.path === path);
      if (!bytes || !captured || !equalRevision(captured.revision, revision(bytes)))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Graph changed before sequential inspection.",
          path,
        );
      await visitGraph(path, bytes);
    }
    await verifyReads(root, snapshot.reads);
  }
  return snapshot;
}

function effectiveConfig(manifest: Row, lock: Lock): Row {
  const overrides = (manifest.model_types ?? {}) as Record<string, ModelType>;
  const modelTypes = Object.entries({ ...lock.starters.model_types, ...overrides })
    .sort(([a], [b]) => utf8Compare(a, b))
    .map(([name, type]) => ({
      name,
      enabled: type.enabled !== false,
      ontology: type.ontology,
      design: type.design ?? null,
      origin: Object.hasOwn(overrides, name) ? "manifest" : "locked-default",
    }));
  const acquisition = manifest.acquisition as Row | undefined;
  return {
    baseIri: manifest.base_iri ?? null,
    modelTypes,
    ontologyChoices: manifest.ontology_choices ?? {},
    designChoices: manifest.design_choices ?? {},
    associations: manifest.associations ?? [],
    views: manifest.views ?? [],
    acquisition: {
      maxGraphBytes: acquisition?.max_graph_bytes ?? 67108864,
      maxTotalBytes: acquisition?.max_total_bytes ?? 268435456,
      maxFiles: acquisition?.max_files ?? 1000,
      maxRedirects: acquisition?.max_redirects ?? 5,
      deadlineMs: acquisition?.deadline_ms ?? 300000,
      maxGitWorkspaceBytes: acquisition?.max_git_workspace_bytes ?? 1073741824,
    },
  };
}
export function rdfTerm(term: Term, scope: string): Row {
  if (term.termType === "NamedNode") return { kind: "iri", value: term.value };
  if (term.termType === "BlankNode")
    return { kind: "blank", value: term.value.replace(/^tb_[a-f0-9]{16}_/, ""), scope };
  if (term.termType === "Literal")
    return {
      kind: "literal",
      value: term.value,
      ...(term.language ? { language: term.language } : { datatype: term.datatype.value }),
    };
  throw new ProjectError("invalid", "RDF_FORMAT_UNSUPPORTED", "Unsupported RDF term.");
}

export async function inspectProject(options: {
  project?: string;
  cwd?: string;
  command: InspectionCommand;
  selector?: string;
}): Promise<Result<InspectionData>> {
  if (options.command === "editor.show") {
    const { showEditor } = await import("./editing.ts");
    if (!options.selector)
      return failure(new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Select a graph."));
    return (await showEditor({
      ...options,
      selector: options.selector,
    })) as unknown as Result<InspectionData>;
  }
  if (options.command === "shapes.list" || options.command === "model.schema.list")
    return listSupport(options);
  if (options.command.startsWith("ontology.") || options.command.startsWith("model.")) {
    const family = options.command.split(".")[0];
    const show = options.command.endsWith(".show");
    const result = await inspectProjectData({
      ...options,
      command: show ? "graph.show" : "graph.list",
    });
    const matches = (resource: Resource) =>
      resource.ownership === "project" &&
      (family === "ontology"
        ? resource.kind === "ontology"
        : resource.kind === "model" || resource.kind.endsWith("-model"));
    if (show && result.data?.resource && !matches(result.data.resource))
      return failure(
        new ProjectError(
          "invalid",
          "GRAPH_CLASSIFICATION",
          `Selector is not a project-owned ${family}.`,
          result.data.resource.file,
        ),
      );
    if (!show && result.data?.items) result.data.items = result.data.items.filter(matches);
    return result;
  }
  return inspectProjectData(options);
}
async function inspectProjectData(
  options: Parameters<typeof inspectProject>[0],
): Promise<Result<InspectionData>> {
  try {
    const root = await discoverProject(options);
    let target = options.selector;
    if (options.command === "graph.show" || (options.command === "validate" && target)) {
      if (!target)
        throw new ProjectError(
          "invalid_arguments",
          "ARGUMENT_INVALID",
          "graph show requires a selector.",
        );
      try {
        target = selector(
          target.startsWith("dep:") ? target.replaceAll("\\", "/") : portablePath(target),
        );
      } catch {
        throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Invalid graph selector.");
      }
    }
    const snapshot = await captureInspection(root, options.command, target);
    return await inspectSnapshot(root, snapshot, options);
  } catch (error) {
    return failure(error);
  }
}
export async function inspectSnapshot(
  root: string,
  snapshot: Snapshot & { ownedPaths: string[]; target?: string },
  options: Parameters<typeof inspectProject>[0],
  scope: {
    targets?: string[];
    onVocabulary?: (resource: Resource, available: Store, blockers: string[]) => void;
  } = {},
): Promise<Result<InspectionData>> {
  try {
    const target = snapshot.target ?? options.selector;
    const diagnostics: Diagnostic[] = [];
    let manifest: Row | undefined;
    let lock: Lock | undefined;
    try {
      manifest = parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
    } catch (error) {
      diagnostics.push(...failure(error).diagnostics);
    }
    try {
      lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    } catch (error) {
      diagnostics.push(...failure(error).diagnostics);
    }
    if (["graph.show", "validate"].includes(options.command) && target?.startsWith("dep:") && !lock)
      return { ...ok<InspectionData>({}, diagnostics), status: "invalid" };
    if (options.command.startsWith("config.")) {
      if (!manifest || !lock) return { ...ok<InspectionData>({}, diagnostics), status: "invalid" };
      const config = effectiveConfig(manifest, lock);
      return ok(
        options.command === "config.show" ? config : { items: config.modelTypes },
        diagnostics,
      ) as Result<InspectionData>;
    }
    const resources: Resource[] = [];
    const stores = new Map<string, Store>();
    let selectedStore: Store | undefined;
    const validation: Validation = {
      validity: "invalid",
      validationComplete: false,
      resources: [],
    };
    const bundle = await loadStarters();
    const lockedPaths = new Map<
      string,
      { id: string; file: Lock["dependencies"][string]["files"][number] }
    >();
    if (lock)
      for (const [id, dep] of Object.entries(lock.dependencies))
        for (const file of dep.files)
          lockedPaths.set(`${dep.snapshot_path}/${file.key}`, { id, file });
    const capturedPaths = new Set([
      ...Object.keys(snapshot.files),
      ...snapshot.reads.flatMap((read) => (read.kind === "file" ? [read.path] : [])),
    ]);
    for (const file of capturedPaths) {
      if (!formats[extname(file).toLowerCase()]) continue;
      let bytes = snapshot.files[file];
      if (bytes === undefined) {
        bytes = await fileBytes(root, file);
        const captured = snapshot.reads.find((read) => read.kind === "file" && read.path === file);
        if (!captured || !equalRevision(captured.revision, revision(bytes)))
          throw new ProjectError(
            "conflict",
            "REVISION_CONFLICT",
            "Graph changed after inspection capture.",
            file,
          );
      }
      const locked = lockedPaths.get(file);
      if (!bytes && !locked && !snapshot.ownedPaths.includes(file)) continue;
      const expanded = locked ? `dep:${locked.id}/${locked.file.key}` : file;
      const resource: Resource = {
        selector: expanded,
        file,
        graphIri: null,
        identity: null,
        kind: "unclassified",
        classification: "unclassified",
        ownership: locked ? "dependency" : "project",
        revision: revision(bytes),
        associations: [],
        ...(locked
          ? {
              dependencyId: locked.id,
              sourceGraphIri: locked.file.source_graph_iri,
              ...(locked.file.kind_override ? { kindOverride: locked.file.kind_override } : {}),
            }
          : {}),
      };
      const checks: Check[] = [];
      try {
        if (!bytes)
          throw new ProjectError(
            "invalid",
            locked ? "SNAPSHOT_INTEGRITY" : "RESOURCE_MISSING",
            "Required captured graph is missing.",
            file,
          );
        const store = locked
          ? await parseGraph(bytes, locked.file, bundle.vettedDigest, expanded)
          : await parseRdf(
              bytes,
              formats[extname(file).toLowerCase()] ?? "text/turtle",
              pathToFileURL(await safePath(root, file)).href,
              false,
              expanded,
            );
        if (options.command === "graph.show" && expanded === target) {
          stores.set(expanded, store);
          selectedStore = store;
        }
        checks.push({ kind: "syntax", state: "passed", blockedBy: [] });
        const classification = classifyGraph(store, expanded);
        Object.assign(
          resource,
          classification,
          locked
            ? {
                kind: locked.file.kind,
                classification: locked.file.classification,
                graphIri: locked.file.graph_iri,
                identity: locked.file.identity,
              }
            : {},
        );
        checks.push({ kind: "classification", state: "passed", blockedBy: [] });
        if (resource.identity === "declared") {
          const types = store.getObjects(resource.graphIri, `${metadata}modelType`, null);
          if (types.length === 1 && types[0]?.termType === "Literal")
            resource.modelType = types[0].value;
          const sourceSelectors = store.getObjects(
            resource.graphIri,
            "http://purl.org/dc/terms/source",
            null,
          );
          const derivations = store.getObjects(
            resource.graphIri,
            "http://www.w3.org/ns/prov#wasDerivedFrom",
            null,
          );
          const sourceSelector =
            derivations.length === 1 && sourceSelectors.length === 1
              ? sourceSelectors[0]
              : undefined;
          resource.provenance = derivations
            .filter((term) => term.termType === "NamedNode")
            .map((term) => ({
              sourceGraphIri: term.value,
              ...(sourceSelector?.termType === "Literal"
                ? { sourceSelector: sourceSelector.value }
                : {}),
            }));
          resource.schemaIris = store
            .getObjects(resource.graphIri, `${metadata}schema`, null)
            .filter((term) => term.termType === "NamedNode")
            .map((term) => term.value);
        }
      } catch (error) {
        const problem =
          error instanceof ProjectError
            ? error
            : new ProjectError(
                "invalid",
                "RDF_SYNTAX",
                "Cannot parse RDF. Repair the source before graph-based operations.",
                file,
              );
        const context =
          error instanceof Error && "context" in error
            ? (error.context as { line?: number; token?: { start?: number } })
            : undefined;
        diagnostics.push(
          ...problem.diagnostics.map((d) => ({
            ...d,
            file,
            selector: expanded,
            ...(Number.isInteger(context?.line) && (context?.line ?? 0) > 0
              ? { line: context?.line }
              : {}),
            ...(Number.isInteger(context?.token?.start) && (context?.token?.start ?? -1) >= 0
              ? { column: (context?.token?.start ?? 0) + 1 }
              : {}),
            check: {
              kind:
                problem.diagnostic.code === "GRAPH_CLASSIFICATION" ? "classification" : "syntax",
              state: "failed" as const,
              blockedBy: [],
            },
            details: { ...d.details, identity: { kind: "file" } },
          })),
        );
        checks.push({
          kind: problem.diagnostic.code === "GRAPH_CLASSIFICATION" ? "classification" : "syntax",
          state: "failed",
          blockedBy: [],
        });
      }
      validation.resources.push({
        selector: expanded,
        state: checks.some((c) => c.state === "failed") ? "failed" : "partial",
        checks,
      });
      resources.push(resource);
    }
    resources.sort((a, b) => utf8Compare(a.selector, b.selector));
    if (lock)
      for (const resource of resources) {
        if (resource.dependencyId) {
          const dep = lock.dependencies[resource.dependencyId];
          const key = resource.selector.slice(`dep:${resource.dependencyId}/`.length);
          resource.associations.push(
            ...(dep?.associations ?? [])
              .filter((a) => a.resource === key && a.active)
              .map((a) => ({
                role: String(a.role),
                selector: `dep:${resource.dependencyId}/${a.support}`,
              })),
          );
          for (const binding of dep?.bindings ?? [])
            if (binding.resource === key)
              for (const [role, field] of [
                ["ontology", "ontologies"],
                ["schema", "schemas"],
              ] as const)
                for (const support of (binding[field] ?? []) as string[])
                  resource.associations.push({
                    role,
                    selector: `dep:${resource.dependencyId}/${support}`,
                  });
        } else {
          for (const schemaIri of resource.schemaIris ?? []) {
            for (const schema of resources.filter(
              (candidate) =>
                candidate.ownership === "project" &&
                candidate.graphIri === schemaIri &&
                candidate.kind === "conceptual-data-model",
            ))
              resource.associations.push({ role: "schema", selector: schema.selector });
            for (const [id, dep] of Object.entries(lock.dependencies))
              for (const schema of dep.files.filter(
                (file) => file.graph_iri === schemaIri && file.kind === "conceptual-data-model",
              ))
                resource.associations.push({ role: "schema", selector: `dep:${id}/${schema.key}` });
          }
          const sibling = resource.file.replace(/\.ttl$/i, ".shacl.ttl");
          if (sibling !== resource.file && snapshot.ownedPaths.includes(sibling))
            resource.associations.push({ role: "shacl", selector: sibling });
          for (const a of (manifest?.associations ?? []) as Row[])
            if (a.resource === resource.selector)
              resource.associations.push({ role: String(a.role), selector: String(a.support) });
          if (resource.modelType && manifest) {
            const type = (effectiveConfig(manifest, lock).modelTypes as Row[]).find(
              (t) => t.name === resource.modelType,
            );
            if (type) {
              resource.associations.push({ role: "ontology", selector: String(type.ontology) });
              if (type.design)
                resource.associations.push({ role: "design", selector: String(type.design) });
            }
          }
        }
        resource.associations = [
          ...new Map(
            resource.associations.map((a) => {
              const primary =
                a.selector.startsWith("dep:") && !a.selector.includes("/")
                  ? lock.dependencies[a.selector.slice(4)]?.primary
                  : undefined;
              const expanded = primary ? { ...a, selector: `${a.selector}/${primary}` } : a;
              return [`${expanded.role}:${expanded.selector}`, expanded] as const;
            }),
          ).values(),
        ].sort((a, b) => utf8Compare(a.role, b.role) || utf8Compare(a.selector, b.selector));
      }
    if (options.command === "graph.show") {
      const resource = resources.find((r) => r.selector === target);
      if (!resource)
        throw new ProjectError(
          "unavailable",
          "RESOURCE_MISSING",
          "Graph selector is not in the captured project inventory.",
        );
      const relevant = diagnostics.filter(
        (d) => d.file === resource.file || ["tbspec.toml", "tbspec.lock"].includes(d.file ?? ""),
      );
      const store = selectedStore;
      return {
        ...ok(
          {
            resource,
            sourceText: snapshot.files[resource.file]?.toString("utf8") ?? "",
            triples: store
              ? Array.from(store, (q) => ({
                  subject: rdfTerm(q.subject, resource.selector),
                  predicate: rdfTerm(q.predicate, resource.selector),
                  object: rdfTerm(q.object, resource.selector),
                }))
              : [],
          },
          relevant,
        ),
        status: relevant.some((d) => d.severity === "error") ? "invalid" : "ok",
      };
    }
    if (options.command === "graph.list")
      return {
        ...ok({ items: resources.filter((r) => r.ownership === "project") }, diagnostics),
        status: diagnostics.some((d) => d.severity === "error") ? "invalid" : "ok",
      };
    const { validateInspection } = await import("./validation.ts");
    const checked = await validateInspection({
      root,
      snapshot,
      manifest,
      lock,
      resources,
      stores,
      validation,
      diagnostics,
      target: options.command === "validate" ? target : undefined,
      ...scope,
    });
    if (options.command === "validate") return checked as Result<InspectionData>;
    diagnostics.splice(0, diagnostics.length, ...checked.diagnostics);
    const counts = {
      resources: resources.filter((r) => r.ownership === "project").length,
      dependencies: Object.keys(lock?.dependencies ?? {}).length,
      errors: diagnostics.filter((d) => d.severity === "error").length,
      warnings: diagnostics.filter((d) => d.severity === "warning").length,
      information: diagnostics.filter((d) => d.severity === "info").length,
    };
    return {
      ...ok(
        {
          project: {
            root,
            validity: validation.validity,
            validationComplete: validation.validationComplete,
          },
          counts,
          validation,
        },
        diagnostics,
      ),
      status: checked.status,
    };
  } catch (error) {
    return failure(error);
  }
}
