import { readdir } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { QueryEngine } from "@comunica/query-sparql-rdfjs-lite";
import { BindingsFactory } from "@comunica/utils-bindings-factory";
import type { Quad, Term } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { parse as parseToml } from "smol-toml";
import { digest, graphSignature, utf8Compare } from "./canonical.ts";
import {
  equalRevision,
  fileBytes,
  inventory,
  type Revision,
  revision,
  verifyReads,
} from "./filesystem.ts";
import { captureInspection } from "./inspection.ts";
import { withLock } from "./lock.ts";
import { failure, ok, ProjectError, type Result } from "./output.ts";
import { absoluteIri, id, portablePath, safePath } from "./paths.ts";
import { discoverProject } from "./project.ts";
import { classifyGraph, parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import {
  type Dependency,
  selector as graphSelector,
  parseLock,
  parseManifest,
  type Row,
} from "./schemas.ts";
import { localQueryInfo } from "./shacl-profile.ts";
import { loadStarters } from "./starters.ts";
import { capture, preparePlan, publishPlan, type Snapshot } from "./transactions.ts";

const xsdString = "http://www.w3.org/2001/XMLSchema#string";
const rdfLangString = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
const defaultParameters = "schema_version = 1\nparameters = []\n";
const sparqlNameStartRanges: readonly (readonly [number, number])[] = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
];
const sparqlNamePartRanges = [
  ...sparqlNameStartRanges,
  [0xb7, 0xb7],
  [0x300, 0x36f],
  [0x203f, 0x2040],
] as const;
const grandfatheredLanguageTags = new Set([
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "art-lojban",
  "cel-gaulish",
  "no-bok",
  "no-nyn",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang",
]);
type Parameter = {
  name: string;
  kind: "iri" | "literal";
  required: boolean;
  datatype?: string;
  language?: string;
};
interface SavedQuery extends Row {
  name: string;
  queryFile: string;
  parametersFile: string;
  parameters: Parameter[];
}

function queryPaths(name: string) {
  const safeName = id(name);
  return {
    name: safeName,
    queryFile: `queries/${safeName}.rq`,
    parametersFile: `queries/${safeName}.query.toml`,
  };
}

function decode(bytes: Uint8Array, file: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new ProjectError(
      "invalid",
      "QUERY_FILE_INVALID",
      "Query files must be valid UTF-8.",
      file,
    );
  }
}

function queryInfo(text: string, status: "invalid" | "invalid_arguments" = "invalid") {
  return localQueryInfo(text.startsWith("\uFEFF") ? text.slice(1) : text, status);
}

function isSparqlVariableName(value: string): boolean {
  const codePoints = [...value].map((character) => character.codePointAt(0) ?? -1);
  const matches = (codePoint: number, ranges: readonly (readonly [number, number])[]) =>
    ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
  return (
    codePoints.length > 0 &&
    matches(codePoints[0] ?? -1, sparqlNameStartRanges) &&
    codePoints.slice(1).every((codePoint) => matches(codePoint, sparqlNamePartRanges))
  );
}

export type QueryRevisions = { query: Revision; parameters: Revision };

function assertExpectedRevisions(
  snapshot: Snapshot,
  files: ReturnType<typeof queryPaths>,
  expected?: QueryRevisions,
) {
  if (!expected) return;
  for (const [key, path] of [
    ["query", files.queryFile],
    ["parameters", files.parametersFile],
  ] as const) {
    if (!equalRevision(expected[key], revision(snapshot.files[path] ?? null)))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Saved query changed since it was reviewed. Refresh and review the latest query before applying this change.",
        path,
      );
  }
}

function parameterError(
  status: "invalid" | "invalid_arguments",
  file: string,
  message: string,
): never {
  throw new ProjectError(status, "QUERY_DECLARATION_INVALID", message, file);
}

function fields(
  row: Row,
  allowed: string[],
  required: string[],
  status: "invalid" | "invalid_arguments",
  file: string,
) {
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    Object.keys(row).some((key) => !allowed.includes(key))
  )
    parameterError(status, file, "Saved query declaration has missing or unknown fields.");
}

