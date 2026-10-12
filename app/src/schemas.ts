import { posix, win32 } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "smol-toml";
import { digest as bytesDigest, canonical, graphSignature, hash, sortedSet } from "./canonical.ts";
import { ProjectError } from "./output.ts";
import { absoluteIri, id, portablePath } from "./paths.ts";

export type Row = Record<string, unknown>;
export interface ModelType {
  enabled: boolean;
  ontology: string;
  design?: string;
}
export interface LockedFile {
  key: string;
  source: string;
  source_resource: string;
  context: string;
  roles: string[];
  kind: string;
  classification: string;
  kind_override?: string;
  graph_iri: string;
  identity: string;
  source_graph_iri: string;
  byte_digest: string;
  byte_length: number;
  media_type: string;
  base_iri: string;
  parser_profile: string;
  graph_signature: string;
}
export interface Dependency {
  kind: string;
  primary: string;
  snapshot_path: string;
  interpretation_signature: string;
  sources: Row[];
  files: LockedFile[];
  edges: Row[];
  bindings: Row[];
  associations: Row[];
  choices: Row[];
  attachments: Row[];
}
export interface Lock {
  schema_version: 1;
  starters: { common_contract: string; model_types: Record<string, ModelType> };
  dependencies: Record<string, Dependency>;
}
const digestPattern = /^sha256:[0-9a-f]{64}$/;
function invalid(message: string): never {
  throw new Error(message);
}
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date)
    invalid("Expected a table.");
  return value as Row;
}
function fields(row: Row, required: string[], optional: string[] = []) {
  for (const key of required) if (!(key in row)) invalid(`Missing required field ${key}.`);
  for (const key of Object.keys(row))
    if (![...required, ...optional].includes(key)) invalid(`Unknown semantic field ${key}.`);
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value || !value.isWellFormed())
    invalid("Expected a nonempty Unicode string.");
  return value;
}
function iri(value: unknown): string {
  if (!absoluteIri(value)) invalid("Expected an absolute IRI.");
  return value;
}
function path(value: unknown): string {
  const raw = string(value);
  if (raw.includes("\\")) invalid("Wire paths require / separators.");
  return portablePath(raw);
}
function enumeration(value: unknown, allowed: string[]) {
  if (!allowed.includes(string(value))) invalid(`Expected one of ${allowed.join(", ")}.`);
}
function boolean(value: unknown) {
  if (typeof value !== "boolean") invalid("Expected boolean.");
}
function integer(value: unknown, minimum: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    invalid("Expected a safe integer in range.");
}
function digest(value: unknown) {
  if (!digestPattern.test(string(value))) invalid("Invalid SHA-256 digest.");
}
function httpLocator(value: unknown): URL {
  const url = new URL(string(value));
  if (!["http:", "https:"].includes(url.protocol)) invalid("URL source requires HTTP(S).");
  if (url.username || url.password || url.href.includes("?") || url.href.includes("#"))
    invalid(
      "Persisted HTTP(S) URLs require a stable locator without userinfo, query strings or fragments. Use transient or external authentication; do not strip credentials to fabricate a locator.",
    );
  return url;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid("Expected an array.");
  return value;
}
function strings(value: unknown): string[] {
  return sortedSet(array(value).map(string));
}
function checkIntegers(value: unknown): void {
  if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value))
    invalid("Integer exceeds the exact wire range.");
  if (Array.isArray(value)) for (const item of value) checkIntegers(item);
  else if (value && typeof value === "object")
    for (const item of Object.values(value)) checkIntegers(item);
}
function version(row: Row, file: string) {
  if (row.schema_version !== 1)
    throw new ProjectError(
      "invalid",
      "SCHEMA_UNSUPPORTED",
      `${file} requires integer schema_version = 1; found ${String(row.schema_version)}. No automatic migration is performed.`,
      file,
    );
}
export function selector(value: unknown): string {
  const raw = string(value);
  if (!raw.startsWith("dep:")) return path(raw);
  const [owner, ...rest] = raw.slice(4).split("/");
  id(owner ?? "");
  if (rest.length) path(rest.join("/"));
  return raw;
}
function modelType(value: unknown, defaultRow: boolean): ModelType {
  const row = object(value);
  if (!("ontology" in row)) invalid("Model type requires ontology.");
  selector(row.ontology);
  if (defaultRow && !("enabled" in row)) invalid("Locked default requires enabled.");
  if (row.enabled !== undefined) boolean(row.enabled);
  if (row.design !== undefined) selector(row.design);
  return {
    enabled: row.enabled !== false,
    ontology: row.ontology as string,
    ...(row.design === undefined ? {} : { design: row.design as string }),
  };
}
export function parseManifest(text: string): Row {
  try {
    const row = object(parse(text));
    version(row, "tbspec.toml");
    checkIntegers(row);
    if (row.base_iri !== undefined && (!absoluteIri(row.base_iri) || !/[#/]$/.test(row.base_iri)))
      invalid("base_iri must be an absolute IRI ending in / or #.");
    if (row.model_types !== undefined)
      for (const [name, type] of Object.entries(object(row.model_types))) {
        id(name);
        modelType(type, false);
      }
    for (const key of ["ontology_choices", "design_choices"])
      if (row[key] !== undefined)
        for (const [target, value] of Object.entries(object(row[key]))) {
          iri(target);
          if (key === "ontology_choices") id(string(value));
          else selector(value);
        }
    if (row.associations !== undefined)
      for (const value of array(row.associations)) {
        const association = object(value);
        selector(association.resource);
        selector(association.support);
        enumeration(association.role, ["shacl", "design"]);
      }
    if (row.views !== undefined)
      for (const value of array(row.views)) {
        const view = object(value);
        fields(view, ["view", "presentation", "source"], ["protocol"]);
        path(view.view);
        path(view.presentation);
        selector(view.source);
        if (view.protocol !== undefined) selector(view.protocol);
      }
    if (row.acquisition !== undefined)
      for (const [key, value] of Object.entries(object(row.acquisition)))
        if (
          [
            "max_graph_bytes",
            "max_total_bytes",
            "max_files",
            "max_redirects",
            "deadline_ms",
            "max_git_workspace_bytes",
          ].includes(key)
        )
          integer(value, key === "max_redirects" ? 0 : 1);
    return row;
  } catch (error) {
    if (error instanceof ProjectError && error.diagnostic.code === "SCHEMA_UNSUPPORTED")
      throw error;
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      error instanceof Error ? error.message : "Invalid manifest.",
      "tbspec.toml",
    );
  }
}
export function interpretationSignature(dependency: Dependency): string {
  const active = new Set<string>([dependency.primary]);
  for (const attachment of dependency.attachments)
    if (attachment.active) active.add(attachment.primary as string);
  let changed = true;
  while (changed) {
    const size = active.size;
    for (const edge of dependency.edges)
      if (active.has(edge.from as string) && edge.to) active.add(edge.to as string);
    for (const association of dependency.associations)
      if (association.active && active.has(association.resource as string))
        active.add(association.support as string);
    for (const binding of dependency.bindings)
      if (active.has(binding.resource as string))
        for (const key of [...(binding.ontologies as string[]), ...(binding.schemas as string[])])
          active.add(key);
    changed = active.size !== size;
  }
  const files = dependency.files
    .filter((file) => active.has(file.key))
    .map((file) => ({
      key: file.key,
      context: file.context,
      roles: sortedSet(file.roles),
      kind: file.kind,
      classification: file.classification,
      kind_override: file.kind_override ?? null,
      identity: file.identity,
      graph_iri: file.identity === "declared" ? file.graph_iri : null,
      byte_digest: file.byte_digest,
      media_type: file.media_type,
      base_iri: file.base_iri,
      parser_profile: file.parser_profile,
    }));
  const edges = dependency.edges
    .filter((edge) => active.has(edge.from as string))
    .map((edge) => ({
      context: edge.context,
      from: edge.from,
      relation: edge.relation,
      to: edge.to ?? null,
      target_iri: edge.target_iri ?? null,
    }));
  const bindings = dependency.bindings
    .filter((binding) => active.has(binding.resource as string))
    .map((binding) => ({
      context: binding.context,
      resource: binding.resource,
      ontologies: sortedSet(binding.ontologies as string[]),
      schemas: sortedSet(binding.schemas as string[]),
      model_type: binding.model_type ?? null,
      unresolved_iris: sortedSet((binding.unresolved_iris ?? []) as string[]),
    }));
  return hash([
    "tbspec.interpretation",
    1,
    {
      kind: dependency.kind,
      primary: dependency.primary,
      files: sortedSet(files),
      edges: sortedSet(edges),
      bindings: sortedSet(bindings),
      associations: sortedSet(
        dependency.associations
          .filter((row) => row.active && active.has(row.resource as string))
          .map((row) => ({ ...row, attachment: row.attachment ?? null })),
      ),
      choices: sortedSet(dependency.choices.filter((row) => active.has(row.selected as string))),
      attachments: sortedSet(
        dependency.attachments
          .filter((row) => row.active)
          .map((row) => ({
            id: row.id,
            role: row.role,
            resource: row.resource,
            primary: row.primary,
          })),
      ),
    },
  ]);
}
export function parseLock(text: string, bundled = false): Lock {
  try {
    const row = object(parse(text));
    version(row, bundled ? "inventory.toml" : "tbspec.lock");
    checkIntegers(row);
    fields(row, ["schema_version", "starters", "dependencies"], bundled ? ["release"] : []);
    if (bundled && row.release !== "0.1.0") invalid("Unavailable starter release.");
    const starters = object(row.starters);
    fields(starters, ["common_contract", "model_types"]);
    selector(starters.common_contract);
    const types = object(starters.model_types);
    fields(types, ["data", "process", "state-machine"]);
    for (const value of Object.values(types)) {
      fields(object(value), ["enabled", "ontology"], ["design"]);
      modelType(value, true);
    }
    const dependencies = object(row.dependencies);
    for (const [name, value] of Object.entries(dependencies)) {
      id(name);
      const dep = object(value);
      fields(dep, [
        "kind",
        "primary",
        "snapshot_path",
        "interpretation_signature",
        "sources",
        "files",
        "edges",
        "bindings",
        "associations",
        "choices",
        "attachments",
      ]);
      enumeration(dep.kind, ["ontology", "model", "design"]);
      path(dep.primary);
      digest(dep.interpretation_signature);
      if (dep.snapshot_path !== `.tbspec/dependencies/${name}`)
        invalid("snapshot_path contradicts dependency ID.");
      const sourceIds = new Set<string>();
      for (const value of array(dep.sources)) {
        const source = object(value);
        fields(
          source,
          ["id", "kind", "locator", "selected_resource"],
          [
            "revision_kind",
            "resolved_commit",
            "requested_ref",
            "effective_locator",
            "release",
            "inventory_digest",
            "attribution",
            "license",
          ],
        );
        const sourceId = path(source.id);
        if (sourceIds.has(sourceId)) invalid("Duplicate source ID.");
        sourceIds.add(sourceId);
        enumeration(source.kind, ["bundle", "directory", "git", "url"]);
        const sourceFields: Record<string, string[]> = {
          bundle: ["release", "inventory_digest"],
          directory: [],
          git: ["revision_kind", "resolved_commit", "requested_ref"],
          url: ["effective_locator"],
        };
        fields(
          source,
          ["id", "kind", "locator", "selected_resource"],
          [...(sourceFields[String(source.kind)] ?? []), "attribution", "license"],
        );
        const locator = string(source.locator);
        path(source.selected_resource);
        const parsedLocator = URL.canParse(locator) ? new URL(locator) : undefined;
        if (parsedLocator && ["http:", "https:"].includes(parsedLocator.protocol))
          httpLocator(locator);
        else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(locator)) {
          const url = new URL(locator);
          const sshAccount = url.protocol === "ssh:" || url.protocol === "git+ssh:";
          if ((url.username && !sshAccount) || url.password || url.hash)
            invalid("Source locator may contain credentials.");
        }
        if (source.kind === "bundle") {
          string(source.release);
          if (!locator.startsWith("tbspec:bundle/") || !locator.endsWith(`/${source.release}`))
            invalid("Invalid bundle locator.");
          if (!bundled) digest(source.inventory_digest);
          else if (source.inventory_digest !== undefined)
            invalid("Bundle inventory must not self-reference.");
          string(source.attribution);
          string(source.license);
        }
        if (source.kind === "url") {
          if (!/^resource\.(?:ttl|nt|rdf)$/.test(string(source.selected_resource)))
            invalid("URL selection requires resource.<ttl|nt|rdf>.");
          httpLocator(locator);
          httpLocator(source.effective_locator);
        }
        if (
          source.kind === "directory" &&
          !(
            (locator.startsWith("/") &&
              posix.normalize(locator) === locator &&
              !locator.includes("\\")) ||
            (/^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+)/.test(locator) &&
              win32.isAbsolute(locator) &&
              win32.normalize(locator) === locator)
          )
        )
          invalid("Directory locator requires a canonical absolute native path.");
        if (source.kind === "git") {
          enumeration(source.revision_kind, ["default", "ref", "commit"]);
          if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(string(source.resolved_commit)))
            invalid("Invalid commit.");
          if (
            source.revision_kind === "default"
              ? source.requested_ref !== undefined
              : source.requested_ref === undefined
          )
            invalid("Invalid requested ref.");
          if (source.revision_kind === "commit" && source.requested_ref !== source.resolved_commit)
            invalid("Commit policy mismatch.");
        }
      }
      const keys = new Map<string, LockedFile>();
      for (const value of array(dep.files)) {
        const file = object(value);
        fields(
          file,
          [
            "key",
            "source",
            "source_resource",
            "context",
            "roles",
            "kind",
            "classification",
            "graph_iri",
            "identity",
            "source_graph_iri",
            "byte_digest",
            "byte_length",
            "media_type",
            "base_iri",
            "parser_profile",
            "graph_signature",
          ],
          ["kind_override"],
        );
        const key = path(file.key);
        if (
          keys.has(key) ||
          [...keys.keys()].some((other) => other.toLowerCase() === key.toLowerCase())
        )
          invalid("Duplicate/platform-equivalent file key.");
        path(file.source_resource);
        if (!sourceIds.has(path(file.context))) invalid("Unknown file resolution context.");
        if (!sourceIds.has(path(file.source))) invalid("Unknown file source.");
        const roles = strings(file.roles);
        if (!roles.length) invalid("Empty file roles.");
        for (const role of roles)
          enumeration(role, ["primary", "closure", "shacl", "design", "vocabulary"]);
        enumeration(file.kind, [
          "ontology",
          "model",
          "conceptual-data-model",
          "concrete-data-model",
          "process-model",
          "state-machine-model",
          "design",
          "shapes",
          "unclassified",
        ]);
        enumeration(file.classification, ["declared", "override", "unclassified"]);
        enumeration(file.identity, ["declared", "generated"]);
        if (
          file.identity === "generated" &&
          file.graph_iri !== `urn:tbspec:graph:${bytesDigest(`dep:${name}/${key}`).slice(7)}`
        )
          invalid("Generated graph identity does not match its expanded selector.");
        if (
          (file.classification === "declared") !== (file.identity === "declared") ||
          (file.classification === "unclassified") !== (file.kind === "unclassified")
        )
          invalid("Classification, kind and identity contradict each other.");
        if (
          (roles.includes("shacl") && file.kind !== "shapes") ||
          (roles.includes("design") && file.kind !== "design")
        )
          invalid("Support roles contradict file kind.");
        if ((file.classification === "override") !== (file.kind_override !== undefined))
          invalid("Contradictory kind override.");
        if (file.kind_override !== undefined && file.kind_override !== file.kind)
          invalid("Override kind mismatch.");
        iri(file.graph_iri);
        iri(file.source_graph_iri);
        iri(file.base_iri);
        if (/^https?:/i.test(String(file.base_iri))) httpLocator(file.base_iri);
        digest(file.byte_digest);
        digest(file.graph_signature);
        integer(file.byte_length, 0);
        const profiles: Record<string, string[]> = {
          "text/turtle": ["turtle-strict-v1"],
          "application/n-triples": ["ntriples-strict-v1"],
          "application/rdf+xml": ["rdfxml-no-dtd-v1", "rdfxml-vetted-bundle-v1"],
        };
        if (!profiles[string(file.media_type)]?.includes(string(file.parser_profile)))
          invalid("Parser/media profile mismatch.");
        if (graphSignature(file as unknown as LockedFile) !== file.graph_signature)
          invalid("Graph signature mismatch.");
        if (roles.includes("primary") !== (key === dep.primary))
          invalid("Exactly primary file carries primary role.");
        keys.set(key, file as unknown as LockedFile);
      }
      if (!keys.has(dep.primary as string)) invalid("Missing dependency primary.");
      const primary = keys.get(dep.primary as string);
      const primarySource = array(dep.sources)
        .map(object)
        .find((source) => source.id === primary?.source);
      if (!primarySource || primary?.source_resource !== primarySource.selected_resource)
        invalid("Primary does not match its source selection.");
      if (
        (dep.kind === "ontology" && primary?.kind !== "ontology") ||
        (dep.kind === "design" && primary?.kind !== "design") ||
        (dep.kind === "model" &&
          ![
            "model",
            "conceptual-data-model",
            "concrete-data-model",
            "process-model",
            "state-machine-model",
          ].includes(primary?.kind ?? ""))
      )
        invalid("Primary kind contradicts dependency.");
      const reference = (value: unknown) => {
        if (!keys.has(path(value))) invalid("Reference to missing retained file.");
      };
      const context = (value: unknown) => {
        if (!sourceIds.has(path(value))) invalid("Unknown resolution context.");
      };
      for (const value of array(dep.edges)) {
        const edge = object(value);
        fields(edge, ["context", "from", "relation"], ["to", "target_iri"]);
        context(edge.context);
        reference(edge.from);
        enumeration(edge.relation, ["import", "ontology", "schema", "vocabulary"]);
        if ((edge.to === undefined) === (edge.target_iri === undefined))
          invalid("Edge needs exactly one target.");
        if (edge.to !== undefined) reference(edge.to);
        else iri(edge.target_iri);
      }
      for (const value of array(dep.bindings)) {
        const binding = object(value);
        fields(
          binding,
          ["context", "resource", "ontologies", "schemas"],
          ["model_type", "unresolved_iris"],
        );
        context(binding.context);
        reference(binding.resource);
        for (const key of strings(binding.ontologies)) {
          reference(key);
          if (keys.get(key)?.kind !== "ontology") invalid("Binding ontology kind mismatch.");
        }
        for (const key of strings(binding.schemas)) {
          reference(key);
          if (keys.get(key)?.kind !== "conceptual-data-model")
            invalid("Binding schema kind mismatch.");
        }
        if (binding.model_type !== undefined) string(binding.model_type);
        if (binding.unresolved_iris !== undefined)
          for (const target of strings(binding.unresolved_iris)) iri(target);
      }
      for (const value of array(dep.associations)) {
        const association = object(value);
        fields(
          association,
          ["context", "resource", "role", "support", "origin", "active"],
          ["attachment"],
        );
        context(association.context);
        reference(association.resource);
        reference(association.support);
        enumeration(association.role, ["shacl", "design"]);
        enumeration(association.origin, ["source", "manual"]);
        boolean(association.active);
        if (
          keys.get(association.support as string)?.kind !==
          (association.role === "shacl" ? "shapes" : "design")
        )
          invalid("Support kind mismatch.");
        if ((association.origin === "manual") !== (association.attachment !== undefined))
          invalid("Manual association requires attachment.");
      }
      const choices = new Set<string>();
      for (const value of array(dep.choices)) {
        const choice = object(value);
        fields(choice, ["context", "kind", "target_iri", "selected"]);
        context(choice.context);
        enumeration(choice.kind, ["ontology", "design"]);
        iri(choice.target_iri);
        reference(choice.selected);
        const key = canonical([choice.context, choice.kind, choice.target_iri]);
        if (choices.has(key)) invalid("Ambiguous source choice.");
        choices.add(key);
        if (keys.get(choice.selected as string)?.kind !== choice.kind)
          invalid("Choice kind mismatch.");
      }
      const attachments = new Set<string>();
      for (const value of array(dep.attachments)) {
        const attachment = object(value);
        fields(attachment, ["id", "role", "resource", "source", "primary", "active"]);
        const name = id(string(attachment.id));
        if (attachments.has(name)) invalid("Duplicate attachment.");
        attachments.add(name);
        enumeration(attachment.role, ["shacl", "design"]);
        reference(attachment.resource);
        reference(attachment.primary);
        if (!sourceIds.has(path(attachment.source))) invalid("Attachment source missing.");
        boolean(attachment.active);
      }
      for (const value of array(dep.associations)) {
        const association = object(value);
        if (association.origin === "manual" && !attachments.has(association.attachment as string))
          invalid("Association attachment missing.");
      }
      const dependency = dep as unknown as Dependency;
      if (interpretationSignature(dependency) !== dependency.interpretation_signature)
        invalid("Interpretation signature mismatch.");
    }
    const resolve = (value: unknown, kind: string) => {
      const selection = selector(value);
      if (!selection.startsWith("dep:")) invalid("Starter defaults must use locked dependencies.");
      const [name, ...parts] = selection.slice(4).split("/");
      const dep = dependencies[name ?? ""] as Dependency | undefined;
      const file = dep?.files.find(
        (file) => file.key === (parts.length ? parts.join("/") : dep.primary),
      );
      if (!file || file.kind !== kind)
        invalid("Required starter resource is missing or has the wrong kind.");
      return file;
    };
    const common = resolve(starters.common_contract, "ontology");
    if (common.graph_iri !== "https://talby.ai/ontology/tbspec")
      invalid("Common metadata contract must be independently bound to the metadata ontology.");
    const commonDependency = dependencies[
      (starters.common_contract as string).slice(4).split("/")[0] ?? ""
    ] as Dependency;
    if (
      !commonDependency.associations.some(
        (association) =>
          association.active === true &&
          association.resource === common.key &&
          association.role === "shacl",
      )
    )
      invalid("Required common metadata shapes are missing.");
    for (const value of Object.values(types)) {
      const type = object(value);
      resolve(type.ontology, "ontology");
      if (type.design !== undefined) resolve(type.design, "design");
    }
    return row as unknown as Lock;
  } catch (error) {
    if (error instanceof ProjectError && error.diagnostic.code === "SCHEMA_UNSUPPORTED")
      throw error;
    throw new ProjectError(
      "invalid",
      "LOCK_INVALID",
      error instanceof Error ? error.message : "Invalid lock.",
      bundled ? "inventory.toml" : "tbspec.lock",
    );
  }
}
export function writeToml(value: unknown): string {
  return stringify(value as Parameters<typeof stringify>[0]);
}
export function editOntologyChoice(
  text: string,
  ontologyIri: string,
  dependencyId?: string,
): string {
  const before = parseManifest(text);
  if (!absoluteIri(ontologyIri))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Ontology IRI must be absolute.",
    );
  if (dependencyId !== undefined) id(dependencyId);
  const choices = { ...((before.ontology_choices ?? {}) as Record<string, string>) };
  if (dependencyId === undefined) delete choices[ontologyIri];
  else choices[ontologyIri] = dependencyId;
  const currentChoices = (before.ontology_choices ?? {}) as Record<string, string>;
  if (isDeepStrictEqual(currentChoices, choices)) return text;

  const lines = (text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean);
  const content = (line: string) => line.replace(/(?:\r\n|\n|\r)$/, "");
  const ending = (line: string) => line.slice(content(line).length);
  const newline = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const header =
    /^\s*\[\s*(?:ontology_choices|"ontology_choices"|'ontology_choices')\s*\]\s*(?:#.*)?$/;
  const start = lines.findIndex((line) => header.test(content(line)));
  const stop =
    start < 0
      ? -1
      : lines.findIndex((line, index) => index > start && /^\s*\[/.test(content(line)));
  const end = stop < 0 ? lines.length : stop;
  const keyFor = (line: string): string | undefined => {
    const match = /^\s*(?:"((?:[^"\\]|\\.)*)"|'([^'\r\n]*)')\s*=/.exec(content(line));
    if (!match) return undefined;
    try {
      return match[1] === undefined ? match[2] : JSON.parse(`"${match[1]}"`);
    } catch {
      return undefined;
    }
  };
  const keyIndex =
    start < 0
      ? -1
      : lines.findIndex(
          (line, index) => index > start && index < end && keyFor(line) === ontologyIri,
        );
  let changed: string;
  if (start < 0) {
    if (dependencyId === undefined) return text;
    if (before.ontology_choices !== undefined)
      throw new ProjectError(
        "invalid",
        "MANIFEST_INVALID",
        "Cannot locate ontology_choices for a safe surgical edit.",
        "tbspec.toml",
      );
    const separator = text.length && !/(?:\r\n|\r|\n)$/.test(text) ? newline : "";
    changed = `${text}${separator}[ontology_choices]${newline}${JSON.stringify(ontologyIri)} = ${JSON.stringify(dependencyId)}${newline}`;
  } else if (keyIndex >= 0) {
    const line = lines[keyIndex] ?? "";
    const body = content(line);
    if (dependencyId === undefined) {
      const marker = trailingTomlComment(body);
      lines.splice(
        keyIndex,
        1,
        ...(marker >= 0
          ? [`${body.slice(0, body.search(/\S|$/))}${body.slice(marker)}${ending(line)}`]
          : []),
      );
    } else {
      const assignment = /^(\s*(?:"(?:[^"\\]|\\.)*"|'[^'\r\n]*')\s*=\s*)(.*)$/.exec(body);
      if (!assignment)
        throw new ProjectError(
          "invalid",
          "MANIFEST_INVALID",
          "Cannot locate the ontology choice assignment for a safe edit.",
          "tbspec.toml",
        );
      const value = assignment[2] ?? "";
      const marker = trailingTomlComment(value);
      const suffix = marker >= 0 ? value.slice(marker) : (/[\t ]*$/.exec(value)?.[0] ?? "");
      lines[keyIndex] = `${assignment[1]}${JSON.stringify(dependencyId)}${suffix}${ending(line)}`;
    }
    changed = lines.join("");
  } else {
    if (dependencyId === undefined) return text;
    const block = lines.slice(start, end);
    if (ending(block.at(-1) ?? "") === "") block[block.length - 1] = `${block.at(-1)}${newline}`;
    block.push(`${JSON.stringify(ontologyIri)} = ${JSON.stringify(dependencyId)}${newline}`);
    changed = [...lines.slice(0, start), ...block, ...lines.slice(end)].join("");
  }

  const after = parseManifest(changed);
  const expected = { ...before };
  if (Object.keys(choices).length || before.ontology_choices !== undefined)
    expected.ontology_choices = choices;
  else delete expected.ontology_choices;
  if (canonical(after) !== canonical(expected))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Ontology-choice edit changed unrelated configuration; no write is permitted.",
      "tbspec.toml",
    );
  return changed;
}

