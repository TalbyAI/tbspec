import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(packageDirectory, "dist");
const hashBytes = (value) => createHash("sha256").update(value).digest("hex");
const toPackagePath = (value) => value.split(sep).join("/");
const packageManifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(join(packageDirectory, "package-lock.json"), "utf8"));
const provenance = JSON.parse(
  await readFile(join(outputDirectory, "web/build-provenance.json"), "utf8"),
);
const lockPackages = lock.packages;

if (packageManifest.name !== "tbspec" || lock.packages[""]?.version !== packageManifest.version)
  throw new Error("Application package metadata does not match its pinned lockfile.");
if (packageManifest.bundleDependencies !== true)
  throw new Error("Production dependencies must be bundled into the application artifact.");
if (!Array.isArray(packageManifest.files) || !packageManifest.files.includes("dist"))
  throw new Error("The application package allowlist must include its generated dist directory.");

function resolveDependency(consumerPath, dependencyName) {
  let parent = consumerPath;
  for (;;) {
    const candidate = toPackagePath(join(parent, "node_modules", dependencyName));
    if (Object.hasOwn(lockPackages, candidate)) return candidate;
    const nestedModules = parent.lastIndexOf("/node_modules/");
    if (nestedModules >= 0) parent = parent.slice(0, nestedModules);
    else if (parent.startsWith("node_modules/")) parent = "";
    else return null;
  }
}

function packageNameFromPath(packagePath) {
  const modulesMarker = "node_modules/";
  const modulesIndex = packagePath.lastIndexOf(modulesMarker);
  if (modulesIndex < 0) throw new Error(`Lock path is not a package instance: ${packagePath}`);
  const parts = packagePath.slice(modulesIndex + modulesMarker.length).split("/");
  if (parts[0]?.startsWith("@")) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? "";
}

async function packageIsInstalled(packagePath) {
  try {
    return (await stat(resolve(packageDirectory, packagePath))).isDirectory();
  } catch {
    return false;
  }
}

const productionPaths = new Set();
const pending = Object.entries(packageManifest.dependencies ?? {}).map(([name]) => {
  const path = resolveDependency("", name);
  if (!path) throw new Error(`Pinned production dependency ${name} is absent from the lockfile.`);
  return path;
});
while (pending.length > 0) {
  const packagePath = pending.pop();
  if (!packagePath || productionPaths.has(packagePath)) continue;
  const packageLock = lockPackages[packagePath];
  if (!packageLock || packageLock.dev === true)
    throw new Error(
      `Production dependency graph contains a non-production lock entry: ${packagePath}`,
    );
  if (!(await packageIsInstalled(packagePath)))
    throw new Error(
      `Pinned production dependency is absent from the installed tree: ${packagePath}`,
    );
  productionPaths.add(packagePath);
  const dependencies = new Map(
    Object.entries(packageLock.dependencies ?? {}).map(([name]) => [name, false]),
  );
  for (const [name] of Object.entries(packageLock.optionalDependencies ?? {}))
    dependencies.set(name, true);
  for (const [name, optional] of dependencies) {
    const dependencyPath = resolveDependency(packagePath, name);
    if (!dependencyPath) {
      if (optional) continue;
      throw new Error(`Production dependency ${name} of ${packagePath} is unresolved.`);
    }
    const dependencyLock = lockPackages[dependencyPath];
    if (!dependencyLock || dependencyLock.dev === true) {
      if (optional) continue;
      throw new Error(
        `Production dependency ${name} of ${packagePath} has no production lock entry.`,
      );
    }
    if (!(await packageIsInstalled(dependencyPath))) {
      if (optional || dependencyLock.optional === true) continue;
      throw new Error(
        `Production dependency ${name} of ${packagePath} is absent from the installed tree.`,
      );
    }
    pending.push(dependencyPath);
  }
}