function parseParameters(
  text: string,
  variables: Set<string>,
  file: string,
  status: "invalid" | "invalid_arguments",
): Parameter[] {
  let value: unknown;
  try {
    value = parseToml(text.startsWith("\uFEFF") ? text.slice(1) : text);
  } catch {
    parameterError(status, file, "Saved query declaration is malformed TOML.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    parameterError(status, file, "Saved query declaration must be a TOML table.");
  const declaration = value as Row;
  fields(
    declaration,
    ["schema_version", "parameters"],
    ["schema_version", "parameters"],
    status,
    file,
  );
  if (declaration.schema_version !== 1)
    throw new ProjectError(
      status,
      "SCHEMA_UNSUPPORTED",
      "Saved queries require schema_version = 1.",
      file,
    );
  const entries = declaration.parameters;
  if (!Array.isArray(entries))
    parameterError(status, file, "Saved query parameters must be an array of tables.");
  const names = new Set<string>();
  const parameters: Parameter[] = [];
  for (const item of entries) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      parameterError(status, file, "Saved query parameters must be tables.");
    const row = item as Row;
    fields(
      row,
      ["name", "kind", "required", "datatype", "language"],
      ["name", "kind", "required"],
      status,
      file,
    );
    if (
      typeof row.name !== "string" ||
      !isSparqlVariableName(row.name) ||
      !variables.has(row.name) ||
      names.has(row.name)
    )
      parameterError(
        status,
        file,
        "Saved query parameter is malformed, duplicated, or absent from the query.",
      );
    if ((row.kind !== "iri" && row.kind !== "literal") || typeof row.required !== "boolean")
      parameterError(
        status,
        file,
        "Saved query parameter is malformed, duplicated, or absent from the query.",
      );
    const name = row.name as string;
    const kind = row.kind as Parameter["kind"];
    const required = row.required as boolean;
    if (kind === "iri" && (row.datatype !== undefined || row.language !== undefined))
      parameterError(status, file, "IRI parameters cannot declare a datatype or language.");
    if (
      kind === "literal" &&
      (row.datatype !== undefined || row.language !== undefined) &&
      row.datatype !== undefined &&
      row.language !== undefined
    )
      parameterError(status, file, "Literal parameters cannot declare both datatype and language.");
    const parameter: Parameter = {
      name,
      kind,
      required,
    };
    if (kind === "literal" && row.datatype !== undefined) {
      if (
        typeof row.datatype !== "string" ||
        !absoluteIri(row.datatype) ||
        row.datatype === rdfLangString
      )
        parameterError(
          status,
          file,
          "Literal datatype must be an absolute IRI; language uses the language field.",
        );
      parameter.datatype = row.datatype;
    }
    if (kind === "literal" && row.language !== undefined) {
      if (typeof row.language !== "string" || !validLanguageTag(row.language))
        parameterError(status, file, "Literal language must be a well-formed BCP 47 tag.");
      parameter.language = row.language.toLowerCase();
    }
    names.add(name);
    parameters.push(parameter);
  }
  return parameters;
}

function validLanguageTag(value: string): boolean {
  const lower = value.toLowerCase();
  if (grandfatheredLanguageTags.has(lower)) return true;
  const parts = lower.split("-");
  if (parts.some((part) => !/^[a-z0-9]{1,8}$/.test(part))) return false;
  if (parts[0] === "x") return parts.length > 1;
  let index = 0;
  const language = parts[index] ?? "";
  if (/^[a-z]{2,3}$/.test(language)) {
    index++;
    let extlangs = 0;
    while (index < parts.length && /^[a-z]{3}$/.test(parts[index] ?? "") && extlangs < 3) {
      index++;
      extlangs++;
    }
  } else if (/^(?:[a-z]{4}|[a-z]{5,8})$/.test(language)) {
    index++;
  } else {
    return false;
  }
  if (/^[a-z]{4}$/.test(parts[index] ?? "")) index++;
  if (/^(?:[a-z]{2}|[0-9]{3})$/.test(parts[index] ?? "")) index++;
  const variants = new Set<string>();
  while (index < parts.length && /^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/.test(parts[index] ?? "")) {
    const variant = parts[index] ?? "";
    if (variants.has(variant)) return false;
    variants.add(variant);
    index++;
  }
  const singletons = new Set<string>();
  while (index < parts.length && /^[0-9a-wy-z]$/.test(parts[index] ?? "")) {
    const singleton = parts[index] ?? "";
    if (singletons.has(singleton) || !/^[a-z0-9]{2,8}$/.test(parts[index + 1] ?? "")) return false;
    singletons.add(singleton);
    index += 2;
    while (index < parts.length && /^[a-z0-9]{2,8}$/.test(parts[index] ?? "")) index++;
  }
  if (parts[index] === "x") {
    index++;
    if (index === parts.length) return false;
    while (index < parts.length && /^[a-z0-9]{1,8}$/.test(parts[index] ?? "")) index++;
  }
  return index === parts.length;
}

async function querySnapshot(root: string, paths: string[]): Promise<Snapshot> {
  return capture(root, paths, [{ path: "queries", included: ["queries"], excluded: [] }]);
}

async function capturedBytes(
  root: string,
  snapshot: Snapshot & { ownedPaths?: string[]; target?: string },
  path: string,
): Promise<Buffer | null> {
  if (Object.hasOwn(snapshot.files, path)) return snapshot.files[path] ?? null;
  const captured = snapshot.reads.find((read) => read.kind === "file" && read.path === path);
  if (!captured)
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Graph was not included in the coherent query capture.",
      path,
    );
  const bytes = await fileBytes(root, path);
  if (!equalRevision(captured.revision, revision(bytes)))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Graph changed after the query capture.",
      path,
    );
  return bytes;
}

