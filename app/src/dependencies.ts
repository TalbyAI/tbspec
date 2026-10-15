import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DataFactory, type Store } from "n3";
import { canonical, digest, graphSignature, hash, sortedSet, utf8Compare } from "./canonical.ts";
import { compareDiagnosticImpact } from "./diagnostic-impact.ts";
import { equalRevision, fileBytes, inventory, revision, verifyReads } from "./filesystem.ts";
import { captureInspection, inspectSnapshot, rdfTerm } from "./inspection.ts";
import { withLock } from "./lock.ts";
import { dependencyDistances, resolveOntologyCandidates } from "./ontology-resolution.ts";
import { type Diagnostic, failure, hasCode, ok, ProjectError, type Result } from "./output.ts";
import { id, portablePath, safePath } from "./paths.ts";
import { discoverProject, projectDiscoveryScope, readProject } from "./project.ts";
import { classifyGraph, parseGraph, parseRdf, rdfFormats } from "./rdf.ts";
import {
  type Dependency,
  editManifestSelectors,
  editOntologyChoice,
  interpretationSignature,
  type Lock,
  type LockedFile,
  parseLock,
  parseManifest,
  type Row,
  removeDependencyChoices,
  selector,
  writeToml,
} from "./schemas.ts";
import { loadStarters } from "./starters.ts";
import {
  capture,
  type Plan,
  preparePlan,
  publishPlan,
  type Snapshot,
  withPlanImpact,
} from "./transactions.ts";

const owlImports = "http://www.w3.org/2002/07/owl#imports";
const metadata = "https://talby.ai/ontology/tbspec#";
const supportedSuffix = /\.(?:ttl|nt|rdf|owl)$/i;
const ignoredDirectoryNames = new Set([
  ".git",
  ".tbspec",
  ".scratch",
  ".cache",
  "node_modules",
  "coverage",
  "dist",
  "target",
  "tmp",
  "temp",
]);

type AcquisitionKind = "directory" | "git" | "url";
type ResourceKind = "ontology" | "model" | "design";
interface Limits {
  maxGraphBytes: number;
  maxTotalBytes: number;
  maxFiles: number;
  maxRedirects: number;
  deadlineMs: number;
  maxGitWorkspaceBytes: number;
}
interface SourceOptions {
  source: string;
  cwd?: string;
  ref?: string;
  resource?: string;
  limits: Limits;
  signal?: AbortSignal;
}
interface SourceEntry {
  address: string;
  sourceResource: string;
  source: string;
  context: string;
  bytes: Buffer | null;
  mediaType?: string;
  baseIri?: string;
  profile?: string;
  lockedFile?: LockedFile;
  lockedDependency?: Dependency;
  store?: Store;
  byteDigest?: string;
  byteLength?: number;
  parseable?: boolean;
  sourcePath?: string;
  capturedDigest?: string;
  readBytes?: () => Promise<Buffer | null>;
  kind?: string;
  classification?: string;
  identity?: "declared" | "generated";
  graphIri?: string;
  parseError?: ProjectError;
}
interface SourceInventory {
  kind: AcquisitionKind;
  locator: string;
  effectiveLocator?: string;
  ref?: string;
  resolvedCommit?: string;
  revisionKind?: "default" | "ref" | "commit";
  root?: string;
  manifest?: Row;
  lock?: Lock;
  entries: Map<string, SourceEntry>;
  files?: Map<string, { mode: string; oid: string }>;
  submodules?: string[];
  treeRevision?: string;
  diagnostics: Diagnostic[];
  cleanup?: () => Promise<void>;
  verifyIncluded?: (entries: SourceEntry[]) => Promise<void>;
  vettedDigest?: string;
  signal?: AbortSignal;
  deadline: number;
}
export interface PreparedDependency {
  root: string;
  id: string;
  dependency: Dependency;
  plan: Plan;
  diagnostics: Diagnostic[];
  projectValidity: "valid" | "invalid" | "unchecked";
  validationComplete: boolean;
  requiresImpactAcceptance?: boolean;
  administration?: {
    kind: "rename" | "remove";
    details: Record<string, unknown>;
  };
}

function checkCancelled(source: SourceInventory): void {
  if (source.signal?.aborted)
    throw new ProjectError(
      "conflict",
      "ACQUISITION_CANCELLED",
      "Dependency acquisition was cancelled.",
    );
  if (Date.now() >= source.deadline)
    throw new ProjectError(
      "unavailable",
      "ACQUISITION_TIMEOUT",
      "Dependency acquisition exceeded its time limit.",
    );
}

function readError(
  message: string,
  status: "invalid" | "unavailable" | "invalid_arguments" = "unavailable",
  code = "SOURCE_UNAVAILABLE",
) {
  return new ProjectError(status, code, message);
}

function defaultLimits(manifest: Row): Limits {
  const value = (manifest.acquisition ?? {}) as Record<string, unknown>;
  return {
    maxGraphBytes: Number(value.max_graph_bytes ?? 67108864),
    maxTotalBytes: Number(value.max_total_bytes ?? 268435456),
    maxFiles: Number(value.max_files ?? 1000),
    maxRedirects: Number(value.max_redirects ?? 5),
    deadlineMs: Number(value.deadline_ms ?? 300000),
    maxGitWorkspaceBytes: Number(value.max_git_workspace_bytes ?? 1073741824),
  };
}

function safeHttpUrl(value: string, purpose: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw readError(
      `${purpose} must be a valid HTTP(S) URL.`,
      "invalid_arguments",
      "SOURCE_LOCATOR_INVALID",
    );
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw readError(
      `${purpose} must use HTTP or HTTPS.`,
      "invalid_arguments",
      "SOURCE_LOCATOR_INVALID",
    );
  if (
    url.username ||
    url.password ||
    hasUrlUserInfo(value) ||
    value.includes("?") ||
    value.includes("#")
  )
    throw readError(
      `${purpose} must be a credential-free URL without query strings or fragments. Use transient authentication or a stable locator.`,
      "invalid_arguments",
      "SOURCE_LOCATOR_UNSAFE",
    );
  return url;
}

function hasUrlUserInfo(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(value);
}

function gitLocator(raw: string, cwd?: string): { locator: string; localRoot?: string; url?: URL } {
  const value = raw.startsWith("git+https://") || raw.startsWith("git+ssh://") ? raw.slice(4) : raw;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw readError(
        "Git source locator is invalid.",
        "invalid_arguments",
        "SOURCE_LOCATOR_INVALID",
      );
    }
    if (
      !["https:", "ssh:"].includes(url.protocol) ||
      url.password ||
      (hasUrlUserInfo(value) && url.protocol === "https:") ||
      value.includes("?") ||
      value.includes("#")
    )
      throw readError(
        "Git sources require a credential-free HTTPS or SSH locator.",
        "invalid_arguments",
        "SOURCE_LOCATOR_UNSAFE",
      );
    if (url.protocol === "https:" && url.username)
      throw readError(
        "Git sources must not persist user information; use a configured credential provider.",
        "invalid_arguments",
        "SOURCE_LOCATOR_UNSAFE",
      );
    return { locator: url.href, url };
  }
  const localRoot = resolve(cwd ?? process.cwd(), raw);
  return { locator: localRoot, localRoot };
}

function isGitCheckout(path: string): boolean {
  try {
    const marker = statSync(join(path, ".git"));
    return marker.isFile() || marker.isDirectory();
  } catch {
    return false;
  }
}

function sourceMode(options: SourceOptions): {
  kind: AcquisitionKind;
  locator: string;
  localRoot?: string;
  url?: URL;
} {
  const source = options.source;
  if (source.startsWith("git+https://") || source.startsWith("git+ssh://")) {
    const git = gitLocator(source, options.cwd);
    return { kind: "git", ...git };
  }
  if (URL.canParse(source) && !/^[A-Za-z]:[\\/]/.test(source)) {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw readError("Source locator is invalid.", "invalid_arguments", "SOURCE_LOCATOR_INVALID");
    }
    if (url.protocol === "ssh:") {
      const git = gitLocator(source, options.cwd);
      return { kind: "git", ...git };
    }
    const gitUrl = options.ref !== undefined || url.pathname.toLowerCase().endsWith(".git");
    if (gitUrl) {
      const git = gitLocator(source, options.cwd);
      return { kind: "git", ...git };
    }
    const safe = safeHttpUrl(source, "HTTP source");
    return { kind: "url", locator: safe.href, url: safe };
  }
  const absolute = resolve(options.cwd ?? process.cwd(), source);
  try {
    if (requireDirectory(absolute) && options.ref === undefined && isGitCheckout(absolute))
      return { kind: "git", locator: absolute, localRoot: absolute };
    if (requireDirectory(absolute))
      return options.ref === undefined
        ? { kind: "directory", locator: absolute, localRoot: absolute }
        : { kind: "git", locator: absolute, localRoot: absolute };
  } catch {
    // Remote locators are classified below; invalid local paths do not hide their source error.
  }
  if (options.ref !== undefined) {
    const git = gitLocator(source, options.cwd);
    return { kind: "git", ...git };
  }
  return { kind: "directory", locator: absolute, localRoot: absolute };
}

function requireDirectory(path: string): boolean {
  // Source-mode probing remains synchronous and never follows a source file.
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sourceExclusions(manifest?: Row): string[] {
  const views = (manifest?.views as Row[] | undefined) ?? [];
  return sortedSet([
    ...new Set([
      ...projectDiscoveryScope.excluded,
      ...ignoredDirectoryNames,
      ...views.flatMap((view) =>
        [view.view, view.presentation].filter(
          (value): value is string => typeof value === "string",
        ),
      ),
    ]),
  ]);
}

async function discoverRdfPaths(
  root: string,
  exclude: string[],
  source: SourceInventory,
): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string) {
    checkCancelled(source);
    const target = directory ? await safePath(root, directory) : root;
    for (const item of await readdir(target, { withFileTypes: true })) {
      checkCancelled(source);
      const path = directory ? `${directory}/${item.name}` : item.name;
      portablePath(path);
      if (exclude.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue;
      await safePath(root, path);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile() && supportedSuffix.test(path)) found.push(path);
      else if (!item.isFile())
        throw new ProjectError(
          "conflict",
          "PATH_UNSAFE",
          "Links or special source files are not supported.",
          path,
        );
    }
  }
  await walk("");
  return found.sort(utf8Compare);
}

async function readSourceFile(
  root: string,
  path: string,
  source: SourceInventory,
  maxBytes: number,
  retainBytes: boolean,
): Promise<{ bytes: Buffer | null; byteLength: number; digest: string } | null> {
  checkCancelled(source);
  const target = await safePath(root, path);
  const signal = nextSignal(source);
  const stream = createReadStream(target, { highWaterMark: 64 * 1024, signal });
  const chunks: Buffer[] = [];
  const hasher = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const chunk of stream) {
      checkCancelled(source);
      const bytes = Buffer.from(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > maxBytes)
        throw new ProjectError(
          "unavailable",
          "ACQUISITION_LIMIT",
          "Source graph exceeds maxGraphBytes.",
          path,
          { maxGraphBytes: maxBytes },
        );
      hasher.update(bytes);
      if (retainBytes) chunks.push(bytes);
    }
    checkCancelled(source);
    return {
      bytes: retainBytes ? Buffer.concat(chunks, byteLength) : null,
      byteLength,
      digest: `sha256:${hasher.digest("hex")}`,
    };
  } catch (error) {
    stream.destroy();
    if (signal.aborted) throw acquisitionAbort(signal);
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  } finally {
    stream.destroy();
  }
}

async function verifyDirectoryReads(
  root: string,
  reads: Map<string, { kind: "file"; path: string; revision: ReturnType<typeof revision> }>,
  scopeRead: {
    kind: "inventory";
    path: string;
    revision: ReturnType<typeof revision>;
    scope: { included: string[]; excluded: string[] };
  },
  source: SourceInventory,
  maxGraphBytes: number,
): Promise<void> {
  for (const read of reads.values()) {
    checkCancelled(source);
    let actual: ReturnType<typeof revision>;
    try {
      const maxBytes =
        read.path === "tbspec.toml" || read.path === "tbspec.lock"
          ? Number.MAX_SAFE_INTEGER
          : maxGraphBytes;
      const captured = await readSourceFile(root, read.path, source, maxBytes, false);
      actual = captured ? { state: "present", digest: captured.digest } : { state: "absent" };
    } catch (error) {
      if (hasCode(error, "ACQUISITION_LIMIT"))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          `Source changed during dependency inventory capture: ${read.path}. Inspect the source again.`,
          read.path,
        );
      throw error;
    }
    checkCancelled(source);
    if (!equalRevision(read.revision, actual))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        `Source changed during dependency inventory capture: ${read.path}. Inspect the source again.`,
        read.path,
      );
  }
  checkCancelled(source);
  const actualInventory = await inventory(root, scopeRead.path, scopeRead.scope);
  checkCancelled(source);
  if (!equalRevision(scopeRead.revision, actualInventory))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Source inventory changed during dependency capture. Inspect the source again.",
    );
}

async function captureDirectorySource(
  options: SourceOptions,
  source: SourceInventory,
): Promise<void> {
  const root = await realpath(resolve(options.cwd ?? process.cwd(), options.source));
  source.root = root;
  source.locator = root;
  checkCancelled(source);
  const manifestExists = (await fileBytes(root, "tbspec.toml")) !== null;
  const capture = async () => {
    checkCancelled(source);
    const manifestBytes = await fileBytes(root, "tbspec.toml");
    const lockBytes = await fileBytes(root, "tbspec.lock");
    checkCancelled(source);
    const manifest = manifestBytes ? parseManifest(manifestBytes.toString("utf8")) : undefined;
    const lock = manifestBytes ? parseLock(lockBytes?.toString("utf8") ?? "") : undefined;
    const exclude = sourceExclusions(manifest);
    const scope = { included: [""], excluded: exclude };
    const discovery = await inventory(root, "", scope);
    const paths = await discoverRdfPaths(root, exclude, source);
    const capturedFiles = new Map<
      string,
      { byteLength: number; digest?: string; error?: ProjectError }
    >();
    const reads = new Map<
      string,
      { kind: "file"; path: string; revision: ReturnType<typeof revision> }
    >();
    reads.set("tbspec.toml", {
      kind: "file",
      path: "tbspec.toml",
      revision: revision(manifestBytes),
    });
    reads.set("tbspec.lock", { kind: "file", path: "tbspec.lock", revision: revision(lockBytes) });
    const scopeRead = {
      kind: "inventory" as const,
      path: "",
      revision: discovery,
      scope,
    };
    for (const path of paths) {
      checkCancelled(source);
      let value: Awaited<ReturnType<typeof readSourceFile>>;
      try {
        value = await readSourceFile(root, path, source, options.limits.maxGraphBytes, true);
      } catch (error) {
        if (!hasCode(error, "ACQUISITION_LIMIT")) throw error;
        capturedFiles.set(path, {
          byteLength: options.limits.maxGraphBytes + 1,
          error: new ProjectError(
            "unavailable",
            "ACQUISITION_LIMIT",
            "Source graph exceeds maxGraphBytes.",
            path,
            { maxGraphBytes: options.limits.maxGraphBytes },
          ),
        });
        continue;
      }
      checkCancelled(source);
      if (value) {
        const fileRevision = { state: "present" as const, digest: value.digest };
        reads.set(path, { kind: "file", path, revision: fileRevision });
        capturedFiles.set(path, { byteLength: value.byteLength, digest: value.digest });
      } else {
        reads.set(path, { kind: "file", path, revision: revision(null) });
        capturedFiles.set(path, {
          byteLength: 0,
          error: new ProjectError(
            "invalid",
            "RESOURCE_MISSING",
            "Source file is unavailable.",
            path,
          ),
        });
      }
    }
    if (lock)
      for (const dependency of Object.values(lock.dependencies))
        for (const file of dependency.files) {
          checkCancelled(source);
          const path = `${dependency.snapshot_path}/${file.key}`;
          if (file.byte_length > options.limits.maxGraphBytes) {
            capturedFiles.set(path, {
              byteLength: file.byte_length,
              error: new ProjectError(
                "unavailable",
                "ACQUISITION_LIMIT",
                "Locked source graph exceeds maxGraphBytes.",
                file.key,
                { maxGraphBytes: options.limits.maxGraphBytes },
              ),
            });
            continue;
          }
          let value: Awaited<ReturnType<typeof readSourceFile>>;
          try {
            value = await readSourceFile(root, path, source, options.limits.maxGraphBytes, true);
          } catch (error) {
            if (!hasCode(error, "ACQUISITION_LIMIT")) throw error;
            capturedFiles.set(path, {
              byteLength: options.limits.maxGraphBytes + 1,
              error: new ProjectError(
                "unavailable",
                "ACQUISITION_LIMIT",
                "Locked source graph exceeds maxGraphBytes.",
                file.key,
                { maxGraphBytes: options.limits.maxGraphBytes },
              ),
            });
            continue;
          }
          checkCancelled(source);
          if (!value) {
            reads.set(path, { kind: "file", path, revision: revision(null) });
            capturedFiles.set(path, {
              byteLength: 0,
              error: new ProjectError(
                "invalid",
                "SNAPSHOT_INTEGRITY",
                "A locked source snapshot file is missing.",
                file.key,
              ),
            });
          } else {
            const fileRevision = { state: "present" as const, digest: value.digest };
            reads.set(path, { kind: "file", path, revision: fileRevision });
            capturedFiles.set(path, { byteLength: value.byteLength, digest: value.digest });
          }
        }
    await verifyDirectoryReads(root, reads, scopeRead, source, options.limits.maxGraphBytes);
    return {
      manifest,
      lock,
      discovery,
      paths,
      capturedFiles,
      manifestRevision: revision(manifestBytes),
      lockRevision: revision(lockBytes),
      manifestExists,
      scope,
    };
  };
  const captured = manifestExists ? await withLock(root, capture) : await capture();
  const {
    manifest,
    lock,
    discovery,
    paths,
    capturedFiles,
    manifestRevision,
    lockRevision,
    manifestExists: capturedManifestExists,
    scope,
  } = captured;
  source.manifest = manifest;
  source.lock = lock;
  source.treeRevision = discovery.state === "present" ? discovery.digest : "";
  const readSourcePath = (path: string) => async () => {
    const capture = await readSourceFile(root, path, source, options.limits.maxGraphBytes, true);
    return capture?.bytes ?? null;
  };
  for (const path of paths) {
    const indexed = capturedFiles.get(path);
    source.entries.set(path, {
      address: path,
      sourceResource: path,
      source: "source",
      context: "source",
      bytes: null,
      sourcePath: path,
      readBytes: readSourcePath(path),
      ...(indexed?.digest ? { capturedDigest: indexed.digest } : {}),
      ...(indexed ? { byteLength: indexed.byteLength } : {}),
      ...(indexed?.error ? { parseError: indexed.error } : {}),
      ...(indexed?.digest
        ? {
            mediaType: rdfFormats[extname(path).toLowerCase()],
            baseIri: pathToFileURL(join(root, ...path.split("/"))).href,
          }
        : {}),
    });
  }
  if (lock)
    for (const [dependencyId, dependency] of Object.entries(lock.dependencies))
      for (const file of dependency.files) {
        const address = `dep:${dependencyId}/${file.key}`;
        const path = `${dependency.snapshot_path}/${file.key}`;
        const indexed = capturedFiles.get(path);
        source.entries.set(address, {
          address,
          sourceResource: file.source_resource,
          source: file.source,
          context: file.context,
          bytes: null,
          sourcePath: path,
          readBytes: readSourcePath(path),
          ...(indexed?.digest ? { capturedDigest: indexed.digest } : {}),
          ...(indexed ? { byteLength: indexed.byteLength } : {}),
          ...(indexed?.error ? { parseError: indexed.error } : {}),
          lockedFile: file,
          lockedDependency: dependency,
        });
      }
  source.verifyIncluded = async (entries) => {
    const verify = async () => {
      checkCancelled(source);
      const currentManifest = revision(await fileBytes(root, "tbspec.toml"));
      const currentLock = revision(await fileBytes(root, "tbspec.lock"));
      checkCancelled(source);
      if (
        !equalRevision(manifestRevision, currentManifest) ||
        !equalRevision(lockRevision, currentLock)
      )
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Source project metadata changed during dependency acquisition. Inspect the source again.",
        );
      const currentInventory = await inventory(root, "", scope);
      checkCancelled(source);
      if (!equalRevision(discovery, currentInventory))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Source inventory changed during dependency acquisition. Inspect the source again.",
        );
      for (const entry of entries) {
        if (!entry.sourcePath || !entry.capturedDigest) continue;
        checkCancelled(source);
        let capturedBytes: Awaited<ReturnType<typeof readSourceFile>>;
        try {
          capturedBytes = await readSourceFile(
            root,
            entry.sourcePath,
            source,
            options.limits.maxGraphBytes,
            false,
          );
        } catch (error) {
          if (!hasCode(error, "ACQUISITION_LIMIT")) throw error;
          throw new ProjectError(
            "conflict",
            "REVISION_CONFLICT",
            "Included source bytes changed during dependency acquisition. Inspect the source again.",
            entry.address,
          );
        }
        checkCancelled(source);
        if (!capturedBytes || capturedBytes.digest !== entry.capturedDigest)
          throw new ProjectError(
            "conflict",
            "REVISION_CONFLICT",
            "Included source bytes changed during dependency acquisition. Inspect the source again.",
            entry.address,
          );
      }
    };
    if (capturedManifestExists) await withLock(root, verify);
    else await verify();
  };
}