export function editDesignChoice(text: string, conceptIri: string, design?: string): string {
  const before = parseManifest(text);
  if (!absoluteIri(conceptIri))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Concept IRI must be absolute.",
    );
  if (design !== undefined) selector(design);
  const choices = { ...((before.design_choices ?? {}) as Record<string, string>) };
  if (design === undefined) delete choices[conceptIri];
  else choices[conceptIri] = design;
  const currentChoices = (before.design_choices ?? {}) as Record<string, string>;
  if (isDeepStrictEqual(currentChoices, choices)) return text;

  const lines = (text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean);
  const content = (line: string) => line.replace(/(?:\r\n|\n|\r)$/, "");
  const ending = (line: string) => line.slice(content(line).length);
  const newline = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const header = /^\s*\[\s*(?:design_choices|"design_choices"|'design_choices')\s*\]\s*(?:#.*)?$/;
  const start = lines.findIndex((line) => header.test(content(line)));
  const stop =
    start < 0
      ? -1
      : lines.findIndex((line, index) => index > start && /^\s*\[/.test(content(line)));
  const end = stop < 0 ? lines.length : stop;
  const keyFor = (line: string): string | undefined => {
    const match = /^\s*(?:"((?:[^"\\]|\\.)*)"|'([^'\r\n]*)')\s*=/.exec(content(line));
    if (!match) return undefined;
    try {
      return match[1] === undefined ? match[2] : JSON.parse(`"${match[1]}"`);
    } catch {
      return undefined;
    }
  };
  const keyIndex =
    start < 0
      ? -1
      : lines.findIndex(
          (line, index) => index > start && index < end && keyFor(line) === conceptIri,
        );
  let changed: string;
  if (start < 0) {
    if (design === undefined) return text;
    if (before.design_choices !== undefined)
      throw new ProjectError(
        "invalid",
        "MANIFEST_INVALID",
        "Cannot locate design_choices for a safe surgical edit.",
        "tbspec.toml",
      );
    const separator = text.length && !/(?:\r\n|\r|\n)$/.test(text) ? newline : "";
    changed = `${text}${separator}[design_choices]${newline}${JSON.stringify(conceptIri)} = ${JSON.stringify(design)}${newline}`;
  } else if (keyIndex >= 0) {
    const line = lines[keyIndex] ?? "";
    const body = content(line);
    if (design === undefined) {
      const marker = trailingTomlComment(body);
      lines.splice(
        keyIndex,
        1,
        ...(marker >= 0
          ? [`${body.slice(0, body.search(/\S|$/))}${body.slice(marker)}${ending(line)}`]
          : []),
      );
    } else {
      const assignment = /^(\s*(?:"(?:[^"\\]|\\.)*"|'[^'\r\n]*')\s*=\s*)(.*)$/.exec(body);
      if (!assignment)
        throw new ProjectError(
          "invalid",
          "MANIFEST_INVALID",
          "Cannot locate the design choice assignment for a safe edit.",
          "tbspec.toml",
        );
      const value = assignment[2] ?? "";
      const marker = trailingTomlComment(value);
      const suffix = marker >= 0 ? value.slice(marker) : (/[\t ]*$/.exec(value)?.[0] ?? "");
      lines[keyIndex] = `${assignment[1]}${JSON.stringify(design)}${suffix}${ending(line)}`;
    }
    changed = lines.join("");
  } else {
    if (design === undefined) return text;
    const block = lines.slice(start, end);
    if (ending(block.at(-1) ?? "") === "") block[block.length - 1] = `${block.at(-1)}${newline}`;
    block.push(`${JSON.stringify(conceptIri)} = ${JSON.stringify(design)}${newline}`);
    changed = [...lines.slice(0, start), ...block, ...lines.slice(end)].join("");
  }

  const after = parseManifest(changed);
  const expected = { ...before };
  if (Object.keys(choices).length || before.design_choices !== undefined)
    expected.design_choices = choices;
  else delete expected.design_choices;
  if (canonical(after) !== canonical(expected))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Design-choice edit changed unrelated configuration; no write is permitted.",
      "tbspec.toml",
    );
  return changed;
}
export function editBaseIri(text: string, baseIri: string): string {
  const before = parseManifest(text);
  if (!absoluteIri(baseIri) || !/[#/]$/.test(baseIri))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Base IRI must be absolute and end in / or #.",
    );
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const tableStart = text.search(/^\s*\[/m);
  const prefix = tableStart < 0 ? text : text.slice(0, tableStart);
  const match =
    /^(base_iri[ \t]*=[ \t]*)("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*')([ \t]*(?:#[^\r\n]*)?)(\r?\n|$)/m.exec(
      prefix,
    );
  let changed: string;
  if (before.base_iri !== undefined) {
    if (
      !match ||
      match.index === undefined ||
      match[2]?.startsWith('"""') ||
      match[2]?.startsWith("'''")
    )
      throw new ProjectError(
        "invalid",
        "MANIFEST_INVALID",
        "This base_iri syntax cannot be edited surgically; edit it manually.",
        "tbspec.toml",
      );
    const replacement = `${match[1]}${JSON.stringify(baseIri)}${match[3]}${match[4]}`;
    changed = text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
  } else changed = `base_iri = ${JSON.stringify(baseIri)}${newline}${text}`;
  const after = parseManifest(changed);
  if (!isDeepStrictEqual({ ...before, base_iri: baseIri }, { ...after }))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Surgical edit changed unrelated configuration; no write is permitted.",
      "tbspec.toml",
    );
  return changed;
}

export function editModelType(text: string, name: string, row?: Row): string {
  id(name);
  const before = parseManifest(text);
  const modelTypes = (before.model_types ?? {}) as Record<string, Row>;
  const existing = Object.hasOwn(modelTypes, name);
  const lines = (text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean);
  const content = (line: string) => line.replace(/(?:\r\n|\n|\r)$/, "");
  const ending = (line: string) => line.slice(content(line).length);
  const header = new RegExp(
    `^[\\t ]*\\[\\s*model_types\\s*\\.\\s*(?:${name}|"${name}")\\s*\\][\\t ]*(?:#.*)?$`,
  );
  const start = lines.findIndex((line) => header.test(content(line)));
  const end =
    start < 0
      ? -1
      : lines.findIndex((line, index) => index > start && /^\s*\[/.test(content(line)));
  const stop = end < 0 ? lines.length : end;
  let changed = text;
  if (existing && start < 0)
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Cannot locate the model-type table for a safe surgical edit.",
      "tbspec.toml",
    );
  if (row === undefined) {
    if (existing) {
      const retained = lines.slice(0, start);
      for (const line of lines.slice(start + 1, stop)) {
        const body = content(line);
        if (!/^\s*(?:ontology|enabled|design)\s*=/.test(body)) retained.push(line);
        else {
          const marker = trailingTomlComment(body);
          if (marker >= 0)
            retained.push(
              `${body.slice(0, body.search(/\S|$/))}${body.slice(marker)}${ending(line)}`,
            );
        }
      }
      retained.push(...lines.slice(stop));
      changed = retained.join("");
    }
  } else {
    const startLine = start < 0 ? -1 : start;
    const endLine = start < 0 ? -1 : stop;
    const bodyLines = start < 0 ? [] : lines.slice(startLine + 1, endLine);
    const additions: string[] = [];
    for (const field of ["ontology", "enabled", "design"]) {
      const assignment = new RegExp(`^([\\t ]*${field}[\\t ]*=[\\t ]*)(.*)$`);
      const lineIndex = bodyLines.findIndex((line) => assignment.test(content(line)));
      const present = Object.hasOwn(row, field);
      if (lineIndex < 0) {
        if (present)
          additions.push(
            `${field} = ${tomlModelTypeValue(field, row[field])}${lines[startLine]?.endsWith("\r\n") ? "\r\n" : lines[startLine]?.endsWith("\r") ? "\r" : "\n"}`,
          );
        continue;
      }
      const line = bodyLines[lineIndex] ?? "";
      const body = content(line);
      if (!present) {
        const marker = trailingTomlComment(body);
        bodyLines.splice(
          lineIndex,
          1,
          ...(marker >= 0
            ? [`${body.slice(0, body.search(/\S|$/))}${body.slice(marker)}${ending(line)}`]
            : []),
        );
        continue;
      }
      const match = assignment.exec(body);
      if (!match) throw new Error(`Cannot locate ${field} in model type ${name}.`);
      const marker = trailingTomlComment(body);
      const suffix = marker >= 0 ? body.slice(marker) : (/[\\t ]*$/.exec(body)?.[0] ?? "");
      bodyLines[lineIndex] =
        `${match[1]}${tomlModelTypeValue(field, row[field])}${suffix}${ending(line)}`;
    }
    if (start < 0) {
      const newline = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
      const separator = text.length === 0 || /(?:\r\n|\r|\n)$/.test(text) ? "" : newline;
      changed = `${text}${separator}${text.length ? newline : ""}[model_types.${name}]${newline}${additions.join("")}`;
    } else {
      const lineEnding = ending(lines[start] ?? "") || "\n";
      if (bodyLines.length && ending(bodyLines.at(-1) ?? "") === "")
        bodyLines[bodyLines.length - 1] = `${bodyLines.at(-1)}${lineEnding}`;
      const normalizedAdditions = additions.map((line) =>
        line.endsWith("\r\n") || line.endsWith("\r") || line.endsWith("\n")
          ? line
          : `${line}${lineEnding}`,
      );
      changed = [
        ...lines.slice(0, start + 1),
        ...bodyLines,
        ...normalizedAdditions,
        ...lines.slice(stop),
      ].join("");
    }
  }
  const after = parseManifest(changed);
  const expectedTypes = { ...modelTypes };
  if (row === undefined) delete expectedTypes[name];
  else expectedTypes[name] = row;
  const expected = { ...before };
  if (Object.keys(expectedTypes).length) expected.model_types = expectedTypes;
  else delete expected.model_types;
  if (canonical(after) !== canonical(expected))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Model-type edit changed unrelated configuration; no write is permitted.",
      "tbspec.toml",
    );
  return changed;
}