async function savedQuery(
  snapshot: Snapshot,
  name: string,
  status: "invalid" | "invalid_arguments" = "invalid",
) {
  const files = queryPaths(name);
  const queryBytes = snapshot.files[files.queryFile];
  const parametersBytes = snapshot.files[files.parametersFile];
  if (!queryBytes || !parametersBytes)
    throw new ProjectError(
      "unavailable",
      "RESOURCE_MISSING",
      "Saved query files are incomplete.",
      files.queryFile,
    );
  const queryText = decode(queryBytes, files.queryFile);
  const info = queryInfo(queryText, status);
  const parameters = parseParameters(
    decode(parametersBytes, files.parametersFile),
    info.variables,
    files.parametersFile,
    status,
  );
  return {
    ...files,
    queryText,
    parameters,
    info,
    revisions: { query: revision(queryBytes), parameters: revision(parametersBytes) },
  };
}

async function readQueryDirectory(root: string) {
  return withLock(root, async () => {
    let names: string[] = [];
    try {
      names = await readdir(await safePath(root, "queries"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const paths = names
      .filter((name) => name.endsWith(".rq") || name.endsWith(".query.toml"))
      .map((name) => portablePath(`queries/${name}`))
      .sort(utf8Compare);
    const files: Record<string, Buffer | null> = {};
    const reads = [] as (
      | { kind: "file"; path: string; revision: Revision }
      | {
          kind: "inventory";
          path: string;
          revision: Revision;
          scope: { included: string[]; excluded: string[] };
        }
    )[];
    for (const path of paths) {
      const bytes = await fileBytes(root, path);
      files[path] = bytes;
      reads.push({ kind: "file", path, revision: revision(bytes) });
    }
    const scope = { included: ["queries"], excluded: [] };
    reads.push({
      kind: "inventory",
      path: "queries",
      revision: await inventory(root, "queries", scope),
      scope,
    });
    await verifyReads(root, reads);
    return { projectRoot: root, files, reads } satisfies Snapshot;
  });
}

export async function listQueries(options: {
  project?: string;
  cwd?: string;
}): Promise<Result<{ items: SavedQuery[] }>> {
  try {
    const root = await discoverProject(options);
    const snapshot = await readQueryDirectory(root);
    const names = new Set<string>();
    for (const path of Object.keys(snapshot.files)) {
      const name = path.endsWith(".rq")
        ? path.slice("queries/".length, -3)
        : path.slice("queries/".length, -".query.toml".length);
      names.add(name);
    }
    const items = [...names].sort(utf8Compare).map((name) => {
      const query = savedQuerySync(snapshot, name);
      return {
        name: query.name,
        queryFile: query.queryFile,
        parametersFile: query.parametersFile,
        parameters: query.parameters,
      };
    });
    return ok({ items });
  } catch (error) {
    return failure(error) as Result<{ items: SavedQuery[] }>;
  }
}

function savedQuerySync(snapshot: Snapshot, name: string) {
  const files = queryPaths(name);
  const queryBytes = snapshot.files[files.queryFile];
  const parametersBytes = snapshot.files[files.parametersFile];
  if (!queryBytes || !parametersBytes)
    throw new ProjectError(
      "invalid",
      "QUERY_FILE_INVALID",
      "Saved query must include both query and declaration files.",
      files.queryFile,
    );
  const queryText = decode(queryBytes, files.queryFile);
  const info = queryInfo(queryText);
  const parameters = parseParameters(
    decode(parametersBytes, files.parametersFile),
    info.variables,
    files.parametersFile,
    "invalid",
  );
  return {
    ...files,
    name,
    queryText,
    parameters,
    info,
    revisions: { query: revision(queryBytes), parameters: revision(parametersBytes) },
  };
}

export async function showQuery(options: {
  project?: string;
  cwd?: string;
  name: string;
}): Promise<
  Result<SavedQuery & { queryText: string; revisions: { query: Revision; parameters: Revision } }>
> {
  try {
    const files = queryPaths(options.name);
    const root = await discoverProject(options);
    const snapshot = await querySnapshot(root, [files.queryFile, files.parametersFile]);
    const query = await savedQuery(snapshot, files.name);
    return ok({
      name: query.name,
      queryFile: query.queryFile,
      parametersFile: query.parametersFile,
      parameters: query.parameters,
      queryText: query.queryText,
      revisions: query.revisions,
    });
  } catch (error) {
    return failure(error) as Result<
      SavedQuery & { queryText: string; revisions: { query: Revision; parameters: Revision } }
    >;
  }
}

export async function querySave(options: {
  project?: string;
  cwd?: string;
  name: string;
  queryText: string;
  parametersText?: string;
  expectedRevisions?: QueryRevisions;
}): Promise<Result> {
  try {
    const files = queryPaths(options.name);
    if (!options.queryText.isWellFormed())
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Query text must be valid Unicode.",
      );
    if (options.parametersText !== undefined && !options.parametersText.isWellFormed())
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Query declarations must be valid Unicode.",
      );
    const info = queryInfo(options.queryText, "invalid_arguments");
    const root = await discoverProject(options);
    const snapshot = await querySnapshot(root, [files.queryFile, files.parametersFile]);
    assertExpectedRevisions(snapshot, files, options.expectedRevisions);
    const existingParameters = snapshot.files[files.parametersFile];
    const parametersBytes =
      options.parametersText === undefined
        ? (existingParameters ?? Buffer.from(defaultParameters))
        : Buffer.from(options.parametersText);
    parseParameters(
      options.parametersText === undefined && existingParameters
        ? decode(existingParameters, files.parametersFile)
        : (options.parametersText ?? defaultParameters),
      info.variables,
      files.parametersFile,
      "invalid_arguments",
    );
    const plan = preparePlan(
      snapshot,
      "query.save",
      [
        { file: files.queryFile, bytes: Buffer.from(options.queryText) },
        { file: files.parametersFile, bytes: parametersBytes },
      ],
      { name: files.name },
    );
    const diagnostics = await publishPlan(root, plan);
    return ok(
      { applied: true, changes: plan.preview.changes, projectValidity: "unchecked" },
      diagnostics,
    );
  } catch (error) {
    return failure(error);
  }
}

export async function queryRemove(options: {
  project?: string;
  cwd?: string;
  name: string;
  confirm?: boolean;
  expectedRevisions?: QueryRevisions;
}): Promise<Result> {
  try {
    const files = queryPaths(options.name);
    const root = await discoverProject(options);
    const snapshot = await querySnapshot(root, [files.queryFile, files.parametersFile]);
    assertExpectedRevisions(snapshot, files, options.expectedRevisions);
    if (!snapshot.files[files.queryFile] || !snapshot.files[files.parametersFile])
      throw new ProjectError(
        "unavailable",
        "RESOURCE_MISSING",
        "Saved query files are incomplete.",
        files.queryFile,
      );
    const plan = preparePlan(
      snapshot,
      "query.remove",
      [
        { file: files.queryFile, bytes: null },
        { file: files.parametersFile, bytes: null },
      ],
      { name: files.name },
    );
    if (!options.confirm)
      return { ...ok({ applied: false, preview: plan.preview }), status: "preview" };
    const diagnostics = await publishPlan(root, plan);
    return ok(
      { applied: true, changes: plan.preview.changes, projectValidity: "unchecked" },
      diagnostics,
    );
  } catch (error) {
    return failure(error);
  }
}

function jsonObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}[\],:]/g) ?? [];
    const scopes: (Set<string> | null)[] = [];
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token === "{") scopes.push(new Set());
      else if (token === "[") scopes.push(null);
      else if (token === "}" || token === "]") scopes.pop();
      else if (token?.startsWith('"') && tokens[index + 1] === ":") {
        const key = JSON.parse(token) as string;
        if (scopes.at(-1)?.has(key)) throw new Error();
        scopes.at(-1)?.add(key);
      }
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ProjectError(
      "invalid_arguments",
      "BINDING_INVALID",
      "Bindings must be a UTF-8 JSON object with unique field names.",
    );
  }
}

