import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const outputPath = process.env.TBSPEC_EVIDENCE_PATH ?? process.argv[3] ?? "packed-evidence.json";
const evidencePath = resolve(outputPath);
const evidence = {
  schemaVersion: 1,
  state: "running",
  artifact: null,
  platform: {
    platform: process.platform,
    release: process.release?.name ?? "unknown",
    osRelease: (await import("node:os")).release(),
    architecture: process.arch,
    node: process.version,
    npm: null,
  },
  installs: [],
  commands: [],
  http: [],
  assertions: [],
  scenarios: [],
  cleanup: [],
  failure: null,
};
let currentStep = "initialization";
let taskRoot;
let tempRoot;
let restrictedPath;
let offlineGuardPath;
let originalPackageRoot;
const activeWebProjects = new Set();
const executeFile = promisify(execFile);
const statusExit = {
  ok: 0,
  preview: 0,
  invalid: 1,
  invalid_arguments: 2,
  conflict: 3,
  unavailable: 4,
};

class VerificationFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function check(condition, code) {
  if (!condition) throw new VerificationFailure(code);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathForEvidence(value) {
  if (typeof value !== "string") return value;
  let cleaned = value;
  for (const root of [tempRoot, taskRoot])
    if (root) cleaned = cleaned.replaceAll(root, "<temporary>");
  return cleaned;
}

function redactArguments(args) {
  const output = [];
  let redactNext = false;
  for (const argument of args) {
    if (redactNext) {
      output.push("<preview-fingerprint>");
      redactNext = false;
      continue;
    }
    if (argument === "--accepted-preview") {
      output.push(argument);
      redactNext = true;
      continue;
    }
    output.push(pathForEvidence(argument));
  }
  return output;
}

async function privateDirectory(prefix) {
  const path = await mkdtemp(prefix);
  if (process.platform === "win32") {
    const literal = `'${path.replaceAll("'", "''")}'`;
    const script = `$ErrorActionPreference='Stop'; $sidValue=[Security.Principal.WindowsIdentity]::GetCurrent().User; $aclValue=[Security.AccessControl.DirectorySecurity]::new(); $aclValue.SetAccessRuleProtection($true,$false); $ruleValue=[Security.AccessControl.FileSystemAccessRule]::new($sidValue,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $aclValue.AddAccessRule($ruleValue); [IO.Directory]::SetAccessControl(${literal},$aclValue);`;
    await executeFile(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
    );
  }
  return path;
}

async function saveEvidence() {
  await mkdir(dirname(evidencePath), { recursive: true });
  const temporary = `${evidencePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  await rm(evidencePath, { force: true });
  const { rename } = await import("node:fs/promises");
  await rename(temporary, evidencePath);
}

function restrictedEnvironment(base = process.env) {
  const environment = { ...base };
  for (const name of Object.keys(environment))
    if (name.toLowerCase() === "path") delete environment[name];
  environment.PATH = restrictedPath;
  environment.NODE_OPTIONS = `--import=${pathToFileURL(offlineGuardPath).href}`;
  return environment;
}

function runProcess(file, args, options = {}) {
  return spawnSync(file, args, {
    cwd: options.cwd ?? tempRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 180000,
    maxBuffer: 16 * 1024 * 1024,
    env: options.env ?? restrictedEnvironment(),
    ...(options.shell ? { shell: true } : {}),
  });
}

function cliPath(packageRoot) {
  return join(packageRoot, "dist", "cli.js");
}

async function runCli(packageRoot, args, cwd = tempRoot, expectedExit) {
  const effectiveArgs = [...args, "--json"];
  const result = runProcess(process.execPath, [cliPath(packageRoot), ...effectiveArgs], { cwd });
  const record = {
    command: redactArguments(args),
    exit: result.status,
    errorCode: result.error?.code ?? null,
    status: null,
    diagnosticCodes: [],
  };
  if (result.status === 0 || result.status !== null) {
    const lines = (result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 1) {
      try {
        const envelope = JSON.parse(lines[0]);
        record.status = envelope?.status ?? null;
        record.diagnosticCodes = Array.isArray(envelope?.diagnostics)
          ? envelope.diagnostics.map((item) => item.code).filter((code) => typeof code === "string")
          : [];
        const runtimeDiagnostics = (envelope?.diagnostics ?? [])
          .filter((item) => typeof item.code === "string" && item.code.startsWith("RUNTIME_"))
          .map((item) => ({
            code: item.code,
            message:
              typeof item.message === "string"
                ? item.message
                    .replaceAll(tempRoot ?? "", "<temporary>")
                    .replaceAll(taskRoot ?? "", "<temporary>")
                    .replace(/https?:\/\/[^\s"<>]+/gi, "<url>")
                    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<redacted-token>")
                : null,
          }));
        if (runtimeDiagnostics.length > 0) record.runtimeDiagnostics = runtimeDiagnostics;
        evidence.commands.push(record);
        await saveEvidence();
        check(envelope?.schemaVersion === 1, "CLI_ENVELOPE_SCHEMA");
        check(
          JSON.stringify(Object.keys(envelope).sort()) ===
            JSON.stringify(["data", "diagnostics", "schemaVersion", "status"]),
          "CLI_ENVELOPE_KEYS",
        );
        check(Array.isArray(envelope.diagnostics), "CLI_ENVELOPE_DIAGNOSTICS");
        check(Object.hasOwn(statusExit, envelope.status), "CLI_ENVELOPE_STATUS");
        check(result.status === statusExit[envelope.status], "CLI_EXIT_STATUS_MISMATCH");
        if (expectedExit !== undefined)
          check(result.status === expectedExit, "CLI_UNEXPECTED_EXIT");
        return { exit: result.status, envelope, stderr: result.stderr ?? "" };
      } catch (error) {
        if (error instanceof VerificationFailure) throw error;
        throw new VerificationFailure("CLI_ENVELOPE_JSON");
      }
    }
  }
  evidence.commands.push(record);
  await saveEvidence();
  throw new VerificationFailure(
    result.error ? "CLI_PROCESS_START_FAILED" : "CLI_ONE_ENVELOPE_REQUIRED",
  );
}

async function verifyInstalledBin(packageRoot, cwd, expectedVersion) {
  const installPrefix = dirname(dirname(packageRoot));
  const binDirectory = join(dirname(packageRoot), ".bin");
  const executable = join(binDirectory, process.platform === "win32" ? "tbspec.cmd" : "tbspec");
  const relativeExecutable = relative(installPrefix, executable).split(sep).join("/");
  check(
    relativeExecutable ===
      `node_modules/.bin/${process.platform === "win32" ? "tbspec.cmd" : "tbspec"}`,
    "INSTALLED_PUBLIC_BIN_SHIM_LOCATION",
  );
  const executableIsFile = await stat(executable).then(
    (item) => item.isFile(),
    () => false,
  );
  check(executableIsFile, "INSTALLED_PUBLIC_BIN_SHIM_PRESENT");
  evidence.assertions.push({
    name: "installed-public-bin-shim-placement",
    passed: true,
    relativePath: relativeExecutable,
  });
  await saveEvidence();
  const pathEntries = [
    binDirectory,
    dirname(process.execPath),
    ...(process.platform === "win32"
      ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")]
      : []),
  ];
  const env = {
    ...restrictedEnvironment(),
    PATH: pathEntries.join(delimiter),
  };
  for (const args of [["--version"], ["--help"]]) {
    const result = runProcess(executable, [...args, "--json"], {
      cwd,
      env,
      shell: process.platform === "win32",
      timeout: 30000,
    });
    const lines = (result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
    let envelope = null;
    if (lines.length === 1) {
      try {
        envelope = JSON.parse(lines[0]);
      } catch {
        envelope = null;
      }
    }
    const record = {
      command: ["<installed-bin>", ...args],
      exit: result.status,
      errorCode: result.error?.code ?? null,
      status: envelope?.status ?? null,
      diagnosticCodes: Array.isArray(envelope?.diagnostics)
        ? envelope.diagnostics.map((item) => item.code).filter((code) => typeof code === "string")
        : [],
    };
    evidence.commands.push(record);
    await saveEvidence();
    check(result.status === 0 && lines.length === 1, "INSTALLED_PUBLIC_BIN_ONE_ENVELOPE");
    check(envelope?.schemaVersion === 1, "INSTALLED_PUBLIC_BIN_ENVELOPE_SCHEMA");
    check(
      JSON.stringify(Object.keys(envelope).sort()) ===
        JSON.stringify(["data", "diagnostics", "schemaVersion", "status"]),
      "INSTALLED_PUBLIC_BIN_ENVELOPE_KEYS",
    );
    check(Array.isArray(envelope.diagnostics), "INSTALLED_PUBLIC_BIN_DIAGNOSTICS");
    check(envelope.status === "ok", "INSTALLED_PUBLIC_BIN_STATUS");
    check(statusExit[envelope.status] === result.status, "INSTALLED_PUBLIC_BIN_EXIT_STATUS");
    if (args[0] === "--version")
      check(
        envelope.data?.applicationVersion === expectedVersion,
        "INSTALLED_PUBLIC_BIN_VERSION_MATCHES_PACKAGE",
      );
    else
      check(
        typeof envelope.data?.text === "string" && envelope.data.text.length > 0,
        "INSTALLED_PUBLIC_BIN_HELP",
      );
    evidence.assertions.push({
      name: `installed-public-bin:${args[0]}`,
      passed: true,
      oneEnvelope: true,
      status: envelope.status,
    });
    await saveEvidence();
  }
}

function expectStatus(result, status, exit = statusExit[status]) {
  check(result.envelope.status === status && result.exit === exit, "CLI_RESULT_STATUS");
  evidence.assertions.push({ name: `cli-status:${status}`, passed: true });
}

function expectDiagnostic(result, code) {
  check(
    result.envelope.diagnostics.some((item) => item.code === code),
    `DIAGNOSTIC_${code}`,
  );
  evidence.assertions.push({ name: `diagnostic:${code}`, passed: true });
}

async function verifyFileHash(path, expectedBytes, expectedDigest, code) {
  const bytes = await readFile(path);
  check(bytes.byteLength === expectedBytes, `${code}_BYTES`);
  check(sha256(bytes) === expectedDigest, `${code}_SHA256`);
}

async function captureProjectBytes(project, excludedRoots = []) {
  const files = new Map();
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const path = relative(project, absolute).split(sep).join("/");
      if (excludedRoots.some((root) => path === root || path.startsWith(`${root}/`))) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.set(path, await readFile(absolute));
    }
  }
  await visit(project);
  return files;
}

function assertProjectBytes(expected, actual, code) {
  const expectedPaths = [...expected.keys()].sort();
  const actualPaths = [...actual.keys()].sort();
  check(JSON.stringify(expectedPaths) === JSON.stringify(actualPaths), `${code}_PATHS`);
  for (const path of expectedPaths)
    check(expected.get(path).equals(actual.get(path)), `${code}_BYTES`);
  evidence.assertions.push({ name: code, passed: true, files: expectedPaths.length });
}

async function verifyServedBrowserAssets(baseUrl, inventory) {
  const served = [];
  for (const file of inventory.browserAssets.files) {
    const route = file.path.replace(/^web\//, "");
    const url = new URL(route, baseUrl);
    check(url.protocol === "http:" && url.hostname === "127.0.0.1", "SERVED_ASSET_LOOPBACK");
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    check(response.status === 200, "SERVED_ASSET_STATUS");
    const bytes = Buffer.from(await response.arrayBuffer());
    check(bytes.byteLength === file.bytes, "SERVED_ASSET_BYTES");
    const digest = sha256(bytes);
    check(digest === file.sha256, "SERVED_ASSET_SHA256");
    served.push({ path: route, bytes: bytes.byteLength, sha256: digest });
  }
  evidence.assertions.push({
    name: "served-browser-assets-match-launched-release",
    passed: true,
    count: served.length,
    assets: served,
  });
  await saveEvidence();
}

async function verifyInstalledInventory(packageRoot, inventory) {
  const packageManifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  check(packageManifest.name === inventory.application.name, "INSTALLED_PACKAGE_NAME");
  check(packageManifest.version === inventory.application.version, "INSTALLED_PACKAGE_VERSION");
  check(packageManifest.bundleDependencies === true, "BUNDLED_DEPENDENCY_METADATA");
  check(packageManifest.engines?.node === ">=24 <25", "NODE_ENGINE_METADATA");
  check(inventory.application.applicationLicense === null, "APPLICATION_LICENSE_INVENTORY");

  const actualPackages = new Map();
  const packageRootPath = resolve(packageRoot);
  async function scanModules(directory) {
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of children.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue;
      const childPath = join(directory, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of await readdir(childPath, { withFileTypes: true })) {
          if (!scoped.isDirectory()) continue;
          const instancePath = join(childPath, scoped.name);
          await recordPackage(instancePath);
          await scanModules(join(instancePath, "node_modules"));
        }
        continue;
      }
      await recordPackage(childPath);
      await scanModules(join(childPath, "node_modules"));
    }
  }
  async function recordPackage(directory) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    } catch {
      return;
    }
    const path = relative(packageRootPath, directory).split(sep).join("/");
    check(
      typeof manifest.name === "string" && typeof manifest.version === "string",
      "INSTALLED_PACKAGE_MANIFEST",
    );
    actualPackages.set(path, { name: manifest.name, version: manifest.version, path });
  }
  await scanModules(join(packageRoot, "node_modules"));

  const expectedPackages = inventory.dependencyGraph.packages
    .filter((item) => item.installedWithArtifact)
    .map((item) => ({ path: item.packagePath, name: item.name, version: item.version }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const actual = [...actualPackages.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  check(
    JSON.stringify(actual.map(({ path, name, version }) => ({ path, name, version }))) ===
      JSON.stringify(expectedPackages),
    "PRODUCTION_PACKAGE_TREE_MISMATCH",
  );
  check(
    actual.length === inventory.dependencyGraph.productionPackageInstances,
    "PRODUCTION_PACKAGE_COUNT",
  );

  for (const starter of inventory.starters) {
    for (const file of starter.files) {
      await verifyFileHash(
        join(packageRoot, "starters", starter.release, ...file.path.split("/")),
        file.bytes,
        file.sha256,
        "STARTER_FILE",
      );
    }
  }
  for (const file of inventory.browserAssets.files) {
    await verifyFileHash(
      join(packageRoot, "dist", ...file.path.split("/")),
      file.bytes,
      file.sha256,
      "BROWSER_FILE",
    );
    check(!file.path.endsWith(".map"), "BROWSER_SOURCE_MAP_PACKED");
  }
  for (const notice of inventory.dependencyGraph.noticeTextFiles) {
    await verifyFileHash(
      join(packageRoot, "dist", "third-party-licenses", `${notice.digest}.txt`),
      notice.textBytes,
      notice.digest,
      "LICENSE_TEXT",
    );
  }
  for (const item of inventory.dependencyGraph.packages) {
    for (const notice of item.notices ?? [])
      check(
        inventory.dependencyGraph.noticeTextFiles.some((text) => text.digest === notice.digest),
        "PACKAGE_NOTICE_TEXT_MISSING",
      );
  }

  const allDistFiles = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else allDistFiles.push(path);
    }
  }
  await walk(join(packageRoot, "dist"));
  check(!allDistFiles.some((path) => path.endsWith(".map")), "SOURCE_MAP_PACKED");
  check(
    !allDistFiles.some((path) => path.endsWith(".ts") && !path.endsWith(".d.ts")),
    "TYPESCRIPT_SOURCE_PACKED",
  );
  const packageEntries = await readdir(packageRoot, { withFileTypes: true });
  const rootNames = new Set(packageEntries.map((entry) => entry.name));
  for (const forbidden of ["tests", "scripts", "src", "web", "package-lock.json"])
    check(!rootNames.has(forbidden), "QA_OR_BUILD_INPUT_PACKED");
  check(
    rootNames.has("dist") && rootNames.has("starters") && rootNames.has("node_modules"),
    "ARTIFACT_LAYOUT",
  );
  check(
    await stat(join(packageRoot, "dist", "cli.js")).then((item) => item.isFile()),
    "COMPILED_CLI_MISSING",
  );
  check(
    await stat(join(packageRoot, "dist", "server.js")).then((item) => item.isFile()),
    "COMPILED_SERVER_MISSING",
  );
  check(
    await stat(join(packageRoot, "dist", "web", "index.html")).then((item) => item.isFile()),
    "WEB_APP_MISSING",
  );

  const provenance = JSON.parse(
    await readFile(join(packageRoot, "dist", "web", "build-provenance.json"), "utf8"),
  );
  check(provenance.workers.length === 1, "ELK_WORKER_COUNT");
  check(provenance.workers[0].package?.name === "elkjs", "ELK_WORKER_PROVENANCE");
  check(
    !provenance.workers.some((worker) => /\.(?:css|html)$/i.test(worker.file)),
    "NON_WORKER_ASSET_CLASSIFIED_AS_WORKER",
  );
  check(provenance.stylesheets.length === 1, "STYLESHEET_COUNT");
  check(
    provenance.stylesheets[0].sourceModules.some((module) => module.file === "web/style.css"),
    "APP_CSS_PROVENANCE",
  );
  check(
    provenance.stylesheets[0].sourceModules.some(
      (module) => module.package?.name === "@xyflow/react",
    ),
    "XYFLOW_CSS_PROVENANCE",
  );
  const buildHelpers = provenance.chunks
    .flatMap((chunk) => chunk.modules)
    .filter((module) => module.file.startsWith("virtual:"));
  check(
    buildHelpers.some((module) => module.package?.name === "vite"),
    "VITE_HELPER_PROVENANCE",
  );
  check(
    buildHelpers.some((module) => module.package?.name === "rolldown"),
    "ROLLDOWN_HELPER_PROVENANCE",
  );
  check(
    inventory.dependencyGraph.packages.some(
      (item) => item.name === "vite" && item.installedWithArtifact === false,
    ) &&
      inventory.dependencyGraph.packages.some(
        (item) => item.name === "rolldown" && item.installedWithArtifact === false,
      ),
    "BUILD_HELPER_LICENSE_INVENTORY",
  );
  evidence.assertions.push(
    { name: "actual-package-instance-paths-and-versions", passed: true, count: actual.length },
    {
      name: "starter-and-browser-digests",
      passed: true,
      starters: inventory.starters.reduce((sum, release) => sum + release.files.length, 0),
      browserFiles: inventory.browserAssets.files.length,
    },
    {
      name: "license-text-hashes-and-provenance",
      passed: true,
      texts: inventory.dependencyGraph.noticeTextFiles.length,
      packageInstances: inventory.dependencyGraph.packages.length,
    },
    {
      name: "clean-package-output-no-maps-or-qa-tools",
      passed: true,
      distFiles: allDistFiles.length,
    },
  );
  await saveEvidence();
}

async function installArtifact(archivePath, label) {
  const prefix = join(tempRoot, label);
  const cache = join(tempRoot, `${label}-empty-npm-cache`);
  const userConfig = join(tempRoot, `${label}-npmrc`);
  await mkdir(prefix, { recursive: true });
  await mkdir(cache, { recursive: true });
  await writeFile(userConfig, "", "utf8");
  check((await readdir(cache)).length === 0, "NPM_CACHE_NOT_EMPTY_BEFORE_INSTALL");
  const args = [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-update-notifier",
    "--cache",
    cache,
    "--userconfig",
    userConfig,
    "--prefix",
    prefix,
    archivePath,
  ];
  const result = runNpm(args, { cwd: tempRoot, offline: true, cache, userConfig });
  evidence.installs.push({
    label,
    offline: true,
    emptyCacheBeforeInstall: true,
    exit: result.status,
    errorCode: result.error?.code ?? null,
  });
  await saveEvidence();
  check(result.status === 0, `OFFLINE_INSTALL_${label.toUpperCase()}`);
  const packageRoot = join(prefix, "node_modules", "tbspec");
  check(
    await stat(join(packageRoot, "package.json")).then((item) => item.isFile()),
    "INSTALLED_PACKAGE_MISSING",
  );
  return packageRoot;
}

function runNpm(args, options = {}) {
  const cli = process.env.TBSPEC_NPM_CLI ?? process.env.npm_execpath;
  const npmEnvironment = {
    ...process.env,
    ...(options.offline ? { npm_config_offline: "true" } : {}),
    ...(options.cache ? { npm_config_cache: options.cache } : {}),
    ...(options.userConfig ? { npm_config_userconfig: options.userConfig } : {}),
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  if (cli)
    return runProcess(process.execPath, [cli, ...args], {
      cwd: options.cwd ?? tempRoot,
      env: npmEnvironment,
      timeout: 600000,
    });
  return runProcess(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: options.cwd ?? tempRoot,
    env: npmEnvironment,
    timeout: 600000,
    shell: process.platform === "win32",
  });
}

function expectHttp(status, envelope, expectedStatus, code) {
  check(status === expectedStatus, `${code}_HTTP_STATUS`);
  check(envelope?.schemaVersion === 1, `${code}_ENVELOPE_SCHEMA`);
  check(Array.isArray(envelope?.diagnostics), `${code}_ENVELOPE_DIAGNOSTICS`);
  evidence.assertions.push({ name: code, passed: true });
}

async function withWeb(project, work) {
  currentStep = `web-start:${pathForEvidence(project)}`;
  activeWebProjects.add(project);
  const started = await runCli(originalPackageRoot, ["web", "--project", project], project, 0);
  try {
    await saveEvidence();
    expectStatus(started, "ok");
    const server = started.envelope.data?.server;
    check(
      typeof server?.baseUrl === "string" && typeof server?.openingLink === "string",
      "WEB_START_READINESS",
    );
    check(server.applicationVersion === evidence.artifact.applicationVersion, "WEB_SERVER_VERSION");
    const base = new URL(server.baseUrl);
    check(base.protocol === "http:" && base.hostname === "127.0.0.1", "WEB_LOOPBACK_BINDING");
    const origin = base.origin;
    const opening = new URL(server.openingLink);
    check(opening.origin === origin, "WEB_OPENING_LINK_ORIGIN");
    const bootstrap = new URLSearchParams(opening.hash.slice(1)).get("tbspec-bootstrap");
    check(typeof bootstrap === "string" && bootstrap.length >= 20, "WEB_BOOTSTRAP_FRAGMENT");
    const openedResponse = await fetch(new URL("api/auth/v1/bootstrap", base), {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, bootstrap }),
      signal: AbortSignal.timeout(15000),
    });
    const opened = await openedResponse.json();
    expectHttp(openedResponse.status, opened, 200, "authenticated-bootstrap");
    const token = opened.data?.sessionToken;
    check(typeof token === "string" && token.length >= 20, "WEB_SESSION_TOKEN");

    async function call(route, body) {
      const url = new URL(`api/project/v1/${route}`, base);
      check(url.hostname === "127.0.0.1" && url.origin === origin, "HTTP_LOOPBACK_ONLY");
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Tbspec-Schema-Version": "1",
          Origin: origin,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30000),
      });
      const envelope = await response.json();
      evidence.http.push({
        route: `/${route.split("?")[0]}`,
        method: body === undefined ? "GET" : "POST",
        status: response.status,
        envelopeStatus: envelope?.status ?? null,
        diagnosticCodes: (envelope?.diagnostics ?? []).map((item) => item.code),
      });
      await saveEvidence();
      return { response, status: response.status, envelope };
    }

    async function apply(route, body, applyRoute = "resource/apply") {
      const staged = await call(route, body);
      expectHttp(staged.status, staged.envelope, 200, `stage-${route}`);
      check(
        staged.envelope.status === "preview",
        `STAGE_${route.toUpperCase().replaceAll("/", "_")}`,
      );
      const preview = staged.envelope.data;
      check(
        typeof preview?.handle === "string" && typeof preview?.preview?.fingerprint === "string",
        "PREVIEW_HANDLE_FINGERPRINT",
      );
      const acceptance = preview.preview.impact?.acceptance ?? [];
      const applied = await call(applyRoute, {
        schemaVersion: 1,
        handle: preview.handle,
        fingerprint: preview.preview.fingerprint,
        accept: acceptance,
      });
      expectHttp(applied.status, applied.envelope, 200, `apply-${route}`);
      check(applied.envelope.status === "ok", `APPLY_${route.toUpperCase().replaceAll("/", "_")}`);
      return { staged: staged.envelope, applied: applied.envelope };
    }

    await work({ base, call, apply });
  } finally {
    currentStep = `web-stop:${pathForEvidence(project)}`;
    const stopped = await runCli(
      originalPackageRoot,
      ["web", "stop", "--project", project],
      project,
      0,
    );
    expectStatus(stopped, "ok");
    check(stopped.envelope.data?.server?.state === "stopped", "WEB_STOP_VERIFIED");
    activeWebProjects.delete(project);
    evidence.cleanup.push({ project: pathForEvidence(project), state: "stopped-and-verified" });
    await saveEvidence();
  }
}

async function newProject(name, baseIri) {
  const project = join(tempRoot, "projects", name);
  await mkdir(join(tempRoot, "projects"), { recursive: true });
  const initialized = await runCli(
    originalPackageRoot,
    ["init", project, "--base-iri", baseIri],
    tempRoot,
    0,
  );
  expectStatus(initialized, "ok");
  return project;
}

async function stageSourceText(api, selector, sourceText) {
  const shown = await api.call(`editor?selector=${encodeURIComponent(selector)}`);
  expectHttp(shown.status, shown.envelope, 200, `editor-read-${selector}`);
  const revision = shown.envelope.data?.resource?.revision;
  check(revision && typeof revision === "object", "EDITOR_REVISION");
  const result = await api.apply("editor/save", { selector, revision, sourceText });
  return result;
}

function scenarioRecord(name, status, detail = {}) {
  evidence.scenarios.push({ name, status, ...detail });
}

async function runScenario(name, work) {
  currentStep = name;
  await saveEvidence();
  try {
    const detail = await work();
    scenarioRecord(name, "passed", detail ?? {});
    await saveEvidence();
  } catch (error) {
    scenarioRecord(name, "failed", { code: error.code ?? "ASSERTION_FAILED" });
    await saveEvidence();
    throw error;
  }
}

async function verifyCommandFamilies(project) {
  const families = [
    [],
    ["init", "--help"],
    ["status", "--help"],
    ["validate", "--help"],
    ["graph", "--help"],
    ["config", "--help"],
    ["web", "--help"],
    ["ontology", "--help"],
    ["model", "--help"],
    ["shapes", "--help"],
    ["query", "--help"],
    ["dependency", "--help"],
    ["impact", "--help"],
    ["resource", "--help"],
    ["view", "--help"],
    ["design", "--help"],
    ["refactor", "--help"],
    ["references", "--help"],
    ["gc", "--help"],
    ["llms", "--help"],
  ];
  for (const args of families) {
    const result = await runCli(originalPackageRoot, args, project, 0);
    expectStatus(result, "ok");
  }
  const invalid = await runCli(originalPackageRoot, ["__unknown_public_route__"], project, 2);
  expectStatus(invalid, "invalid_arguments");
  check(invalid.envelope.diagnostics[0]?.code === "ARGUMENT_INVALID", "INVALID_COMMAND_DIAGNOSTIC");
  const version = await runCli(originalPackageRoot, ["--version"], project, 0);
  expectStatus(version, "ok");
  check(
    version.envelope.data?.applicationVersion === evidence.artifact.applicationVersion,
    "CLI_DYNAMIC_VERSION",
  );
  const guidanceRoutes = [
    ["llms"],
    ["llms", "project", "inspect"],
    ["llms", "modeling", "validation"],
    ["llms", "views", "canvas"],
    ["llms", "dependencies", "update"],
    ["llms", "safety", "recovery"],
  ];
  for (const args of guidanceRoutes) {
    const result = await runCli(originalPackageRoot, args, project, 0);
    expectStatus(result, "ok");
    check(typeof result.envelope.data?.text === "string", `GUIDANCE_TEXT_${args.join("_")}`);
    check(Array.isArray(result.envelope.data?.topics), `GUIDANCE_TOPICS_${args.join("_")}`);
  }
  const unknownGuidance = await runCli(
    originalPackageRoot,
    ["llms", "__unknown_guidance_topic__"],
    project,
    2,
  );
  expectStatus(unknownGuidance, "invalid_arguments");
  check(
    unknownGuidance.envelope.data?.text?.includes("Nearest valid index") &&
      unknownGuidance.envelope.diagnostics[0]?.code === "ARGUMENT_INVALID",
    "GUIDANCE_UNKNOWN_TOPIC_HAS_NEAREST_INDEX_AND_ONE_ENVELOPE",
  );
  evidence.assertions.push({
    name: "public-command-family-help-and-one-envelope-routing",
    passed: true,
    families: families.length,
    guidanceRoutes: guidanceRoutes.length,
    unknownGuidanceRoute: true,
  });
  await saveEvidence();
}

async function verifyScenarioOne() {
  const project = await newProject("scenario-1", "urn:installed:scenario-1:/");
  const createdConceptual = await runCli(
    originalPackageRoot,
    ["model", "create", "concepts.ttl", "--type", "data", "--profile", "conceptual"],
    project,
    0,
  );
  expectStatus(createdConceptual, "ok");
  const createdConcrete = await runCli(
    originalPackageRoot,
    [
      "model",
      "create",
      "people.ttl",
      "--type",
      "data",
      "--profile",
      "concrete",
      "--schema",
      "concepts.ttl",
    ],
    project,
    0,
  );
  expectStatus(createdConcrete, "ok");
  const missingSchemaModel = await runCli(
    originalPackageRoot,
    ["model", "create", "declared-missing-schema.ttl", "--type", "data", "--profile", "concrete"],
    project,
    0,
  );
  expectStatus(missingSchemaModel, "ok");
  const schemaList = await runCli(
    originalPackageRoot,
    ["model", "schema", "list", "people.ttl"],
    project,
    0,
  );
  expectStatus(schemaList, "ok");
  check(
    schemaList.envelope.data?.items?.some((item) => item.selector === "concepts.ttl"),
    "SCHEMA_ASSOCIATION_CREATED",
  );

  await withWeb(project, async (api) => {
    const conceptual = await api.call("editor?selector=concepts.ttl");
    expectHttp(conceptual.status, conceptual.envelope, 200, "conceptual-editor");
    check(
      conceptual.envelope.data.creationTypes?.some(
        (item) => item.type === "http://www.w3.org/2002/07/owl#Class",
      ),
      "CONCEPTUAL_EDITOR_SPECIALIZED_CLASS_FORM",
    );
    await stageSourceText(
      api,
      "concepts.ttl",
      `${conceptual.envelope.data.sourceText}\n<urn:installed:scenario-1:/Person> a <http://www.w3.org/2002/07/owl#Class> .\n<urn:installed:scenario-1:/name> a <http://www.w3.org/2002/07/owl#DatatypeProperty>; <http://www.w3.org/2000/01/rdf-schema#domain> <urn:installed:scenario-1:/Person>; <http://www.w3.org/2000/01/rdf-schema#range> <http://www.w3.org/2001/XMLSchema#string> .\n`,
    );
    const authoredConceptual = await api.call("editor?selector=concepts.ttl");
    expectHttp(
      authoredConceptual.status,
      authoredConceptual.envelope,
      200,
      "authored-conceptual-editor",
    );
    check(
      authoredConceptual.envelope.data.creationTypes?.some(
        (item) => item.type === "http://www.w3.org/2002/07/owl#Class",
      ) &&
        authoredConceptual.envelope.data.creationTypes?.some(
          (item) => item.type === "http://www.w3.org/2002/07/owl#DatatypeProperty",
        ),
      "CONCEPTUAL_EDITOR_SPECIALIZED_CLASS_AND_PROPERTY_FORMS",
    );
    check(
      authoredConceptual.envelope.data.sections?.some(
        (section) =>
          section.type === "http://www.w3.org/2002/07/owl#Class" &&
          section.subjects.some((subject) => subject.value === "urn:installed:scenario-1:/Person"),
      ) &&
        authoredConceptual.envelope.data.sections?.some(
          (section) =>
            section.type === "http://www.w3.org/2002/07/owl#DatatypeProperty" &&
            section.subjects.some((subject) => subject.value === "urn:installed:scenario-1:/name"),
        ),
      "CONCEPTUAL_EDITOR_RECOGNIZES_AUTHORED_CLASS_AND_PROPERTY",
    );
    const people = await api.call("editor?selector=people.ttl");
    expectHttp(people.status, people.envelope, 200, "concrete-editor");
    await stageSourceText(
      api,
      "people.ttl",
      `${people.envelope.data.sourceText}\n<urn:installed:scenario-1:/alice> a <urn:installed:scenario-1:/Person>; <urn:installed:scenario-1:/name> "Alice" .\n`,
    );
    const editor = await api.call("editor?selector=people.ttl");
    expectHttp(editor.status, editor.envelope, 200, "authored-concrete-editor");
    check(editor.envelope.data?.parseable === true, "CONCRETE_MODEL_PARSEABLE");
    check(
      editor.envelope.data.creationClasses?.includes("urn:installed:scenario-1:/Person"),
      "FORM_CLASS_RECOGNITION",
    );
    check(
      editor.envelope.data.triples?.some(
        (triple) =>
          triple.subject?.value === "urn:installed:scenario-1:/alice" &&
          triple.predicate?.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
          triple.object?.value === "urn:installed:scenario-1:/Person",
      ),
      "CONCRETE_MODEL_GENERIC_CLASS_STATEMENT",
    );
    check(
      editor.envelope.data.triples?.some(
        (triple) =>
          triple.subject?.value === "urn:installed:scenario-1:/alice" &&
          triple.predicate?.value === "urn:installed:scenario-1:/name" &&
          triple.object?.value === "Alice",
      ),
      "CONCRETE_MODEL_GENERIC_PROPERTY_STATEMENT",
    );
    const missingSchema = await api.call("editor?selector=declared-missing-schema.ttl");
    expectHttp(
      missingSchema.status,
      missingSchema.envelope,
      200,
      "concrete-model-with-declared-schema",
    );
    await stageSourceText(
      api,
      "declared-missing-schema.ttl",
      `${missingSchema.envelope.data.sourceText}\n<${missingSchema.envelope.data.resource.graphIri}> <https://talby.ai/ontology/tbspec#schema> <urn:installed:scenario-1:/missing-schema> .\n`,
    );
  });
  const missingSchemaValidation = await runCli(
    originalPackageRoot,
    ["validate", "declared-missing-schema.ttl"],
    project,
    1,
  );
  expectStatus(missingSchemaValidation, "invalid", 1);
  check(
    missingSchemaValidation.envelope.diagnostics.some(
      (item) =>
        item.code === "ASSOCIATION_BROKEN" &&
        item.file === "declared-missing-schema.ttl" &&
        item.severity === "error",
    ),
    "VALIDATION_REPORTS_DECLARED_MISSING_SCHEMA_ASSOCIATION",
  );
  const nested = join(project, "nested", "workspace");
  await mkdir(nested, { recursive: true });
  const discovered = await runCli(originalPackageRoot, ["status"], nested, 1);
  expectStatus(discovered, "invalid", 1);
  check(discovered.envelope.data?.project?.root === project, "UPWARD_PROJECT_DISCOVERY");
  check(
    discovered.envelope.diagnostics.some((item) => item.code === "ASSOCIATION_BROKEN"),
    "UPWARD_DISCOVERY_REPORTS_CURRENT_PROJECT_VALIDITY",
  );
  return {
    assertions: [
      "conceptual/concrete creation",
      "schema association",
      "declared missing schema association validation",
      "authenticated form fields",
      "generic concrete graph retains class and property triples",
      "upward discovery",
    ],
  };
}

