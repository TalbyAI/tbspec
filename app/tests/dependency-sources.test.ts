import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest } from "../src/canonical.ts";
import { dependencyAdd, dependencyInspect } from "../src/dependencies.ts";
import { initializeProject } from "../src/project.ts";

const gitAvailable = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;

function git(directory: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: directory,
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
}

test("Git provenance advances while unchanged source graphs keep stable parser signatures", {
  skip: !gitAvailable,
}, async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-git-base-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  await writeFile(
    join(source, "shop.ttl"),
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/shop> a owl:Ontology .\n",
  );
  git(source, ["init", "-b", "main"]);
  git(source, ["add", "shop.ttl"]);
  git(source, [
    "-c",
    "user.name=tbspec",
    "-c",
    "user.email=tbspec@example.invalid",
    "commit",
    "-m",
    "source",
  ]);

  const first = await dependencyInspect({ project, source });
  assert.equal(first.status, "ok", JSON.stringify(first));
  assert.ok(first.data);
  const firstSource = first.data.source as { kind: string; resolvedCommit: string };
  const firstGraph = (first.data.items as { resource: string; graphSignature: string }[]).find(
    (item) => item.resource === "shop.ttl",
  );
  assert.equal(firstSource.kind, "git");
  assert.match(firstSource.resolvedCommit, /^[0-9a-f]{40,64}$/);
  assert.ok(firstGraph?.graphSignature);

  await writeFile(join(source, "unrelated.txt"), "This commit does not change the RDF graph.\n");
  git(source, ["add", "unrelated.txt"]);
  git(source, [
    "-c",
    "user.name=tbspec",
    "-c",
    "user.email=tbspec@example.invalid",
    "commit",
    "-m",
    "unrelated",
  ]);
  const second = await dependencyInspect({ project, source });
  assert.equal(second.status, "ok", JSON.stringify(second));
  assert.ok(second.data);
  const secondSource = second.data.source as { resolvedCommit: string };
  const secondGraph = (second.data.items as { resource: string; graphSignature: string }[]).find(
    (item) => item.resource === "shop.ttl",
  );
  assert.notEqual(secondSource.resolvedCommit, firstSource.resolvedCommit);
  assert.equal(secondGraph?.graphSignature, firstGraph?.graphSignature);
});