function bindingTerm(value: unknown, name: string): { term: Term; record: Row } {
  const invalid = () =>
    new ProjectError("invalid_arguments", "BINDING_INVALID", `Binding for ${name} is invalid.`);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const row = value as Row;
  if (row.kind === "iri") {
    if (Object.keys(row).sort().join(",") !== "kind,value" || !absoluteIri(row.value))
      throw invalid();
    return { term: DataFactory.namedNode(row.value), record: { kind: "iri", value: row.value } };
  }
  if (row.kind !== "literal" || typeof row.value !== "string" || !row.value.isWellFormed())
    throw invalid();
  const keys = Object.keys(row).sort().join(",");
  if (!["kind,value", "kind,language,value", "datatype,kind,value"].includes(keys)) throw invalid();
  if (row.datatype !== undefined && (!absoluteIri(row.datatype) || row.datatype === rdfLangString))
    throw invalid();
  if (
    row.language !== undefined &&
    (typeof row.language !== "string" || !validLanguageTag(row.language))
  )
    throw invalid();
  const language = typeof row.language === "string" ? row.language.toLowerCase() : undefined;
  const datatype = typeof row.datatype === "string" ? row.datatype : xsdString;
  const term = language
    ? DataFactory.literal(row.value, language)
    : DataFactory.literal(row.value, DataFactory.namedNode(datatype));
  return {
    term,
    record: { kind: "literal", value: row.value, ...(language ? { language } : { datatype }) },
  };
}