export function removeModelType(text: string, name: string): string {
  id(name);
  const before = parseManifest(text);
  const modelTypes = (before.model_types ?? {}) as Record<string, Row>;
  if (!Object.hasOwn(modelTypes, name))
    throw new ProjectError(
      "invalid_arguments",
      "MODEL_TYPE_UNUSABLE",
      "Custom model type does not exist.",
    );
  const lines = (text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean);
  const content = (line: string) => line.replace(/(?:\r\n|\n|\r)$/, "");
  const header = new RegExp(
    `^[\\t ]*\\[\\s*model_types\\s*\\.\\s*(?:${name}|"${name}")\\s*\\][\\t ]*(?:#.*)?$`,
  );
  const start = lines.findIndex((line) => header.test(content(line)));
  if (start < 0)
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Cannot locate the custom model-type table for safe removal.",
      "tbspec.toml",
    );
  const end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(content(line)));
  const stop = end < 0 ? lines.length : end;
  const changed = [...lines.slice(0, start), ...lines.slice(stop)].join("");
  const after = parseManifest(changed);
  const expected = structuredClone(before) as Row;
  const expectedTypes = { ...modelTypes };
  delete expectedTypes[name];
  if (Object.keys(expectedTypes).length) expected.model_types = expectedTypes;
  else Reflect.deleteProperty(expected, "model_types");
  if (canonical(after) !== canonical(expected))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Removing the custom model type changed unrelated configuration.",
      "tbspec.toml",
    );
  return changed;
}