test("Git reads raw blobs without running configured hooks or smudge filters and rejects LFS pointers", {
  skip: !gitAvailable,
}, async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-git-raw-tree-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  const hooks = join(parent, "attacker-hooks");
  const hookMarker = join(parent, "hook-ran");
  const filterMarker = join(parent, "filter-ran");
  const globalConfig = join(parent, "gitconfig");
  const filterScript = join(parent, "smudge.cjs");
  const shellPath = (path: string) => {
    const normalized = path.replaceAll("\\", "/");
    return process.platform === "win32"
      ? normalized.replace(/^([A-Za-z]):\//, (_match, drive: string) => `/${drive.toLowerCase()}/`)
      : normalized;
  };
  const shopBytes = Buffer.from(
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/raw-shop> a owl:Ontology .\n",
  );
  await mkdir(source);
  await mkdir(hooks);
  await initializeProject({ directory: project, baseIri: "urn:raw-git:/" });
  await writeFile(join(source, "shop.ttl"), shopBytes);
  await writeFile(
    join(source, "lfs.ttl"),
    "version https://git-lfs.github.com/spec/v1\n" + "oid sha256:" + "a".repeat(64) + "\nsize 42\n",
  );
  await writeFile(join(source, ".gitattributes"), "*.ttl filter=untrusted\n");
  git(source, ["init", "-b", "main"]);
  git(source, ["add", "."]);
  git(source, [
    "-c",
    "user.name=tbspec",
    "-c",
    "user.email=tbspec@example.invalid",
    "commit",
    "-m",
    "raw blobs",
  ]);
  const submoduleCommit = git(source, ["rev-parse", "HEAD"]).trim();
  git(source, [
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${submoduleCommit},vendor/submodule`,
  ]);
  git(source, [
    "-c",
    "user.name=tbspec",
    "-c",
    "user.email=tbspec@example.invalid",
    "commit",
    "-m",
    "submodule gitlink",
  ]);

  await writeFile(
    filterScript,
    `const fs = require("node:fs");\n` +
      `process.stdin.resume();\n` +
      `process.stdin.on("data", () => {});\n` +
      `process.stdin.on("end", () => { fs.writeFileSync(process.argv[2], "ran"); process.stdout.write("@prefix owl: <http://www.w3.org/2002/07/owl#> .\\n<https://example.org/filtered> a owl:Ontology .\\n"); });\n`,
  );
  const hook = join(hooks, "post-checkout");
  await writeFile(hook, `#!/bin/sh\nprintf hook > '${shellPath(hookMarker)}'\n`);
  await chmod(hook, 0o700).catch(() => undefined);
  const hookConfigPath = shellPath(hooks);
  const filterCommand = `node "${shellPath(filterScript)}" "${shellPath(filterMarker)}"`;
  git(source, ["config", "--file", globalConfig, "core.hooksPath", hookConfigPath]);
  git(source, ["config", "--file", globalConfig, "filter.untrusted.smudge", filterCommand]);
  git(source, ["config", "--file", globalConfig, "filter.untrusted.required", "true"]);

  const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    const inspected = await dependencyInspect({ project, source, resource: "shop.ttl" });
    assert.equal(inspected.status, "ok", JSON.stringify(inspected));
    assert.ok(inspected.data);
    const item = (inspected.data.items as { resource: string; byteDigest: string }[]).find(
      (candidate) => candidate.resource === "shop.ttl",
    );
    assert.equal(item?.byteDigest, digest(shopBytes));

    const before = await readFile(join(project, "tbspec.lock"));
    const rejected = await dependencyAdd({
      project,
      source,
      id: "lfs-resource",
      kind: "ontology",
      resource: "lfs.ttl",
    });
    assert.equal(rejected.status, "invalid", JSON.stringify(rejected));
    assert.ok(
      rejected.diagnostics.some((diagnostic) => diagnostic.code === "GIT_FEATURE_UNSUPPORTED"),
    );
    const submodule = await dependencyInspect({ project, source, resource: "vendor/submodule" });
    assert.equal(submodule.status, "invalid", JSON.stringify(submodule));
    assert.ok(
      submodule.diagnostics.some((diagnostic) => diagnostic.code === "GIT_FEATURE_UNSUPPORTED"),
    );
    assert.deepEqual(await readFile(join(project, "tbspec.lock")), before);
    await assert.rejects(readFile(filterMarker), { code: "ENOENT" });
    await assert.rejects(readFile(hookMarker), { code: "ENOENT" });
  } finally {
    if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
  }
});

test("HTTP acquisition preserves unresolved references and rejects signed redirects without persisting a snapshot", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-http-"));
  const project = join(parent, "project");
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/graph.ttl?token=must-not-be-saved" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/turtle; charset=utf-8" });
    response.end(
      "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/shop> a owl:Ontology; owl:imports <https://example.org/not-fetched> .\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const accepted = await dependencyAdd({
      project,
      source: `${base}/graph.ttl`,
      id: "remote-shop",
      kind: "ontology",
    });
    assert.equal(accepted.status, "conflict", JSON.stringify(accepted));
    const dependency = accepted.data?.dependency as {
      edges: { target_iri?: string }[];
      files: { base_iri: string }[];
    };
    assert.ok(
      dependency.edges.some((edge) => edge.target_iri === "https://example.org/not-fetched"),
    );
    assert.equal(dependency.files.length, 1);
    assert.equal(dependency.files[0]?.base_iri, `${base}/graph.ttl`);

    const before = await readFile(join(project, "tbspec.lock"), "utf8");
    const rejected = await dependencyAdd({
      project,
      source: `${base}/redirect`,
      id: "signed-shop",
      kind: "ontology",
    });
    assert.equal(rejected.status, "invalid_arguments", JSON.stringify(rejected));
    assert.equal(JSON.stringify(rejected).includes("must-not-be-saved"), false);
    assert.equal(await readFile(join(project, "tbspec.lock"), "utf8"), before);
    assert.deepEqual(requests, ["/graph.ttl", "/redirect"]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