function typedBindings(
  text: string | undefined,
  variables: Set<string>,
  parameters?: Parameter[],
): Record<string, Term> {
  const input = text === undefined ? {} : jsonObject(text);
  const declarations = new Map((parameters ?? []).map((parameter) => [parameter.name, parameter]));
  const bindings: Record<string, Term> = {};
  for (const [name, raw] of Object.entries(input)) {
    const declaration = declarations.get(name);
    if (parameters && !declaration)
      throw new ProjectError(
        "invalid_arguments",
        "BINDING_INVALID",
        "Binding names an undeclared saved-query parameter.",
      );
    if (!variables.has(name))
      throw new ProjectError(
        "invalid_arguments",
        "BINDING_INVALID",
        "Binding names a variable absent from the query.",
      );
    const { term, record } = bindingTerm(raw, name);
    if (declaration) {
      if (
        record.kind !== declaration.kind ||
        (declaration.datatype && record.datatype !== declaration.datatype) ||
        (declaration.language && record.language !== declaration.language)
      )
        throw new ProjectError(
          "invalid_arguments",
          "BINDING_INVALID",
          "Binding does not match its saved-query parameter declaration.",
        );
    }
    bindings[name] = term;
  }
  for (const parameter of parameters ?? [])
    if (parameter.required && !Object.hasOwn(input, parameter.name))
      throw new ProjectError(
        "invalid_arguments",
        "BINDING_INVALID",
        "A required saved-query binding is missing.",
      );
  return bindings;
}

interface LoadedGraph {
  selector: string;
  file: string;
  graphIri: string;
  kind: string;
  signature: string;
  store: Store;
}

function mediaProfile(path: string) {
  const mediaType = rdfFormats[extname(path).toLowerCase()];
  if (!mediaType)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Graph selector must name a supported RDF graph.",
      path,
    );
  return {
    mediaType,
    parserProfile:
      mediaType === "text/turtle"
        ? "turtle-strict-v1"
        : mediaType === "application/n-triples"
          ? "ntriples-strict-v1"
          : "rdfxml-no-dtd-v1",
  };
}

function identitySignature(bytes: Buffer, baseIri: string, path: string) {
  const profile = mediaProfile(path);
  return graphSignature({
    byte_digest: digest(bytes),
    media_type: profile.mediaType,
    base_iri: baseIri,
    parser_profile: profile.parserProfile,
  });
}

async function loadSelected(root: string, selectorValue: string): Promise<LoadedGraph> {
  let target: string;
  try {
    target = graphSelector(selectorValue.replaceAll("\\", "/"));
  } catch {
    throw new ProjectError("invalid_arguments", "ARGUMENT_INVALID", "Invalid graph selector.");
  }
  const snapshot = await captureInspection(root, "graph.show", target);
  const expanded = snapshot.target ?? target;
  let graph: LoadedGraph;
  if (expanded.startsWith("dep:")) {
    const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    const [idValue, ...parts] = expanded.slice(4).split("/");
    const dependency = lock.dependencies[idValue ?? ""];
    const locked = dependency?.files.find((file) => file.key === parts.join("/"));
    if (!dependency || !locked)
      throw new ProjectError(
        "unavailable",
        "RESOURCE_MISSING",
        "Selected dependency graph is unavailable.",
        expanded,
      );
    const file = `${dependency.snapshot_path}/${locked.key}`;
    const bytes = await capturedBytes(root, snapshot, file);
    if (!bytes)
      throw new ProjectError(
        "invalid",
        "SNAPSHOT_INTEGRITY",
        "Selected locked graph is missing.",
        file,
      );
    const bundle = await loadStarters();
    const store = await parseGraph(bytes, locked, bundle.vettedDigest, expanded);
    graph = {
      selector: expanded,
      file,
      graphIri: locked.graph_iri,
      kind: locked.kind,
      signature: locked.graph_signature,
      store,
    };
  } else {
    const file = expanded;
    const bytes = snapshot.files[file];
    if (!bytes)
      throw new ProjectError(
        "unavailable",
        "RESOURCE_MISSING",
        "Selected project graph is unavailable.",
        file,
      );
    const profile = mediaProfile(file);
    const rootPath = await safePath(root, file);
    let store: Store;
    try {
      store = await parseRdf(
        bytes,
        profile.mediaType,
        pathToFileURL(rootPath).href,
        false,
        expanded,
      );
    } catch {
      throw new ProjectError("invalid", "RDF_SYNTAX", "Cannot parse selected RDF graph.", file);
    }
    const classification = classifyGraph(store, expanded);
    graph = {
      selector: expanded,
      file,
      graphIri: classification.graphIri,
      kind: classification.kind,
      signature: identitySignature(bytes, pathToFileURL(rootPath).href, file),
      store,
    };
  }
  return graph;
}

interface Candidate {
  selector: string;
  graphIri: string;
  signature: string;
  rank: number;
  dependencyId?: string;
  dependency?: Dependency;
  file?: Dependency["files"][number];
}