/** Rewrite known manifest selectors while preserving comments, unknown keys and line endings. */
export function editManifestSelectors(text: string, replacements: Record<string, string>): string {
  const before = parseManifest(text);
  const expected = structuredClone(before) as Row;
  const fieldsByTable: Record<string, string[]> = {
    associations: ["resource", "support"],
    views: ["view", "presentation", "source", "protocol"],
  };
  for (const value of Object.values((expected.model_types ?? {}) as Record<string, Row>))
    for (const field of ["ontology", "design"])
      if (typeof value[field] === "string" && replacements[value[field] as string])
        value[field] = replacements[value[field] as string];
  for (const table of ["associations", "views"])
    for (const row of (expected[table] ?? []) as Row[])
      for (const field of fieldsByTable[table] ?? [])
        if (typeof row[field] === "string" && replacements[row[field] as string])
          row[field] = replacements[row[field] as string];
  // Design choices are keyed by IRI, so update them without relying on path-shaped keys.
  if (expected.design_choices && before.design_choices) {
    const choices = { ...(before.design_choices as Row) };
    for (const [key, value] of Object.entries(choices))
      if (typeof value === "string" && replacements[value]) choices[key] = replacements[value];
    expected.design_choices = choices;
  }

  const lines = (text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean);
  const content = (line: string) => line.replace(/(?:\r\n|\n|\r)$/, "");
  const ending = (line: string) => line.slice(content(line).length);
  let table = "";
  let changed = false;
  const rewritten = lines.map((line) => {
    const body = content(line);
    const header = /^\s*(\[\[|\[)\s*([^\]]+?)\s*(\]\]|\])\s*(?:#.*)?$/.exec(body);
    if (header) {
      table = header[2]?.replaceAll('"', "").trim() ?? "";
      return line;
    }
    const assignment = /^([\t ]*(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*")[\t ]*=[\t ]*)(.*)$/.exec(body);
    if (!assignment) return line;
    const key = assignment[1]?.slice(0, assignment[1].indexOf("=")).trim().replaceAll('"', "");
    const allowed = table.startsWith("model_types.")
      ? ["ontology", "design"]
      : (fieldsByTable[table] ?? (table === "design_choices" ? [key ?? ""] : []));
    if (!key || !allowed.includes(key)) return line;
    const raw = assignment[2] ?? "";
    const comment = trailingTomlComment(raw);
    const valueText = (comment < 0 ? raw : raw.slice(0, comment)).trim();
    let value: unknown;
    try {
      value = (parse(`value = ${valueText}`) as Row).value;
    } catch {
      return line;
    }
    if (typeof value !== "string" || !replacements[value]) return line;
    const beforeValue = raw.match(/^\s*/)?.[0] ?? "";
    const afterValue = comment < 0 ? (/[\t ]*$/.exec(raw)?.[0] ?? "") : raw.slice(comment);
    changed = true;
    return `${assignment[1]}${beforeValue}${JSON.stringify(replacements[value])}${afterValue}${ending(line)}`;
  });
  const result = rewritten.join("");
  const after = parseManifest(result);
  // Verify exactly the known selector fields changed. Unknown keys and other settings stay intact.
  if (canonical(after) !== canonical(expected))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Cannot surgically update every manifest path reference; edit the affected references manually.",
      "tbspec.toml",
    );
  if (Object.keys(replacements).length && !changed && canonical(before) !== canonical(expected))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Manifest path references could not be located safely.",
      "tbspec.toml",
    );
  return result;
}