function nextSignal(source: SourceInventory): AbortSignal {
  checkCancelled(source);
  return source.signal
    ? AbortSignal.any([
        source.signal,
        AbortSignal.timeout(Math.max(1, source.deadline - Date.now())),
      ])
    : AbortSignal.timeout(Math.max(1, source.deadline - Date.now()));
}

function mediaTypeForSuffix(path: string): string | undefined {
  return rdfFormats[extname(path).toLowerCase()];
}

function profileFor(mediaType: string, vetted = false): string {
  if (mediaType === "text/turtle") return "turtle-strict-v1";
  if (mediaType === "application/n-triples") return "ntriples-strict-v1";
  if (mediaType === "application/rdf+xml")
    return vetted ? "rdfxml-vetted-bundle-v1" : "rdfxml-no-dtd-v1";
  throw new ProjectError(
    "invalid",
    "RDF_FORMAT_UNSUPPORTED",
    "Only Turtle, N-Triples and conservative RDF/XML are supported.",
  );
}

async function readIndexedEntry(
  source: SourceInventory,
  entry: SourceEntry,
  limits: Limits,
): Promise<Buffer> {
  checkCancelled(source);
  if ((entry.byteLength ?? 0) > limits.maxGraphBytes)
    throw new ProjectError(
      "unavailable",
      "ACQUISITION_LIMIT",
      "An included graph exceeds maxGraphBytes.",
      entry.address,
      { maxGraphBytes: limits.maxGraphBytes },
    );
  const bytes = entry.bytes ?? (await entry.readBytes?.()) ?? null;
  checkCancelled(source);
  if (!bytes)
    throw new ProjectError(
      "invalid",
      entry.lockedFile ? "SNAPSHOT_INTEGRITY" : "RESOURCE_MISSING",
      "A source file is unavailable.",
      entry.address,
    );
  if (bytes.byteLength > limits.maxGraphBytes)
    throw new ProjectError(
      "unavailable",
      "ACQUISITION_LIMIT",
      "An included graph exceeds maxGraphBytes.",
      entry.address,
      { maxGraphBytes: limits.maxGraphBytes },
    );
  const actualDigest = digest(bytes);
  if (
    (entry.capturedDigest && entry.capturedDigest !== actualDigest) ||
    (entry.byteDigest && entry.byteDigest !== actualDigest) ||
    (entry.byteLength !== undefined && entry.byteLength !== bytes.byteLength)
  )
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Source bytes changed during dependency acquisition; inspect the source again.",
      entry.address,
    );
  entry.byteDigest = actualDigest;
  entry.byteLength = bytes.byteLength;
  return bytes;
}

async function parseSourceEntry(entry: SourceEntry, vettedDigest: string): Promise<void> {
  if (!entry.bytes)
    throw new ProjectError("invalid", "RESOURCE_MISSING", "Source RDF bytes are unavailable.");
  const mediaType = entry.lockedFile?.media_type ?? entry.mediaType;
  const baseIri = entry.lockedFile?.base_iri ?? entry.baseIri;
  if (!mediaType || !baseIri)
    throw new ProjectError(
      "invalid",
      "RDF_FORMAT_UNSUPPORTED",
      "Source RDF format is unsupported.",
      entry.address,
    );
  const vetted = digest(entry.bytes) === vettedDigest;
  entry.store = entry.lockedFile
    ? await parseGraph(entry.bytes, entry.lockedFile, vettedDigest, entry.address)
    : await parseRdf(entry.bytes, mediaType, baseIri, vetted, entry.address);
  const classification = entry.lockedFile
    ? {
        kind: entry.lockedFile.kind,
        classification: entry.lockedFile.classification,
        identity: entry.lockedFile.identity as "declared" | "generated",
        graphIri: entry.lockedFile.graph_iri,
      }
    : classifyGraph(entry.store, entry.address);
  Object.assign(entry, classification);
  entry.mediaType = mediaType;
  entry.baseIri = baseIri;
  entry.profile = entry.lockedFile?.parser_profile ?? profileFor(mediaType, vetted);
  entry.byteDigest = digest(entry.bytes);
  entry.byteLength = entry.bytes.byteLength;
  entry.parseable = true;
}