function packageReferencePath(reference) {
  if (!reference || typeof reference.path !== "string" || typeof reference.version !== "string")
    throw new Error("Build provenance contains an incomplete package reference.");
  const packagePath = toPackagePath(reference.path.replace(/^app\//, ""));
  if (!packagePath.startsWith("node_modules/"))
    throw new Error(`Build provenance points outside the pinned package tree: ${reference.path}`);
  if (packageNameFromPath(packagePath) !== reference.name)
    throw new Error(
      `Build provenance package name does not match its installed path: ${reference.path}`,
    );
  const lockPackage = lockPackages[packagePath];
  if (!lockPackage || lockPackage.version !== reference.version)
    throw new Error(`Browser module provenance does not match the lockfile: ${reference.path}`);
  return packagePath;
}

const browserPaths = new Set((provenance.browserPackages ?? []).map(packageReferencePath));
if (provenance.schemaVersion !== 1 || !Array.isArray(provenance.stylesheets))
  throw new Error("Browser build provenance is missing its schema or CSS module inventory.");
if (!provenance.workers?.some((worker) => worker.package?.name === "elkjs"))
  throw new Error("The emitted browser artifact has no ELK worker package provenance.");
if (provenance.workers.some((worker) => /\.(?:css|html)$/i.test(worker.file)))
  throw new Error("A CSS or HTML output was misclassified as an ELK worker.");
if (![...browserPaths].some((packagePath) => packageNameFromPath(packagePath) === "elkjs"))
  throw new Error("Browser module provenance omits the packaged ELK dependency.");
if (![...browserPaths].some((packagePath) => packageNameFromPath(packagePath) === "@xyflow/react"))
  throw new Error("Browser module provenance omits the packaged React Flow dependency.");

const includedPaths = new Set([...productionPaths, ...browserPaths]);
const sourceNoticeDirectory = join(packageDirectory, "license-sources");
const noticeSources = {
  "@rubensworks/saxes@6.0.1": {
    file: "saxes-6.0.1-LICENSE.txt",
    source: "https://raw.githubusercontent.com/rubensworks/saxes/v6.0.1/LICENSE",
  },
  "undici-types@5.26.5": {
    file: "undici-types-5.26.5-LICENSE.txt",
    source: "https://raw.githubusercontent.com/nodejs/undici/v5.26.5/LICENSE",
  },
  "@comunica/5.4.0": {
    file: "comunica-5.4.0-LICENSE.txt",
    source: "https://raw.githubusercontent.com/comunica/comunica/v5.4.0/LICENSE.txt",
    sharedSource: true,
  },
  "@comunica/5.4.1": {
    file: "comunica-5.4.1-LICENSE.txt",
    source: "https://raw.githubusercontent.com/comunica/comunica/v5.4.1/LICENSE.txt",
    sharedSource: true,
  },
};
const verifiedReleaseWithoutLicenseFile = {
  "asyncjoin@1.2.5": {
    revision: "4dc958d91c90e5fd52285b1769856964c55f9ae2",
    evidence: "No LICENSE or NOTICE file at the version-matched release root.",
  },
  "sparqlalgebrajs@5.0.2": {
    revision: "92b1f000c393b826cb37a883f1a295bf41e84324",
    evidence: "No LICENSE or NOTICE file at the version-matched release root.",
  },
  "tr46@0.0.3": {
    revision: "a8009f9ce80ff5dbe71dd71e203afe4e4c878d28",
    evidence: "No LICENSE or NOTICE file at the version-matched release root.",
  },
};
const readmeLicenseLinks = {
  "@unicode/unicode-15.0.0@1.6.17": {
    file: "README.md",
    url: "https://mths.be/mit",
  },
};
const noticeFiles = new Map();
const noticeEntries = [];

async function packageLicenseFiles(packageDirectoryPath) {
  const children = await readdir(packageDirectoryPath, { withFileTypes: true });
  return children
    .filter(
      (child) =>
        child.isFile() && /^(?:license|licence|copying|notice)(?:[._ -].*)?$/i.test(child.name),
    )
    .map((child) => child.name)
    .sort((a, b) => a.localeCompare(b));
}

function embeddedLicenseText(fileName, text) {
  const permissionIndex = text.search(/Permission is hereby granted/i);
  if (permissionIndex >= 0) {
    const copyrightIndex = text.lastIndexOf("Copyright", permissionIndex);
    const headingIndex = text.lastIndexOf("License", copyrightIndex);
    const start = headingIndex >= 0 ? headingIndex : copyrightIndex;
    const disclaimer =
      /THE SOFTWARE IS PROVIDED[\s\S]*?(?:USE OF THE SOFTWARE|THE SOFTWARE)\./i.exec(
        text.slice(permissionIndex),
      );
    if (copyrightIndex >= 0 && disclaimer)
      return {
        fileName,
        text: text.slice(start, permissionIndex + disclaimer.index + disclaimer[0].length).trim(),
      };
  }
  const copyrightIndex = text.indexOf("Copyright 2010 Gary Court.");
  if (copyrightIndex >= 0) {
    const disclaimer =
      /THIS SOFTWARE IS PROVIDED BY GARY COURT[\s\S]*?POSSIBILITY OF SUCH DAMAGE\./i.exec(
        text.slice(copyrightIndex),
      );
    if (disclaimer)
      return {
        fileName,
        text: text
          .slice(copyrightIndex, copyrightIndex + disclaimer.index + disclaimer[0].length)
          .split("\n")
          .map((line) => line.replace(/^\s*\* ?/, "").trimEnd())
          .join("\n")
          .trim(),
      };
  }
  return null;
}

async function readEmbeddedNotice(packageDirectoryPath, manifest) {
  const names = await readdir(packageDirectoryPath, { withFileTypes: true });
  const candidates = names
    .filter(
      (child) =>
        child.isFile() &&
        (/^readme(?:\..+)?$/i.test(child.name) || /\.(?:js|cjs|mjs|ts)$/i.test(child.name)),
    )
    .map((child) => child.name)
    .sort((a, b) => a.localeCompare(b));
  if (typeof manifest.main === "string") candidates.unshift(manifest.main.replace(/^\.\//, ""));
  for (const name of [...new Set(candidates)]) {
    let text;
    try {
      text = await readFile(join(packageDirectoryPath, name), "utf8");
    } catch {
      continue;
    }
    const notice = embeddedLicenseText(name, text);
    if (notice) return notice;
  }
  return null;
}

for (const packagePath of [...includedPaths].sort((a, b) => a.localeCompare(b))) {
  const lockPackage = lockPackages[packagePath];
  const installedPath = resolve(packageDirectory, packagePath);
  const manifestPath = join(installedPath, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.name !== packageNameFromPath(packagePath) ||
    manifest.version !== lockPackage.version
  )
    throw new Error(`Installed package does not match its lock entry: ${packagePath}`);
  const paths = productionPaths.has(packagePath) ? ["production"] : [];
  if (browserPaths.has(packagePath)) paths.push("browser");
  const licenseDeclaration = manifest.license ?? manifest.licenses ?? lockPackage.license ?? null;
  const declaredRepository =
    typeof manifest.repository === "string"
      ? manifest.repository
      : (manifest.repository?.url ?? null);
  const files = await packageLicenseFiles(installedPath);
  const notices = [];
  for (const fileName of files) {
    const text = await readFile(join(installedPath, fileName));
    const digest = hashBytes(text);
    const destination = `${digest}.txt`;
    if (!noticeFiles.has(destination)) {
      await mkdir(join(outputDirectory, "third-party-licenses"), { recursive: true });
      await copyFile(
        join(installedPath, fileName),
        join(outputDirectory, "third-party-licenses", destination),
      );
      noticeFiles.set(destination, { digest, textBytes: text.byteLength });
    }
    notices.push({
      file: toPackagePath(join(packagePath, fileName)),
      digest,
      source: "package-file",
    });
  }
  if (notices.length === 0) {
    const upstream =
      noticeSources[`${manifest.name}@${manifest.version}`] ??
      (manifest.name.startsWith("@comunica/")
        ? noticeSources[`@comunica/${manifest.version}`]
        : undefined);
    if (upstream) {
      const text = await readFile(join(sourceNoticeDirectory, upstream.file));
      const digest = hashBytes(text);
      const destination = `${digest}.txt`;
      await mkdir(join(outputDirectory, "third-party-licenses"), { recursive: true });
      await writeFile(join(outputDirectory, "third-party-licenses", destination), text);
      noticeFiles.set(destination, { digest, textBytes: text.byteLength });
      notices.push({
        file: destination,
        digest,
        source: upstream.sharedSource
          ? "version-matched-shared-upstream-license"
          : "version-matched-upstream-license",
        url: upstream.source,
        ...(upstream.sharedSource
          ? {
              sourceLinkage:
                "The installed @comunica packages share the Comunica monorepo release license.",
            }
          : {}),
      });
    } else {
      const embedded = await readEmbeddedNotice(installedPath, manifest);
      if (embedded) {
        const text = Buffer.from(embedded.text, "utf8");
        const digest = hashBytes(text);
        const destination = `${digest}.txt`;
        await mkdir(join(outputDirectory, "third-party-licenses"), { recursive: true });
        await writeFile(join(outputDirectory, "third-party-licenses", destination), text);
        noticeFiles.set(destination, { digest, textBytes: text.byteLength });
        notices.push({
          file: destination,
          digest,
          source: "embedded-upstream-source",
          packageFile: toPackagePath(join(packagePath, embedded.fileName)),
        });
      }
    }
  }
  const packageIdentity = `${manifest.name}@${manifest.version}`;
  let readmeLicenseLink;
  const linkOnly = readmeLicenseLinks[packageIdentity];
  if (notices.length === 0 && linkOnly) {
    const readmeText = await readFile(join(installedPath, linkOnly.file), "utf8");
    if (!readmeText.includes(linkOnly.url))
      throw new Error(
        `Pinned package README no longer contains its recorded license link: ${packagePath}`,
      );
    readmeLicenseLink = {
      file: toPackagePath(join(packagePath, linkOnly.file)),
      url: linkOnly.url,
    };
  }
  const verifiedMissing = verifiedReleaseWithoutLicenseFile[packageIdentity];
  const noticeStatus =
    notices.length > 0
      ? "text-included"
      : readmeLicenseLink
        ? "readme-license-link-only"
        : verifiedMissing
          ? "version-matched-release-license-file-absent"
          : "package-license-text-absent-upstream-unverified";
  noticeEntries.push({
    name: manifest.name,
    version: manifest.version,
    packagePath,
    includedBy: paths,
    production: productionPaths.has(packagePath),
    browser: browserPaths.has(packagePath),
    installedWithArtifact: productionPaths.has(packagePath),
    license: licenseDeclaration,
    repository: declaredRepository,
    resolved: lockPackage.resolved ?? null,
    integrity: lockPackage.integrity ?? null,
    noticeStatus,
    notices,
    ...(readmeLicenseLink ? { readmeLicenseLink } : {}),
    ...(verifiedMissing ? { upstreamEvidence: verifiedMissing } : {}),
  });
}

const starterRoot = join(packageDirectory, "starters");
const starterReleases = [];
const starterEntries = await readdir(starterRoot, { withFileTypes: true });
for (const releaseName of starterEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()) {
  const releaseDirectory = join(starterRoot, releaseName);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else {
        const bytes = await readFile(fullPath);
        files.push({
          path: toPackagePath(relative(releaseDirectory, fullPath)),
          bytes: bytes.byteLength,
          sha256: hashBytes(bytes),
        });
      }
    }
  }
  await walk(releaseDirectory);
  starterReleases.push({
    release: releaseName,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  });
}

const emittedWebFiles = [];
const webRoot = join(outputDirectory, "web");
for (const output of [...(provenance.assets ?? []), ...(provenance.stylesheets ?? [])]) {
  const relativePath = output.file;
  if (typeof relativePath !== "string")
    throw new Error("Build provenance contains an invalid emitted web path.");
  const absolutePath = resolve(webRoot, relativePath);
  const pathFromWebRoot = relative(webRoot, absolutePath);
  if (
    pathFromWebRoot === ".." ||
    pathFromWebRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromWebRoot) ||
    absolutePath === webRoot
  )
    throw new Error(`Build provenance points outside the emitted web directory: ${relativePath}`);
  const bytes = await readFile(absolutePath);
  output.bytes = bytes.byteLength;
}
await writeFile(join(webRoot, "build-provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
async function walkWeb(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) await walkWeb(fullPath);
    else {
      const bytes = await readFile(fullPath);
      emittedWebFiles.push({
        path: toPackagePath(relative(outputDirectory, fullPath)),
        bytes: bytes.byteLength,
        sha256: hashBytes(bytes),
      });
    }
  }
}
await walkWeb(join(outputDirectory, "web"));
const browserAssets = {
  files: emittedWebFiles.sort((a, b) => a.path.localeCompare(b.path)),
  provenance: {
    chunks: provenance.chunks,
    stylesheets: provenance.stylesheets,
    workers: provenance.workers,
  },
};
const inventory = {
  schemaVersion: 1,
  application: {
    name: packageManifest.name,
    version: packageManifest.version,
    private: packageManifest.private === true,
    applicationLicense: null,
    engines: packageManifest.engines,
  },
  dependencyGraph: {
    lockfileVersion: lock.lockfileVersion,
    productionPackageInstances: productionPaths.size,
    browserPackageInstances: browserPaths.size,
    totalPackageInstances: includedPaths.size,
    packages: noticeEntries,
    noticeTextFiles: [...noticeFiles.values()].sort((a, b) => a.digest.localeCompare(b.digest)),
  },
  starters: starterReleases,
  browserAssets,
};
await writeFile(
  join(outputDirectory, "release-inventory.json"),
  `${JSON.stringify(inventory, null, 2)}\n`,
);

const grouped = new Map();
for (const entry of noticeEntries) {
  const key = JSON.stringify([
    entry.name,
    entry.version,
    entry.license,
    entry.noticeStatus,
    entry.notices,
  ]);
  const group = grouped.get(key) ?? { ...entry, packagePaths: [] };
  group.packagePaths.push(entry.packagePath);
  grouped.set(key, group);
}
const lines = [
  "# Third-party notices",
  "",
  `This private application artifact includes ${productionPaths.size} pinned production package instances and ${browserPaths.size} package instances represented in the emitted browser assets. The exact installed paths, versions, lockfile integrity values, repositories, source contributions, starter digests, and notice text hashes are recorded in [release-inventory.json](release-inventory.json).`,
  "",
  "The application package declares no application license. This inventory describes third-party package declarations and supplied notice texts; it does not grant a license to the private application itself.",
  "",
  "## Included notice texts",
  "",
  "Files are content-addressed by SHA-256 and stored under `third-party-licenses/`. Repeated package notices share one text file, while every package instance remains separately listed in the inventory.",
  "",
];
for (const group of [...grouped.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
)) {
  if (group.noticeStatus !== "text-included") continue;
  const refs = group.packagePaths.map((path) => `\`${path}\``).join(", ");
  const textLinks = group.notices
    .map((notice) => `[${notice.digest.slice(0, 12)}](third-party-licenses/${notice.digest}.txt)`)
    .join(", ");
  lines.push(
    `- **${group.name}@${group.version}** (${JSON.stringify(group.license)}): ${textLinks}; package instances: ${refs}.`,
  );
}
lines.push(
  "",
  "## Package points to a license text",
  "",
  "These package README files identify an external license text without including its full body in the installed package. The link and package path are recorded in the release inventory.",
  "",
);
for (const group of [...grouped.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
)) {
  if (group.noticeStatus !== "readme-license-link-only") continue;
  const refs = group.packagePaths.map((path) => `\`${path}\``).join(", ");
  const link = group.readmeLicenseLink?.url ?? "license link recorded in inventory";
  lines.push(
    `- **${group.name}@${group.version}** (${JSON.stringify(group.license)}): ${link}; package instances: ${refs}.`,
  );
}
lines.push(
  "",
  "## Checked release roots without a license file",
  "",
  "These exact package releases declare license metadata, but their version-matched release root has no LICENSE or NOTICE file. The inventory records the checked release commit. No copyright text is inferred from a license identifier or generated from a generic license template.",
  "",
);
for (const group of [...grouped.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
)) {
  if (group.noticeStatus !== "version-matched-release-license-file-absent") continue;
  const refs = group.packagePaths.map((path) => `\`${path}\``).join(", ");
  lines.push(
    `- **${group.name}@${group.version}** (${JSON.stringify(group.license)}; repository: ${group.repository ?? "not declared"}; release commit: ${group.upstreamEvidence?.revision}): ${refs}.`,
  );
}
lines.push(
  "",
  "## Package text absent; upstream source not checked",
  "",
  "These package tarballs contain no named license file or detected full notice text. Their version-matched upstream source was not verified for this inventory, so no claim is made that no upstream text exists.",
  "",
);
for (const group of [...grouped.values()].sort((a, b) =>
  `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
)) {
  if (group.noticeStatus !== "package-license-text-absent-upstream-unverified") continue;
  const refs = group.packagePaths.map((path) => `\`${path}\``).join(", ");
  lines.push(
    `- **${group.name}@${group.version}** (${JSON.stringify(group.license)}; repository: ${group.repository ?? "not declared"}; resolved: ${group.resolved ?? "not recorded"}): ${refs}.`,
  );
}
lines.push(
  "",
  "Browser package references identify source modules emitted into JavaScript, stylesheet assets, and the ELK worker URL asset. The stylesheet inventory lists the actual CSS modules transformed for the emitted stylesheet, with their source paths, package versions, and source byte counts. Source maps are not shipped. Non-code HTML/CSS outputs are not classified as workers. Build-only modules such as the emitted Vite preload and Rolldown runtime helpers are inventoried with their matching build-package license texts, but they are not listed as installed application dependencies.",
  "",
);
await writeFile(join(outputDirectory, "THIRD_PARTY_NOTICES.md"), lines.join("\n"));

console.log(
  JSON.stringify({
    applicationVersion: packageManifest.version,
    productionPackageInstances: productionPaths.size,
    browserPackageInstances: browserPaths.size,
    missingUpstreamNoticeTexts: noticeEntries.filter(
      (entry) => entry.noticeStatus !== "text-included",
    ).length,
    starterFiles: starterReleases.reduce((sum, release) => sum + release.files.length, 0),
    webFiles: emittedWebFiles.length,
  }),
);