export function editManifestView(text: string, view: Row, remove = false): string {
  const before = parseManifest(text);
  const existing = (before.views ?? []) as Row[];
  const path = view.view;
  if (typeof path !== "string")
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Select a view path.");
  let changed: string;
  if (remove) {
    const lines = (text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? []).filter(Boolean);
    const content = (line: string) => line.replace(/(?:\r\n|\n|\r)$/, "");
    const sections: { start: number; end: number; view: string }[] = [];
    for (let start = 0; start < lines.length; start++) {
      if (!/^\s*\[\[\s*views\s*\]\]\s*(?:#.*)?$/.test(content(lines[start] ?? ""))) continue;
      let end = start + 1;
      while (end < lines.length && !/^\s*\[/.test(content(lines[end] ?? ""))) end++;
      let parsed: Row;
      try {
        parsed = object(parse(lines.slice(start, end).join("")));
      } catch {
        throw new ProjectError(
          "invalid",
          "MANIFEST_INVALID",
          "Cannot safely locate the selected view association.",
          "tbspec.toml",
        );
      }
      const row = ((parsed.views ?? []) as Row[])[0];
      if (typeof row?.view === "string") sections.push({ start, end, view: row.view });
      start = end - 1;
    }
    const matches = sections.filter((section) => section.view === path);
    if (matches.length !== 1)
      throw new ProjectError(
        "invalid",
        "MANIFEST_INVALID",
        "Cannot identify exactly one selected view association.",
        "tbspec.toml",
      );
    const match = matches[0];
    if (!match) throw new Error("Missing selected view association.");
    changed = [...lines.slice(0, match.start), ...lines.slice(match.end)].join("");
    const after = parseManifest(changed);
    const expectedViews = existing.filter((entry) => entry.view !== path);
    const expected = { ...before };
    if (expectedViews.length) expected.views = expectedViews;
    else delete expected.views;
    if (canonical(after) !== canonical(expected))
      throw new ProjectError(
        "invalid",
        "MANIFEST_INVALID",
        "Removing the selected view changed unrelated configuration.",
        "tbspec.toml",
      );
    return changed;
  }

  if (existing.some((entry) => entry.view === path || entry.presentation === view.presentation))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "View or presentation path is already associated.",
      path,
    );
  const row = {
    view: path,
    presentation: view.presentation,
    source: view.source,
    ...(view.protocol === undefined ? {} : { protocol: view.protocol }),
  };
  const expected = { ...before, views: [...existing, row] };
  const newline = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const separator = text.length && !/(?:\r\n|\r|\n)$/.test(text) ? newline : "";
  changed =
    `${text}${separator}[[views]]${newline}` +
    `view = ${JSON.stringify(row.view)}${newline}` +
    `presentation = ${JSON.stringify(row.presentation)}${newline}` +
    `source = ${JSON.stringify(row.source)}${newline}` +
    (row.protocol === undefined ? "" : `protocol = ${JSON.stringify(row.protocol)}${newline}`);
  if (canonical(parseManifest(changed)) !== canonical(expected))
    throw new ProjectError(
      "invalid",
      "MANIFEST_INVALID",
      "Adding the view changed unrelated configuration.",
      "tbspec.toml",
    );
  return changed;
}

function tomlModelTypeValue(field: string, value: unknown): string {
  if (field === "enabled") {
    if (typeof value !== "boolean") throw new Error("Invalid model type enablement.");
    return String(value);
  }
  if (typeof value !== "string") throw new Error(`Invalid model type ${field}.`);
  return JSON.stringify(value);
}

function trailingTomlComment(line: string): number {
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (escaped) escaped = false;
    else if (quote === '"' && character === "\\") escaped = true;
    else if (quote && character === quote) quote = undefined;
    else if (!quote && (character === '"' || character === "'")) quote = character;
    else if (!quote && character === "#") {
      let start = index;
      while (start > 0 && /[\\t ]/.test(line[start - 1] ?? "")) start--;
      return start;
    }
  }
  return -1;
}