function gitBase(locator: string, path: string, localRoot?: string): string {
  if (localRoot) return pathToFileURL(join(localRoot, ...path.split("/"))).href;
  const value =
    locator.startsWith("git+https://") || locator.startsWith("git+ssh://")
      ? locator.slice(4)
      : locator;
  const url = new URL(value);
  if (url.protocol === "ssh:") {
    url.protocol = "https:";
    url.username = "";
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path}`;
  return url.href;
}

function runGit(
  args: string[],
  options: {
    hooks: string;
    cwd?: string;
    signal: AbortSignal;
    maxBytes?: number;
    allowedProtocols?: string;
    workspacePath?: string;
    maxWorkspaceBytes?: number;
  },
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "git",
      [
        "-c",
        `core.hooksPath=${options.hooks}`,
        "-c",
        "fetch.recurseSubmodules=false",
        "-c",
        "submodule.recurse=false",
        ...(options.cwd ? ["-C", options.cwd] : []),
        ...args,
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) =>
                !key.startsWith("GIT_") ||
                ["GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_CONFIG_GLOBAL"].includes(key),
            ),
          ),
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_ALLOW_PROTOCOL: options.allowedProtocols ?? "https:ssh:file",
          GIT_NO_REPLACE_OBJECTS: "1",
        },
      },
    );
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;
    let workspaceMonitor: NodeJS.Timeout | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", abort);
      if (workspaceMonitor) clearInterval(workspaceMonitor);
      if (error) reject(error);
      else resolvePromise(Buffer.concat(chunks));
    };
    const abort = () => {
      child.kill();
      finish(
        options.signal.reason?.name === "TimeoutError"
          ? new ProjectError(
              "unavailable",
              "ACQUISITION_TIMEOUT",
              "Dependency acquisition exceeded its time limit.",
            )
          : new ProjectError(
              "conflict",
              "ACQUISITION_CANCELLED",
              "Dependency acquisition was cancelled.",
            ),
      );
    };
    options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    if (options.workspacePath && options.maxWorkspaceBytes) {
      let checking = false;
      workspaceMonitor = setInterval(() => {
        if (checking || settled) return;
        checking = true;
        void workspaceSize(options.workspacePath as string)
          .then((bytes) => {
            if (bytes <= (options.maxWorkspaceBytes as number) || settled) return;
            child.kill();
            finish(
              new ProjectError(
                "unavailable",
                "ACQUISITION_LIMIT",
                "Git acquisition workspace exceeded maxGitWorkspaceBytes.",
                null,
                { maxGitWorkspaceBytes: options.maxWorkspaceBytes },
              ),
            );
          })
          .catch(() => undefined)
          .finally(() => {
            checking = false;
          });
      }, 100);
    }
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > (options.maxBytes ?? 134217728)) {
        child.kill();
        finish(
          new ProjectError(
            "unavailable",
            "ACQUISITION_LIMIT",
            "Git returned more data than the configured acquisition limit.",
          ),
        );
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    child.once("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        finish(
          new ProjectError(
            "unavailable",
            "GIT_UNAVAILABLE",
            "Git is required only for this Git source action; install Git and retry.",
          ),
        );
      else
        finish(
          new ProjectError(
            "unavailable",
            "GIT_SOURCE_UNAVAILABLE",
            "Git source could not be read.",
          ),
        );
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0)
        finish(
          new ProjectError(
            "unavailable",
            "GIT_SOURCE_UNAVAILABLE",
            "Git source could not be read.",
          ),
        );
      else finish();
    });
  });
}

async function workspaceSize(root: string): Promise<number> {
  let total = 0;
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) total += (await stat(path)).size;
    }
  }
  await walk(root);
  return total;
}

async function captureGitSource(
  options: SourceOptions,
  source: SourceInventory,
  rawLocator: string,
): Promise<void> {
  const parsed = gitLocator(rawLocator, options.cwd);
  source.locator = parsed.locator;
  let localRoot = parsed.localRoot;
  if (localRoot) {
    try {
      localRoot = await realpath(localRoot);
      if (!(await stat(localRoot)).isDirectory()) throw new Error("not a directory");
      source.locator = localRoot;
    } catch {
      throw readError("Selected local Git source is unavailable.");
    }
  }
  const temp = await mkdtemp(join(tmpdir(), "tbspec-acquire-git-"));
  if (process.platform !== "win32") await chmod(temp, 0o700);
  const bare = join(temp, "repo.git");
  const hooks = join(temp, "empty-hooks");
  await mkdir(hooks, { mode: 0o700 });
  const signal = nextSignal(source);
  let retained = false;
  try {
    await runGit(["init", "--bare", bare], { hooks, signal });
    const requestedRef = options.ref;
    if (requestedRef !== undefined && (!requestedRef || requestedRef.startsWith("-")))
      throw readError(
        "Git ref must be a nonempty branch, tag or full commit identifier.",
        "invalid_arguments",
        "GIT_REF_INVALID",
      );
    const fetchRef = requestedRef ?? "HEAD";
    let revisionKind: "default" | "ref" | "commit" = "default";
    if (requestedRef !== undefined) {
      revisionKind = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(requestedRef) ? "commit" : "ref";
      if (revisionKind === "ref") {
        const checked = await runGit(["check-ref-format", "--allow-onelevel", requestedRef], {
          hooks,
          signal,
        });
        void checked;
      }
    }
    await runGit(
      ["fetch", "--no-tags", "--no-recurse-submodules", "--depth=1", source.locator, fetchRef],
      {
        hooks,
        cwd: bare,
        signal,
        workspacePath: temp,
        maxWorkspaceBytes: options.limits.maxGitWorkspaceBytes,
        allowedProtocols: localRoot ? "file" : parsed.url?.protocol === "https:" ? "https" : "ssh",
      },
    );
    const resolved = (
      await runGit(["rev-parse", "--verify", "FETCH_HEAD^{commit}"], {
        hooks,
        cwd: bare,
        signal,
        maxBytes: 256,
      })
    )
      .toString("ascii")
      .trim();
    if (
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(resolved) ||
      (revisionKind === "commit" && resolved !== requestedRef)
    )
      throw readError(
        "Git ref did not resolve to the requested immutable commit.",
        "unavailable",
        "GIT_REVISION_UNAVAILABLE",
      );
    const workspaceBytes = await workspaceSize(temp);
    if (workspaceBytes > options.limits.maxGitWorkspaceBytes)
      throw new ProjectError(
        "unavailable",
        "ACQUISITION_LIMIT",
        "Git acquisition workspace exceeded maxGitWorkspaceBytes.",
        null,
        { maxGitWorkspaceBytes: options.limits.maxGitWorkspaceBytes },
      );
    const tree = await runGit(["ls-tree", "-rz", "--full-tree", resolved], {
      hooks,
      cwd: bare,
      signal,
    });
    const files = new Map<string, { mode: string; oid: string }>();
    const submodules: string[] = [];
    for (const record of tree.toString("utf8").split("\0")) {
      if (!record) continue;
      const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40,64})\t([\s\S]+)$/.exec(record);
      if (!match)
        throw readError(
          "Git tree contains an unsupported entry.",
          "invalid",
          "GIT_FEATURE_UNSUPPORTED",
        );
      const path = portablePath(match[4] ?? "");
      files.set(path, { mode: match[1] ?? "", oid: match[3] ?? "" });
      if (match[1] === "160000" && match[2] === "commit") submodules.push(path);
    }
    const readBlob = async (
      path: string,
      maxBytes = options.limits.maxGraphBytes,
    ): Promise<Buffer | null> => {
      const entry = files.get(path);
      if (!entry || !["100644", "100755"].includes(entry.mode)) return null;
      const size = Number(
        (await runGit(["cat-file", "-s", entry.oid], { hooks, cwd: bare, signal, maxBytes: 128 }))
          .toString("ascii")
          .trim(),
      );
      if (!Number.isSafeInteger(size) || size < 0)
        throw readError("Git blob size is invalid.", "invalid", "GIT_FEATURE_UNSUPPORTED");
      if (size > maxBytes)
        throw new ProjectError(
          "unavailable",
          "ACQUISITION_LIMIT",
          "Git source graph exceeds its configured byte limit.",
          path,
          { maxBytes },
        );
      return runGit(["cat-file", "blob", entry.oid], { hooks, cwd: bare, signal, maxBytes });
    };
    const manifestBytes = await readBlob("tbspec.toml", 1024 * 1024);
    const lockBytes = manifestBytes
      ? await readBlob("tbspec.lock", options.limits.maxGitWorkspaceBytes)
      : null;
    source.manifest = manifestBytes ? parseManifest(manifestBytes.toString("utf8")) : undefined;
    source.lock = manifestBytes ? parseLock(lockBytes?.toString("utf8") ?? "") : undefined;
    const excluded = sourceExclusions(source.manifest);
    const isExcluded = (path: string) =>
      excluded.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    const requestedPath = options.resource?.replaceAll("\\", "/");
    if (
      requestedPath &&
      submodules.some((path) => requestedPath === path || requestedPath.startsWith(`${path}/`))
    )
      throw readError(
        "A selected Git submodule is unsupported; add its repository explicitly.",
        "invalid",
        "GIT_FEATURE_UNSUPPORTED",
      );
    for (const [path, file] of files) {
      if (
        isExcluded(path) ||
        !supportedSuffix.test(path) ||
        (file.mode !== "100644" && file.mode !== "100755")
      )
        continue;
      checkCancelled(source);
      const size = Number(
        (await runGit(["cat-file", "-s", file.oid], { hooks, cwd: bare, signal, maxBytes: 128 }))
          .toString("ascii")
          .trim(),
      );
      if (!Number.isSafeInteger(size) || size < 0)
        throw readError("Git blob size is invalid.", "invalid", "GIT_FEATURE_UNSUPPORTED");
      if (size > options.limits.maxGraphBytes) {
        source.entries.set(path, {
          address: path,
          sourceResource: path,
          source: "source",
          context: "source",
          bytes: null,
          byteLength: size,
          parseError: new ProjectError(
            "unavailable",
            "ACQUISITION_LIMIT",
            "Source graph exceeds maxGraphBytes.",
            path,
            { maxGraphBytes: options.limits.maxGraphBytes },
          ),
        });
        continue;
      }
      source.entries.set(path, {
        address: path,
        sourceResource: path,
        source: "source",
        context: "source",
        bytes: null,
        byteLength: size,
        readBytes: async () => {
          checkCancelled(source);
          const bytes = await readBlob(path);
          checkCancelled(source);
          if (
            bytes
              ?.toString("utf8", 0, Math.min(bytes.length, 80))
              .startsWith("version https://git-lfs.github.com/spec/v1")
          )
            throw readError(
              "A required Git LFS object is unavailable; install the object through a trusted external workflow.",
              "invalid",
              "GIT_FEATURE_UNSUPPORTED",
            );
          return bytes;
        },
        mediaType: mediaTypeForSuffix(path),
        baseIri: gitBase(source.locator, path, localRoot),
      });
    }
    if (source.lock)
      for (const [dependencyId, dependency] of Object.entries(source.lock.dependencies))
        for (const lockedFile of dependency.files) {
          const path = `${dependency.snapshot_path}/${lockedFile.key}`;
          source.entries.set(`dep:${dependencyId}/${lockedFile.key}`, {
            address: `dep:${dependencyId}/${lockedFile.key}`,
            sourceResource: lockedFile.source_resource,
            source: lockedFile.source,
            context: lockedFile.context,
            bytes: null,
            byteLength: lockedFile.byte_length,
            capturedDigest: lockedFile.byte_digest,
            readBytes: async () => {
              checkCancelled(source);
              const bytes = await readBlob(path);
              checkCancelled(source);
              return bytes;
            },
            lockedFile,
            lockedDependency: dependency,
          });
        }
    source.files = files;
    source.submodules = submodules;
    source.resolvedCommit = resolved;
    source.revisionKind = revisionKind;
    source.ref = requestedRef;
    source.root = localRoot;
    source.treeRevision = hash([...files].map(([path, value]) => ({ path, ...value })));
    source.cleanup = async () => rm(temp, { recursive: true, force: true });
    retained = true;
  } finally {
    if (!retained) await rm(temp, { recursive: true, force: true });
  }
}

function responseMediaType(value: string | null, path: string): string {
  const media = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const formats = new Set(["text/turtle", "application/n-triples", "application/rdf+xml"]);
  const suffix = mediaTypeForSuffix(path);
  if (formats.has(media)) {
    if (suffix && suffix !== media)
      throw new ProjectError(
        "invalid",
        "RDF_FORMAT_UNSUPPORTED",
        "HTTP Content-Type conflicts with the source filename format.",
      );
    return media;
  }
  if (
    media &&
    ![
      "application/octet-stream",
      "binary/octet-stream",
      "text/plain",
      "application/unknown",
    ].includes(media)
  )
    throw new ProjectError(
      "invalid",
      "RDF_FORMAT_UNSUPPORTED",
      "HTTP source Content-Type is unsupported.",
    );
  if (suffix) return suffix;
  throw new ProjectError(
    "invalid",
    "RDF_FORMAT_UNSUPPORTED",
    "HTTP source needs a supported RDF Content-Type or filename suffix.",
  );
}

async function responseBytes(
  response: Response,
  limit: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!response.body) throw readError("HTTP source returned no RDF content.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      if (signal.aborted) throw acquisitionAbort(signal);
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit)
        throw new ProjectError(
          "unavailable",
          "ACQUISITION_LIMIT",
          "HTTP graph exceeds maxGraphBytes.",
          null,
          { maxGraphBytes: limit },
        );
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (signal.aborted) throw acquisitionAbort(signal);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    length,
  );
}

function acquisitionAbort(signal: AbortSignal): ProjectError {
  return signal.reason?.name === "TimeoutError"
    ? new ProjectError(
        "unavailable",
        "ACQUISITION_TIMEOUT",
        "Dependency acquisition exceeded its time limit.",
      )
    : new ProjectError(
        "conflict",
        "ACQUISITION_CANCELLED",
        "Dependency acquisition was cancelled.",
      );
}

async function captureHttpSource(
  source: SourceInventory,
  locator: string,
  limits: Limits,
): Promise<void> {
  const requested = safeHttpUrl(locator, "HTTP source");
  source.locator = requested.href;
  let current = requested;
  let response: Response | undefined;
  const signal = nextSignal(source);
  for (let redirects = 0; redirects <= limits.maxRedirects; redirects++) {
    checkCancelled(source);
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal,
        headers: { Accept: "text/turtle, application/n-triples, application/rdf+xml;q=0.9" },
      });
    } catch {
      if (signal.aborted) throw acquisitionAbort(signal);
      checkCancelled(source);
      throw readError("HTTP source could not be retrieved.");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects >= limits.maxRedirects) {
      await response.body?.cancel().catch(() => undefined);
      throw readError("HTTP source exceeded maxRedirects.", "unavailable", "ACQUISITION_LIMIT");
    }
    const location = response.headers.get("location");
    if (!location) {
      await response.body?.cancel().catch(() => undefined);
      throw readError("HTTP redirect did not include a location.");
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      await response.body?.cancel().catch(() => undefined);
      throw readError("HTTP redirect target is invalid.", "invalid", "SOURCE_LOCATOR_INVALID");
    }
    let safe: URL;
    try {
      safe = safeHttpUrl(next.href, "HTTP redirect target");
    } catch (error) {
      await response.body?.cancel().catch(() => undefined);
      throw error;
    }
    await response.body?.cancel().catch(() => undefined);
    current = safe;
  }
  if (!response) throw readError("HTTP source returned an unsuccessful response.");
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw readError("HTTP source returned an unsuccessful response.");
  }
  const pathname = current.pathname;
  let mediaType: string;
  try {
    mediaType = responseMediaType(response.headers.get("content-type"), pathname);
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = await responseBytes(response, limits.maxGraphBytes, signal);
  source.kind = "url";
  source.effectiveLocator = current.href;
  source.entries.set("resource", {
    address: "resource",
    sourceResource: `resource.${mediaType === "text/turtle" ? "ttl" : mediaType === "application/n-triples" ? "nt" : "rdf"}`,
    source: "source",
    context: "source",
    bytes,
    mediaType,
    baseIri: current.href,
  });
}

async function discoverSource(options: SourceOptions): Promise<SourceInventory> {
  const mode = sourceMode(options);
  const source: SourceInventory = {
    kind: mode.kind,
    locator: mode.locator,
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    entries: new Map(),
    diagnostics: [],
    deadline: Date.now() + options.limits.deadlineMs,
    ...(options.signal ? { signal: options.signal } : {}),
  };
  try {
    if (mode.kind === "directory") await captureDirectorySource(options, source);
    else if (mode.kind === "git") await captureGitSource(options, source, options.source);
    else await captureHttpSource(source, mode.locator, options.limits);
    checkCancelled(source);
    const bundle = await loadStarters();
    source.vettedDigest = bundle.vettedDigest;
    for (const entry of source.entries.values()) {
      checkCancelled(source);
      if (entry.parseError) {
        source.diagnostics.push(entry.parseError.diagnostic);
        continue;
      }
      try {
        if (!entry.bytes) entry.bytes = await readIndexedEntry(source, entry, options.limits);
        else {
          checkCancelled(source);
          if (entry.bytes.byteLength > options.limits.maxGraphBytes)
            throw new ProjectError(
              "unavailable",
              "ACQUISITION_LIMIT",
              "Source graph exceeds maxGraphBytes.",
              entry.address,
              { maxGraphBytes: options.limits.maxGraphBytes },
            );
          entry.byteDigest = digest(entry.bytes);
          entry.byteLength = entry.bytes.byteLength;
        }
        await parseSourceEntry(entry, bundle.vettedDigest);
        if (entry.readBytes) {
          entry.bytes = null;
          entry.store = undefined;
        }
      } catch (error) {
        if (hasCode(error, "ACQUISITION_CANCELLED") || hasCode(error, "ACQUISITION_TIMEOUT"))
          throw error;
        entry.parseable = false;
        entry.parseError =
          error instanceof ProjectError
            ? new ProjectError(
                error.status,
                error.diagnostic.code,
                "Source RDF is malformed, unavailable, or unsupported.",
                entry.address,
              )
            : new ProjectError(
                "invalid",
                "RDF_SYNTAX",
                "Source RDF is malformed or unsupported.",
                entry.address,
              );
        if (entry.readBytes) {
          entry.bytes = null;
          entry.store = undefined;
        }
        source.diagnostics.push(entry.parseError.diagnostic);
      }
    }
    checkCancelled(source);
    return source;
  } catch (error) {
    await source.cleanup?.();
    throw error;
  }
}

export async function dependencyInspect(_options: {
  project?: string;
  cwd?: string;
  source: string;
  ref?: string;
  resource?: string;
  signal?: AbortSignal;
}): Promise<Result> {
  let source: SourceInventory | undefined;
  try {
    const project = await readProject({ project: _options.project, cwd: _options.cwd });
    source = await discoverSource({
      source: _options.source,
      cwd: _options.cwd,
      ref: _options.ref,
      resource: _options.resource,
      signal: _options.signal,
      limits: defaultLimits(project.manifest),
    });
    const indexedSource = source;
    const items = [...indexedSource.entries.values()]
      .map((entry) => inspectEntry(indexedSource, entry))
      .sort((left, right) => utf8Compare(String(left.resource), String(right.resource)));
    return ok(
      {
        source: {
          kind: indexedSource.kind,
          locator: indexedSource.locator,
          effectiveLocator: indexedSource.effectiveLocator ?? null,
          revisionKind: indexedSource.revisionKind ?? null,
          resolvedCommit: indexedSource.resolvedCommit ?? null,
          requestedRef: indexedSource.ref ?? null,
        },
        items,
      },
      indexedSource.diagnostics,
    );
  } catch (error) {
    return failure(error);
  } finally {
    await source?.cleanup?.();
  }
}
export async function dependencyAdd(_options: {
  project?: string;
  cwd?: string;
  source: string;
  id: string;
  kind: ResourceKind;
  ref?: string;
  resource?: string;
  acceptedPreview?: string;
  signal?: AbortSignal;
}): Promise<Result> {
  try {
    const prepared = await prepareDependencyAdd(_options);
    if (!_options.acceptedPreview)
      return previewConflict(
        prepared,
        "PREVIEW_REQUIRED",
        "Review the dependency preview and retry with its accepted fingerprint.",
      );
    if (_options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return previewConflict(
        prepared,
        "PREVIEW_CHANGED",
        "The reacquired dependency differs from the accepted preview. Review the new preview and retry.",
      );
    return await publishPreparedDependency(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function dependencyUpdate(options: {
  project?: string;
  cwd?: string;
  id: string;
  apply?: boolean;
  acceptImpact?: boolean;
  acceptedPreview?: string;
  signal?: AbortSignal;
}): Promise<Result> {
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
    if (!options.apply && options.acceptedPreview)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--accepted-preview requires --apply for dependency update.",
      );
    const prepared = await prepareDependencyUpdate(options);
    if (!options.apply) return dependencyPreview(prepared, "preview");
    if (!options.acceptedPreview)
      return previewConflict(
        prepared,
        "PREVIEW_REQUIRED",
        "Review the dependency update and retry with --accepted-preview.",
      );
    if (options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return previewConflict(
        prepared,
        "PREVIEW_CHANGED",
        "The reacquired dependency differs from the accepted preview. Review the new preview and retry.",
      );
    if (prepared.requiresImpactAcceptance && !options.acceptImpact)
      return previewConflict(
        prepared,
        "ACCEPTANCE_REQUIRED",
        "Dependency update introduces or worsens affected impact. Retry with --accept-impact after review.",
      );
    return await publishPreparedDependency(prepared);
  } catch (error) {
    return failure(error);
  }
}

type DependencyAdminSnapshot = Awaited<ReturnType<typeof captureInspection>>;
type DependencyReference = {
  ownership: "owned" | "locked";
  file: string;
  selector?: string;
  targetIri: string;
  position: "subject" | "predicate" | "object" | "configuration";
  field?: string;
  statement?: { subject: Row; predicate: Row; object: Row };
};

const dependencyEntityTypes = new Set([
  "http://www.w3.org/2002/07/owl#Class",
  "http://www.w3.org/2000/01/rdf-schema#Class",
  "http://www.w3.org/2000/01/rdf-schema#Datatype",
  "http://www.w3.org/1999/02/22-rdf-syntax-ns#Property",
  "http://www.w3.org/2002/07/owl#ObjectProperty",
  "http://www.w3.org/2002/07/owl#DatatypeProperty",
  "http://www.w3.org/2002/07/owl#AnnotationProperty",
  "http://www.w3.org/2002/07/owl#OntologyProperty",
  "http://www.w3.org/2002/07/owl#NamedIndividual",
]);
const dependencyRdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function dependencySelector(selectorValue: string, dependencyId: string): boolean {
  return (
    selectorValue === `dep:${dependencyId}` || selectorValue.startsWith(`dep:${dependencyId}/`)
  );
}

function manifestSelectors(manifest: Row): { selector: string; field: string }[] {
  const found: { selector: string; field: string }[] = [];
  const add = (value: unknown, field: string) => {
    if (typeof value === "string" && value.startsWith("dep:"))
      found.push({ selector: value, field });
  };
  for (const [name, value] of Object.entries((manifest.model_types ?? {}) as Record<string, Row>))
    for (const field of ["ontology", "design"]) add(value[field], `model_types.${name}.${field}`);
  for (const [index, row] of ((manifest.associations ?? []) as Row[]).entries())
    for (const field of ["resource", "support"]) add(row[field], `associations[${index}].${field}`);
  for (const [index, row] of ((manifest.views ?? []) as Row[]).entries())
    for (const field of ["view", "presentation", "source", "protocol"])
      add(row[field], `views[${index}].${field}`);
  for (const [iri, value] of Object.entries((manifest.design_choices ?? {}) as Row))
    add(value, `design_choices.${iri}`);
  return found.sort(
    (left, right) =>
      utf8Compare(left.field, right.field) || utf8Compare(left.selector, right.selector),
  );
}

async function captureDependencyAdministration(
  root: string,
  extraPaths: string[],
  scopes: { path: string; included: string[]; excluded: string[] }[],
): Promise<DependencyAdminSnapshot> {
  const status = await captureInspection(root, "status");
  const extra = await capture(
    root,
    [...new Set(["tbspec.toml", "tbspec.lock", ...extraPaths])],
    scopes,
  );
  const snapshot = {
    ...status,
    files: { ...status.files, ...extra.files },
    reads: [
      ...new Map([...status.reads, ...extra.reads].map((read) => [canonical(read), read])).values(),
    ],
  };
  await verifyReads(root, snapshot.reads);
  return snapshot;
}

function requireAddition(dependency: Dependency | undefined, dependencyId: string): Dependency {
  if (!dependency)
    throw new ProjectError("invalid_arguments", "RESOURCE_MISSING", "Dependency ID was not found.");
  if (
    dependencyId.startsWith("tbspec-") ||
    dependency.sources.some((source) => source.kind === "bundle")
  )
    throw new ProjectError(
      "invalid_arguments",
      "DEPENDENCY_MANAGED",
      "Bundled dependencies are managed by the tool and cannot be renamed or removed.",
    );
  return dependency;
}

async function pathExists(root: string, relativePath: string): Promise<boolean> {
  try {
    await stat(await safePath(root, relativePath));
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

function statusResult(result: Result) {
  const data = result.data as Row | null;
  const project = (data?.project ?? {}) as Row;
  return {
    projectValidity: (project.validity ?? "unchecked") as PreparedDependency["projectValidity"],
    validationComplete: project.validationComplete === true,
  };
}

function dependencyAdminImpact(
  plan: Plan,
  baseline: Result,
  proposed: Result,
  changedSelectors: string[],
  affectedFiles: string[],
  acceptance: string[],
): Plan {
  const comparison = compareDiagnosticImpact(
    baseline.diagnostics,
    proposed.diagnostics,
    changedSelectors,
    {
      baselineChecks: impactChecks(baseline),
      proposedChecks: impactChecks(proposed),
      changedFiles: affectedFiles,
    },
  );
  return withPlanImpact(plan, {
    impact: {
      baselineErrors: comparison.baselineErrors,
      introducedErrors: comparison.introducedErrors,
      worsenedErrors: comparison.worsenedErrors,
      skippedChecks: comparison.skippedChecks,
      affectedFiles: sortedSet(affectedFiles),
      acceptance,
    },
  });
}

function checkAcceptedPreview(value: string | undefined) {
  if (value !== undefined && !/^sha256:[0-9a-f]{64}$/.test(value))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Accepted preview must be a SHA-256 digest.",
    );
}

export async function prepareDependencyRename(options: {
  project?: string;
  cwd?: string;
  from: string;
  to: string;
}): Promise<PreparedDependency> {
  const fromId = id(options.from);
  const toId = id(options.to);
  if (fromId === toId)
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "The new dependency ID must differ from the current ID.",
    );
  if (toId.startsWith("tbspec-"))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Dependency IDs beginning with tbspec- are reserved for bundled resources.",
    );
  const root = await discoverProject(options);
  const first = await capture(root, ["tbspec.toml", "tbspec.lock"]);
  const initialLock = parseLock(first.files["tbspec.lock"]?.toString("utf8") ?? "");
  const oldDependency = requireAddition(initialLock.dependencies[fromId], fromId);
  if (initialLock.dependencies[toId])
    throw new ProjectError(
      "conflict",
      "DEPENDENCY_ID_COLLISION",
      "A dependency with the requested ID already exists.",
      "tbspec.lock",
    );
  const fromRoot = oldDependency.snapshot_path;
  const toRoot = `.tbspec/dependencies/${toId}`;
  if (await pathExists(root, toRoot))
    throw new ProjectError(
      "conflict",
      "DEPENDENCY_DESTINATION_OCCUPIED",
      "The requested dependency snapshot destination already exists.",
      toRoot,
    );
  const files = oldDependency.files.map((file) => ({
    file,
    from: `${fromRoot}/${file.key}`,
    to: `${toRoot}/${file.key}`,
  }));
  const snapshot = await captureDependencyAdministration(
    root,
    files.flatMap(({ from, to }) => [from, to]),
    [{ path: ".tbspec/dependencies", included: [fromRoot, toRoot], excluded: [] }],
  );
  const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
  const lockText = snapshot.files["tbspec.lock"]?.toString("utf8") ?? "";
  const manifest = parseManifest(manifestText);
  const lock = parseLock(lockText);
  const dependency = requireAddition(lock.dependencies[fromId], fromId);
  if (lock.dependencies[toId])
    throw new ProjectError(
      "conflict",
      "DEPENDENCY_ID_COLLISION",
      "A dependency with the requested ID already exists.",
      "tbspec.lock",
    );
  if (await pathExists(root, toRoot))
    throw new ProjectError(
      "conflict",
      "DEPENDENCY_DESTINATION_OCCUPIED",
      "The requested dependency snapshot destination already exists.",
      toRoot,
    );

  const fileSelectors: Record<string, string> = {};
  for (const file of dependency.files)
    fileSelectors[`dep:${fromId}/${file.key}`] = `dep:${toId}/${file.key}`;
  const allSelectors = manifestSelectors(manifest).filter(({ selector: value }) =>
    dependencySelector(value, fromId),
  );
  const selectorChanges = Object.fromEntries(
    allSelectors.map(({ selector: value }) => [
      value,
      value === `dep:${fromId}`
        ? `dep:${toId}`
        : `dep:${toId}${value.slice(`dep:${fromId}`.length)}`,
    ]),
  );
  const selectorRewrites = Object.fromEntries(
    Object.entries(selectorChanges).map(([oldSelector, newSelector]) => [oldSelector, newSelector]),
  );
  const ontologyChoices = Object.entries(
    (manifest.ontology_choices ?? {}) as Record<string, string>,
  )
    .filter(([, selected]) => selected === fromId)
    .map(([ontologyIri]) => ({ ontologyIri, from: fromId, to: toId }))
    .sort((left, right) => utf8Compare(left.ontologyIri, right.ontologyIri));
  let nextManifest = manifestText;
  for (const choice of ontologyChoices)
    nextManifest = editOntologyChoice(nextManifest, choice.ontologyIri, toId);
  nextManifest = editManifestSelectors(nextManifest, selectorRewrites);

  const generatedIdentityChanges: Row[] = [];
  const renamedDependency: Dependency = {
    ...dependency,
    snapshot_path: toRoot,
    files: dependency.files.map((file) => {
      if (file.identity !== "generated") return file;
      const selectorBefore = `dep:${fromId}/${file.key}`;
      const graphIriAfter = `urn:tbspec:graph:${digest(`dep:${toId}/${file.key}`).slice(7)}`;
      generatedIdentityChanges.push({
        selectorBefore,
        selectorAfter: `dep:${toId}/${file.key}`,
        graphIriBefore: file.graph_iri,
        graphIriAfter,
      });
      return { ...file, graph_iri: graphIriAfter };
    }),
  };
  if (interpretationSignature(renamedDependency) !== dependency.interpretation_signature)
    throw new ProjectError(
      "conflict",
      "DEPENDENCY_SIGNATURE_CHANGED",
      "Renaming changed the dependency interpretation signature; no write is permitted.",
      "tbspec.lock",
    );
  const renamedDependencies: Record<string, Dependency> = {};
  for (const [currentId, current] of Object.entries(lock.dependencies))
    renamedDependencies[currentId === fromId ? toId : currentId] =
      currentId === fromId ? renamedDependency : current;
  const nextLockText = writeToml({ ...lock, dependencies: renamedDependencies });
  const nextLock = parseLock(nextLockText);
  const nextDependency = nextLock.dependencies[toId];
  if (!nextDependency)
    throw new ProjectError("invalid", "LOCK_INVALID", "Renamed dependency was not written.");

  const baseline = await inspectSnapshot(root, snapshot, { command: "status" });
  const stagedFiles: Record<string, Buffer | null> = {
    ...snapshot.files,
    "tbspec.lock": Buffer.from(nextLockText),
    "tbspec.toml": Buffer.from(nextManifest),
  };
  const writes = [
    { file: "tbspec.lock", bytes: Buffer.from(nextLockText) },
    ...(nextManifest !== manifestText
      ? [{ file: "tbspec.toml", bytes: Buffer.from(nextManifest) }]
      : []),
    ...files.map(({ from, to }) => {
      const bytes = snapshot.files[from];
      if (!bytes)
        throw new ProjectError(
          "invalid",
          "SNAPSHOT_INTEGRITY",
          "A managed dependency file is missing; no rename is permitted.",
          from,
        );
      stagedFiles[from] = null;
      stagedFiles[to] = bytes;
      return { file: from, to, bytes };
    }),
  ];
  const staged = { ...snapshot, files: stagedFiles };
  const proposed = await inspectSnapshot(root, staged, { command: "status" });
  const status = statusResult(proposed);
  const affectedFiles = sortedSet([
    "tbspec.lock",
    ...(nextManifest !== manifestText ? ["tbspec.toml"] : []),
    ...files.flatMap(({ from, to }) => [from, to]),
  ]);
  const plan = dependencyAdminImpact(
    preparePlan(snapshot, "dependency.rename", writes, {
      from: fromId,
      to: toId,
      selectors: { ...fileSelectors, ...selectorChanges },
      selectorChanges: allSelectors.map(({ selector: value, field }) => ({
        field,
        from: value,
        to: selectorChanges[value],
      })),
      paths: files.map(({ from, to, file }) => ({
        from,
        to,
        selectorBefore: `dep:${fromId}/${file.key}`,
        selectorAfter: `dep:${toId}/${file.key}`,
        byteDigest: file.byte_digest,
        graphSignature: file.graph_signature,
        parserContext: file.context,
        declaredGraphIri: file.identity === "declared" ? file.graph_iri : null,
      })),
      ontologyChoices,
      generatedIdentityChanges,
      projectValidity: status.projectValidity,
    }),
    baseline,
    proposed,
    [
      ...Object.keys(fileSelectors),
      ...Object.values(fileSelectors),
      ...Object.keys(selectorChanges),
      ...Object.values(selectorChanges),
      ...generatedIdentityChanges.flatMap((change) => [
        String(change.selectorBefore),
        String(change.selectorAfter),
      ]),
    ],
    affectedFiles,
    [],
  );
  return {
    root,
    id: toId,
    dependency: nextDependency,
    plan,
    diagnostics: proposed.diagnostics,
    projectValidity: status.projectValidity,
    validationComplete: status.validationComplete,
    administration: {
      kind: "rename",
      details: {
        fromId,
        toId,
        selectors: { ...fileSelectors, ...selectorChanges },
        paths: files.map(({ from, to, file }) => ({
          from,
          to,
          selectorBefore: `dep:${fromId}/${file.key}`,
          selectorAfter: `dep:${toId}/${file.key}`,
        })),
        ontologyChoices,
        generatedIdentityChanges,
      },
    },
  };
}

function configReferencesForRemoval(
  manifest: Row,
  dependencyId: string,
  primarySelector: string,
  primaryGraphIri: string,
): DependencyReference[] {
  const references = manifestSelectors(manifest)
    .filter(({ selector: value }) => dependencySelector(value, dependencyId))
    .map(({ selector: value, field }) => ({
      ownership: "owned" as const,
      file: "tbspec.toml",
      selector: value,
      targetIri: primaryGraphIri,
      position: "configuration" as const,
      field,
    }));
  const designChoices = Object.entries((manifest.design_choices ?? {}) as Row)
    .filter(([, value]) => typeof value === "string" && dependencySelector(value, dependencyId))
    .map(([ontologyIri, value]) => ({
      ownership: "owned" as const,
      file: "tbspec.toml",
      selector: String(value),
      targetIri: primaryGraphIri,
      position: "configuration" as const,
      field: `design_choices.${ontologyIri}`,
    }));
  const ontologyChoices = Object.entries(
    (manifest.ontology_choices ?? {}) as Record<string, string>,
  )
    .filter(([, value]) => value === dependencyId)
    .map(([ontologyIri]) => ({
      ownership: "owned" as const,
      file: "tbspec.toml",
      selector: primarySelector,
      targetIri: ontologyIri,
      position: "configuration" as const,
      field: `ontology_choices.${ontologyIri}`,
    }));
  return [...references, ...designChoices, ...ontologyChoices].sort(
    (left, right) =>
      utf8Compare(left.field ?? "", right.field ?? "") ||
      utf8Compare(left.selector ?? "", right.selector ?? ""),
  );
}

function lockStringReferences(
  lock: Lock,
  targets: Set<string>,
  excludedId: string,
): DependencyReference[] {
  const found: DependencyReference[] = [];
  function visit(value: unknown, path: string, dependencyId?: string): void {
    if (typeof value === "string") {
      if (targets.has(value))
        found.push({
          ownership: "locked",
          file: "tbspec.lock",
          ...(dependencyId ? { selector: `dep:${dependencyId}` } : {}),
          targetIri: value,
          position: "configuration",
          field: path,
        });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, `${path}[${index}]`, dependencyId);
      });
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value))
      visit(item, path ? `${path}.${key}` : key, dependencyId);
  }
  for (const [dependencyId, dependency] of Object.entries(lock.dependencies)) {
    if (dependencyId === excludedId) continue;
    visit(dependency, `dependencies.${dependencyId}`, dependencyId);
  }
  return found;
}

async function bytesFromStatus(
  root: string,
  snapshot: DependencyAdminSnapshot,
  path: string,
): Promise<Buffer | null> {
  const captured = snapshot.reads.find((read) => read.kind === "file" && read.path === path);
  const bytes = snapshot.files[path] ?? (await fileBytes(root, path));
  if (!captured || !equalRevision(captured.revision, revision(bytes)))
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "A graph changed during dependency impact inspection.",
      path,
    );
  return bytes;
}

async function dependencyReferences(
  root: string,
  snapshot: DependencyAdminSnapshot,
  lock: Lock,
  removedId: string,
  dependency: Dependency,
  manifest: Row,
): Promise<{ references: DependencyReference[]; targetIris: string[]; skippedFiles: string[] }> {
  const bundle = await loadStarters();
  const targets = new Set<string>();
  for (const file of dependency.files) {
    const path = `${dependency.snapshot_path}/${file.key}`;
    const bytes = await bytesFromStatus(root, snapshot, path);
    if (!bytes)
      throw new ProjectError(
        "invalid",
        "SNAPSHOT_INTEGRITY",
        "A managed dependency file is missing; no removal is permitted.",
        path,
      );
    const store = await parseGraph(
      bytes,
      file,
      bundle.vettedDigest,
      `dep:${removedId}/${file.key}`,
    );
    targets.add(file.graph_iri);
    for (const quad of store)
      if (
        quad.subject.termType === "NamedNode" &&
        quad.predicate.value === dependencyRdfType &&
        quad.object.termType === "NamedNode" &&
        dependencyEntityTypes.has(quad.object.value)
      )
        targets.add(quad.subject.value);
  }

  const references: DependencyReference[] = configReferencesForRemoval(
    manifest,
    removedId,
    `dep:${removedId}/${dependency.primary}`,
    dependency.files.find((file) => file.key === dependency.primary)?.graph_iri ??
      `dep:${removedId}/${dependency.primary}`,
  );
  const lockedPaths = new Map<string, string>();
  for (const [id, current] of Object.entries(lock.dependencies))
    if (id !== removedId)
      for (const file of current.files)
        lockedPaths.set(`${current.snapshot_path}/${file.key}`, `dep:${id}/${file.key}`);
  const skippedFiles: string[] = [];

  const recordStoreReferences = (
    store: Store,
    path: string,
    ownership: "owned" | "locked",
    graphSelector: string | undefined,
  ) => {
    for (const quad of store) {
      const positions: { position: "subject" | "predicate" | "object"; target: string }[] = [];
      if (quad.subject.termType === "NamedNode" && targets.has(quad.subject.value))
        positions.push({ position: "subject", target: quad.subject.value });
      if (targets.has(quad.predicate.value))
        positions.push({ position: "predicate", target: quad.predicate.value });
      if (quad.object.termType === "NamedNode" && targets.has(quad.object.value))
        positions.push({ position: "object", target: quad.object.value });
      for (const match of positions)
        references.push({
          ownership,
          file: path,
          ...(graphSelector ? { selector: graphSelector } : {}),
          targetIri: match.target,
          position: match.position,
          statement: {
            subject: rdfTerm(quad.subject, graphSelector ?? path),
            predicate: rdfTerm(quad.predicate, graphSelector ?? path),
            object: rdfTerm(quad.object, graphSelector ?? path),
          },
        });
    }
  };

  for (const [path, graphSelector] of lockedPaths) {
    const bytes = await bytesFromStatus(root, snapshot, path);
    if (!bytes) continue;
    const file = Object.entries(lock.dependencies)
      .flatMap(([id, current]) =>
        current.files
          .filter((record) => `${current.snapshot_path}/${record.key}` === path)
          .map((record) => ({ id, record })),
      )
      .find((entry) => entry.id !== removedId)?.record;
    if (!file) continue;
    const store = await parseGraph(bytes, file, bundle.vettedDigest, graphSelector);
    recordStoreReferences(store, path, "locked", graphSelector);
  }
  const mediaByExtension = rdfFormats;
  for (const path of snapshot.ownedPaths) {
    const mediaType = mediaByExtension[extname(path).toLowerCase()];
    if (!mediaType) continue;
    const bytes = await bytesFromStatus(root, snapshot, path);
    if (!bytes) continue;
    try {
      const baseIri =
        typeof manifest.base_iri === "string"
          ? manifest.base_iri
          : pathToFileURL(await safePath(root, path)).href;
      const store = await parseRdf(bytes, mediaType, baseIri, false, path);
      recordStoreReferences(store, path, "owned", undefined);
    } catch {
      skippedFiles.push(path);
    }
  }
  references.push(...lockStringReferences(lock, targets, removedId));
  const unique = new Map<string, DependencyReference>();
  for (const reference of references) unique.set(canonical(reference), reference);
  const result = [...unique.values()].sort(
    (left, right) =>
      utf8Compare(left.file, right.file) ||
      utf8Compare(left.selector ?? "", right.selector ?? "") ||
      utf8Compare(left.targetIri, right.targetIri) ||
      utf8Compare(left.position, right.position),
  );
  return {
    references: result,
    targetIris: sortedSet([...targets]),
    skippedFiles: sortedSet(skippedFiles),
  };
}

export async function prepareDependencyRemove(options: {
  project?: string;
  cwd?: string;
  id: string;
}): Promise<PreparedDependency> {
  const dependencyId = id(options.id);
  const root = await discoverProject(options);
  const first = await capture(root, ["tbspec.toml", "tbspec.lock"]);
  const initialLock = parseLock(first.files["tbspec.lock"]?.toString("utf8") ?? "");
  const initialDependency = requireAddition(initialLock.dependencies[dependencyId], dependencyId);
  const paths = initialDependency.files.map(
    (file) => `${initialDependency.snapshot_path}/${file.key}`,
  );
  const snapshot = await captureDependencyAdministration(root, paths, [
    { path: ".tbspec/dependencies", included: [initialDependency.snapshot_path], excluded: [] },
  ]);
  const manifestText = snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
  const lockText = snapshot.files["tbspec.lock"]?.toString("utf8") ?? "";
  const manifest = parseManifest(manifestText);
  const lock = parseLock(lockText);
  const dependency = requireAddition(lock.dependencies[dependencyId], dependencyId);
  const impact = await dependencyReferences(
    root,
    snapshot,
    lock,
    dependencyId,
    dependency,
    manifest,
  );
  const nextManifest = removeDependencyChoices(manifestText, dependencyId);
  const retainedDependencies = Object.fromEntries(
    Object.entries(lock.dependencies).filter(([currentId]) => currentId !== dependencyId),
  );
  const nextLockText = writeToml({ ...lock, dependencies: retainedDependencies });
  parseLock(nextLockText);
  const baseline = await inspectSnapshot(root, snapshot, { command: "status" });
  const stagedFiles: Record<string, Buffer | null> = {
    ...snapshot.files,
    "tbspec.lock": Buffer.from(nextLockText),
    "tbspec.toml": Buffer.from(nextManifest),
  };
  const writes = [
    { file: "tbspec.lock", bytes: Buffer.from(nextLockText) },
    ...(nextManifest !== manifestText
      ? [{ file: "tbspec.toml", bytes: Buffer.from(nextManifest) }]
      : []),
    ...paths.map((path) => {
      if (!snapshot.files[path])
        throw new ProjectError(
          "invalid",
          "SNAPSHOT_INTEGRITY",
          "A managed dependency file is missing; no removal is permitted.",
          path,
        );
      stagedFiles[path] = null;
      return { file: path, bytes: null };
    }),
  ];
  const staged = { ...snapshot, files: stagedFiles };
  const proposed = await inspectSnapshot(root, staged, { command: "status" });
  const status = statusResult(proposed);
  const choices = {
    ontology: Object.entries((manifest.ontology_choices ?? {}) as Record<string, string>)
      .filter(([, selected]) => selected === dependencyId)
      .map(([ontologyIri]) => ontologyIri)
      .sort(utf8Compare),
    design: Object.entries((manifest.design_choices ?? {}) as Row)
      .filter(([, value]) => typeof value === "string" && dependencySelector(value, dependencyId))
      .map(([ontologyIri, selected]) => ({ ontologyIri, selector: selected }))
      .sort((left, right) => utf8Compare(left.ontologyIri, right.ontologyIri)),
  };
  const removedSelectors = dependency.files
    .map((file) => `dep:${dependencyId}/${file.key}`)
    .sort(utf8Compare);
  const affectedFiles = sortedSet([
    ...new Set([
      "tbspec.lock",
      ...(nextManifest !== manifestText ? ["tbspec.toml"] : []),
      ...paths,
      ...impact.references.map((reference) => reference.file),
    ]),
  ]);
  const details = {
    id: dependencyId,
    primarySelector: `dep:${dependencyId}/${dependency.primary}`,
    removedSelectors,
    removedPaths: paths,
    choices,
    directAndDownstreamReferences: impact.references,
    targetIris: impact.targetIris,
    skippedFiles: impact.skippedFiles,
    projectValidity: status.projectValidity,
  };
  const plan = dependencyAdminImpact(
    preparePlan(snapshot, "dependency.remove", writes, details),
    baseline,
    proposed,
    [...removedSelectors, ...impact.targetIris, `dep:${dependencyId}`],
    affectedFiles,
    ["confirm"],
  );
  return {
    root,
    id: dependencyId,
    dependency,
    plan,
    diagnostics: [
      ...proposed.diagnostics,
      ...impact.skippedFiles.map((file) => ({
        code: "DEPENDENCY_IMPACT_INCOMPLETE",
        severity: "warning" as const,
        message:
          "Known references could not be inspected because this owned RDF file is malformed.",
        file,
      })),
    ],
    projectValidity: status.projectValidity,
    validationComplete: status.validationComplete,
    administration: { kind: "remove", details },
  };
}

export async function dependencyRename(options: {
  project?: string;
  cwd?: string;
  from: string;
  to: string;
  apply?: boolean;
  acceptedPreview?: string;
}): Promise<Result> {
  try {
    checkAcceptedPreview(options.acceptedPreview);
    if (options.acceptedPreview && !options.apply)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--accepted-preview requires --apply for dependency rename.",
      );
    const prepared = await prepareDependencyRename(options);
    if (!options.apply) return dependencyPreview(prepared, "preview");
    if (!options.acceptedPreview)
      return previewConflict(
        prepared,
        "PREVIEW_REQUIRED",
        "Review the dependency rename and retry with --apply --accepted-preview.",
      );
    if (options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return previewConflict(
        prepared,
        "PREVIEW_CHANGED",
        "The dependency changed after the rename preview. Review the new preview and retry.",
      );
    return await publishPreparedDependency(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function dependencyRemove(options: {
  project?: string;
  cwd?: string;
  id: string;
  confirm?: boolean;
  acceptedPreview?: string;
}): Promise<Result> {
  try {
    checkAcceptedPreview(options.acceptedPreview);
    if (options.acceptedPreview && !options.confirm)
      throw new ProjectError(
        "invalid_arguments",
        "ARGUMENT_INVALID",
        "--accepted-preview requires --confirm for dependency removal.",
      );
    const prepared = await prepareDependencyRemove(options);
    if (!options.confirm) return dependencyPreview(prepared, "preview");
    if (!options.acceptedPreview)
      return previewConflict(
        prepared,
        "PREVIEW_REQUIRED",
        "Review the dependency removal and retry with --confirm --accepted-preview.",
      );
    if (options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return previewConflict(
        prepared,
        "PREVIEW_CHANGED",
        "The dependency changed after the removal preview. Review the new preview and retry.",
      );
    return await publishPreparedDependency(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function dependencySupportSet(options: {
  project?: string;
  cwd?: string;
  id: string;
  target?: string;
  role: "shacl" | "design";
  source: string;
  ref?: string;
  resource?: string;
  acceptedPreview?: string;
  signal?: AbortSignal;
}): Promise<Result> {
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
    const prepared = await prepareDependencySupportSet(options);
    if (!options.acceptedPreview)
      return previewConflict(
        prepared,
        "PREVIEW_REQUIRED",
        "Review the manual support preview and retry with its accepted fingerprint.",
      );
    if (options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return previewConflict(
        prepared,
        "PREVIEW_CHANGED",
        "The reacquired manual support differs from the accepted preview. Review the new preview and retry.",
      );
    return await publishPreparedDependency(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function dependencySupportClear(options: {
  project?: string;
  cwd?: string;
  id: string;
  target?: string;
  role: "shacl" | "design";
  resource: string;
  acceptedPreview?: string;
}): Promise<Result> {
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
    const prepared = await prepareDependencySupportClear(options);
    if (options.acceptedPreview && options.acceptedPreview !== prepared.plan.preview.fingerprint)
      return previewConflict(
        prepared,
        "PREVIEW_CHANGED",
        "The dependency changed after the support preview. Review the new preview and retry.",
      );
    return await publishPreparedDependency(prepared);
  } catch (error) {
    return failure(error);
  }
}

export async function dependencySelect(options: {
  project?: string;
  cwd?: string;
  ontologyIri: string;
  id: string;
}): Promise<Result> {
  try {
    const dependencyId = id(options.id);
    const project = await readProject({ project: options.project, cwd: options.cwd });
    const manifestText = project.snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
    const proposedText = editOntologyChoice(manifestText, options.ontologyIri, dependencyId);
    const dependency = project.lock.dependencies[dependencyId];
    if (!dependency)
      throw new ProjectError(
        "invalid_arguments",
        "RESOURCE_MISSING",
        "Dependency ID was not found.",
      );
    const reachable = dependencyDistances(dependency);
    const candidates = dependency.files.filter((file) => {
      if (
        file.kind !== "ontology" ||
        file.graph_iri !== options.ontologyIri ||
        !reachable.has(file.key)
      )
        return false;
      const sourceChoice = dependency.choices.find(
        (choice) =>
          choice.kind === "ontology" &&
          choice.target_iri === options.ontologyIri &&
          choice.context === file.context,
      );
      const selectedIsReachable =
        sourceChoice !== undefined && reachable.has(String(sourceChoice.selected));
      return !selectedIsReachable || sourceChoice?.selected === file.key;
    });
    if (!candidates.length)
      throw new ProjectError(
        "invalid_arguments",
        "RESOURCE_MISSING",
        "The selected dependency does not contain this ontology IRI.",
      );
    const signatures = new Set(candidates.map((file) => file.graph_signature));
    if (signatures.size > 1)
      throw new ProjectError(
        "conflict",
        "SOURCE_SELECTION_AMBIGUOUS",
        "The dependency contains multiple different versions of this ontology without a recorded source winner.",
        "tbspec.lock",
        {
          graphIri: options.ontologyIri,
          dependencyId,
          selectors: candidates.map((file) => `dep:${dependencyId}/${file.key}`).sort(utf8Compare),
        },
      );
    const selectors = candidates.map((file) => `dep:${dependencyId}/${file.key}`).sort(utf8Compare);
    if (proposedText === manifestText)
      return ok({ applied: false, ontologyIri: options.ontologyIri, dependencyId, selectors });
    const plan = preparePlan(
      project.snapshot,
      "dependency.select",
      [{ file: "tbspec.toml", bytes: Buffer.from(proposedText) }],
      { ontologyIri: options.ontologyIri, dependencyId, selectors },
    );
    const diagnostics = await publishPlan(project.root, plan);
    return ok(
      {
        applied: true,
        ontologyIri: options.ontologyIri,
        dependencyId,
        selectors,
        changes: plan.preview.changes,
      },
      diagnostics,
    );
  } catch (error) {
    return failure(error);
  }
}

export async function dependencyClear(options: {
  project?: string;
  cwd?: string;
  ontologyIri: string;
}): Promise<Result> {
  try {
    const project = await readProject({ project: options.project, cwd: options.cwd });
    const manifestText = project.snapshot.files["tbspec.toml"]?.toString("utf8") ?? "";
    const previous = (project.manifest.ontology_choices as Record<string, string> | undefined)?.[
      options.ontologyIri
    ];
    const proposedText = editOntologyChoice(manifestText, options.ontologyIri);
    if (proposedText === manifestText)
      return ok({
        applied: false,
        ontologyIri: options.ontologyIri,
        previousDependencyId: previous ?? null,
      });
    const plan = preparePlan(
      project.snapshot,
      "dependency.clear",
      [{ file: "tbspec.toml", bytes: Buffer.from(proposedText) }],
      { ontologyIri: options.ontologyIri },
    );
    const diagnostics = await publishPlan(project.root, plan);
    return ok(
      {
        applied: true,
        ontologyIri: options.ontologyIri,
        previousDependencyId: previous ?? null,
        changes: plan.preview.changes,
      },
      diagnostics,
    );
  } catch (error) {
    return failure(error);
  }
}

function sourceOutput(source: Row): Row {
  return {
    id: source.id,
    kind: source.kind,
    locator: source.locator,
    selectedResource: source.selected_resource,
    ...(source.effective_locator ? { effectiveLocator: source.effective_locator } : {}),
    ...(source.revision_kind ? { revisionKind: source.revision_kind } : {}),
    ...(source.resolved_commit ? { resolvedCommit: source.resolved_commit } : {}),
    ...(source.requested_ref ? { requestedRef: source.requested_ref } : {}),
    ...(source.release ? { release: source.release } : {}),
    ...(source.inventory_digest ? { inventoryDigest: source.inventory_digest } : {}),
  };
}

export async function dependencyCheck(options: {
  project?: string;
  cwd?: string;
  id?: string;
  signal?: AbortSignal;
}): Promise<Result> {
  try {
    const root = await discoverProject(options);
    const initial = await capture(root, ["tbspec.toml", "tbspec.lock"]);
    const manifest = parseManifest(initial.files["tbspec.toml"]?.toString("utf8") ?? "");
    const initialLock = parseLock(initial.files["tbspec.lock"]?.toString("utf8") ?? "");
    const ids = options.id
      ? [id(options.id)]
      : Object.keys(initialLock.dependencies).sort(utf8Compare);
    if (options.id && !initialLock.dependencies[ids[0] ?? ""])
      throw new ProjectError(
        "invalid_arguments",
        "RESOURCE_MISSING",
        "Dependency ID was not found.",
      );
    const targetPaths = ids.flatMap((dependencyId) => {
      const dependency = initialLock.dependencies[dependencyId];
      return dependency?.files.map((file) => `${dependency.snapshot_path}/${file.key}`) ?? [];
    });
    const snapshot = await capture(root, ["tbspec.toml", "tbspec.lock", ...targetPaths]);
    for (const path of ["tbspec.toml", "tbspec.lock"])
      if (!initial.files[path]?.equals(snapshot.files[path] ?? Buffer.alloc(0)))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Project configuration changed during dependency check.",
          path,
        );
    const lock = parseLock(snapshot.files["tbspec.lock"]?.toString("utf8") ?? "");
    const bundle = await loadStarters();
    const limits = defaultLimits(manifest);
    const items: Row[] = [];
    const diagnostics: Diagnostic[] = [];
    for (const dependencyId of ids) {
      if (options.signal?.aborted)
        throw new ProjectError(
          "conflict",
          "ACQUISITION_CANCELLED",
          "Dependency check was cancelled.",
        );
      const dependency = lock.dependencies[dependencyId];
      if (!dependency) continue;
      const lockedSignature = dependency.interpretation_signature;
      const corrupted = dependency.files.find((file) => {
        const bytes = snapshot.files[`${dependency.snapshot_path}/${file.key}`];
        return (
          !bytes || bytes.byteLength !== file.byte_length || digest(bytes) !== file.byte_digest
        );
      });
      if (corrupted) {
        const file = `${dependency.snapshot_path}/${corrupted.key}`;
        items.push({
          id: dependencyId,
          state: "unavailable",
          lockedSignature,
          observedSignature: null,
          comparison: "unavailable",
          observedSources: [],
        });
        diagnostics.push({
          code: "SNAPSHOT_INTEGRITY",
          severity: "error",
          message:
            "A retained dependency file differs from its lock record; restore it before checking the source.",
          file,
          selector: `dep:${dependencyId}/${corrupted.key}`,
        });
        continue;
      }

      const primary = dependency.files.find((file) => file.key === dependency.primary);
      const sourceRecordValue = dependency.sources.find((source) => source.id === "source");
      if (!primary || !sourceRecordValue) {
        items.push({
          id: dependencyId,
          state: "unavailable",
          lockedSignature,
          observedSignature: null,
          comparison: "unavailable",
          observedSources: [],
        });
        diagnostics.push({
          code: "SOURCE_UNAVAILABLE",
          severity: "error",
          message: "The recorded dependency source cannot be checked.",
          file: "tbspec.lock",
          selector: `dep:${dependencyId}`,
        });
        continue;
      }

      if (sourceRecordValue.kind === "bundle") {
        const installed = Object.values(bundle.lock.dependencies).find((candidate) =>
          candidate.sources.some(
            (source) =>
              source.kind === "bundle" &&
              source.release === sourceRecordValue.release &&
              source.selected_resource === sourceRecordValue.selected_resource,
          ),
        );
        if (!installed) {
          items.push({
            id: dependencyId,
            state: "unavailable",
            lockedSignature,
            observedSignature: null,
            comparison: "unavailable",
            observedSources: [],
          });
          diagnostics.push({
            code: "SOURCE_UNAVAILABLE",
            severity: "error",
            message: "The recorded bundled resource is not present in the installed release.",
            file: "tbspec.lock",
            selector: `dep:${dependencyId}`,
          });
          continue;
        }
        const observedSignature = installed.interpretation_signature;
        const state = observedSignature === lockedSignature ? "unchanged" : "changed";
        items.push({
          id: dependencyId,
          state,
          lockedSignature,
          observedSignature,
          comparison: "complete",
          observedSources: installed.sources.map(sourceOutput),
        });
        if (state === "changed")
          diagnostics.push({
            code: "DEPENDENCY_DRIFT",
            severity: "error",
            message: "The installed bundled interpretation differs from the locked snapshot.",
            file: "tbspec.lock",
            selector: `dep:${dependencyId}`,
          });
        continue;
      }

      let source: SourceInventory | undefined;
      try {
        const ref =
          sourceRecordValue.kind === "git" && sourceRecordValue.revision_kind !== "default"
            ? String(sourceRecordValue.requested_ref ?? sourceRecordValue.resolved_commit)
            : undefined;
        source = await discoverSource({
          source: String(sourceRecordValue.locator),
          cwd: root,
          ...(ref ? { ref } : {}),
          resource: String(sourceRecordValue.selected_resource),
          limits,
          signal: options.signal,
        });
        const observed = await resolveDependencySource(
          {
            id: dependencyId,
            kind: dependency.kind as ResourceKind,
            resource: String(sourceRecordValue.selected_resource),
          },
          limits,
          source,
        );
        const observedWithManual = preserveManualAttachments(dependency, observed.dependency);
        const manualState = await checkManualAttachmentSources({
          dependencyId,
          dependency,
          baseDependency: observedWithManual,
          root,
          limits,
          signal: options.signal,
        });
        const currentObserved = manualState.observedDependency ?? observedWithManual;
        const state =
          manualState.unavailable ||
          currentObserved.interpretation_signature !== lockedSignature ||
          manualState.changed
            ? manualState.unavailable
              ? "unavailable"
              : "changed"
            : "unchanged";
        items.push({
          id: dependencyId,
          state,
          lockedSignature,
          observedSignature:
            manualState.unavailable || manualState.partial
              ? null
              : currentObserved.interpretation_signature,
          comparison: manualState.partial ? "partial" : "complete",
          observedSources: [
            ...observed.dependency.sources.map(sourceOutput),
            ...manualState.observedSources,
          ],
        });
        diagnostics.push(...manualState.diagnostics);
        if (state === "changed")
          diagnostics.push({
            code: "DEPENDENCY_DRIFT",
            severity: "error",
            message: manualState.changed
              ? "The selected source or an active manual support source now resolves to a different interpretation."
              : "The selected source now resolves to a different interpretation.",
            file: "tbspec.lock",
            selector: `dep:${dependencyId}`,
          });
        if (state === "unavailable")
          diagnostics.push({
            code: "SOURCE_UNAVAILABLE",
            severity: "error",
            message: "An active manual support source could not be checked.",
            file: "tbspec.lock",
            selector: `dep:${dependencyId}`,
          });
      } catch (error) {
        const result = failure(error);
        const unavailable = !source || result.status === "unavailable";
        const state = unavailable ? "unavailable" : "changed";
        const comparison = unavailable ? "unavailable" : "partial";
        items.push({
          id: dependencyId,
          state,
          lockedSignature,
          observedSignature: null,
          comparison,
          observedSources: source ? [sourceOutput(sourceRecordValue)] : [],
        });
        diagnostics.push(
          ...result.diagnostics.map((diagnostic) =>
            unavailable
              ? { ...diagnostic, selector: diagnostic.selector ?? `dep:${dependencyId}` }
              : {
                  ...diagnostic,
                  code:
                    diagnostic.code === "SOURCE_UNAVAILABLE" ? diagnostic.code : "DEPENDENCY_DRIFT",
                  selector: diagnostic.selector ?? `dep:${dependencyId}`,
                },
          ),
        );
      } finally {
        await source?.cleanup?.();
      }
    }
    await verifyReads(root, snapshot.reads);
    const result = ok({ items }, diagnostics);
    if (items.some((item) => item.state === "unavailable")) result.status = "unavailable";
    else if (items.some((item) => item.state === "changed")) result.status = "invalid";
    return result;
  } catch (error) {
    return failure(error);
  }
}

async function checkManualAttachmentSources(options: {
  dependencyId: string;
  dependency: Dependency;
  baseDependency: Dependency;
  root: string;
  limits: Limits;
  signal?: AbortSignal;
}): Promise<{
  changed: boolean;
  unavailable: boolean;
  partial: boolean;
  diagnostics: Diagnostic[];
  observedDependency: Dependency | null;
  observedSources: Row[];
}> {
  let changed = false;
  let unavailable = false;
  let partial = false;
  let observedDependency: Dependency | null = options.baseDependency;
  const diagnostics: Diagnostic[] = [];
  const observedSources: Row[] = [];
  const active = options.dependency.attachments.filter(
    (attachment) =>
      attachment.active === true &&
      typeof attachment.source === "string" &&
      /^manual\/attachment-[1-9]\d*$/.test(attachment.source),
  );
  for (const attachment of active) {
    if (options.signal?.aborted)
      throw new ProjectError(
        "conflict",
        "ACQUISITION_CANCELLED",
        "Dependency check was cancelled.",
      );
    const sourceId = String(attachment.source);
    const record = options.dependency.sources.find((source) => source.id === sourceId);
    if (!record) {
      changed = true;
      partial = true;
      diagnostics.push({
        code: "SOURCE_UNAVAILABLE",
        severity: "error",
        message: "The active manual support source record is missing.",
        file: "tbspec.lock",
        selector: `dep:${options.dependencyId}/${String(attachment.primary)}`,
      });
      continue;
    }
    let source: SourceInventory | undefined;
    try {
      const ref =
        record.kind === "git" && record.revision_kind !== "default"
          ? String(record.requested_ref ?? record.resolved_commit)
          : undefined;
      source = await discoverSource({
        source: String(record.locator),
        cwd: options.root,
        ...(ref ? { ref } : {}),
        resource: String(record.selected_resource),
        signal: options.signal,
        limits: options.limits,
      });
      const selected = sourceEntryForSelection(source, String(record.selected_resource));
      if (!selected)
        throw new ProjectError(
          "invalid",
          "RESOURCE_MISSING",
          "The manually attached source resource is no longer available.",
          String(record.selected_resource),
        );
      if (selected.parseError) throw selected.parseError;
      const closure = await buildClosure(source, selected, options.limits);
      await source.verifyIncluded?.(closure.entries);
      const fresh = dependencyFor(options.dependencyId, "design", source, selected, closure);
      const projection = projectManualAttachment({
        dependencyId: options.dependencyId,
        attachmentId: String(attachment.id),
        sourceId,
        role: String(attachment.role),
        fresh,
      });
      if (
        !manualAttachmentProjectionMatches(
          options.dependency,
          projection,
          sourceId,
          String(attachment.id),
        )
      )
        changed = true;
      if (observedDependency)
        observedDependency = mergeManualAttachmentProjection(
          observedDependency,
          projection,
          sourceId,
          String(attachment.id),
        );
      const observedRecord = sourceRecord(source, selected);
      observedRecord.id = sourceId;
      observedSources.push(sourceOutput(observedRecord));
      diagnostics.push(...closure.diagnostics);
    } catch (error) {
      const result = failure(error);
      if (result.status === "unavailable") unavailable = true;
      else changed = true;
      partial = true;
      observedDependency = null;
      diagnostics.push(
        ...result.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          selector:
            diagnostic.selector ?? `dep:${options.dependencyId}/${String(attachment.primary)}`,
        })),
      );
    } finally {
      await source?.cleanup?.();
    }
  }
  return { changed, unavailable, partial, diagnostics, observedDependency, observedSources };
}

function mergeManualAttachmentProjection(
  dependency: Dependency,
  projection: ReturnType<typeof projectManualAttachment>,
  sourceId: string,
  attachmentId: string,
): Dependency {
  const inSource = (value: unknown) =>
    typeof value === "string" && (value === sourceId || value.startsWith(`${sourceId}/`));
  const referencesSource = (row: Row) =>
    [row.context, row.from, row.to, row.resource, row.support, row.selected, row.primary].some(
      inSource,
    ) ||
    [row.ontologies, row.schemas].some((values) => Array.isArray(values) && values.some(inSource));
  const nestedAttachment = (row: Row) =>
    row.id !== attachmentId &&
    (String(row.id).startsWith(`${attachmentId}-`) || inSource(row.source));
  const next: Dependency = {
    ...dependency,
    sources: [
      ...dependency.sources.filter((record) => !inSource(record.id)),
      ...projection.sources,
    ],
    files: [
      ...dependency.files.filter((file) => !String(file.key).startsWith(`${sourceId}/`)),
      ...projection.files,
    ],
    edges: [...dependency.edges.filter((row) => !referencesSource(row)), ...projection.edges],
    bindings: [
      ...dependency.bindings.filter((row) => !referencesSource(row)),
      ...projection.bindings,
    ],
    associations: [
      ...dependency.associations.filter(
        (row) => !(row.origin === "source" && referencesSource(row)),
      ),
      ...projection.associations,
    ],
    choices: [...dependency.choices.filter((row) => !referencesSource(row)), ...projection.choices],
    attachments: [
      ...dependency.attachments.filter((row) => !nestedAttachment(row)),
      ...projection.attachments,
    ],
    interpretation_signature: "sha256:" + "0".repeat(64),
  };
  next.interpretation_signature = interpretationSignature(next);
  return next;
}

function projectManualAttachment(options: {
  dependencyId: string;
  attachmentId: string;
  sourceId: string;
  role: string;
  fresh: Dependency;
}): {
  files: LockedFile[];
  sources: Row[];
  edges: Row[];
  bindings: Row[];
  associations: Row[];
  choices: Row[];
  attachments: Row[];
} {
  const keyMap = new Map(
    options.fresh.files.map((file) => [file.key, portablePath(`${options.sourceId}/${file.key}`)]),
  );
  const sourceMap = new Map(
    options.fresh.sources.map((record) => [
      String(record.id),
      String(record.id) === "source"
        ? options.sourceId
        : portablePath(`${options.sourceId}/${String(record.id)}`),
    ]),
  );
  const contextMap = new Map<string, string>();
  const mappedContext = (context: unknown) => {
    const value = String(context);
    let mapped = contextMap.get(value);
    if (!mapped) {
      mapped = value === "source" ? options.sourceId : portablePath(`${options.sourceId}/${value}`);
      contextMap.set(value, mapped);
    }
    return mapped;
  };
  const mappedKey = (key: unknown) => keyMap.get(String(key)) ?? String(key);
  const mappedSource = (value: unknown) =>
    sourceMap.get(String(value)) ?? portablePath(`${options.sourceId}/${String(value)}`);
  const nestedAttachmentMap = new Map(
    options.fresh.attachments.map((attachment) => [
      String(attachment.id),
      `${options.attachmentId}-${String(attachment.id)}`,
    ]),
  );
  const sources: Row[] = options.fresh.sources.map((record) => ({
    ...record,
    id: sourceMap.get(String(record.id)) ?? options.sourceId,
  }));
  const files = options.fresh.files.map((file) => {
    const key = mappedKey(file.key);
    const roles = file.roles.filter((role) => role !== "primary");
    if (file.key === options.fresh.primary) roles.push(options.role);
    return {
      ...file,
      key,
      source: mappedSource(file.source),
      context: mappedContext(file.context),
      roles: sortedSet(roles.length ? roles : ["closure"]),
      graph_iri:
        file.identity === "declared"
          ? file.graph_iri
          : `urn:tbspec:graph:${digest(`dep:${options.dependencyId}/${key}`).slice(7)}`,
    };
  });
  const edges = options.fresh.edges.map((edge) => ({
    ...edge,
    context: mappedContext(edge.context),
    from: mappedKey(edge.from),
    ...(edge.to ? { to: mappedKey(edge.to) } : {}),
  }));
  const bindings = options.fresh.bindings.map((binding) => ({
    ...binding,
    context: mappedContext(binding.context),
    resource: mappedKey(binding.resource),
    ontologies: ((binding.ontologies as string[]) ?? []).map(mappedKey),
    schemas: ((binding.schemas as string[]) ?? []).map(mappedKey),
  }));
  const associations = options.fresh.associations.map((association) => ({
    ...association,
    context: mappedContext(association.context),
    resource: mappedKey(association.resource),
    support: mappedKey(association.support),
    ...(association.attachment
      ? { attachment: nestedAttachmentMap.get(String(association.attachment)) }
      : {}),
  }));
  const choices = options.fresh.choices.map((choice) => ({
    ...choice,
    context: mappedContext(choice.context),
    selected: mappedKey(choice.selected),
  }));
  const attachments = options.fresh.attachments.map((attachment) => ({
    ...attachment,
    id: nestedAttachmentMap.get(String(attachment.id)),
    resource: mappedKey(attachment.resource),
    source: mappedSource(attachment.source),
    primary: mappedKey(attachment.primary),
  }));
  const sourceRecordValue = sources.find((record) => record.id === options.sourceId);
  if (sourceRecordValue) {
    const selected = options.fresh.sources[0];
    if (selected) sourceRecordValue.selected_resource = selected.selected_resource;
  }
  return { files, sources, edges, bindings, associations, choices, attachments };
}

function manualAttachmentProjectionMatches(
  dependency: Dependency,
  projection: ReturnType<typeof projectManualAttachment>,
  sourceId: string,
  attachmentId: string,
): boolean {
  const equalRows = <T extends object>(left: T[], right: T[]) =>
    canonical([...left].sort((a, b) => utf8Compare(canonical(a), canonical(b)))) ===
    canonical([...right].sort((a, b) => utf8Compare(canonical(a), canonical(b))));
  const inSource = (value: unknown) =>
    typeof value === "string" && (value === sourceId || value.startsWith(`${sourceId}/`));
  const referencesSource = (row: Row) =>
    [row.context, row.from, row.to, row.resource, row.support, row.selected, row.primary].some(
      inSource,
    ) ||
    [row.ontologies, row.schemas].some((values) => Array.isArray(values) && values.some(inSource));
  const actualSources = dependency.sources
    .filter((record) => inSource(record.id))
    .map((record) => ({ id: record.id, selected_resource: record.selected_resource }));
  const expectedSources = projection.sources.map((record) => ({
    id: record.id,
    selected_resource: record.selected_resource,
  }));
  const actualAssociations = dependency.associations.filter(
    (row) => row.origin === "source" && referencesSource(row),
  );
  const actualAttachments = dependency.attachments.filter(
    (row) =>
      String(row.id).startsWith(`${attachmentId}-`) ||
      (row.id !== attachmentId && inSource(row.source)),
  );
  return (
    equalRows(
      dependency.files.filter((file) => String(file.key).startsWith(`${sourceId}/`)),
      projection.files,
    ) &&
    equalRows(actualSources, expectedSources) &&
    equalRows(dependency.edges.filter(referencesSource), projection.edges) &&
    equalRows(dependency.bindings.filter(referencesSource), projection.bindings) &&
    equalRows(actualAssociations, projection.associations) &&
    equalRows(dependency.choices.filter(referencesSource), projection.choices) &&
    equalRows(actualAttachments, projection.attachments)
  );
}

export interface DependencyAddOptions {
  project?: string;
  cwd?: string;
  source: string;
  id: string;
  kind: ResourceKind;
  ref?: string;
  resource?: string;
  acceptedPreview?: string;
  signal?: AbortSignal;
}

export async function prepareDependencyUpdate(options: {
  project?: string;
  cwd?: string;
  id: string;
  signal?: AbortSignal;
}): Promise<PreparedDependency> {
  const dependencyId = id(options.id);
  const current = await readProject({ project: options.project, cwd: options.cwd });
  const existing = current.lock.dependencies[dependencyId];
  if (!existing)
    throw new ProjectError("invalid_arguments", "RESOURCE_MISSING", "Dependency ID was not found.");
  const sourceRecordValue = existing.sources.find((record) => record.id === "source");
  if (!sourceRecordValue)
    throw new ProjectError(
      "unavailable",
      "SOURCE_UNAVAILABLE",
      "This dependency does not have a refreshable external source.",
      "tbspec.lock",
      { selector: `dep:${dependencyId}` },
    );
  const limits = defaultLimits(current.manifest);
  if (sourceRecordValue.kind === "bundle") {
    if (options.signal?.aborted)
      throw new ProjectError(
        "conflict",
        "ACQUISITION_CANCELLED",
        "Dependency update was cancelled.",
      );
    const bundle = await loadStarters();
    const installed = Object.values(bundle.lock.dependencies).find(
      (candidate) =>
        candidate.kind === existing.kind &&
        candidate.sources.some(
          (source) =>
            source.kind === "bundle" &&
            source.selected_resource === sourceRecordValue.selected_resource,
        ),
    );
    const installedSource = installed?.sources.find(
      (source) =>
        source.kind === "bundle" &&
        source.selected_resource === sourceRecordValue.selected_resource,
    );
    if (!installed || !installedSource)
      throw new ProjectError(
        "unavailable",
        "SOURCE_UNAVAILABLE",
        "The selected bundled resource is not present in the installed release.",
        "tbspec.lock",
        { selector: `dep:${dependencyId}` },
      );
    const source: SourceInventory = {
      kind: "directory",
      locator: String(installedSource.locator),
      entries: new Map(),
      diagnostics: [],
      deadline: Date.now() + limits.deadlineMs,
      vettedDigest: bundle.vettedDigest,
      treeRevision: hash({
        release: installedSource.release ?? null,
        inventoryDigest: installedSource.inventory_digest ?? null,
        files: installed.files.map((file) => ({
          key: file.key,
          byteDigest: file.byte_digest,
          graphSignature: file.graph_signature,
        })),
      }),
    };
    const bundledFiles = new Map<string, Buffer>();
    for (const file of installed.files) {
      const bytes = bundle.files[`${installed.snapshot_path}/${file.key}`];
      if (!bytes)
        throw new ProjectError(
          "unavailable",
          "SOURCE_UNAVAILABLE",
          "A required bundled dependency file is not present in the installed release.",
          file.key,
        );
      bundledFiles.set(file.key, Buffer.from(bytes));
    }
    if (options.signal?.aborted)
      throw new ProjectError(
        "conflict",
        "ACQUISITION_CANCELLED",
        "Dependency update was cancelled.",
      );
    return await prepareDependencyCandidate(
      {
        id: dependencyId,
        kind: existing.kind as ResourceKind,
        resource: String(installedSource.selected_resource),
      },
      current,
      source,
      "dependency.update",
      installed,
      installedSource,
      bundledFiles,
    );
  }
  const ref =
    sourceRecordValue.kind === "git" && sourceRecordValue.revision_kind !== "default"
      ? String(sourceRecordValue.requested_ref ?? sourceRecordValue.resolved_commit)
      : undefined;
  const source = await discoverSource({
    source: String(sourceRecordValue.locator),
    cwd: current.root,
    ...(ref ? { ref } : {}),
    resource: String(sourceRecordValue.selected_resource),
    signal: options.signal,
    limits,
  });
  try {
    return await prepareDependencyFromSource(
      {
        id: dependencyId,
        kind: existing.kind as ResourceKind,
        resource: String(sourceRecordValue.selected_resource),
      },
      current,
      limits,
      source,
      "dependency.update",
    );
  } finally {
    await source.cleanup?.();
  }
}

export async function prepareDependencySupportSet(options: {
  project?: string;
  cwd?: string;
  id: string;
  target?: string;
  role: "shacl" | "design";
  source: string;
  ref?: string;
  resource?: string;
  signal?: AbortSignal;
}): Promise<PreparedDependency> {
  const dependencyId = id(options.id);
  const current = await readProject({ project: options.project, cwd: options.cwd });
  const existing = current.lock.dependencies[dependencyId];
  if (!existing)
    throw new ProjectError("invalid_arguments", "RESOURCE_MISSING", "Dependency ID was not found.");
  if (options.role !== "shacl" && options.role !== "design")
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Support role must be shacl or design.",
    );
  const targetKey = dependencyKey(
    dependencyId,
    options.target ?? `dep:${dependencyId}/${existing.primary}`,
  );
  const target = existing.files.find((file) => file.key === targetKey);
  if (!target)
    throw new ProjectError(
      "invalid_arguments",
      "RESOURCE_MISSING",
      "Target selector is not in this dependency.",
    );

  const limits = defaultLimits(current.manifest);
  const source = await discoverSource({
    source: options.source,
    cwd: options.cwd,
    ref: options.ref,
    ...(options.resource ? { resource: options.resource } : {}),
    signal: options.signal,
    limits,
  });
  try {
    const expectedKind = options.role === "shacl" ? "shapes" : "design";
    const candidates = [...source.entries.values()].filter((entry) => {
      if (options.resource)
        return [entry.address, entry.sourceResource, inspectedResource(source, entry)].includes(
          options.resource,
        );
      return entry.kind === expectedKind && !entry.parseError;
    });
    if (!options.resource && candidates.length > 1)
      throw new ProjectError(
        "conflict",
        "SOURCE_SELECTION_AMBIGUOUS",
        "Omitting --resource is only supported when the source has one parseable resource for this support role.",
        undefined,
        {
          role: options.role,
          resources: candidates.map((entry) => entry.address).sort(utf8Compare),
        },
      );
    const selected = candidates[0];
    if (!selected)
      throw new ProjectError(
        "invalid_arguments",
        "RESOURCE_MISSING",
        "Selected support resource is unavailable.",
      );
    if (selected.parseError) throw selected.parseError;
    if (selected.kind !== expectedKind)
      throw new ProjectError(
        "invalid_arguments",
        "SOURCE_ASSOCIATION_INVALID",
        `Selected support resource must be a ${expectedKind} graph.`,
        selected.address,
      );
    const closure = await buildClosure(source, selected, limits);
    await source.verifyIncluded?.(closure.entries);

    const used = new Set(existing.attachments.map((attachment) => String(attachment.id)));
    let ordinal = 1;
    while (used.has(`attachment-${ordinal}`)) ordinal++;
    const attachmentId = `attachment-${ordinal}`;
    const attachmentSourceId = `manual/${attachmentId}`;
    const acquired = dependencyFor(dependencyId, "design", source, selected, closure);
    const keyMap = new Map(
      acquired.files.map((file) => [file.key, portablePath(`${attachmentSourceId}/${file.key}`)]),
    );
    const sourceMap = new Map(
      acquired.sources.map((record) => [
        String(record.id),
        String(record.id) === "source"
          ? attachmentSourceId
          : portablePath(`${attachmentSourceId}/${String(record.id)}`),
      ]),
    );
    const contextMap = new Map<string, string>();
    const mappedContext = (context: unknown) => {
      const value = String(context);
      let mapped = contextMap.get(value);
      if (!mapped) {
        mapped =
          value === "source" ? attachmentSourceId : portablePath(`${attachmentSourceId}/${value}`);
        contextMap.set(value, mapped);
      }
      return mapped;
    };
    const mappedKey = (key: unknown) => keyMap.get(String(key)) ?? String(key);
    const mappedSource = (value: unknown) =>
      sourceMap.get(String(value)) ?? portablePath(`${attachmentSourceId}/${String(value)}`);
    const nestedAttachmentMap = new Map(
      acquired.attachments.map((attachment) => [
        String(attachment.id),
        `${attachmentId}-${String(attachment.id)}`,
      ]),
    );
    const sourceRows: Row[] = acquired.sources.map((record) => ({
      ...record,
      id: sourceMap.get(String(record.id)) ?? attachmentSourceId,
    }));
    const sourceRecordValue = sourceRecord(source, selected);
    sourceRecordValue.id = attachmentSourceId;
    sourceRows[0] = sourceRecordValue;
    const files: LockedFile[] = acquired.files.map((file) => {
      const key = mappedKey(file.key);
      const roles = file.roles.filter((role) => role !== "primary");
      if (file.key === acquired.primary) roles.push(options.role);
      return {
        ...file,
        key,
        source: mappedSource(file.source),
        context: mappedContext(file.context),
        roles: sortedSet(roles.length ? roles : ["closure"]),
        graph_iri:
          file.identity === "declared"
            ? file.graph_iri
            : `urn:tbspec:graph:${digest(`dep:${dependencyId}/${key}`).slice(7)}`,
      };
    });
    const edges = acquired.edges.map((edge) => ({
      ...edge,
      context: mappedContext(edge.context),
      from: mappedKey(edge.from),
      ...(edge.to ? { to: mappedKey(edge.to) } : {}),
    }));
    const bindings = acquired.bindings.map((binding) => ({
      ...binding,
      context: mappedContext(binding.context),
      resource: mappedKey(binding.resource),
      ontologies: ((binding.ontologies as string[]) ?? []).map(mappedKey),
      schemas: ((binding.schemas as string[]) ?? []).map(mappedKey),
    }));
    const associations = acquired.associations.map((association) => ({
      ...association,
      context: mappedContext(association.context),
      resource: mappedKey(association.resource),
      support: mappedKey(association.support),
      ...(association.attachment
        ? { attachment: nestedAttachmentMap.get(String(association.attachment)) }
        : {}),
    }));
    const choices = acquired.choices.map((choice) => ({
      ...choice,
      context: mappedContext(choice.context),
      selected: mappedKey(choice.selected),
    }));
    const attachments = acquired.attachments.map((attachment) => ({
      ...attachment,
      id: nestedAttachmentMap.get(String(attachment.id)),
      resource: mappedKey(attachment.resource),
      source: mappedSource(attachment.source),
      primary: mappedKey(attachment.primary),
    }));
    const primaryKey = mappedKey(acquired.primary);
    const manualAssociation: Row = {
      context: target.context,
      resource: target.key,
      role: options.role,
      support: primaryKey,
      origin: "manual",
      active: true,
      attachment: attachmentId,
    };
    const manualAttachment: Row = {
      id: attachmentId,
      role: options.role,
      resource: target.key,
      source: attachmentSourceId,
      primary: primaryKey,
      active: true,
    };
    const dependency: Dependency = {
      ...existing,
      sources: [
        ...existing.sources,
        ...sourceRows.filter(
          (record) => !existing.sources.some((currentSource) => currentSource.id === record.id),
        ),
      ],
      files: [...existing.files, ...files],
      edges: [...existing.edges, ...edges],
      bindings: [...existing.bindings, ...bindings],
      associations: [...existing.associations, ...associations, manualAssociation],
      choices: [...existing.choices, ...choices],
      attachments: [...existing.attachments, ...attachments, manualAttachment],
      interpretation_signature: "sha256:" + "0".repeat(64),
    };
    dependency.interpretation_signature = interpretationSignature(dependency);
    const sourceBytes = new Map(
      closure.entries.map((entry) => [
        mappedKey(outputKey(entry)),
        Buffer.from(entry.bytes as Buffer),
      ]),
    );
    const lock: Lock = {
      ...current.lock,
      dependencies: { ...current.lock.dependencies, [dependencyId]: dependency },
    };
    const writes = [
      { file: "tbspec.lock", bytes: Buffer.from(writeToml(lock)) },
      ...files.map((file) => ({
        file: `${existing.snapshot_path}/${file.key}`,
        bytes: sourceBytes.get(file.key) as Buffer,
      })),
    ];
    return await prepareDependencyPlan(
      current,
      dependencyId,
      existing,
      dependency,
      source,
      "dependency.support.set",
      {
        target: `dep:${dependencyId}/${target.key}`,
        role: options.role,
        resource: selected.address,
      },
      writes,
      files,
      closure.diagnostics,
    );
  } finally {
    await source.cleanup?.();
  }
}

export async function prepareDependencySupportClear(options: {
  project?: string;
  cwd?: string;
  id: string;
  target?: string;
  role: "shacl" | "design";
  resource: string;
}): Promise<PreparedDependency> {
  const dependencyId = id(options.id);
  const current = await readProject({ project: options.project, cwd: options.cwd });
  const existing = current.lock.dependencies[dependencyId];
  if (!existing)
    throw new ProjectError("invalid_arguments", "RESOURCE_MISSING", "Dependency ID was not found.");
  const targetKey = dependencyKey(
    dependencyId,
    options.target ?? `dep:${dependencyId}/${existing.primary}`,
  );
  const supportKey = dependencyKey(dependencyId, options.resource);
  const association = existing.associations.find(
    (item) =>
      item.origin === "manual" &&
      item.active === true &&
      item.resource === targetKey &&
      item.support === supportKey &&
      item.role === options.role,
  );
  if (!association)
    throw new ProjectError(
      "invalid_arguments",
      "ASSOCIATION_MISSING",
      "Active manual support association was not found.",
    );
  const next: Dependency = {
    ...existing,
    associations: existing.associations.map((item) =>
      item === association ? { ...item, active: false } : item,
    ),
    attachments: existing.attachments.map((attachment) =>
      attachment.id === association.attachment ? { ...attachment, active: false } : attachment,
    ),
    interpretation_signature: "sha256:" + "0".repeat(64),
  };
  next.interpretation_signature = interpretationSignature(next);
  const lock: Lock = {
    ...current.lock,
    dependencies: { ...current.lock.dependencies, [dependencyId]: next },
  };
  const writes = [{ file: "tbspec.lock", bytes: Buffer.from(writeToml(lock)) }];
  return prepareDependencyPlan(
    current,
    dependencyId,
    existing,
    next,
    null,
    "dependency.support.clear",
    {
      target: `dep:${dependencyId}/${targetKey}`,
      role: options.role,
      resource: `dep:${dependencyId}/${supportKey}`,
    },
    writes,
    [],
  );
}

function dependencyKey(dependencyId: string, value: string): string {
  const prefix = `dep:${dependencyId}/`;
  if (!value.startsWith(prefix) || value.length === prefix.length)
    throw new ProjectError(
      "invalid_arguments",
      "SELECTOR_INVALID",
      "Dependency resource selector must name a file in the selected dependency.",
    );
  return portablePath(value.slice(prefix.length));
}

async function prepareDependencyPlan(
  current: Awaited<ReturnType<typeof readProject>>,
  dependencyId: string,
  existing: Dependency,
  dependency: Dependency,
  source: SourceInventory | null,
  operation: string,
  args: Record<string, unknown>,
  proposedWrites: { file: string; bytes: Uint8Array | null }[],
  acquiredFiles: LockedFile[],
  extraDiagnostics: Diagnostic[] = [],
): Promise<PreparedDependency> {
  const targetPaths = proposedWrites
    .filter((write) => write.file !== "tbspec.lock")
    .map((write) => write.file);
  const statusSnapshot = await captureInspection(current.root, "status");
  for (const path of ["tbspec.toml", "tbspec.lock"])
    if (!statusSnapshot.files[path]?.equals(current.snapshot.files[path] as Buffer))
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Project configuration changed while dependency support was prepared; retry with a fresh preview.",
        path,
      );
  const before = await inspectSnapshot(current.root, statusSnapshot, { command: "status" });
  const destinations = await capture(
    current.root,
    ["tbspec.toml", "tbspec.lock", ...targetPaths],
    [{ path: ".tbspec/dependencies", included: [dependencyId], excluded: [] }],
  );
  for (const path of ["tbspec.toml", "tbspec.lock"])
    if (destinations.files[path]?.equals(current.snapshot.files[path] as Buffer) !== true)
      throw new ProjectError(
        "conflict",
        "REVISION_CONFLICT",
        "Project configuration changed while dependency support was prepared; retry with a fresh preview.",
        path,
      );
  const reads = new Map(statusSnapshot.reads.map((read) => [canonical(read), read]));
  for (const read of destinations.reads) reads.set(canonical(read), read);
  const snapshot = {
    ...statusSnapshot,
    files: { ...statusSnapshot.files, ...destinations.files },
    reads: [...reads.values()],
  };
  const existingKeys = new Set(existing.files.map((file) => file.key));
  for (const write of proposedWrites)
    if (
      write.file !== "tbspec.lock" &&
      snapshot.files[write.file] !== null &&
      !existingKeys.has(write.file.slice(`${dependency.snapshot_path}/`.length))
    )
      throw new ProjectError(
        "conflict",
        "DEPENDENCY_SNAPSHOT_EXISTS",
        "Dependency snapshot destination is already occupied.",
        write.file,
      );
  const plan = preparePlan(snapshot, operation, proposedWrites, {
    ...args,
    source: source?.locator ?? null,
    sourceInventoryRevision: source?.treeRevision ?? null,
  });
  const staged = { ...snapshot, files: { ...snapshot.files } };
  for (const write of proposedWrites)
    staged.files[write.file] = write.bytes === null ? null : Buffer.from(write.bytes);
  const after = await inspectSnapshot(current.root, staged, { command: "status" });
  const oldByKey = new Map(existing.files.map((file) => [file.key, file]));
  const newByKey = new Map(dependency.files.map((file) => [file.key, file]));
  const changedKeys = new Set(
    [...new Set([...oldByKey.keys(), ...newByKey.keys()])].filter(
      (key) => canonical(oldByKey.get(key) ?? null) !== canonical(newByKey.get(key) ?? null),
    ),
  );
  const changedGraphs = new Set([...changedKeys].map((key) => `dep:${dependencyId}/${key}`));
  const changedRecords = <T extends Row>(oldRows: T[], newRows: T[]) => {
    const oldSet = new Set(oldRows.map((row) => canonical(row)));
    const newSet = new Set(newRows.map((row) => canonical(row)));
    return [
      ...oldRows.filter((row) => !newSet.has(canonical(row))),
      ...newRows.filter((row) => !oldSet.has(canonical(row))),
    ];
  };
  for (const association of changedRecords(existing.associations, dependency.associations))
    for (const key of [association.resource, association.support])
      if (typeof key === "string") changedGraphs.add(`dep:${dependencyId}/${key}`);
  for (const binding of changedRecords(existing.bindings, dependency.bindings))
    for (const key of [
      binding.resource,
      ...(binding.ontologies as string[]),
      ...(binding.schemas as string[]),
    ])
      if (typeof key === "string") changedGraphs.add(`dep:${dependencyId}/${key}`);
  for (const edge of changedRecords(existing.edges, dependency.edges))
    for (const key of [edge.from, edge.to])
      if (typeof key === "string") changedGraphs.add(`dep:${dependencyId}/${key}`);
  const impact = compareDiagnosticImpact(
    before.diagnostics,
    after.diagnostics,
    [...changedGraphs],
    {
      baselineChecks: impactChecks(before),
      proposedChecks: impactChecks(after),
      changedFiles: [...changedKeys].map((key) => `${dependency.snapshot_path}/${key}`),
    },
  );
  const completedPlan = withPlanImpact(
    {
      ...plan,
      preview: {
        ...plan.preview,
        acquired: acquiredFiles.map((file) => ({
          selector: selector(`dep:${dependencyId}/${file.key}`),
          byteDigest: file.byte_digest,
          graphSignature: file.graph_signature,
        })),
        interpretationSignatures: { [dependencyId]: dependency.interpretation_signature },
      },
    },
    {
      impact: {
        baselineErrors: impact.baselineErrors,
        introducedErrors: impact.introducedErrors,
        worsenedErrors: impact.worsenedErrors,
        skippedChecks: impact.skippedChecks,
        affectedFiles: sortedSet([
          ...new Set([...plan.preview.impact.affectedFiles, ...targetPaths]),
        ]),
        acceptance: [],
      },
    },
  );
  return {
    root: current.root,
    id: dependencyId,
    dependency,
    plan: completedPlan,
    diagnostics: [...(source?.diagnostics ?? []), ...extraDiagnostics, ...after.diagnostics],
    projectValidity: (after.data?.project?.validity ??
      "unchecked") as PreparedDependency["projectValidity"],
    validationComplete: after.data?.project?.validationComplete ?? false,
  };
}

function inspectedResource(source: SourceInventory, entry: SourceEntry): string {
  return source.kind === "url" ? entry.sourceResource : entry.address;
}
function sourceEntryForSelection(
  source: SourceInventory,
  selected: string,
): SourceEntry | undefined {
  const requested = selected.replaceAll("\\", "/");
  if (source.lock)
    for (const [dependencyId, dependency] of Object.entries(source.lock.dependencies))
      for (const file of dependency.files)
        if (requested === `${dependency.snapshot_path}/${file.key}`)
          return source.entries.get(`dep:${dependencyId}/${file.key}`);
  return [...source.entries.values()].find((entry) =>
    [entry.address, entry.sourceResource, inspectedResource(source, entry)].includes(requested),
  );
}
function inspectEntry(source: SourceInventory, entry: SourceEntry): Row {
  const resource = inspectedResource(source, entry);
  const byteDigest = entry.byteDigest ?? (entry.bytes ? digest(entry.bytes) : null);
  const signature =
    byteDigest && entry.mediaType && entry.baseIri && entry.profile
      ? graphSignature({
          byte_digest: byteDigest,
          media_type: entry.mediaType,
          base_iri: entry.baseIri,
          parser_profile: entry.profile,
        })
      : (entry.lockedFile?.graph_signature ?? null);
  return {
    resource,
    sourceResource: entry.sourceResource,
    kind: entry.kind ?? "unclassified",
    classification: entry.classification ?? "unclassified",
    identity: entry.identity ?? "generated",
    graphIri: entry.graphIri ?? null,
    byteDigest,
    graphSignature: signature,
    byteLength: entry.byteLength ?? entry.bytes?.byteLength ?? null,
    parseable: entry.parseable ?? Boolean(entry.store),
    ...(entry.parseError ? { diagnostic: entry.parseError.diagnostic } : {}),
  };
}
function resolvedKind(kind: ResourceKind, entry: SourceEntry): boolean {
  return kind === "ontology"
    ? entry.kind === "ontology"
    : kind === "design"
      ? entry.kind === "design"
      : [
          "model",
          "conceptual-data-model",
          "concrete-data-model",
          "process-model",
          "state-machine-model",
        ].includes(entry.kind ?? "");
}
function sourceRecord(source: SourceInventory, selected: SourceEntry): Row {
  const record: Row = {
    id: "source",
    kind: source.kind,
    locator: source.locator,
    selected_resource:
      selected.address.startsWith("dep:") && selected.lockedDependency && selected.lockedFile
        ? `${selected.lockedDependency.snapshot_path}/${selected.lockedFile.key}`
        : selected.sourceResource,
  };
  if (source.kind === "url") record.effective_locator = source.effectiveLocator;
  if (source.kind === "git") {
    record.revision_kind = source.revisionKind ?? "default";
    record.resolved_commit = source.resolvedCommit;
    if (source.ref !== undefined) record.requested_ref = source.ref;
  }
  return record;
}
function outputKey(entry: SourceEntry): string {
  if (entry.address === "resource") return portablePath(`source/${entry.sourceResource}`);
  const address = entry.address.startsWith("dep:")
    ? `locked/${entry.address.slice(4)}`
    : entry.address;
  return portablePath(`source/${address}`);
}
function sourceDependencyId(entry: SourceEntry): string | undefined {
  return /^dep:([^/]+)\//.exec(entry.address)?.[1];
}
function upstreamSourceId(entry: SourceEntry, sourceId: string): string {
  const dependencyId = sourceDependencyId(entry);
  return dependencyId ? portablePath(`upstream/${dependencyId}/${sourceId}`) : "source";
}
function sourceIdFor(entry: SourceEntry): string {
  return entry.lockedFile ? upstreamSourceId(entry, entry.lockedFile.source) : "source";
}
function contextIdFor(entry: SourceEntry): string {
  return entry.lockedFile ? upstreamSourceId(entry, entry.lockedFile.context) : "source";
}
function impactChecks(result: Result): {
  selector: string;
  kind: string;
  state: "passed" | "failed" | "skipped";
  blockedBy: string[];
  shapesSelector?: string;
}[] {
  const validation = (result.data as Row | null)?.validation as Row | undefined;
  return ((validation?.resources as Row[] | undefined) ?? []).flatMap((resource) =>
    ((resource.checks as Row[] | undefined) ?? []).map((check) => ({
      selector: String(resource.selector),
      kind: String(check.kind),
      state: String(check.state) as "passed" | "failed" | "skipped",
      blockedBy: (check.blockedBy as string[]) ?? [],
      ...(typeof check.shapesSelector === "string" ? { shapesSelector: check.shapesSelector } : {}),
    })),
  );
}
function entryKind(entry: SourceEntry): string | undefined {
  return entry.kind ?? entry.lockedFile?.kind;
}
interface ClosureResult {
  entries: SourceEntry[];
  edges: Row[];
  associations: Row[];
  bindings: Row[];
  choices: Row[];
  attachments: Row[];
  diagnostics: Diagnostic[];
}
async function ensureClosureEntry(
  source: SourceInventory,
  entry: SourceEntry,
  limits: Limits,
): Promise<void> {
  if (entry.parseError) throw entry.parseError;
  if (entry.bytes && entry.store) return;
  const bytes = await readIndexedEntry(source, entry, limits);
  entry.bytes = bytes;
  try {
    await parseSourceEntry(entry, source.vettedDigest ?? "");
  } catch (error) {
    entry.bytes = null;
    entry.store = undefined;
    const parseError =
      error instanceof ProjectError
        ? new ProjectError(
            error.status,
            error.diagnostic.code,
            "An included source graph is malformed, unavailable, or unsupported.",
            entry.address,
          )
        : new ProjectError(
            "invalid",
            "RDF_SYNTAX",
            "An included source graph is malformed or unsupported.",
            entry.address,
          );
    entry.parseError = parseError;
    entry.parseable = false;
    throw parseError;
  }
}

function containsVocabularyTerm(entry: SourceEntry, value: string): boolean {
  const store = entry.store;
  if (!store) return false;
  const term = DataFactory.namedNode(value);
  return (
    store.countQuads(term, null, null, null) > 0 || store.countQuads(null, term, null, null) > 0
  );
}

async function uniqueVocabularyEntry(
  source: SourceInventory,
  value: string,
  limits: Limits,
): Promise<SourceEntry | undefined> {
  let match: SourceEntry | undefined;
  for (const candidate of source.entries.values()) {
    checkCancelled(source);
    if (candidate.parseError || !candidate.mediaType || !candidate.baseIri) continue;
    const loadedHere = !candidate.store;
    try {
      if (loadedHere) {
        candidate.bytes = await readIndexedEntry(source, candidate, limits);
        await parseSourceEntry(candidate, source.vettedDigest ?? "");
      }
      if (!containsVocabularyTerm(candidate, value)) continue;
      if (match) return undefined;
      match = candidate;
    } finally {
      if (loadedHere && candidate.readBytes) {
        candidate.bytes = null;
        candidate.store = undefined;
      }
    }
  }
  return match;
}

async function buildClosure(
  source: SourceInventory,
  primary: SourceEntry,
  limits: Limits,
): Promise<ClosureResult> {
  const entries = new Map<string, SourceEntry>();
  const edges: Row[] = [];
  const associations: Row[] = [];
  const bindings: Row[] = [];
  const choices: Row[] = [];
  const attachments: Row[] = [];
  const diagnostics: Diagnostic[] = [];
  const seenEdges = new Set<string>();
  const rememberEdge = (edge: Row) => {
    const key = canonical(edge);
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      edges.push(edge);
    }
  };
  const byGraph = new Map<string, SourceEntry[]>();
  for (const entry of source.entries.values())
    if (entry.graphIri) {
      const candidates = byGraph.get(entry.graphIri) ?? [];
      candidates.push(entry);
      byGraph.set(entry.graphIri, candidates);
    }
  const resolve = (iri: string, expected?: (entry: SourceEntry) => boolean) => {
    const candidates = (byGraph.get(iri) ?? []).filter((entry) => !expected || expected(entry));
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const selectedBySourceChoice = (target: string, kind: "ontology" | "design") => {
    if (kind === "ontology") {
      const selectedId = ((source.manifest?.ontology_choices ?? {}) as Record<string, string>)[
        target
      ];
      const dependency = selectedId ? source.lock?.dependencies[selectedId] : undefined;
      if (dependency && selectedId) {
        const reachable = dependencyDistances(dependency);
        const candidates = dependency.files
          .filter((file) => {
            if (file.kind !== "ontology" || file.graph_iri !== target || !reachable.has(file.key))
              return false;
            const sourceChoice = dependency.choices.find(
              (choice) =>
                choice.kind === "ontology" &&
                choice.target_iri === target &&
                choice.context === file.context,
            );
            const selectedIsReachable =
              sourceChoice !== undefined && reachable.has(String(sourceChoice.selected));
            return !selectedIsReachable || sourceChoice?.selected === file.key;
          })
          .flatMap((file) => {
            const entry = source.entries.get(`dep:${selectedId}/${file.key}`);
            const distance = reachable.get(file.key);
            return entry && distance !== undefined
              ? [{ entry, distance, key: file.key, signature: file.graph_signature }]
              : [];
          });
        const resolution = resolveOntologyCandidates(
          target,
          candidates.map(({ distance, key, signature }) => ({
            selector: `dep:${selectedId}/${key}`,
            graphIri: target,
            signature,
            rank: distance,
            dependencyId: selectedId,
          })),
        );
        const selectedSignature =
          resolution.state === "resolved" ? resolution.signature : undefined;
        const selected = selectedSignature
          ? candidates
              .filter((candidate) => candidate.signature === selectedSignature)
              .sort(
                (left, right) => left.distance - right.distance || utf8Compare(left.key, right.key),
              )[0]?.entry
          : undefined;
        if (selected && entryKind(selected) === kind && selected.graphIri === target)
          return selected;
      }
    }
    if (kind === "design") {
      const choice = ((source.manifest?.design_choices ?? {}) as Record<string, string>)[target];
      if (choice) {
        const selected = resolveSelector(choice);
        if (selected && entryKind(selected) === kind) return selected;
      }
    }
    return undefined;
  };
  const resolveSelector = (selection: string) => {
    if (!selection.startsWith("dep:")) return source.entries.get(selection);
    const [dependencyId, ...parts] = selection.slice(4).split("/");
    const dependency = source.lock?.dependencies[dependencyId ?? ""];
    const key = parts.join("/") || dependency?.primary;
    const selected =
      dependency && key ? source.entries.get(`dep:${dependencyId}/${key}`) : undefined;
    if (
      !selected &&
      source.submodules?.some((path) => selection === path || selection.startsWith(`${path}/`))
    )
      throw readError(
        "A required Git resource is inside an unsupported submodule; add its repository explicitly.",
        "invalid",
        "GIT_FEATURE_UNSUPPORTED",
      );
    return selected;
  };
  const queue: { entry: SourceEntry; role: string }[] = [{ entry: primary, role: "primary" }];
  while (queue.length) {
    const item = queue.shift();
    if (!item) continue;
    const entry = item.entry;
    if (entries.has(entry.address)) continue;
    if (entry.parseError) throw entry.parseError;
    const byteLength = entry.byteLength ?? entry.bytes?.byteLength;
    if (byteLength === undefined)
      throw new ProjectError(
        "invalid",
        "DEPENDENCY_FILE_INVALID",
        "A selected dependency or declared included file has no captured size.",
        entry.address,
      );
    if (byteLength > limits.maxGraphBytes)
      throw new ProjectError(
        "unavailable",
        "ACQUISITION_LIMIT",
        "An included graph exceeds maxGraphBytes.",
        entry.address,
        { maxGraphBytes: limits.maxGraphBytes },
      );
    if (entries.size + 1 > limits.maxFiles)
      throw new ProjectError(
        "unavailable",
        "ACQUISITION_LIMIT",
        "Dependency closure exceeds maxFiles.",
        null,
        { maxFiles: limits.maxFiles },
      );
    const totalBytes = [...entries.values()].reduce(
      (total, value) => total + (value.byteLength ?? value.bytes?.byteLength ?? 0),
      0,
    );
    if (totalBytes + byteLength > limits.maxTotalBytes)
      throw new ProjectError(
        "unavailable",
        "ACQUISITION_LIMIT",
        "Dependency closure exceeds maxTotalBytes.",
        null,
        { maxTotalBytes: limits.maxTotalBytes },
      );
    await ensureClosureEntry(source, entry, limits);
    const store = entry.store;
    if (!store)
      throw new ProjectError(
        "invalid",
        "DEPENDENCY_FILE_INVALID",
        "A selected source graph could not be retained for closure inspection.",
        entry.address,
      );
    entries.set(entry.address, entry);
    const dependencyId = sourceDependencyId(entry);
    const lockedDependency = entry.lockedDependency;
    if (entry.lockedFile && lockedDependency && dependencyId) {
      const sourceKey = entry.lockedFile.key;
      const activeSourceKeys = dependencyDistances(lockedDependency);
      for (const edge of lockedDependency.edges.filter((value) => value.from === sourceKey)) {
        const target = edge.to
          ? source.entries.get(`dep:${dependencyId}/${String(edge.to)}`)
          : undefined;
        if (edge.to && !target)
          throw new ProjectError(
            "invalid",
            "SNAPSHOT_INTEGRITY",
            "A retained source edge points to a missing locked file.",
            entry.address,
          );
        rememberEdge({
          context: contextIdFor(entry),
          from: outputKey(entry),
          relation: edge.relation,
          ...(target ? { to: outputKey(target) } : { target_iri: edge.target_iri }),
        });
        if (target) queue.push({ entry: target, role: "closure" });
      }
      for (const binding of lockedDependency.bindings.filter(
        (value) => value.resource === sourceKey,
      )) {
        const ontologies = (binding.ontologies as string[]).map((key) =>
          source.entries.get(`dep:${dependencyId}/${key}`),
        );
        const schemas = (binding.schemas as string[]).map((key) =>
          source.entries.get(`dep:${dependencyId}/${key}`),
        );
        if ([...ontologies, ...schemas].some((target) => !target))
          throw new ProjectError(
            "invalid",
            "SNAPSHOT_INTEGRITY",
            "A retained source binding points to a missing locked file.",
            entry.address,
          );
        for (const target of [...ontologies, ...schemas])
          if (target) queue.push({ entry: target, role: "closure" });
        bindings.push({
          context: contextIdFor(entry),
          resource: outputKey(entry),
          ontologies: ontologies.map((target) => outputKey(target as SourceEntry)),
          schemas: schemas.map((target) => outputKey(target as SourceEntry)),
          ...(binding.model_type ? { model_type: binding.model_type } : {}),
          ...(binding.unresolved_iris ? { unresolved_iris: binding.unresolved_iris } : {}),
        });
      }
      for (const choice of lockedDependency.choices.filter(
        (value) =>
          value.selected &&
          value.context === entry.lockedFile?.context &&
          activeSourceKeys.has(String(value.selected)),
      )) {
        const selected = source.entries.get(`dep:${dependencyId}/${String(choice.selected)}`);
        if (selected) {
          choices.push({
            context: contextIdFor(entry),
            kind: choice.kind,
            target_iri: choice.target_iri,
            selected: outputKey(selected),
          });
        }
      }
      for (const association of lockedDependency.associations.filter(
        (value) => value.resource === sourceKey && value.active === true,
      )) {
        const support = source.entries.get(`dep:${dependencyId}/${String(association.support)}`);
        if (!support)
          throw new ProjectError(
            "invalid",
            "SNAPSHOT_INTEGRITY",
            "A retained source association points to a missing locked file.",
            entry.address,
          );
        queue.push({ entry: support, role: String(association.role) });
        const attachmentId = association.attachment
          ? `att-${digest(`${dependencyId}/${String(association.attachment)}`).slice(7, 23)}`
          : undefined;
        associations.push({
          context: contextIdFor(entry),
          resource: outputKey(entry),
          role: association.role,
          support: outputKey(support),
          origin: association.origin,
          active: true,
          ...(attachmentId ? { attachment: attachmentId } : {}),
        });
        if (association.attachment) {
          const attached = lockedDependency.attachments.find(
            (value) => value.id === association.attachment,
          );
          if (!attached)
            throw new ProjectError(
              "invalid",
              "SNAPSHOT_INTEGRITY",
              "A retained support attachment is missing.",
              entry.address,
            );
          const resource = source.entries.get(`dep:${dependencyId}/${String(attached.resource)}`);
          const attachmentPrimary = source.entries.get(
            `dep:${dependencyId}/${String(attached.primary)}`,
          );
          if (!resource || !attachmentPrimary)
            throw new ProjectError(
              "invalid",
              "SNAPSHOT_INTEGRITY",
              "A retained support attachment points to a missing locked file.",
              entry.address,
            );
          attachments.push({
            id: attachmentId,
            role: attached.role,
            resource: outputKey(resource),
            source: upstreamSourceId(entry, String(attached.source)),
            primary: outputKey(attachmentPrimary),
            active: attached.active,
          });
          queue.push(
            { entry: resource, role: String(attached.role) },
            { entry: attachmentPrimary, role: String(attached.role) },
          );
        }
      }
      continue;
    }
    for (const [predicate, relation, accepts] of [
      [
        owlImports,
        "import",
        (target: string) => resolve(target, (candidate) => candidate.kind === "ontology"),
      ],
      [
        `${metadata}schema`,
        "schema",
        (target: string) =>
          resolve(target, (candidate) => entryKind(candidate) === "conceptual-data-model"),
      ],
    ] as const) {
      const targets = store.getObjects(null, predicate, null);
      for (const target of targets) {
        if (target.termType !== "NamedNode") continue;
        const selected =
          relation === "import" ? selectedBySourceChoice(target.value, "ontology") : undefined;
        const found = selected ?? accepts(target.value);
        const edge: Row = {
          context: contextIdFor(entry),
          from: outputKey(entry),
          relation,
          ...(found ? { to: outputKey(found) } : { target_iri: target.value }),
        };
        rememberEdge(edge);
        if (selected)
          choices.push({
            context: contextIdFor(entry),
            kind: "ontology",
            target_iri: target.value,
            selected: outputKey(selected),
          });
        if (found)
          queue.push({ entry: found, role: relation === "schema" ? "closure" : "closure" });
        else
          diagnostics.push({
            code: "DEPENDENCY_IRI_UNRESOLVED",
            severity: "warning",
            message:
              "A referenced IRI was not present in the selected source inventory; it remains unresolved without network loading.",
            file: null,
            selector: inspectedResource(source, entry),
          });
      }
    }
    const targetConcepts = store.getObjects(null, `${metadata}targetConcept`, null);
    const labelProperties = store.getObjects(null, `${metadata}labelProperty`, null);
    for (const target of [...targetConcepts, ...labelProperties]) {
      if (target.termType !== "NamedNode") continue;
      const selected = selectedBySourceChoice(target.value, "ontology") ?? resolve(target.value);
      const vocabularyMatch = selected
        ? undefined
        : await uniqueVocabularyEntry(source, target.value, limits);
      const found = selected ?? vocabularyMatch;
      const edge: Row = {
        context: contextIdFor(entry),
        from: outputKey(entry),
        relation: "vocabulary",
        ...(found ? { to: outputKey(found) } : { target_iri: target.value }),
      };
      rememberEdge(edge);
      if (found) queue.push({ entry: found, role: "closure" });
      else
        diagnostics.push({
          code: "DEPENDENCY_IRI_UNRESOLVED",
          severity: "warning",
          message:
            "A vocabulary reference was not present in the selected source inventory; it remains unresolved without network loading.",
          file: null,
          selector: inspectedResource(source, entry),
        });
      const chosen = selectedBySourceChoice(target.value, "ontology");
      if (chosen)
        choices.push({
          context: contextIdFor(entry),
          kind: "ontology",
          target_iri: target.value,
          selected: outputKey(chosen),
        });
    }
    for (const target of targetConcepts) {
      if (target.termType !== "NamedNode") continue;
      const chosen = selectedBySourceChoice(target.value, "design");
      if (!chosen) continue;
      queue.push({ entry: chosen, role: "design" });
      associations.push({
        context: contextIdFor(entry),
        resource: outputKey(entry),
        role: "design",
        support: outputKey(chosen),
        origin: "source",
        active: true,
      });
      choices.push({
        context: contextIdFor(entry),
        kind: "design",
        target_iri: target.value,
        selected: outputKey(chosen),
      });
    }
    const typeNames = entry.graphIri
      ? store.getObjects(entry.graphIri, `${metadata}modelType`, null)
      : [];
    if (typeNames.length) {
      if (typeNames.length !== 1 || typeNames[0]?.termType !== "Literal")
        throw new ProjectError(
          "invalid",
          "SOURCE_BINDING_INVALID",
          "Source model type metadata is ambiguous or unsupported.",
          entry.address,
        );
      const modelType = (typeNames[0] as import("@rdfjs/types").Literal).value;
      const modelTypes: Record<string, { enabled?: boolean; ontology: string; design?: string }> = {
        ...source.lock?.starters.model_types,
        ...((source.manifest?.model_types ?? {}) as Record<
          string,
          { enabled?: boolean; ontology: string; design?: string }
        >),
      };
      const modelConfig = modelTypes[modelType];
      if (!modelConfig)
        throw new ProjectError(
          "invalid",
          "SOURCE_BINDING_INVALID",
          "Source model type has no source-project binding.",
          entry.address,
        );
      const ontology = resolveSelector(modelConfig.ontology);
      if (!ontology || entryKind(ontology) !== "ontology")
        throw new ProjectError(
          "invalid",
          "SOURCE_BINDING_INVALID",
          "Source model type ontology binding is unavailable.",
          entry.address,
        );
      queue.push({ entry: ontology, role: "closure" });
      const modelIri = entry.graphIri;
      const schemas = modelIri
        ? store
            .getObjects(modelIri, `${metadata}schema`, null)
            .map((term) =>
              term.termType === "NamedNode"
                ? resolve(
                    term.value,
                    (candidate) => entryKind(candidate) === "conceptual-data-model",
                  )
                : undefined,
            )
            .filter((value): value is SourceEntry => Boolean(value))
        : [];
      for (const schema of schemas) queue.push({ entry: schema, role: "closure" });
      bindings.push({
        context: contextIdFor(entry),
        resource: outputKey(entry),
        ontologies: [outputKey(ontology)],
        schemas: schemas.map((schema) => outputKey(schema)),
        model_type: modelType,
      });
      if (modelConfig.design) {
        const design = resolveSelector(modelConfig.design);
        if (!design || entryKind(design) !== "design")
          throw new ProjectError(
            "invalid",
            "SOURCE_BINDING_INVALID",
            "Source model type design binding is unavailable.",
            entry.address,
          );
        queue.push({ entry: design, role: "design" });
        associations.push({
          context: contextIdFor(entry),
          resource: outputKey(entry),
          role: "design",
          support: outputKey(design),
          origin: "source",
          active: true,
        });
      }
    }
    for (const association of (source.manifest?.associations ?? []) as Row[]) {
      const resource = resolveSelector(String(association.resource));
      if (resource?.address !== entry.address) continue;
      const support = resolveSelector(String(association.support));
      if (!support?.parseable || support.parseError)
        throw new ProjectError(
          "invalid",
          "DEPENDENCY_FILE_INVALID",
          "A directly associated source resource is missing, corrupt, or unsupported.",
          String(association.support),
        );
      const role = String(association.role);
      const expectedKind = role === "shacl" ? "shapes" : "design";
      if (entryKind(support) !== expectedKind)
        throw new ProjectError(
          "invalid",
          "SOURCE_ASSOCIATION_INVALID",
          "Source association role contradicts its support graph kind.",
          support.address,
        );
      queue.push({ entry: support, role });
      associations.push({
        context: contextIdFor(entry),
        resource: outputKey(entry),
        role,
        support: outputKey(support),
        origin: "source",
        active: true,
      });
    }
    if (source.kind !== "url" && !entry.address.startsWith("dep:")) {
      const sibling = entry.address.endsWith(".ttl")
        ? `${entry.address.slice(0, -4)}.shacl.ttl`
        : "";
      const support = sibling ? source.entries.get(sibling) : undefined;
      if (support) {
        if (support.parseError || support.kind !== "shapes")
          throw new ProjectError(
            "invalid",
            "DEPENDENCY_FILE_INVALID",
            "Directly associated SHACL support is missing, corrupt, or unsupported.",
            sibling,
          );
        queue.push({ entry: support, role: "shacl" });
        associations.push({
          context: contextIdFor(entry),
          resource: outputKey(entry),
          role: "shacl",
          support: outputKey(support),
          origin: "source",
          active: true,
        });
      }
    }
  }
  const unique = (rows: Row[]) => [...new Map(rows.map((row) => [canonical(row), row])).values()];
  return {
    entries: [...entries.values()],
    edges: unique(edges),
    associations: unique(associations),
    bindings: unique(bindings),
    choices: unique(choices),
    attachments: unique(attachments),
    diagnostics,
  };
}
function dependencyFor(
  dependencyId: string,
  kind: ResourceKind,
  source: SourceInventory,
  primary: SourceEntry,
  closure: ClosureResult,
): Dependency {
  const roles = new Map<string, Set<string>>();
  const addRole = (entry: SourceEntry, role: string) => {
    const key = outputKey(entry);
    const value = roles.get(key) ?? new Set<string>();
    value.add(role);
    roles.set(key, value);
  };
  addRole(primary, "primary");
  for (const entry of closure.entries)
    if (entry.address !== primary.address) addRole(entry, "closure");
  for (const association of closure.associations) {
    const support = closure.entries.find((entry) => outputKey(entry) === association.support);
    if (support) addRole(support, String(association.role));
  }
  for (const attachment of closure.attachments) {
    const support = closure.entries.find((entry) => outputKey(entry) === attachment.primary);
    if (support) addRole(support, String(attachment.role));
  }
  const files = closure.entries.map((entry): LockedFile => {
    const bytes = entry.bytes as Buffer;
    const key = outputKey(entry);
    const identity = entry.identity ?? "generated";
    const fileKind = entry.kind ?? "unclassified";
    const classification = entry.classification ?? "unclassified";
    const graphIri =
      identity === "declared"
        ? (entry.graphIri as string)
        : `urn:tbspec:graph:${digest(`dep:${dependencyId}/${key}`).slice(7)}`;
    const mediaType = entry.lockedFile?.media_type ?? (entry.mediaType as string);
    const baseIri = entry.lockedFile?.base_iri ?? (entry.baseIri as string);
    const parserProfile = entry.lockedFile?.parser_profile ?? (entry.profile as string);
    const byteDigest = digest(bytes);
    const item = {
      key,
      source: sourceIdFor(entry),
      source_resource: entry.sourceResource,
      context: contextIdFor(entry),
      roles: sortedSet([...(roles.get(key) ?? new Set(["closure"]))]),
      kind: fileKind,
      classification,
      ...(entry.lockedFile?.kind_override ? { kind_override: entry.lockedFile.kind_override } : {}),
      graph_iri: graphIri,
      identity,
      source_graph_iri: entry.lockedFile?.source_graph_iri ?? (entry.graphIri as string),
      byte_digest: byteDigest,
      byte_length: bytes.byteLength,
      media_type: mediaType,
      base_iri: baseIri,
      parser_profile: parserProfile,
      graph_signature: graphSignature({
        byte_digest: byteDigest,
        media_type: mediaType,
        base_iri: baseIri,
        parser_profile: parserProfile,
      }),
    };
    return item;
  });
  const upstreamSources = new Map<string, Row>();
  for (const entry of closure.entries)
    for (const record of entry.lockedDependency?.sources ?? []) {
      const remapped = upstreamSourceId(entry, String(record.id));
      upstreamSources.set(remapped, { ...record, id: remapped });
    }
  if (primary.lockedFile) {
    const primarySourceId = sourceIdFor(primary);
    const record = upstreamSources.get(primarySourceId);
    if (record)
      upstreamSources.set(primarySourceId, {
        ...record,
        selected_resource: primary.sourceResource,
      });
  }
  const output: Dependency = {
    kind,
    primary: outputKey(primary),
    snapshot_path: `.tbspec/dependencies/${dependencyId}`,
    interpretation_signature: "sha256:" + "0".repeat(64),
    sources: [sourceRecord(source, primary), ...upstreamSources.values()],
    files,
    edges: closure.edges,
    bindings: closure.bindings,
    associations: closure.associations,
    choices: closure.choices,
    attachments: closure.attachments,
  };
  output.interpretation_signature = interpretationSignature(output);
  return output;
}

export async function prepareDependencyAdd(
  options: DependencyAddOptions,
): Promise<PreparedDependency> {
  const dependencyId = id(options.id);
  if (!["ontology", "model", "design"].includes(options.kind))
    throw new ProjectError(
      "invalid_arguments",
      "ARGUMENT_INVALID",
      "Dependency kind must be ontology, model, or design.",
    );
  const current = await readProject({ project: options.project, cwd: options.cwd });
  if (current.lock.dependencies[dependencyId])
    throw new ProjectError(
      "conflict",
      "DEPENDENCY_EXISTS",
      "Dependency ID already exists.",
      "tbspec.lock",
    );
  const limits = defaultLimits(current.manifest);
  const source = await discoverSource({
    source: options.source,
    cwd: options.cwd,
    ref: options.ref,
    resource: options.resource,
    signal: options.signal,
    limits,
  });
  try {
    return await prepareDependencyFromSource(options, current, limits, source);
  } finally {
    await source.cleanup?.();
  }
}

async function prepareDependencyFromSource(
  options: Pick<DependencyAddOptions, "id" | "kind" | "resource">,
  current: Awaited<ReturnType<typeof readProject>>,
  limits: Limits,
  source: SourceInventory,
  operation = "dependency.add",
  sourceRecordOverride?: Row,
): Promise<PreparedDependency> {
  const { closure, dependency: acquiredDependency } = await resolveDependencySource(
    options,
    limits,
    source,
  );
  return await prepareDependencyCandidate(
    options,
    current,
    source,
    operation,
    acquiredDependency,
    sourceRecordOverride,
    new Map(closure.entries.map((entry) => [outputKey(entry), Buffer.from(entry.bytes as Buffer)])),
    closure.diagnostics,
  );
}

async function prepareDependencyCandidate(
  options: Pick<DependencyAddOptions, "id" | "kind" | "resource">,
  current: Awaited<ReturnType<typeof readProject>>,
  source: SourceInventory,
  operation: string,
  acquiredDependency: Dependency,
  sourceRecordOverride?: Row,
  acquiredBytes: Map<string, Buffer> = new Map(),
  closureDiagnostics: Diagnostic[] = [],
): Promise<PreparedDependency> {
  const dependencyId = id(options.id);
  if (sourceRecordOverride) acquiredDependency.sources[0] = sourceRecordOverride;
  const existing =
    operation === "dependency.update" ? current.lock.dependencies[dependencyId] : undefined;
  if (operation === "dependency.update" && !existing)
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Dependency disappeared during update.",
    );
  const dependency = existing
    ? preserveManualAttachments(existing, {
        ...acquiredDependency,
        snapshot_path: existing.snapshot_path,
      })
    : acquiredDependency;
  const lock: Lock = {
    ...current.lock,
    dependencies: { ...current.lock.dependencies, [dependencyId]: dependency },
  };
  const lockBytes = Buffer.from(writeToml(lock));
  const existingKeys = new Set((existing?.files ?? []).map((file) => file.key));
  const nextKeys = new Set(dependency.files.map((file) => file.key));
  const fileWrites = dependency.files.map((file) => {
    const path = `${dependency.snapshot_path}/${file.key}`;
    const bytes = acquiredBytes.get(file.key) ?? current.snapshot.files[path];
    if (!bytes)
      throw new ProjectError(
        "invalid",
        "SNAPSHOT_INTEGRITY",
        "A retained dependency file is missing during update.",
        path,
      );
    return { file: path, bytes: Buffer.from(bytes) };
  });
  const retired = (existing?.files ?? [])
    .filter((file) => !nextKeys.has(file.key))
    .map((file) => ({ file: `${dependency.snapshot_path}/${file.key}`, bytes: null }));
  const writes = [{ file: "tbspec.lock", bytes: lockBytes }, ...fileWrites, ...retired];
  const targetPaths = writes
    .filter((write) => write.file !== "tbspec.lock")
    .map((write) => write.file);
  const statusSnapshot = await captureInspection(current.root, "status");
  if (
    !statusSnapshot.files["tbspec.toml"]?.equals(current.snapshot.files["tbspec.toml"] as Buffer) ||
    !statusSnapshot.files["tbspec.lock"]?.equals(current.snapshot.files["tbspec.lock"] as Buffer)
  )
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Project configuration changed during dependency acquisition; retry with a fresh preview.",
    );
  const before = await inspectSnapshot(current.root, statusSnapshot, { command: "status" });
  const destinations = await capture(
    current.root,
    ["tbspec.toml", "tbspec.lock", ...targetPaths],
    [{ path: ".tbspec/dependencies", included: [dependencyId], excluded: [] }],
  );
  if (
    destinations.files["tbspec.toml"]?.equals(current.snapshot.files["tbspec.toml"] as Buffer) !==
      true ||
    destinations.files["tbspec.lock"]?.equals(current.snapshot.files["tbspec.lock"] as Buffer) !==
      true
  )
    throw new ProjectError(
      "conflict",
      "REVISION_CONFLICT",
      "Project configuration changed during dependency acquisition; retry with a fresh preview.",
    );
  const existingReads = new Map(statusSnapshot.reads.map((read) => [canonical(read), read]));
  for (const read of destinations.reads) existingReads.set(canonical(read), read);
  const snapshot: Snapshot & { ownedPaths: string[]; target?: string } = {
    ...statusSnapshot,
    files: { ...statusSnapshot.files, ...destinations.files },
    reads: [...existingReads.values()],
  };
  for (const write of writes)
    if (
      write.file !== "tbspec.lock" &&
      snapshot.files[write.file] !== null &&
      !existingKeys.has(write.file.slice(`${dependency.snapshot_path}/`.length))
    )
      throw new ProjectError(
        "conflict",
        "DEPENDENCY_SNAPSHOT_EXISTS",
        "Dependency snapshot destination is already occupied.",
        write.file,
      );
  const plan = preparePlan(snapshot, operation, writes, {
    id: dependencyId,
    kind: options.kind,
    source: source.locator,
    sourceInventoryRevision: source.treeRevision ?? null,
    resource: options.resource ?? dependency.primary,
  });
  const staged = { ...snapshot, files: { ...snapshot.files } };
  for (const write of writes) staged.files[write.file] = write.bytes;
  const after = await inspectSnapshot(current.root, staged, { command: "status" });
  const oldFiles = new Map((existing?.files ?? []).map((file) => [file.key, file]));
  const newFiles = new Map(dependency.files.map((file) => [file.key, file]));
  const changedKeys = sortedSet(
    [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter(
      (key) => oldFiles.get(key)?.graph_signature !== newFiles.get(key)?.graph_signature,
    ),
  );
  const changedGraphs = new Set(changedKeys.map((key) => `dep:${dependencyId}/${key}`));
  const changedRecords = <T extends Row>(oldRows: T[], newRows: T[]) => {
    const oldSet = new Set(oldRows.map((row) => canonical(row)));
    const newSet = new Set(newRows.map((row) => canonical(row)));
    return [
      ...oldRows.filter((row) => !newSet.has(canonical(row))),
      ...newRows.filter((row) => !oldSet.has(canonical(row))),
    ];
  };
  for (const rows of [
    changedRecords(existing?.associations ?? [], dependency.associations),
    changedRecords(existing?.bindings ?? [], dependency.bindings),
    changedRecords(existing?.edges ?? [], dependency.edges),
    changedRecords(existing?.choices ?? [], dependency.choices),
    changedRecords(existing?.attachments ?? [], dependency.attachments),
  ])
    for (const row of rows)
      for (const key of ["resource", "support", "from", "to", "selected", "primary"]) {
        const value = row[key];
        if (typeof value === "string") changedGraphs.add(`dep:${dependencyId}/${value}`);
      }
  for (const rows of [changedRecords(existing?.bindings ?? [], dependency.bindings)])
    for (const row of rows)
      for (const field of ["ontologies", "schemas"])
        for (const value of (row[field] as string[] | undefined) ?? [])
          changedGraphs.add(`dep:${dependencyId}/${value}`);
  const changedFiles = changedKeys.map((key) => `${dependency.snapshot_path}/${key}`);
  const impact = compareDiagnosticImpact(
    before.diagnostics,
    after.diagnostics,
    [...changedGraphs],
    {
      baselineChecks: impactChecks(before),
      proposedChecks: impactChecks(after),
      changedFiles,
    },
  );
  const acquiredFiles = dependency.files.map((file) => ({
    selector: selector(`dep:${dependencyId}/${file.key}`),
    byteDigest: file.byte_digest,
    graphSignature: file.graph_signature,
  }));
  const requiresImpactAcceptance =
    impact.introducedErrors.length > 0 ||
    impact.worsenedErrors.length > 0 ||
    impact.requiresAcceptance;
  const completedPlan = withPlanImpact(
    {
      ...plan,
      preview: {
        ...plan.preview,
        acquired: acquiredFiles,
        interpretationSignatures: { [dependencyId]: dependency.interpretation_signature },
      },
    },
    {
      impact: {
        baselineErrors: impact.baselineErrors,
        introducedErrors: impact.introducedErrors,
        worsenedErrors: impact.worsenedErrors,
        skippedChecks: impact.skippedChecks,
        affectedFiles: sortedSet([
          ...new Set([...plan.preview.impact.affectedFiles, ...targetPaths]),
        ]),
        acceptance:
          operation === "dependency.update"
            ? ["apply", ...(requiresImpactAcceptance ? ["accept-impact"] : [])]
            : [],
      },
    },
  );
  return {
    root: current.root,
    id: dependencyId,
    dependency,
    plan: completedPlan,
    diagnostics: [...source.diagnostics, ...closureDiagnostics, ...after.diagnostics],
    projectValidity: (after.data?.project?.validity ??
      "unchecked") as PreparedDependency["projectValidity"],
    validationComplete: after.data?.project?.validationComplete ?? false,
    requiresImpactAcceptance,
  };
}

async function resolveDependencySource(
  options: Pick<DependencyAddOptions, "id" | "kind" | "resource">,
  limits: Limits,
  source: SourceInventory,
): Promise<{ dependency: Dependency; closure: ClosureResult }> {
  const dependencyId = id(options.id);
  const requested = options.resource;
  const requestedEntry =
    requested === undefined
      ? undefined
      : (sourceEntryForSelection(source, requested) ??
        (source.kind === "url" ? source.entries.values().next().value : undefined));
  if (requestedEntry?.parseError) throw requestedEntry.parseError;
  const candidates = [...source.entries.values()].filter((entry) =>
    resolvedKind(options.kind, entry),
  );
  if (!candidates.length)
    throw new ProjectError(
      "invalid",
      "RESOURCE_MISSING",
      "Source inventory contains no resource of the requested kind.",
    );
  const primary =
    requested === undefined
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : candidates.includes(requestedEntry as SourceEntry)
        ? requestedEntry
        : undefined;
  if (!primary)
    throw new ProjectError(
      "invalid_arguments",
      requested ? "RESOURCE_MISSING" : "RESOURCE_SELECTION_REQUIRED",
      requested
        ? "Selected source resource is unavailable or has a different kind."
        : "Select one resource from the source inventory.",
    );
  const closure = await buildClosure(source, primary, limits);
  await source.verifyIncluded?.(closure.entries);
  const dependency = dependencyFor(dependencyId, options.kind, source, primary, closure);
  return { dependency, closure };
}
export function dependencyPreview(
  prepared: PreparedDependency,
  status: "preview" | "conflict",
): Result {
  const adminDetails = prepared.administration?.details ?? {};
  return {
    ...ok(
      {
        applied: false,
        ...(prepared.administration
          ? { operation: `dependency.${prepared.administration.kind}` }
          : {}),
        id: prepared.id,
        ...(prepared.administration?.kind === "remove" ? {} : { dependency: prepared.dependency }),
        ...(prepared.administration?.kind === "remove"
          ? {}
          : { primarySelector: `dep:${prepared.id}/${prepared.dependency.primary}` }),
        ...adminDetails,
        projectValidity: prepared.projectValidity,
        validationComplete: prepared.validationComplete,
        preview: prepared.plan.preview,
      },
      prepared.diagnostics,
    ),
    status,
  };
}
function previewConflict(prepared: PreparedDependency, code: string, message: string): Result {
  const result = dependencyPreview(prepared, "conflict");
  return {
    ...result,
    diagnostics: [...result.diagnostics, { code, severity: "error", message, file: "tbspec.lock" }],
  };
}

function preserveManualAttachments(existing: Dependency, refreshed: Dependency): Dependency {
  const roots = new Set(
    existing.attachments
      .map((attachment) => attachment.source)
      .filter(
        (source): source is string =>
          typeof source === "string" && /^manual\/attachment-[1-9]\d*$/.test(source),
      ),
  );
  const manualSources = existing.sources.filter((source) => {
    const sourceId = source.id;
    return (
      typeof sourceId === "string" &&
      [...roots].some((root) => sourceId === root || sourceId.startsWith(`${root}/`))
    );
  });
  const sourceIds = new Set(manualSources.map((source) => String(source.id)));
  if (!roots.size) return refreshed;

  const retainedFiles = existing.files.filter(
    (file) =>
      [...roots].some((root) => file.key.startsWith(`${root}/`)) ||
      [...sourceIds].some((source) => file.source === source),
  );
  const retainedKeys = new Set(retainedFiles.map((file) => file.key));
  const attachments = existing.attachments.filter((attachment) =>
    sourceIds.has(String(attachment.source)),
  );
  const attachmentIds = new Set(attachments.map((attachment) => String(attachment.id)));
  const referencesManual = (row: Row) =>
    Object.entries(row).some(([key, value]) =>
      key === "resource" ||
      key === "support" ||
      key === "from" ||
      key === "to" ||
      key === "selected"
        ? retainedKeys.has(String(value))
        : key === "ontologies" || key === "schemas"
          ? Array.isArray(value) && value.some((item) => retainedKeys.has(String(item)))
          : false,
    );
  const preserveRows = (current: Row[], prior: Row[], include: (row: Row) => boolean) => [
    ...new Map([...current, ...prior.filter(include)].map((row) => [canonical(row), row])).values(),
  ];
  const combined: Dependency = {
    ...refreshed,
    sources: preserveRows(refreshed.sources, manualSources, (source) =>
      sourceIds.has(String(source.id)),
    ),
    files: [
      ...new Map([...refreshed.files, ...retainedFiles].map((file) => [file.key, file])).values(),
    ],
    edges: preserveRows(refreshed.edges, existing.edges, (edge) => referencesManual(edge)),
    bindings: preserveRows(refreshed.bindings, existing.bindings, (binding) =>
      referencesManual(binding),
    ),
    associations: preserveRows(
      refreshed.associations,
      existing.associations,
      (association) =>
        attachmentIds.has(String(association.attachment)) || referencesManual(association),
    ),
    choices: preserveRows(refreshed.choices, existing.choices, (choice) =>
      referencesManual(choice),
    ),
    attachments: preserveRows(refreshed.attachments, attachments, (attachment) =>
      sourceIds.has(String(attachment.source)),
    ),
    interpretation_signature: "sha256:" + "0".repeat(64),
  };
  combined.interpretation_signature = interpretationSignature(combined);
  return combined;
}

export async function publishPreparedDependency(prepared: PreparedDependency): Promise<Result> {
  try {
    const diagnostics = await publishPlan(prepared.root, prepared.plan);
    const adminDetails = prepared.administration?.details ?? {};
    return ok(
      {
        applied: true,
        ...(prepared.administration
          ? { operation: `dependency.${prepared.administration.kind}` }
          : {}),
        id: prepared.id,
        ...(prepared.administration?.kind === "remove"
          ? { removed: true }
          : {
              primarySelector: `dep:${prepared.id}/${prepared.dependency.primary}`,
              dependency: prepared.dependency,
            }),
        ...adminDetails,
        projectValidity: prepared.projectValidity,
        validationComplete: prepared.validationComplete,
        preview: prepared.plan.preview,
      },
      [...prepared.diagnostics, ...diagnostics],
    );
  } catch (error) {
    return failure(error);
  }
}
export async function dependencyList(_options: {
  project?: string;
  cwd?: string;
}): Promise<Result> {
  try {
    const project = await readProject({ project: _options.project, cwd: _options.cwd });
    const inspectionSnapshot = await captureInspection(project.root, "graph.list");
    for (const path of ["tbspec.toml", "tbspec.lock"])
      if (!project.snapshot.files[path]?.equals(inspectionSnapshot.files[path] ?? Buffer.alloc(0)))
        throw new ProjectError(
          "conflict",
          "REVISION_CONFLICT",
          "Project changed while dependency candidates were being listed.",
          path,
        );
    const ownedResult = await inspectSnapshot(project.root, inspectionSnapshot, {
      command: "graph.list",
    });
    if (!ownedResult.data)
      throw new ProjectError(
        ownedResult.status,
        ownedResult.diagnostics[0]?.code ?? "PROJECT_INVALID",
        ownedResult.diagnostics[0]?.message ?? "Project ontology candidates could not be listed.",
      );
    const candidates: {
      selector: string;
      graphIri: string;
      signature: string;
      rank: number;
      dependencyId?: string;
      file?: LockedFile;
    }[] = [];
    for (const resource of ownedResult.data.items ?? []) {
      if (resource.kind !== "ontology" || !resource.graphIri) continue;
      const bytes = inspectionSnapshot.files[resource.file];
      if (!bytes) continue;
      const extension = extname(resource.file).toLowerCase();
      const mediaType = rdfFormats[extension];
      if (!mediaType) continue;
      const baseIri = pathToFileURL(await safePath(project.root, resource.file)).href;
      candidates.push({
        selector: resource.selector,
        graphIri: resource.graphIri,
        signature: graphSignature({
          byte_digest: digest(bytes),
          media_type: mediaType,
          base_iri: baseIri,
          parser_profile:
            mediaType === "text/turtle"
              ? "turtle-strict-v1"
              : mediaType === "application/n-triples"
                ? "ntriples-strict-v1"
                : "rdfxml-no-dtd-v1",
        }),
        rank: 0,
      });
    }
    const dependencies = Object.entries(project.lock.dependencies);
    const distances = new Map<string, Map<string, number>>();
    for (const [dependencyId, dependency] of dependencies) {
      const reachable = dependencyDistances(dependency, 1);
      distances.set(dependencyId, reachable);
      for (const [key, distance] of reachable) {
        const file = dependency.files.find((item) => item.key === key);
        if (file?.kind !== "ontology" || !file.graph_iri) continue;
        const sourceChoice = dependency.choices.find(
          (choice) =>
            choice.kind === "ontology" &&
            choice.target_iri === file.graph_iri &&
            choice.context === file.context,
        );
        const selectedIsReachable =
          sourceChoice !== undefined && reachable.has(String(sourceChoice.selected));
        if (selectedIsReachable && sourceChoice?.selected !== key) continue;
        candidates.push({
          selector: `dep:${dependencyId}/${key}`,
          graphIri: file.graph_iri,
          signature: file.graph_signature,
          rank: distance,
          dependencyId,
          file,
        });
      }
    }
    const choices = (project.manifest.ontology_choices as Record<string, string> | undefined) ?? {};
    const resolutions = new Map(
      [...new Set(candidates.map((candidate) => candidate.graphIri))].map((graphIri) => [
        graphIri,
        resolveOntologyCandidates(graphIri, candidates, choices),
      ]),
    );
    const items = dependencies
      .sort(([left], [right]) => utf8Compare(left, right))
      .map(([name, dependency]) => ({
        id: name,
        kind: dependency.kind,
        primarySelector: `dep:${name}/${dependency.primary}`,
        interpretationSignature: dependency.interpretation_signature,
        sources: dependency.sources.map(sourceOutput),
        support: [
          ...dependency.associations.map((association) => ({
            kind: "association",
            context: association.context ?? null,
            resourceSelector: `dep:${name}/${String(association.resource)}`,
            supportSelector: `dep:${name}/${String(association.support)}`,
            role: association.role,
            origin: association.origin ?? null,
            active: association.active ?? false,
          })),
          ...dependency.bindings.map((binding) => ({
            kind: "binding",
            context: binding.context ?? null,
            resourceSelector: `dep:${name}/${String(binding.resource)}`,
            ontologySelectors: ((binding.ontologies as string[] | undefined) ?? []).map(
              (key) => `dep:${name}/${key}`,
            ),
            schemaSelectors: ((binding.schemas as string[] | undefined) ?? []).map(
              (key) => `dep:${name}/${key}`,
            ),
            modelType: binding.model_type ?? null,
          })),
          ...dependency.choices.map((choice) => ({
            kind: "source-choice",
            context: choice.context ?? null,
            targetIri: choice.target_iri,
            selectedSelector: `dep:${name}/${String(choice.selected)}`,
          })),
        ],
        files: dependency.files.map((file) => ({
          selector: `dep:${name}/${file.key}`,
          file: `${dependency.snapshot_path}/${file.key}`,
          role: file.roles,
        })),
        ontologies: dependency.files.flatMap((file) => {
          if (file.kind !== "ontology" || !file.graph_iri) return [];
          const resolution = resolutions.get(file.graph_iri);
          return [
            {
              graphIri: file.graph_iri,
              selector: `dep:${name}/${file.key}`,
              signature: file.graph_signature,
              effective:
                resolution?.effective.some(
                  (candidate) => candidate.selector === `dep:${name}/${file.key}`,
                ) ?? false,
              choice: choices[file.graph_iri] ?? null,
              resolution: resolution?.state ?? "none",
              candidates: resolution?.conflicted.map((candidate) => candidate.selector) ?? [],
            },
          ];
        }),
      }));
    return ok({ items });
  } catch (error) {
    return failure(error);
  }
}
export async function dependencyShow(_options: {
  project?: string;
  cwd?: string;
  id: string;
}): Promise<Result> {
  try {
    const dependencyId = id(_options.id);
    const project = await readProject({ project: _options.project, cwd: _options.cwd });
    const dependency = project.lock.dependencies[dependencyId];
    if (!dependency)
      throw new ProjectError(
        "unavailable",
        "RESOURCE_MISSING",
        "Dependency ID was not found.",
        "tbspec.lock",
      );
    return ok({
      id: dependencyId,
      dependency: {
        ...dependency,
        primarySelector: `dep:${dependencyId}/${dependency.primary}`,
        files: dependency.files.map((file) => ({
          ...file,
          selector: `dep:${dependencyId}/${file.key}`,
          file: `${dependency.snapshot_path}/${file.key}`,
        })),
      },
    });
  } catch (error) {
    return failure(error);
  }
}