async function verifyScenarioTwo() {
  const project = await newProject("scenario-2", "urn:installed:scenario-2:/");
  const source = join(tempRoot, "sources", "directory-shop");
  await mkdir(source, { recursive: true });
  await writeFile(
    join(source, "shop.ttl"),
    '<https://example.test/shop> a <http://www.w3.org/2002/07/owl#Ontology>; <http://www.w3.org/2002/07/owl#imports> <https://example.test/base>; <urn:label> "first" .\n',
  );
  await writeFile(
    join(source, "base.ttl"),
    "<https://example.test/base> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );
  await writeFile(
    join(source, "unrelated.ttl"),
    "<https://example.test/unrelated> a <https://talby.ai/ontology/tbspec#Model> .\n",
  );
  const inspected = await runCli(
    originalPackageRoot,
    ["dependency", "inspect", source],
    project,
    0,
  );
  expectStatus(inspected, "ok");
  check(inspected.envelope.data?.items?.length === 3, "DIRECTORY_SOURCE_INSPECTION");
  const preview = await runCli(
    originalPackageRoot,
    ["dependency", "add", source, "--id", "shop", "--kind", "ontology", "--resource", "shop.ttl"],
    project,
    3,
  );
  expectStatus(preview, "conflict");
  check(preview.envelope.data?.preview?.operation === "dependency.add", "DEPENDENCY_ADD_PREVIEW");
  const fingerprint = preview.envelope.data.preview.fingerprint;
  const added = await runCli(
    originalPackageRoot,
    [
      "dependency",
      "add",
      source,
      "--id",
      "shop",
      "--kind",
      "ontology",
      "--resource",
      "shop.ttl",
      "--accepted-preview",
      fingerprint,
    ],
    project,
    0,
  );
  expectStatus(added, "ok");
  const shown = await runCli(originalPackageRoot, ["dependency", "show", "shop"], project, 0);
  expectStatus(shown, "ok");
  const dependency = shown.envelope.data?.dependency;
  check(dependency?.primarySelector === "dep:shop/source/shop.ttl", "DEPENDENCY_PRIMARY_SELECTOR");
  const acquiredKeys = dependency.files.map((item) => item.key).sort();
  check(
    acquiredKeys.includes("source/base.ttl") && acquiredKeys.includes("source/shop.ttl"),
    "IMPORT_CLOSURE_RETAINED",
  );
  check(
    !acquiredKeys.some((item) => item.includes("unrelated")),
    "UNRELATED_DIRECTORY_FILE_EXCLUDED",
  );
  const unchanged = await runCli(originalPackageRoot, ["dependency", "check", "shop"], project, 0);
  expectStatus(unchanged, "ok");
  check(unchanged.envelope.data?.items?.[0]?.state === "unchanged", "DEPENDENCY_CHECK_UNCHANGED");
  await writeFile(
    join(source, "shop.ttl"),
    '<https://example.test/shop> a <http://www.w3.org/2002/07/owl#Ontology>; <http://www.w3.org/2002/07/owl#imports> <https://example.test/base>; <urn:label> "updated" .\n',
  );
  const changed = await runCli(originalPackageRoot, ["dependency", "check", "shop"], project, 1);
  expectStatus(changed, "invalid", 1);
  check(changed.envelope.data?.items?.[0]?.state === "changed", "DEPENDENCY_SOURCE_DRIFT");
  const update = await runCli(originalPackageRoot, ["dependency", "update", "shop"], project, 0);
  expectStatus(update, "preview", 0);
  check(update.envelope.status === "preview", "DEPENDENCY_UPDATE_PREVIEW");
  const updateArgs = [
    "dependency",
    "update",
    "shop",
    "--apply",
    "--accepted-preview",
    update.envelope.data.preview.fingerprint,
  ];
  if (update.envelope.data.preview.impact?.acceptance?.includes("accept-impact"))
    updateArgs.push("--accept-impact");
  const updated = await runCli(originalPackageRoot, updateArgs, project, 0);
  expectStatus(updated, "ok");
  const finalCheck = await runCli(originalPackageRoot, ["dependency", "check", "shop"], project, 0);
  expectStatus(finalCheck, "ok");
  check(
    finalCheck.envelope.data?.items?.[0]?.state === "unchanged",
    "DEPENDENCY_UPDATE_SNAPSHOT_REFRESHED",
  );
  return {
    assertions: [
      "offline directory source closure",
      "unrelated exclusion",
      "change check",
      "accepted update",
    ],
  };
}

async function verifyScenarioThree() {
  const project = await newProject("scenario-3", "urn:installed:scenario-3:/");
  const defaults = await runCli(
    originalPackageRoot,
    ["config", "model-type", "show", "process"],
    project,
    0,
  );
  expectStatus(defaults, "ok");
  const defaultType = defaults.envelope.data.modelType;
  check(defaultType.ontology === "dep:tbspec-process", "LOCKED_PROCESS_ONTOLOGY_DEFAULT");
  check(defaultType.design === "dep:tbspec-process-design", "LOCKED_PROCESS_DESIGN_DEFAULT");
  const created = await runCli(
    originalPackageRoot,
    ["model", "create", "models/process.ttl", "--type", "process"],
    project,
    0,
  );
  expectStatus(created, "ok");
  const modelPath = join(project, "models", "process.ttl");
  await writeFile(
    modelPath,
    `${await readFile(modelPath, "utf8")}\n<urn:installed:scenario-3:/Plan> a <http://purl.org/net/p-plan#Plan> .\n`,
  );
  const modelBefore = await readFile(modelPath);
  const unrelatedToml =
    '\n# Keep this unrelated section byte-for-byte.\n[verification]\nmarker = "preserve me"\n';
  await writeFile(
    join(project, "tbspec.toml"),
    `${await readFile(join(project, "tbspec.toml"), "utf8")}${unrelatedToml}`,
  );
  await writeFile(
    join(project, "replacement.ttl"),
    "<urn:installed:scenario-3:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );
  const stableProjectBytes = await captureProjectBytes(project, ["tbspec.toml", ".tbspec/runtime"]);
  const preview = await runCli(
    originalPackageRoot,
    ["config", "model-type", "set", "process", "--ontology", "replacement.ttl"],
    project,
    0,
  );
  expectStatus(preview, "preview", 0);
  check(preview.envelope.status === "preview", "VOCABULARY_CHANGE_PREVIEW");
  const proposed = preview.envelope.data.preview;
  check(
    proposed.arguments.affectedModels.some(
      (item) =>
        item.selector === "models/process.ttl" &&
        item.validityBefore === "passed" &&
        item.validityAfter === "failed",
    ),
    "VOCABULARY_AFFECTED_MODEL_IMPACT",
  );
  check(proposed.impact.acceptance.includes("accept-impact"), "VOCABULARY_IMPACT_ACCEPTANCE");
  check(
    proposed.impact.introducedErrors.some((item) => item.code === "VOCABULARY_UNKNOWN"),
    "VOCABULARY_UNKNOWN_PREVIEW",
  );
  const applied = await runCli(
    originalPackageRoot,
    [
      "config",
      "model-type",
      "set",
      "process",
      "--ontology",
      "replacement.ttl",
      "--accept-impact",
      "--accepted-preview",
      proposed.fingerprint,
    ],
    project,
    0,
  );
  expectStatus(applied, "ok");
  check((await readFile(modelPath)).equals(modelBefore), "PROCESS_MODEL_BYTES_PRESERVED");
  check(
    (await readFile(join(project, "tbspec.toml"), "utf8")).includes(unrelatedToml),
    "UNRELATED_TOML_PRESERVED",
  );
  assertProjectBytes(
    stableProjectBytes,
    await captureProjectBytes(project, ["tbspec.toml", ".tbspec/runtime"]),
    "VOCABULARY_REPLACEMENT_PRESERVES_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );
  const replacement = await runCli(
    originalPackageRoot,
    ["config", "model-type", "show", "process"],
    project,
    0,
  );
  expectStatus(replacement, "ok");
  check(
    replacement.envelope.data.modelType.ontology === "replacement.ttl" &&
      replacement.envelope.data.modelType.design === null,
    "REPLACEMENT_DISCONNECTS_DESIGN",
  );
  const validation = await runCli(
    originalPackageRoot,
    ["validate", "models/process.ttl"],
    project,
    1,
  );
  expectStatus(validation, "invalid", 1);
  expectDiagnostic(validation, "VOCABULARY_UNKNOWN");
  const editor = await runCli(
    originalPackageRoot,
    ["graph", "show", "models/process.ttl"],
    project,
    0,
  );
  expectStatus(editor, "ok");
  check(typeof editor.envelope.data?.sourceText === "string", "REPLACEMENT_MODEL_STILL_PARSEABLE");
  const importedCopy = await runCli(
    originalPackageRoot,
    ["ontology", "import", "dep:tbspec-process", "process-copy.ttl"],
    project,
    0,
  );
  expectStatus(importedCopy, "ok");
  const copiedOntology = await runCli(
    originalPackageRoot,
    ["graph", "show", "process-copy.ttl"],
    project,
    0,
  );
  expectStatus(copiedOntology, "ok");
  const processOntologyIri = "https://talby.ai/ontology/process";
  const processClassIri = `${processOntologyIri}#Flow`;
  const copiedOntologyIri = "urn:installed:scenario-3:/process-copy";
  const owlImportsIri = "http://www.w3.org/2002/07/owl#imports";
  check(
    copiedOntology.envelope.data?.resource?.kind === "ontology" &&
      copiedOntology.envelope.data?.triples?.some(
        (item) =>
          item.subject?.value === processClassIri &&
          item.predicate?.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
          item.object?.value === "http://www.w3.org/2002/07/owl#Class",
      ) &&
      copiedOntology.envelope.data?.triples?.some(
        (item) =>
          item.subject?.value === copiedOntologyIri &&
          item.predicate?.value === owlImportsIri &&
          item.object?.value === "http://purl.org/net/p-plan#",
      ),
    "COMPATIBLE_LOCAL_COPY_RETAINS_FLOW_DECLARATION_AND_EXACT_P_PLAN_IMPORT",
  );
  const compatibleCopyBytes = await readFile(join(project, "process-copy.ttl"));
  const compatibleProjectBytes = await captureProjectBytes(project, [
    "tbspec.toml",
    ".tbspec/runtime",
  ]);
  const compatiblePreview = await runCli(
    originalPackageRoot,
    ["config", "model-type", "set", "process", "--ontology", "process-copy.ttl"],
    project,
    0,
  );
  expectStatus(compatiblePreview, "preview", 0);
  check(
    compatiblePreview.envelope.data.preview.arguments.affectedModels.some(
      (item) =>
        item.selector === "models/process.ttl" &&
        item.validityBefore === "failed" &&
        item.validityAfter === "passed",
    ),
    "COMPATIBLE_COPY_PRESERVES_MODEL_VALIDITY_IN_PREVIEW",
  );
  const compatibleSetArgs = [
    "config",
    "model-type",
    "set",
    "process",
    "--ontology",
    "process-copy.ttl",
    "--accepted-preview",
    compatiblePreview.envelope.data.preview.fingerprint,
  ];
  if ((compatiblePreview.envelope.data.preview.impact?.acceptance ?? []).includes("accept-impact"))
    compatibleSetArgs.push("--accept-impact");
  const compatibleSet = await runCli(originalPackageRoot, compatibleSetArgs, project, 0);
  expectStatus(compatibleSet, "ok");
  check((await readFile(modelPath)).equals(modelBefore), "COMPATIBLE_COPY_MODEL_BYTES_PRESERVED");
  check(
    (await readFile(join(project, "process-copy.ttl"))).equals(compatibleCopyBytes),
    "COMPATIBLE_COPY_SOURCE_BYTES_PRESERVED",
  );
  const compatibleDesign = await runCli(
    originalPackageRoot,
    ["config", "model-type", "design", "set", "process", defaultType.design],
    project,
    0,
  );
  expectStatus(compatibleDesign, "ok");
  const compatibleConfig = await runCli(
    originalPackageRoot,
    ["config", "model-type", "show", "process"],
    project,
    0,
  );
  expectStatus(compatibleConfig, "ok");
  check(
    compatibleConfig.envelope.data.modelType.ontology === "process-copy.ttl" &&
      typeof compatibleConfig.envelope.data.modelType.design === "string" &&
      compatibleConfig.envelope.data.modelType.design.startsWith("dep:tbspec-process-design"),
    "OLD_DESIGN_EXPLICITLY_REUSED_WITH_COMPATIBLE_LOCAL_COPY",
  );
  const compatibleValidation = await runCli(
    originalPackageRoot,
    ["validate", "models/process.ttl"],
    project,
    0,
  );
  expectStatus(compatibleValidation, "ok");
  check(
    !compatibleValidation.envelope.diagnostics.some(
      (item) => item.code === "VOCABULARY_UNKNOWN" && item.file === "models/process.ttl",
    ),
    "COMPATIBLE_COPY_KNOWS_PROCESS_MODEL_TERMS",
  );
  assertProjectBytes(
    compatibleProjectBytes,
    await captureProjectBytes(project, ["tbspec.toml", ".tbspec/runtime"]),
    "COMPATIBLE_COPY_AND_DESIGN_REUSE_PRESERVE_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );
  const resetPreview = await runCli(
    originalPackageRoot,
    ["config", "model-type", "reset", "process"],
    project,
  );
  check(
    resetPreview.envelope.status === "preview" || resetPreview.envelope.status === "ok",
    "RESET_RESULT",
  );
  if (resetPreview.envelope.status === "preview") {
    const resetAcceptance = resetPreview.envelope.data.preview.impact?.acceptance ?? [];
    const resetArgs = [
      "config",
      "model-type",
      "reset",
      "process",
      "--accepted-preview",
      resetPreview.envelope.data.preview.fingerprint,
    ];
    if (resetAcceptance.includes("accept-impact")) resetArgs.push("--accept-impact");
    const reset = await runCli(originalPackageRoot, resetArgs, project, 0);
    expectStatus(reset, "ok");
  }
  const restored = await runCli(
    originalPackageRoot,
    ["config", "model-type", "show", "process"],
    project,
    0,
  );
  expectStatus(restored, "ok");
  check(
    restored.envelope.data.modelType.ontology === defaultType.ontology &&
      restored.envelope.data.modelType.design === defaultType.design,
    "PROJECT_LOCKED_DEFAULTS_RESET",
  );
  check(
    (await readFile(join(project, "tbspec.toml"), "utf8")).includes(unrelatedToml),
    "LOCKED_RESET_PRESERVES_UNRELATED_TOML_BYTES",
  );
  assertProjectBytes(
    compatibleProjectBytes,
    await captureProjectBytes(project, ["tbspec.toml", ".tbspec/runtime"]),
    "LOCKED_RESET_PRESERVES_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );
  return {
    assertions: [
      "impact preview",
      "accept-impact",
      "model and unrelated TOML preservation",
      "old design reused with an exact compatible local vocabulary copy",
      "actual default reset",
    ],
  };
}

async function verifyScenarioFour() {
  const project = await newProject("scenario-4", "urn:installed:scenario-4:/");
  const model = await runCli(
    originalPackageRoot,
    ["model", "create", "source.ttl", "--type", "data", "--profile", "conceptual"],
    project,
    0,
  );
  expectStatus(model, "ok");
  const designPrefix = "https://talby.ai/ontology/tbspec#";
  const sourcePath = join(project, "source.ttl");
  const originalSource = await readFile(sourcePath, "utf8");
  const viewSource = `${originalSource}\n<urn:Person> a <http://www.w3.org/2002/07/owl#Class> .\n<urn:a> a <urn:Person>; <urn:p> <urn:b>; <urn:q> <urn:b>; <urn:p> <urn:a> .\n<urn:b> <urn:q> <urn:c> .\n`;
  await writeFile(
    join(project, "designs-one.ttl"),
    `<urn:design-one> a <${designPrefix}VisualDesignModel>; <${designPrefix}rule> <urn:rule-one> .\n<urn:rule-one> a <${designPrefix}NodeVisualRule>; <${designPrefix}targetConcept> <urn:Person>; <${designPrefix}fillColor> "#112233" .\n`,
  );
  await writeFile(
    join(project, "designs-two.ttl"),
    `<urn:design-two> a <${designPrefix}VisualDesignModel>; <${designPrefix}rule> <urn:rule-two> .\n<urn:rule-two> a <${designPrefix}NodeVisualRule>; <${designPrefix}targetConcept> <urn:Person>; <${designPrefix}fillColor> "#334455" .\n`,
  );
  const list = await runCli(originalPackageRoot, ["design", "list"], project, 0);
  expectStatus(list, "ok");
  check(
    list.envelope.data.items.some((item) => item.selector === "designs-one.ttl") &&
      list.envelope.data.items.some((item) => item.selector === "designs-two.ttl"),
    "TIED_DESIGNS_DISCOVERED",
  );
  const sourceBeforeViews = Buffer.from(viewSource);
  await withWeb(project, async (api) => {
    await stageSourceText(api, "source.ttl", viewSource);
    const conflicted = await api.call("editor?selector=source.ttl");
    expectHttp(conflicted.status, conflicted.envelope, 200, "design-tie-editor");
    check(
      conflicted.envelope.diagnostics.some((item) => item.code === "DESIGN_CONFLICT"),
      "DESIGN_TIE_DIAGNOSTIC",
    );
    const choice = await runCli(
      originalPackageRoot,
      ["design", "select", "urn:Person", "designs-one.ttl"],
      project,
      0,
    );
    expectStatus(choice, "ok");
    const selected = await api.call("editor?selector=source.ttl");
    expectHttp(selected.status, selected.envelope, 200, "selected-design-editor");
    check(
      selected.envelope.data.designResolution?.effectivePresentation?.nodes?.["urn:a"]?.appearance
        ?.fillColor?.value === "#112233",
      "EXPLICIT_DESIGN_SELECTION_RENDER_INPUT",
    );

    await api.apply("views/create", { path: "views/one.ttl", source: "source.ttl" });
    await api.apply("views/create", { path: "views/two.ttl", source: "source.ttl" });
    const one = (await api.call("view?selector=views/one.ttl")).envelope.data;
    const oneEdit = await api.apply("view/edit", {
      selector: "views/one.ttl",
      sourceRevision: one.sourceRevision,
      viewRevision: one.resource.revision,
      presentationRevision: one.presentation.resource.revision,
      members: ["urn:a"],
      relationships: [{ subject: "urn:a", predicate: "urn:p", object: "urn:b" }],
      positions: [
        { element: "urn:a", x: "-1.5", y: "2.25" },
        { element: "urn:b", x: "8", y: "9" },
      ],
    });
    check(oneEdit.applied.status === "ok", "FIRST_VIEW_APPLIED");
    const two = (await api.call("view?selector=views/two.ttl")).envelope.data;
    const twoEdit = await api.apply("view/edit", {
      selector: "views/two.ttl",
      sourceRevision: two.sourceRevision,
      viewRevision: two.resource.revision,
      presentationRevision: two.presentation.resource.revision,
      members: ["urn:b", "urn:c"],
      relationships: [{ subject: "urn:b", predicate: "urn:q", object: "urn:c" }],
      positions: [
        { element: "urn:b", x: "7.5", y: "-8.25" },
        { element: "urn:c", x: "11", y: "4" },
      ],
    });
    check(twoEdit.applied.status === "ok", "SECOND_VIEW_APPLIED");
    const oneAfter = (await api.call("view?selector=views/one.ttl")).envelope.data;
    const twoAfter = (await api.call("view?selector=views/two.ttl")).envelope.data;
    check(
      oneAfter.members.includes("urn:a") &&
        oneAfter.members.includes("urn:b") &&
        !oneAfter.members.includes("urn:c"),
      "FIRST_VIEW_MEMBERSHIP",
    );
    check(
      twoAfter.members.includes("urn:b") &&
        twoAfter.members.includes("urn:c") &&
        !twoAfter.members.includes("urn:a"),
      "SECOND_VIEW_MEMBERSHIP",
    );
    check(
      oneAfter.relationships.some(
        (edge) => edge.subject === "urn:a" && edge.predicate === "urn:p" && edge.object === "urn:b",
      ),
      "FIRST_VIEW_EXACT_EDGE",
    );
    check(
      twoAfter.relationships.some(
        (edge) => edge.subject === "urn:b" && edge.predicate === "urn:q" && edge.object === "urn:c",
      ),
      "SECOND_VIEW_EXACT_EDGE",
    );
    const positionValues = (view) =>
      view.presentation.triples
        .filter((triple) =>
          ["https://talby.ai/ontology/tbspec#x", "https://talby.ai/ontology/tbspec#y"].includes(
            triple.predicate.value,
          ),
        )
        .map((triple) => triple.object.value);
    check(
      positionValues(oneAfter).includes("-1.5") && positionValues(oneAfter).includes("2.25"),
      "FIRST_VIEW_FRACTIONAL_POSITIONS",
    );
    check(
      positionValues(twoAfter).includes("7.5") && positionValues(twoAfter).includes("-8.25"),
      "SECOND_VIEW_INDEPENDENT_POSITIONS",
    );
    check(
      (await readFile(sourcePath)).equals(sourceBeforeViews),
      "VIEW_EDITS_PRESERVE_SOURCE_BYTES",
    );
  });
  return {
    assertions: [
      "design tie surfaced",
      "explicit design choice",
      "independent memberships",
      "exact edges and positions",
      "source graph unchanged",
    ],
  };
}

async function verifyScenarioFive() {
  const project = await newProject("scenario-5", "urn:installed:scenario-5:/");
  const left = join(tempRoot, "sources", "left");
  const right = join(tempRoot, "sources", "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  const sharedIri = "https://example.test/ontology/shared-transitive";
  for (const [directory, id, rootIri, marker] of [
    [left, "left", "https://example.test/ontology/left", "left"],
    [right, "right", "https://example.test/ontology/right", "right"],
  ]) {
    await writeFile(
      join(directory, "root.ttl"),
      `<${rootIri}> a <http://www.w3.org/2002/07/owl#Ontology>; <http://www.w3.org/2002/07/owl#imports> <${sharedIri}> .\n`,
    );
    await writeFile(
      join(directory, "shared.ttl"),
      `<${sharedIri}> a <http://www.w3.org/2002/07/owl#Ontology>; <urn:marker> "${marker}" .\n`,
    );
    const preview = await runCli(
      originalPackageRoot,
      [
        "dependency",
        "add",
        id,
        "--source",
        directory,
        "--kind",
        "ontology",
        "--resource",
        "root.ttl",
      ],
      project,
      3,
    );
    expectStatus(preview, "conflict");
    const add = await runCli(
      originalPackageRoot,
      [
        "dependency",
        "add",
        id,
        "--source",
        directory,
        "--kind",
        "ontology",
        "--resource",
        "root.ttl",
        "--accepted-preview",
        preview.envelope.data.preview.fingerprint,
      ],
      project,
      0,
    );
    expectStatus(add, "ok");
  }
  await writeFile(join(project, "ask.rq"), `ASK { <${sharedIri}> <urn:marker> "left" }\n`);
  const conflicted = await runCli(
    originalPackageRoot,
    ["query", "run", "--file", "ask.rq"],
    project,
    3,
  );
  expectStatus(conflicted, "conflict", 3);
  expectDiagnostic(conflicted, "ONTOLOGY_CONFLICT");
  const nearer = join(tempRoot, "sources", "nearer");
  await mkdir(nearer, { recursive: true });
  await writeFile(
    join(nearer, "shared.ttl"),
    `<${sharedIri}> a <http://www.w3.org/2002/07/owl#Ontology>; <urn:marker> "nearer" .\n`,
  );
  const nearerPreview = await runCli(
    originalPackageRoot,
    [
      "dependency",
      "add",
      "nearer",
      "--source",
      nearer,
      "--kind",
      "ontology",
      "--resource",
      "shared.ttl",
    ],
    project,
    3,
  );
  expectStatus(nearerPreview, "conflict");
  const nearerAdded = await runCli(
    originalPackageRoot,
    [
      "dependency",
      "add",
      "nearer",
      "--source",
      nearer,
      "--kind",
      "ontology",
      "--resource",
      "shared.ttl",
      "--accepted-preview",
      nearerPreview.envelope.data.preview.fingerprint,
    ],
    project,
    0,
  );
  expectStatus(nearerAdded, "ok");
  await writeFile(join(project, "ask-nearer.rq"), `ASK { <${sharedIri}> <urn:marker> "nearer" }\n`);
  const nearerGraph = await runCli(
    originalPackageRoot,
    ["query", "run", "--file", "ask-nearer.rq"],
    project,
    0,
  );
  expectStatus(nearerGraph, "ok");
  check(
    nearerGraph.envelope.data?.type === "ask" && nearerGraph.envelope.data.value === true,
    "NEARER_ONTOLOGY_CANDIDATE_BECOMES_EFFECTIVE",
  );
  const candidateList = await runCli(originalPackageRoot, ["dependency", "list"], project, 0);
  expectStatus(candidateList, "ok");
  const nearerRecord = candidateList.envelope.data.items.find((item) => item.id === "nearer");
  check(
    nearerRecord?.ontologies.some(
      (item) =>
        item.graphIri === sharedIri &&
        item.selector === "dep:nearer/source/shared.ttl" &&
        item.effective === true &&
        item.choice === null,
    ) === true,
    "NEARER_CANDIDATE_WINS_BY_DISTANCE_WITHOUT_CHOICE",
  );
  const nearerRemovalPreview = await runCli(
    originalPackageRoot,
    ["dependency", "remove", "nearer"],
    project,
    0,
  );
  expectStatus(nearerRemovalPreview, "preview", 0);
  const nearerRemoved = await runCli(
    originalPackageRoot,
    [
      "dependency",
      "remove",
      "nearer",
      "--confirm",
      "--accepted-preview",
      nearerRemovalPreview.envelope.data.preview.fingerprint,
    ],
    project,
    0,
  );
  expectStatus(nearerRemoved, "ok");
  const restoredTie = await runCli(
    originalPackageRoot,
    ["query", "run", "--file", "ask.rq"],
    project,
    3,
  );
  expectStatus(restoredTie, "conflict", 3);
  expectDiagnostic(restoredTie, "ONTOLOGY_CONFLICT");
  const retainedCandidates = await runCli(originalPackageRoot, ["dependency", "list"], project, 0);
  expectStatus(retainedCandidates, "ok");
  check(
    retainedCandidates.envelope.data.items.some(
      (item) =>
        item.id === "left" &&
        item.files.some((file) => file.selector === "dep:left/source/shared.ttl"),
    ) &&
      retainedCandidates.envelope.data.items.some(
        (item) =>
          item.id === "right" &&
          item.files.some((file) => file.selector === "dep:right/source/shared.ttl"),
      ),
    "NEARER_CANDIDATE_REMOVAL_RETAINS_NESTED_SNAPSHOTS",
  );
  const selected = await runCli(
    originalPackageRoot,
    ["dependency", "select", sharedIri, "left"],
    project,
    0,
  );
  expectStatus(selected, "ok");
  const defaultGraph = await runCli(
    originalPackageRoot,
    ["query", "run", "--file", "ask.rq"],
    project,
    0,
  );
  expectStatus(defaultGraph, "ok");
  check(
    defaultGraph.envelope.data?.type === "ask" && defaultGraph.envelope.data.value === true,
    "SELECTED_TRANSITIVE_ONTOLOGY_DEFAULT",
  );
  const rightGraph = await runCli(
    originalPackageRoot,
    ["query", "run", "--file", "ask.rq", "--graph", "dep:right/source/shared.ttl"],
    project,
    0,
  );
  expectStatus(rightGraph, "ok");
  check(
    rightGraph.envelope.data?.type === "ask" && rightGraph.envelope.data.value === false,
    "LOSING_TRANSITIVE_SNAPSHOT_RETAINED",
  );
  const rightGraphShow = await runCli(
    originalPackageRoot,
    ["graph", "show", "dep:right/source/shared.ttl"],
    project,
    0,
  );
  expectStatus(rightGraphShow, "ok");
  check(
    rightGraphShow.envelope.data?.triples?.some(
      (triple) => triple.predicate.value === "urn:marker" && triple.object.value === "right",
    ),
    "EXPLICIT_LOSER_GRAPH_READABLE",
  );
  return {
    assertions: [
      "two transitive candidates conflict",
      "nearer direct candidate temporarily becomes effective",
      "reviewed removal restores transitive tie and snapshots",
      "explicit winner selection",
      "default query uses winner",
      "loser snapshot remains readable",
    ],
  };
}

async function verifyScenarioSix() {
  const project = await newProject("scenario-6", "urn:installed:scenario-6:/");
  const schemaIri = "urn:installed:scenario-6:/schema";
  await runCli(
    originalPackageRoot,
    [
      "model",
      "create",
      "schema.ttl",
      "--type",
      "data",
      "--profile",
      "conceptual",
      "--iri",
      schemaIri,
    ],
    project,
    0,
  );
  await runCli(
    originalPackageRoot,
    [
      "model",
      "create",
      "data.ttl",
      "--type",
      "data",
      "--profile",
      "concrete",
      "--schema",
      "schema.ttl",
      "--iri",
      "urn:installed:scenario-6:/data",
    ],
    project,
    0,
  );
  await runCli(originalPackageRoot, ["shapes", "create", "schema.ttl"], project, 0);
  const dataPath = join(project, "data.ttl");
  const dataBytes = await readFile(dataPath);
  const removal = await runCli(originalPackageRoot, ["model", "remove", "schema.ttl"], project, 0);
  expectStatus(removal, "preview", 0);
  check(removal.envelope.status === "preview", "BREAKING_SCHEMA_REMOVAL_PREVIEW");
  const removed = await runCli(
    originalPackageRoot,
    [
      "model",
      "remove",
      "schema.ttl",
      "--confirm",
      "--accepted-preview",
      removal.envelope.data.preview.fingerprint,
    ],
    project,
    0,
  );
  expectStatus(removed, "ok");
  check(
    !(await readFile(join(project, "schema.ttl"))
      .then(() => true)
      .catch(() => false)),
    "SCHEMA_FILE_REMOVED",
  );
  check((await readFile(dataPath)).equals(dataBytes), "DEPENDENT_DATA_BYTES_PRESERVED");
  const invalidAfterRemoval = await runCli(originalPackageRoot, ["status"], project, 1);
  expectStatus(invalidAfterRemoval, "invalid", 1);
  expectDiagnostic(invalidAfterRemoval, "ASSOCIATION_BROKEN");

  const externalTarget = "urn:installed:scenario-6:/individual";
  await writeFile(join(project, "ordinary.ttl"), `<${externalTarget}> <urn:p> "value" .\n`);
  const externalBytes = Buffer.from(`<urn:external> <urn:refersTo> <${externalTarget}> .\n`);
  await writeFile(join(project, "external.ttl"), externalBytes);
  await withWeb(project, async (api) => {
    const repair = await api.call("repair/references/remove", {
      targetIri: schemaIri,
      files: ["data.ttl"],
    });
    check(repair.envelope.status === "preview", "REFERENCE_REPAIR_PREVIEW");
    const preview = repair.envelope.data.preview;
    const applied = await api.call("repair/apply", {
      schemaVersion: 1,
      handle: repair.envelope.data.handle,
      fingerprint: preview.fingerprint,
      accept: preview.impact?.acceptance ?? [],
    });
    expectHttp(applied.status, applied.envelope, 200, "repair-broken-schema-association");
    check(applied.envelope.status === "ok", "SCHEMA_ASSOCIATION_REPAIRED");
    check(
      (await api.call(`references?target=${encodeURIComponent(schemaIri)}`)).envelope.data.items
        .length === 0,
      "BROKEN_REFERENCE_REMOVED",
    );
    const editor = await api.call("editor?selector=ordinary.ttl");
    expectHttp(editor.status, editor.envelope, 200, "ordinary-individual-editor");
    const deletion = await api.call("editor/delete", {
      selector: "ordinary.ttl",
      revision: editor.envelope.data.resource.revision,
      element: { kind: "iri", value: externalTarget },
    });
    check(deletion.envelope.status === "preview", "ORDINARY_INDIVIDUAL_DELETE_PREVIEW");
    check(
      deletion.envelope.data.preview.impact.acceptance.includes("confirm"),
      "ORDINARY_DELETE_CONFIRMATION",
    );
    const deleteApply = await api.call("resource/apply", {
      schemaVersion: 1,
      handle: deletion.envelope.data.handle,
      fingerprint: deletion.envelope.data.preview.fingerprint,
      accept: ["confirm"],
    });
    expectHttp(deleteApply.status, deleteApply.envelope, 200, "ordinary-individual-delete");
    check(deleteApply.envelope.status === "ok", "ORDINARY_INDIVIDUAL_REMOVED");
    check(
      (await readFile(join(project, "external.ttl"))).equals(externalBytes),
      "EXTERNAL_ORDINARY_REFERENCE_PRESERVED",
    );
    const dangling = await api.call("references?dangling=true");
    check(
      !dangling.envelope.data.items.some((item) => item.targetIri === externalTarget),
      "ORDINARY_REFERENCE_NOT_MANAGED_DANGLING",
    );
    const gc = await api.call("repair/gc");
    check(
      gc.envelope.data.candidates.some((item) => item.file === "schema.shacl.ttl"),
      "ORPHANED_SHAPES_GC_CANDIDATE",
    );
    const selectedGc = await api.call("repair/gc", { resources: ["schema.shacl.ttl"] });
    check(selectedGc.envelope.status === "preview", "GC_REVIEW_PREVIEW");
    const collected = await api.call("repair/apply", {
      schemaVersion: 1,
      handle: selectedGc.envelope.data.handle,
      fingerprint: selectedGc.envelope.data.preview.fingerprint,
      accept: selectedGc.envelope.data.preview.impact?.acceptance ?? [],
    });
    expectHttp(collected.status, collected.envelope, 200, "orphaned-shapes-gc");
    check(collected.envelope.status === "ok", "ORPHANED_SHAPES_COLLECTED");
  });
  check(
    !(await readFile(join(project, "schema.shacl.ttl"))
      .then(() => true)
      .catch(() => false)),
    "GC_FILE_REMOVED",
  );
  return {
    assertions: [
      "schema removal impact",
      "broken association repair",
      "ordinary element deletion",
      "external reference preserved",
      "selected support GC",
    ],
  };
}

async function verifyScenarioSeven() {
  const project = await newProject("scenario-7", "urn:installed:scenario-7:/");
  await writeFile(
    join(project, "selected.ttl"),
    "<urn:selected> a <http://www.w3.org/2002/07/owl#Ontology>; <urn:p> <urn:o> .\n",
  );
  await writeFile(join(project, "broken.ttl"), "<urn:broken> <urn:p> <urn:o> .\n");
  await writeFile(join(project, "whole.rq"), "ASK { ?subject ?predicate ?object }\n");
  await writeFile(
    join(project, "selected.rq"),
    "ASK { GRAPH <urn:selected> { <urn:selected> <urn:p> <urn:o> } }\n",
  );
  await withWeb(project, async (api) => {
    const shown = await api.call("editor?selector=broken.ttl");
    expectHttp(shown.status, shown.envelope, 200, "valid-graph-before-malformed-edit");
    const saved = await api.apply("editor/save", {
      selector: "broken.ttl",
      revision: shown.envelope.data.resource.revision,
      sourceText: "broken Turtle [",
    });
    check(saved.applied.status === "ok", "MALFORMED_TEXT_SAVE_STAGED_AND_APPLIED");
    const malformed = await api.call("editor?selector=broken.ttl");
    expectHttp(malformed.status, malformed.envelope, 200, "malformed-graph-editor");
    check(malformed.envelope.data.parseable === false, "MALFORMED_GRAPH_STILL_EDITABLE");
    check(malformed.envelope.data.sourceText === "broken Turtle [", "MALFORMED_SOURCE_RETAINED");
    check(
      malformed.envelope.diagnostics.some((item) => item.code === "RDF_SYNTAX"),
      "MALFORMED_GRAPH_DIAGNOSTIC",
    );
    const refusedEdit = await api.call("editor/save", {
      selector: "broken.ttl",
      revision: malformed.envelope.data.resource.revision,
      edits: [{ action: "add", after: shown.envelope.data.triples[0] }],
    });
    expectHttp(
      refusedEdit.status,
      refusedEdit.envelope,
      422,
      "malformed-graph-generic-edit-refusal",
    );
    check(refusedEdit.envelope.status === "invalid", "MALFORMED_GRAPH_GENERIC_EDIT_STATUS");
    check(
      refusedEdit.envelope.diagnostics.some((item) => item.code === "RDF_SYNTAX"),
      "MALFORMED_GRAPH_GENERIC_EDIT_DIAGNOSTIC",
    );
    check(
      (await readFile(join(project, "broken.ttl"))).equals(Buffer.from("broken Turtle [")),
      "MALFORMED_GRAPH_GENERIC_EDIT_PRESERVES_SOURCE_BYTES",
    );
  });
  const whole = await runCli(
    originalPackageRoot,
    ["query", "run", "--file", "whole.rq"],
    project,
    1,
  );
  expectStatus(whole, "invalid", 1);
  expectDiagnostic(whole, "RDF_SYNTAX");
  check(
    whole.envelope.diagnostics.some((item) => item.file === "broken.ttl"),
    "WHOLE_PROJECT_ERROR_IDENTIFIES_FILE",
  );
  const validation = await runCli(originalPackageRoot, ["validate"], project, 1);
  expectStatus(validation, "invalid", 1);
  const syntaxDiagnostic = validation.envelope.diagnostics.find(
    (item) => item.code === "RDF_SYNTAX" && item.file === "broken.ttl",
  );
  check(syntaxDiagnostic?.severity === "error", "VALIDATE_SYNTAX_DIAGNOSTIC_SEVERITY");
  check(
    (typeof syntaxDiagnostic?.line === "number" && syntaxDiagnostic.line > 0) ||
      (typeof syntaxDiagnostic?.column === "number" && syntaxDiagnostic.column > 0),
    "VALIDATE_SYNTAX_DIAGNOSTIC_AVAILABLE_LOCATION",
  );
  const isolated = await runCli(
    originalPackageRoot,
    ["query", "run", "--file", "selected.rq", "--graph", "selected.ttl"],
    project,
    0,
  );
  expectStatus(isolated, "ok");
  check(
    isolated.envelope.data?.type === "ask" && isolated.envelope.data.value === true,
    "ISOLATED_QUERY_SUCCEEDS",
  );
  return {
    assertions: [
      "public malformed-source save",
      "partial editor diagnostics",
      "malformed generic graph edit refused with bytes retained",
      "whole query fails with file",
      "validate reports file, code, severity and available location",
      "selected graph query passes",
    ],
  };
}

async function verifyVersionAndRuntime(archivePath) {
  const project = await newProject("runtime-compatibility", "urn:installed:runtime:/");
  const description = await runCli(
    originalPackageRoot,
    [
      "model",
      "create",
      "owned-description.ttl",
      "--type",
      "data",
      "--profile",
      "conceptual",
      "--iri",
      "urn:installed:runtime:/description",
    ],
    project,
    0,
  );
  expectStatus(description, "ok");
  check(
    (await readFile(join(project, "owned-description.ttl"))).byteLength > 0,
    "OWNED_RDF_DESCRIPTION_CREATED",
  );
  activeWebProjects.add(project);
  const start = await runCli(originalPackageRoot, ["web", "--project", project], project, 0);
  expectStatus(start, "ok");
  const originalServer = start.envelope.data.server;
  check(
    originalServer.applicationVersion === evidence.artifact.applicationVersion,
    "RUNNING_SERVER_ACTUAL_VERSION",
  );
  check(processIsAlive(originalServer.pid), "ORIGINAL_SERVER_PROCESS_LIVE");
  const releaseInventory = JSON.parse(
    await readFile(join(originalPackageRoot, "dist", "release-inventory.json"), "utf8"),
  );
  await verifyServedBrowserAssets(originalServer.baseUrl, releaseInventory);
  const projectBytesBeforeProbe = await captureProjectBytes(project, [".tbspec/runtime"]);

  const probeRoot = await installArtifact(archivePath, "version-probe");
  const probeManifestPath = join(probeRoot, "package.json");
  const originalManifestBytes = await readFile(probeManifestPath);
  const probeManifest = JSON.parse(originalManifestBytes.toString("utf8"));
  probeManifest.version = "99.0.0-installed-probe";
  await writeFile(probeManifestPath, `${JSON.stringify(probeManifest, null, 2)}\n`, "utf8");
  const probeVersion = await runCli(probeRoot, ["--version"], project, 0);
  expectStatus(probeVersion, "ok");
  check(
    probeVersion.envelope.data.applicationVersion === probeManifest.version,
    "PROBE_VERSION_READ_FROM_INSTALLED_PACKAGE",
  );
  const compatible = await runCli(probeRoot, ["web", "--project", project], project, 0);
  expectStatus(compatible, "ok");
  check(
    compatible.envelope.data.server.applicationVersion === evidence.artifact.applicationVersion,
    "COMPATIBLE_PROBE_REPORTS_RUNNING_RELEASE",
  );
  check(
    compatible.envelope.data.server.instanceId === originalServer.instanceId,
    "COMPATIBLE_PROBE_RECONNECTS_SAME_INSTANCE",
  );
  check(
    compatible.envelope.data.server.pid === originalServer.pid,
    "COMPATIBLE_PROBE_DOES_NOT_RESTART_SERVER",
  );
  await verifyServedBrowserAssets(originalServer.baseUrl, releaseInventory);
  const serverStatus = await runCli(probeRoot, ["web", "status", "--project", project], project, 0);
  expectStatus(serverStatus, "ok");
  check(
    serverStatus.envelope.data.server.applicationVersion === evidence.artifact.applicationVersion,
    "STATUS_ACTUAL_VERSION",
  );
  check(
    serverStatus.envelope.data.server.instanceId === originalServer.instanceId &&
      serverStatus.envelope.data.server.pid === originalServer.pid,
    "STATUS_REPORTS_ORIGINAL_LIVE_INSTANCE",
  );
  assertProjectBytes(
    projectBytesBeforeProbe,
    await captureProjectBytes(project, [".tbspec/runtime"]),
    "METADATA_VERSION_PROBE_PRESERVES_MANIFEST_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );

  const runtimePath = join(project, ".tbspec", "runtime", "web.json");
  const runtimeBefore = await readFile(runtimePath);
  const runtime = JSON.parse(runtimeBefore.toString("utf8"));
  runtime.controlProtocolVersion = 2;
  const protocolProbeBytes = Buffer.from(`${JSON.stringify(runtime, null, 2)}\n`);
  let protocolProbeWritten = false;
  let protocolRecordOwnershipChanged = false;
  try {
    await writeFile(runtimePath, protocolProbeBytes);
    protocolProbeWritten = true;
    const refused = await runCli(probeRoot, ["web", "status", "--project", project], project, 3);
    expectStatus(refused, "conflict");
    expectDiagnostic(refused, "RUNTIME_PROTOCOL_UNSUPPORTED");
    const refusedRecordBytes = await readFile(runtimePath);
    check(
      refusedRecordBytes.equals(protocolProbeBytes),
      "INCOMPATIBLE_PROTOCOL_REFUSAL_PRESERVES_RECORD_BYTES",
    );
    const refusedRecord = JSON.parse(refusedRecordBytes.toString("utf8"));
    check(
      refusedRecord.instanceId === originalServer.instanceId &&
        refusedRecord.pid === originalServer.pid,
      "INCOMPATIBLE_PROTOCOL_REFUSAL_PRESERVES_OWNER_IDENTITY",
    );
    check(
      processIsAlive(originalServer.pid),
      "INCOMPATIBLE_PROTOCOL_REFUSAL_LEAVES_OWNER_PROCESS_LIVE",
    );
  } finally {
    if (protocolProbeWritten) {
      const currentRecordBytes = await readFile(runtimePath).catch(() => null);
      let currentRecord;
      try {
        currentRecord = currentRecordBytes ? JSON.parse(currentRecordBytes.toString("utf8")) : null;
      } catch {
        currentRecord = null;
      }
      const stillOwnsLiveRecord =
        currentRecord?.instanceId === originalServer.instanceId &&
        currentRecord?.pid === originalServer.pid &&
        processIsAlive(originalServer.pid);
      if (currentRecordBytes?.equals(protocolProbeBytes) && stillOwnsLiveRecord) {
        await writeFile(runtimePath, runtimeBefore);
        check(
          (await readFile(runtimePath)).equals(runtimeBefore),
          "INCOMPATIBLE_PROTOCOL_PROBE_RESTORED_RECORD_BYTES",
        );
      } else {
        evidence.cleanup.push({
          project: pathForEvidence(project),
          state: "runtime-probe-bytes-changed; retained for ownership review",
        });
        await saveEvidence();
        protocolRecordOwnershipChanged = true;
      }
    }
  }
  if (protocolRecordOwnershipChanged)
    throw new VerificationFailure("RUNTIME_PROBE_RECORD_OWNERSHIP_CHANGED");
  assertProjectBytes(
    projectBytesBeforeProbe,
    await captureProjectBytes(project, [".tbspec/runtime"]),
    "INCOMPATIBLE_PROTOCOL_PROBE_PRESERVES_MANIFEST_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );
  const stop = await runCli(originalPackageRoot, ["web", "stop", "--project", project], project, 0);
  expectStatus(stop, "ok");
  check(stop.envelope.data.server.state === "stopped", "COMPATIBLE_RELEASE_STOPS_OWNED_SERVER");
  activeWebProjects.delete(project);
  evidence.cleanup.push({ project: pathForEvidence(project), state: "stopped-and-verified" });
  assertProjectBytes(
    projectBytesBeforeProbe,
    await captureProjectBytes(project, [".tbspec/runtime"]),
    "ORIGINAL_RELEASE_STOP_PRESERVES_MANIFEST_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );
  activeWebProjects.add(project);
  const replacement = await runCli(probeRoot, ["web", "--project", project], project, 0);
  expectStatus(replacement, "ok");
  check(
    replacement.envelope.data.server.applicationVersion === probeManifest.version,
    "METADATA_PROBE_REPLACEMENT_REPORTS_INSTALLED_VERSION",
  );
  check(
    replacement.envelope.data.server.instanceId !== originalServer.instanceId,
    "METADATA_PROBE_REPLACEMENT_STARTS_NEW_INSTANCE",
  );
  check(
    processIsAlive(replacement.envelope.data.server.pid),
    "METADATA_PROBE_REPLACEMENT_PROCESS_LIVE",
  );
  await verifyServedBrowserAssets(replacement.envelope.data.server.baseUrl, releaseInventory);
  assertProjectBytes(
    projectBytesBeforeProbe,
    await captureProjectBytes(project, [".tbspec/runtime"]),
    "METADATA_PROBE_REPLACEMENT_PRESERVES_MANIFEST_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );
  const replacementStatus = await runCli(
    probeRoot,
    ["web", "status", "--project", project],
    project,
    0,
  );
  expectStatus(replacementStatus, "ok");
  check(
    replacementStatus.envelope.data.server.applicationVersion === probeManifest.version,
    "REPLACEMENT_RECORD_REPORTS_INSTALLED_VERSION",
  );
  const replacementStop = await runCli(
    probeRoot,
    ["web", "stop", "--project", project],
    project,
    0,
  );
  expectStatus(replacementStop, "ok");
  check(
    replacementStop.envelope.data.server.state === "stopped",
    "METADATA_PROBE_RELEASE_STOPS_REPLACEMENT_SERVER",
  );
  activeWebProjects.delete(project);
  evidence.cleanup.push({
    project: pathForEvidence(project),
    state: "metadata-probe-replacement-stopped-and-verified",
  });
  assertProjectBytes(
    projectBytesBeforeProbe,
    await captureProjectBytes(project, [".tbspec/runtime"]),
    "METADATA_PROBE_STOP_PRESERVES_MANIFEST_LOCK_SNAPSHOTS_AND_OWNED_GRAPHS",
  );
  return {
    derivativeMetadataProbe: {
      version: probeManifest.version,
      change: "installed package.json version only",
      originalArchiveSha256: evidence.artifact.sha256,
    },
    compatible: true,
    samePidAndInstance: true,
    refusedIncompatibleProtocolPreservedRecordAndOwner: true,
    replacementServerReportedProbeVersion: true,
    servedBrowserAssetsMatchOriginalRelease: releaseInventory.browserAssets.files.length,
    assertions: [
      "installed package version",
      "compatible reconnection reports running server version",
      "incompatible protocol refused",
      "old server normal stop",
      "metadata probe replacement start and normal stop",
    ],
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function main() {
  currentStep = "artifact-identity";
  const suppliedArtifact = resolve(process.argv[2] ?? "..");
  const artifactInfo = await stat(suppliedArtifact);
  const entries = artifactInfo.isDirectory()
    ? await readdir(suppliedArtifact)
    : [basename(suppliedArtifact)];
  const archives = entries.filter((name) => name.endsWith(".tgz"));
  check(archives.length === 1, "ONE_PACKED_ARTIFACT_REQUIRED");
  const archivePath = artifactInfo.isDirectory()
    ? join(suppliedArtifact, archives[0])
    : suppliedArtifact;
  const archiveBytes = await readFile(archivePath);
  const archiveDigest = sha256(archiveBytes);
  const sidecarPath = `${archivePath}.sha256`;
  const sidecar = (await readFile(sidecarPath, "utf8")).trim();
  const sidecarMatch = /^([a-f0-9]{64})\s+(.+)$/.exec(sidecar);
  check(
    sidecarMatch?.[1] === archiveDigest && sidecarMatch[2] === basename(archivePath),
    "ARTIFACT_SHA256_SIDECAR",
  );
  evidence.artifact = {
    filename: basename(archivePath),
    bytes: archiveBytes.byteLength,
    sha256: archiveDigest,
    applicationVersion: null,
  };
  await saveEvidence();

  taskRoot = await privateDirectory(join(await realpath(tmpdir()), "tbspec-packed-verification-"));
  tempRoot = taskRoot;
  taskRoot = await realpath(taskRoot);
  tempRoot = taskRoot;
  await mkdir(tempRoot, { recursive: true });
  if (process.platform === "win32")
    evidence.assertions.push({
      name: "verifier-owned-windows-fixture-directory-private",
      passed: true,
    });
  restrictedPath = join(tempRoot, "empty-path");
  await mkdir(restrictedPath);
  offlineGuardPath = join(tempRoot, "offline-loopback-guard.mjs");
  await writeFile(
    offlineGuardPath,
    `
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
const allowed = (host) => ["127.0.0.1", "::1", "localhost"].includes(String(host ?? "").replace(/^\\[|\\]$/g, "").toLowerCase());
const denied = () => { throw new Error("Installed verifier blocks non-loopback network access."); };
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  let url;
  try { url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url); } catch { return denied(); }
  if (!["http:", "https:"].includes(url.protocol) || !allowed(url.hostname)) return denied();
  return originalFetch(input, init);
};
const localIpc = (args) => {
  const first = args[0];
  return (typeof first === "string" && args.length === 1) ||
    (first && typeof first === "object" && typeof first.path === "string" && !first.host && !first.hostname);
};
function hostOf(args) {
  const first = args[0];
  if (first instanceof URL) return first.hostname;
  if (typeof first === "string" && /^https?:\\/\\//i.test(first)) { try { return new URL(first).hostname; } catch { return ""; } }
  if (first && typeof first === "object") return first.hostname ?? first.host ?? "localhost";
  if (typeof first === "number") return typeof args[1] === "string" ? args[1] : "localhost";
  return "localhost";
}
for (const module of [http, https]) {
  const originalRequest = module.request.bind(module);
  module.request = (...args) => { if (!allowed(hostOf(args))) return denied(); return originalRequest(...args); };
  const originalGet = module.get.bind(module);
  module.get = (...args) => { if (!allowed(hostOf(args))) return denied(); return originalGet(...args); };
}
for (const name of ["connect", "createConnection"]) {
  const original = net[name].bind(net);
  net[name] = (...args) => { if (!localIpc(args) && !allowed(hostOf(args))) return denied(); return original(...args); };
}
const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  if (!localIpc(args) && !allowed(hostOf(args))) return denied();
  return originalSocketConnect.apply(this, args);
};
syncBuiltinESMExports();
`,
  );

  const guardCheckProgram = String.raw`
import http from "node:http";
import net from "node:net";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fetchDenied = false;
try { await fetch("http://203.0.113.1/"); } catch { fetchDenied = true; }
let socketDenied = false;
try { new net.Socket().connect({ host: "203.0.113.1", port: 80 }); } catch { socketDenied = true; }

const webServer = http.createServer((_request, response) => response.end("ok"));
await new Promise((resolve, reject) => {
  webServer.once("error", reject);
  webServer.listen(0, "127.0.0.1", resolve);
});
const webAddress = webServer.address();
let loopbackFetchWorks = false;
let loopbackSocketWorks = false;
try {
  const response = await fetch("http://127.0.0.1:" + webAddress.port + "/");
  loopbackFetchWorks = response.status === 200 && (await response.text()) === "ok";
  loopbackSocketWorks = await new Promise((resolve) => {
    const socket = new net.Socket();
    socket.once("connect", () => { socket.end(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.connect(webAddress.port, "127.0.0.1");
  });
} finally {
  await new Promise((resolve) => webServer.close(resolve));
}

const pipe = process.platform === "win32"
  ? "\\\\.\\pipe\\tbspec-offline-guard-" + process.pid
  : join(tmpdir(), "tbspec-offline-guard-" + process.pid + ".sock");
const ipcServer = net.createServer((socket) => socket.end());
await new Promise((resolve, reject) => {
  ipcServer.once("error", reject);
  ipcServer.listen(pipe, resolve);
});
let localIpcWorks = false;
try {
  localIpcWorks = await new Promise((resolve) => {
    const socket = net.createConnection(pipe);
    socket.once("connect", () => { socket.end(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
} finally {
  await new Promise((resolve) => ipcServer.close(resolve));
  if (process.platform !== "win32") await rm(pipe, { force: true });
}

if (!fetchDenied || !socketDenied || !loopbackFetchWorks || !loopbackSocketWorks || !localIpcWorks)
  process.exit(70);
process.stdout.write("guard-self-check-passed\n");
`;
  const guardCheck = runProcess(
    process.execPath,
    ["--input-type=module", "-e", guardCheckProgram],
    { cwd: tempRoot, env: restrictedEnvironment(), timeout: 30000 },
  );
  evidence.networkGuardSelfCheck = {
    exit: guardCheck.status,
    errorCode: guardCheck.error?.code ?? null,
    markerFound: guardCheck.stdout.trim() === "guard-self-check-passed",
    stderrPresent: Boolean(guardCheck.stderr.trim()),
  };
  await saveEvidence();
  check(
    guardCheck.status === 0 && guardCheck.stdout.trim() === "guard-self-check-passed",
    "PROCESS_NETWORK_GUARD_SELF_CHECK",
  );
  evidence.assertions.push({
    name: "process-scoped-node-network-guard",
    passed: true,
    nonLoopbackFetchAndDirectSocketDenied: true,
    loopbackFetchAndDirectSocketAllowed: true,
    localIpcAllowed: true,
  });
  await saveEvidence();

  const npmCli = process.env.TBSPEC_NPM_CLI ?? process.env.npm_execpath;
  const npmVersionResult = npmCli
    ? runProcess(process.execPath, [npmCli, "--version"], {
        cwd: tempRoot,
        env: process.env,
        timeout: 30000,
      })
    : runNpm(["--version"], { cwd: tempRoot });
  check(npmVersionResult.status === 0, "NPM_VERSION_COMMAND");
  evidence.platform.npm = (npmVersionResult.stdout ?? "").trim().split(/\r?\n/).at(-1) ?? "unknown";

  originalPackageRoot = await installArtifact(archivePath, "original-consumer");
  const inventory = JSON.parse(
    await readFile(join(originalPackageRoot, "dist", "release-inventory.json"), "utf8"),
  );
  evidence.artifact.applicationVersion = inventory.application.version;
  await verifyInstalledInventory(originalPackageRoot, inventory);
  const originalManifest = JSON.parse(
    await readFile(join(originalPackageRoot, "package.json"), "utf8"),
  );
  check(
    originalManifest.version === inventory.application.version,
    "ARTIFACT_VERSION_MATCHES_INVENTORY",
  );

  currentStep = "installed-runtime-only-environment";
  for (const tool of ["git", "npm", "tsc", "vite"]) {
    const unavailable = runProcess(tool, ["--version"]);
    check(unavailable.error?.code === "ENOENT", `BUILD_TOOL_VISIBLE_${tool.toUpperCase()}`);
  }
  const nested = join(tempRoot, "command-help");
  await mkdir(nested, { recursive: true });
  await verifyInstalledBin(originalPackageRoot, nested, inventory.application.version);
  await verifyCommandFamilies(nested);

  await runScenario("dynamic-version-and-runtime-compatibility", () =>
    verifyVersionAndRuntime(archivePath),
  );
  await runScenario("project-conceptual-concrete-schema-forms", verifyScenarioOne);
  await runScenario("directory-acquisition-check-update", verifyScenarioTwo);
  await runScenario("accepted-vocabulary-replacement", verifyScenarioThree);
  await runScenario("independent-views-and-design-ties", verifyScenarioFour);
  await runScenario("retained-transitive-ontology-conflict", verifyScenarioFive);
  await runScenario("breaking-removal-repair-ordinary-deletion-gc", verifyScenarioSix);
  await runScenario("malformed-source-isolated-query", verifyScenarioSeven);

  evidence.state = "passed";
  evidence.failure = null;
  await saveEvidence();
}

try {
  await main();
} catch (error) {
  evidence.state = "failed";
  evidence.failure = {
    step: currentStep,
    code: error?.code ?? "VERIFIER_FAILED",
    errorName: error?.name ?? "Error",
  };
  try {
    await saveEvidence();
  } catch {
    // The primary verification failure remains the process exit reason.
  }
  process.exitCode = 1;
} finally {
  let cleanupSafe = true;
  for (const project of [...activeWebProjects]) {
    try {
      check(originalPackageRoot !== undefined, "CLEANUP_RELEASE_UNAVAILABLE");
      const stopped = await runCli(
        originalPackageRoot,
        ["web", "stop", "--project", project],
        project,
        0,
      );
      expectStatus(stopped, "ok");
      check(stopped.envelope.data?.server?.state === "stopped", "CLEANUP_STOP_VERIFIED");
      activeWebProjects.delete(project);
      evidence.cleanup.push({
        project: pathForEvidence(project),
        state: "stopped-and-verified-during-final-cleanup",
      });
    } catch (error) {
      cleanupSafe = false;
      evidence.cleanup.push({
        project: pathForEvidence(project),
        state: "stop-unverified; retained",
        code: error?.code ?? "CLEANUP_FAILED",
      });
    }
  }
  if (tempRoot) {
    let verifiedTempRoot;
    try {
      const candidate = resolve(tempRoot);
      const expected = taskRoot ? resolve(taskRoot) : null;
      const [realCandidate, realTempDirectory] = await Promise.all([
        realpath(candidate),
        realpath(tmpdir()),
      ]);
      verifiedTempRoot =
        expected === candidate &&
        realCandidate === candidate &&
        dirname(candidate) === realTempDirectory &&
        basename(candidate).startsWith("tbspec-packed-verification-");
    } catch {
      verifiedTempRoot = false;
    }
    if (cleanupSafe && activeWebProjects.size === 0 && verifiedTempRoot) {
      const candidate = resolve(tempRoot);
      try {
        await rm(candidate, { recursive: true, force: true });
        evidence.cleanup.push({ state: "verified-owned-temporary-root-removed" });
      } catch (error) {
        cleanupSafe = false;
        evidence.cleanup.push({
          state: "temporary-root-removal-failed; retained if present",
          tempRoot: candidate,
          code: error?.code ?? "CLEANUP_FAILED",
        });
      }
    } else {
      evidence.cleanup.push({
        state: "temporary-root-retained-for-ownership-review",
        tempRoot: resolve(tempRoot),
        activeProjects: [...activeWebProjects].map(pathForEvidence),
        verifiedOwnedPath: Boolean(verifiedTempRoot),
      });
      process.exitCode = 1;
    }
  }
  try {
    await saveEvidence();
  } catch {
    process.exitCode = 1;
  }
}

if (process.exitCode === 1)
  process.stderr.write(
    `Packed application verification failed at ${currentStep}. See the sanitized JSON evidence file.\n`,
  );
else
  process.stdout.write(
    `${JSON.stringify({ status: evidence.state, sha256: evidence.artifact?.sha256, scenarios: evidence.scenarios.length, assertions: evidence.assertions.length, evidenceFile: pathForEvidence(evidencePath) })}\n`,
  );