function reachableFiles(dependency: Dependency): Map<string, number> {
  const distances = new Map<string, number>([[dependency.primary, 0]]);
  const queue = [dependency.primary];
  const add = (key: string, from: string) => {
    const distance = (distances.get(from) ?? 0) + 1;
    if (!distances.has(key) || distance < (distances.get(key) ?? Infinity)) {
      distances.set(key, distance);
      queue.push(key);
    }
  };
  while (queue.length) {
    const key = queue.shift();
    if (!key) continue;
    for (const edge of dependency.edges)
      if (edge.from === key && edge.to) add(String(edge.to), key);
    for (const binding of dependency.bindings)
      if (binding.resource === key)
        for (const file of [
          ...(Array.isArray(binding.ontologies) ? binding.ontologies : []),
          ...(Array.isArray(binding.schemas) ? binding.schemas : []),
        ])
          add(String(file), key);
    for (const association of dependency.associations)
      if (association.resource === key && association.active) add(String(association.support), key);
    for (const choice of dependency.choices) add(String(choice.selected), key);
  }
  return distances;
}

async function loadFullDataset(root: string): Promise<Store> {
  const snapshot = await captureInspection(root, "status");
  const manifest = parseManifest(snapshot.files["tbspec.toml"]?.toString("utf8") ?? "");
  const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
  const bundle = await loadStarters();
  const reachable = new Map<string, Map<string, number>>();
  for (const [idValue, dependency] of Object.entries(lock.dependencies)) {
    const distances = reachableFiles(dependency);
    reachable.set(idValue, distances);
  }
  const loaded = new Map<string, LoadedGraph>();
  const localCandidates: Candidate[] = [];
  for (const file of snapshot.ownedPaths) {
    const bytes = await capturedBytes(root, snapshot, file);
    if (!bytes) continue;
    const profile = mediaProfile(file);
    const baseIri = pathToFileURL(await safePath(root, file)).href;
    let store: Store;
    try {
      store = await parseRdf(bytes, profile.mediaType, baseIri, false, file);
    } catch {
      throw new ProjectError("invalid", "RDF_SYNTAX", "Cannot parse required project graph.", file);
    }
    const classification = classifyGraph(store, file);
    const graph: LoadedGraph = {
      selector: file,
      file,
      graphIri: classification.graphIri,
      kind: classification.kind,
      signature: identitySignature(bytes, baseIri, file),
      store,
    };
    loaded.set(file, graph);
    if (graph.kind === "ontology")
      localCandidates.push({
        selector: file,
        graphIri: graph.graphIri,
        signature: graph.signature,
        rank: 1,
      });
  }
  const dependencyCandidates: Candidate[] = [];
  for (const [idValue, dependency] of Object.entries(lock.dependencies)) {
    for (const [key, distance] of reachable.get(idValue) ?? []) {
      const file = dependency.files.find((item) => item.key === key);
      if (file?.kind === "ontology")
        dependencyCandidates.push({
          selector: `dep:${idValue}/${key}`,
          graphIri: file.graph_iri,
          signature: file.graph_signature,
          rank: 2 + distance,
          dependencyId: idValue,
          dependency,
          file,
        });
    }
  }
  const allCandidates = [...localCandidates, ...dependencyCandidates];
  const ontologyWinners = new Set<string>();
  const winningCandidateGroups: Candidate[][] = [];
  const ontologyIris = new Set(allCandidates.map((candidate) => candidate.graphIri));
  for (const [iri, chosen] of Object.entries(
    (manifest.ontology_choices as Record<string, string> | undefined) ?? {},
  ))
    if (!ontologyIris.has(iri))
      throw new ProjectError(
        "conflict",
        "ONTOLOGY_CONFLICT",
        "Configured ontology choice has no matching candidate graph.",
        "tbspec.toml",
        { graphIri: iri, dependency: chosen },
      );
  for (const graphIri of ontologyIris) {
    let candidates = allCandidates.filter((candidate) => candidate.graphIri === graphIri);
    candidates = candidates.filter((candidate) => {
      if (!candidate.dependency || !candidate.file) return true;
      const choices = candidate.dependency.choices.filter(
        (choice) =>
          choice.kind === "ontology" &&
          choice.target_iri === graphIri &&
          choice.context === candidate.file?.context,
      );
      return (
        choices.length === 0 || choices.some((choice) => choice.selected === candidate.file?.key)
      );
    });
    const chosenId = (manifest.ontology_choices as Record<string, string> | undefined)?.[graphIri];
    if (chosenId) {
      const selected = candidates.filter((candidate) => candidate.dependencyId === chosenId);
      if (!selected.length)
        throw new ProjectError(
          "conflict",
          "ONTOLOGY_CONFLICT",
          "Configured ontology choice has no matching effective dependency candidate.",
          "tbspec.toml",
          { graphIri, dependency: chosenId },
        );
      candidates = selected;
    }
    if (!candidates.length) continue;
    const rank = Math.min(...candidates.map((candidate) => candidate.rank));
    const winners = candidates.filter((candidate) => candidate.rank === rank);
    if (new Set(winners.map((candidate) => candidate.signature)).size > 1)
      throw new ProjectError(
        "conflict",
        "ONTOLOGY_CONFLICT",
        "Different ontology candidates tie at the effective resolution rank.",
        null,
        { graphIri, selectors: winners.map((candidate) => candidate.selector).sort(utf8Compare) },
      );
    for (const winner of winners) ontologyWinners.add(winner.selector);
    winningCandidateGroups.push(winners);
  }
  for (const group of winningCandidateGroups) {
    const selected = [...group].sort((left, right) =>
      utf8Compare(left.selector, right.selector),
    )[0];
    if (!selected) continue;
    if (selected.file && selected.dependency && selected.dependencyId) {
      const bytes = await capturedBytes(
        root,
        snapshot,
        `${selected.dependency.snapshot_path}/${selected.file.key}`,
      );
      if (!bytes)
        throw new ProjectError(
          "invalid",
          "SNAPSHOT_INTEGRITY",
          "Required locked ontology is missing.",
          `${selected.dependency.snapshot_path}/${selected.file.key}`,
        );
      const store = await parseGraph(bytes, selected.file, bundle.vettedDigest, selected.selector);
      loaded.set(selected.selector, {
        selector: selected.selector,
        file: `${selected.dependency.snapshot_path}/${selected.file.key}`,
        graphIri: selected.file.graph_iri,
        kind: selected.file.kind,
        signature: selected.signature,
        store,
      });
    }
  }
  for (const candidate of localCandidates)
    if (!ontologyWinners.has(candidate.selector)) loaded.delete(candidate.selector);
  const effectiveDependencyFiles = new Map<string, Set<string>>();
  for (const [idValue, dependency] of Object.entries(lock.dependencies)) {
    const keys = new Set<string>();
    for (const [key] of reachable.get(idValue) ?? []) {
      const file = dependency.files.find((item) => item.key === key);
      if (!file) continue;
      if (file.kind === "ontology" && !ontologyWinners.has(`dep:${idValue}/${key}`)) continue;
      if (["shapes", "design"].includes(file.kind)) {
        const associations = dependency.associations.filter(
          (item) => item.active && item.support === key,
        );
        if (
          associations.length &&
          !associations.some((item) => {
            const owner = dependency.files.find((candidate) => candidate.key === item.resource);
            return owner?.kind !== "ontology" || ontologyWinners.has(`dep:${idValue}/${owner.key}`);
          })
        )
          continue;
      }
      keys.add(key);
    }
    effectiveDependencyFiles.set(idValue, keys);
  }
  const dataset = new Store();
  const graphOwners = new Map<string, LoadedGraph>();
  const register = (graph: LoadedGraph) => {
    const prior = graphOwners.get(graph.graphIri);
    if (prior) {
      if (prior.signature === graph.signature) return;
      throw new ProjectError(
        "conflict",
        "GRAPH_IRI_COLLISION",
        "Loaded resources declare the same graph IRI.",
        graph.file,
        { graphIri: graph.graphIri, selectors: [prior.selector, graph.selector].sort(utf8Compare) },
      );
    }
    graphOwners.set(graph.graphIri, graph);
    const named = DataFactory.namedNode(graph.graphIri);
    for (const quad of graph.store) {
      dataset.addQuad(DataFactory.quad(quad.subject, quad.predicate, quad.object, named));
      if (graph.kind === "ontology" || graph.kind === "model" || graph.kind.endsWith("-model"))
        dataset.addQuad(DataFactory.quad(quad.subject, quad.predicate, quad.object));
    }
  };
  for (const graph of loaded.values()) register(graph);
  for (const [idValue, keys] of effectiveDependencyFiles) {
    const dependency = lock.dependencies[idValue];
    if (!dependency) continue;
    for (const key of keys) {
      const graph = loaded.get(`dep:${idValue}/${key}`);
      if (graph) {
        register(graph);
        continue;
      }
      const file = dependency.files.find((item) => item.key === key);
      if (!file) continue;
      const physical = `${dependency.snapshot_path}/${key}`;
      const bytes = await capturedBytes(root, snapshot, physical);
      if (!bytes)
        throw new ProjectError(
          "invalid",
          "SNAPSHOT_INTEGRITY",
          "Required locked graph is missing.",
          physical,
        );
      const store = await parseGraph(bytes, file, bundle.vettedDigest, `dep:${idValue}/${key}`);
      register({
        selector: `dep:${idValue}/${key}`,
        file: physical,
        graphIri: file.graph_iri,
        kind: file.kind,
        signature: file.graph_signature,
        store,
      });
    }
  }
  await verifyReads(root, snapshot.reads);
  return dataset;
}

function outputTerm(term: Term, blanks: Map<string, string>): Row {
  if (term.termType === "NamedNode") return { kind: "iri", value: term.value };
  if (term.termType === "BlankNode") {
    if (!blanks.has(term.value)) blanks.set(term.value, `b${blanks.size}`);
    return { kind: "blank", value: blanks.get(term.value), scope: "result" };
  }
  if (term.termType === "Literal")
    return {
      kind: "literal",
      value: term.value,
      ...(term.language
        ? { language: term.language.toLowerCase() }
        : { datatype: term.datatype.value }),
    };
  throw new ProjectError("invalid", "RDF_FORMAT_UNSUPPORTED", "Unsupported query result term.");
}

function queryDataset(graph: LoadedGraph) {
  const dataset = new Store();
  const named = DataFactory.namedNode(graph.graphIri);
  for (const quad of graph.store) {
    dataset.addQuad(DataFactory.quad(quad.subject, quad.predicate, quad.object, named));
    dataset.addQuad(DataFactory.quad(quad.subject, quad.predicate, quad.object));
  }
  return dataset;
}

export async function queryRun(options: {
  project?: string;
  cwd?: string;
  queryText?: string;
  saved?: string;
  graph?: string;
  bindingsText?: string;
}): Promise<Result> {
  try {
    if ((options.queryText === undefined) === (options.saved === undefined))
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Choose exactly one of queryText or saved.",
      );
    const root = await discoverProject(options);
    let text = options.queryText;
    let parameters: Parameter[] = [];
    let queryReads: Snapshot | undefined;
    if (options.saved !== undefined) {
      const files = queryPaths(options.saved);
      queryReads = await querySnapshot(root, [files.queryFile, files.parametersFile]);
      const saved = await savedQuery(queryReads, files.name);
      text = saved.queryText;
      parameters = saved.parameters;
    }
    if (typeof text !== "string" || !text.isWellFormed())
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "Query text must be valid Unicode.",
      );
    if (text.startsWith("\uFEFF")) text = text.slice(1);
    const info = queryInfo(text, "invalid_arguments");
    const bindings = typedBindings(
      options.bindingsText,
      info.variables,
      options.saved === undefined ? undefined : parameters,
    );
    const dataset = options.graph
      ? queryDataset(await loadSelected(root, options.graph))
      : await loadFullDataset(root);
    if (queryReads) await verifyReads(root, queryReads.reads);
    const context = {
      sources: [dataset],
      unionDefaultGraph: false,
      ...(Object.keys(bindings).length
        ? { initialBindings: new BindingsFactory(DataFactory).fromRecord(bindings) }
        : {}),
    };
    const engine = new QueryEngine();
    if (info.form === "ask")
      return ok({ type: "ask", value: await engine.queryBoolean(text, context) });
    if (info.form === "select") {
      const result = await engine.query(text, context);
      if (result.resultType !== "bindings")
        throw new ProjectError(
          "invalid_arguments",
          "QUERY_REJECTED",
          "SELECT did not produce bindings.",
        );
      const variables = (await result.metadata()).variables.map((variable) => variable.value);
      const rows = await result.execute().then((stream) => stream.toArray());
      const blanks = new Map<string, string>();
      return ok({
        type: "select",
        variables,
        rows: rows.map((row) =>
          Object.fromEntries(
            variables.flatMap((name) => {
              const term = row.get(name);
              return term ? [[name, outputTerm(term, blanks)]] : [];
            }),
          ),
        ),
      });
    }
    const triples = await engine.queryQuads(text, context).then((stream) => stream.toArray());
    const blanks = new Map<string, string>();
    return ok({
      type: info.form,
      triples: triples.map((quad: Quad) => ({
        subject: outputTerm(quad.subject, blanks),
        predicate: outputTerm(quad.predicate, blanks),
        object: outputTerm(quad.object, blanks),
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export type QueryOperation =
  | { action: "list" }
  | { action: "show"; name: string }
  | {
      action: "save";
      name: string;
      queryText: string;
      parametersText?: string;
      expectedRevisions?: QueryRevisions;
    }
  | { action: "run"; queryText?: string; saved?: string; graph?: string; bindingsText?: string }
  | { action: "remove"; name: string; confirm?: boolean; expectedRevisions?: QueryRevisions };

export function queryOperation(options: {
  project: string;
  operation: QueryOperation;
}): Promise<Result> {
  const { project, operation } = options;
  if (operation.action === "list") return listQueries({ project });
  if (operation.action === "show") return showQuery({ project, name: operation.name });
  if (operation.action === "save") return querySave({ project, ...operation });
  if (operation.action === "run") return queryRun({ project, ...operation });
  return queryRemove({
    project,
    name: operation.name,
    confirm: operation.confirm,
    expectedRevisions: operation.expectedRevisions,
  });
}
