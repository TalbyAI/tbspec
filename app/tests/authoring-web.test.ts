import assert from "node:assert/strict";
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Worker } from "node:worker_threads";
import { token as opaqueToken } from "../src/ownership.ts";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

async function session(server: Awaited<ReturnType<typeof startWebServer>>) {
  const link = await controlRequest(server.record, "opening-link", {});
  const base = server.record.baseUrl ?? "";
  const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const response = await fetch(new URL("api/auth/v1/bootstrap", base), {
    method: "POST",
    headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  return (await response.json()).data.sessionToken as string;
}

test("authenticated HTTP authoring shares identities, model families and one-use session-owned import previews", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-http-author-"));
  await initializeProject({ directory: root, baseIri: "urn:http:/" });
  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  const token = await session(server);
  const otherToken = await session(server);
  async function call(
    route: string,
    body?: Record<string, unknown>,
    bearer = token,
    origin = new URL(base).origin,
  ) {
    const response = await fetch(new URL(`api/project/v1/${route}`, base), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "X-Tbspec-Schema-Version": "1",
        Origin: origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, envelope: await response.json() };
  }
  async function create(route: string, body: Record<string, unknown>) {
    const preview = await call(route, body);
    assert.equal(preview.envelope.status, "preview", JSON.stringify(preview));
    assert.equal(preview.envelope.data.applied, false);
    await assert.rejects(readFile(join(root, String(body.path))), { code: "ENOENT" });
    return call("resource/apply", {
      schemaVersion: 1,
      handle: preview.envelope.data.handle,
      fingerprint: preview.envelope.data.preview.fingerprint,
      accept: [],
    });
  }
  assert.equal(
    (await call("ontology/create", { path: "blocked.ttl" }, token, "https://attacker.example"))
      .status,
    403,
  );
  for (const [type, profile, path, kind] of [
    ["data", "conceptual", "concepts.ttl", "conceptual-data-model"],
    ["data", "concrete", "individuals.ttl", "concrete-data-model"],
    ["process", undefined, "plan.ttl", "process-model"],
    ["state-machine", undefined, "machine.ttl", "state-machine-model"],
  ]) {
    const created = await create("model/create", {
      path,
      type,
      ...(profile ? { profile } : {}),
      ...(profile === "concrete" ? { schemas: ["concepts.ttl"] } : {}),
    });
    assert.equal(created.status, 200, JSON.stringify(created));
    assert.equal(created.envelope.data.resource.kind, kind);
    assert.equal(created.envelope.data.validationComplete, false);
    assert.equal(created.envelope.data.applied, true);
    assert.equal(created.envelope.data.projectValidity, "unchecked");
  }
  const concrete = await call("model?selector=individuals.ttl");
  assert.deepEqual(concrete.envelope.data.resource.schemaIris, ["urn:http:/concepts"]);
  assert.ok(
    (await call("graphs")).envelope.data.items
      .find((item: { selector: string }) => item.selector === "individuals.ttl")
      .associations.some(
        (a: { role: string; selector: string }) =>
          a.role === "schema" && a.selector === "concepts.ttl",
      ),
  );
  const explicit = await create("ontology/create", { path: "explicit.ttl", iri: "urn:explicit" });
  assert.equal(explicit.envelope.data.resource.graphIri, "urn:explicit");
  assert.equal((await call("models")).envelope.data.items.length, 4);
  assert.equal((await call("ontology/create", { path: "explicit.ttl" })).status, 409);
  assert.equal((await call("ontology/create", { path: "../escape.ttl" })).status, 400);
  assert.equal(
    (await call("ontology/create", { path: "override.ttl", project: tmpdir() })).status,
    400,
  );
  const original = (await call("graph?selector=dep:tbspec-state-machine")).envelope.data.sourceText;
  const preview = await call("ontology/import", {
    source: "dep:tbspec-state-machine",
    path: "adopted.ttl",
  });
  assert.equal(preview.envelope.status, "preview");
  assert.equal(preview.envelope.data.applied, false);
  assert.match(preview.envelope.data.handle, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(preview.envelope.data.instanceId, server.record.instanceId);
  assert.ok(Math.abs(Date.parse(preview.envelope.data.expiresAt) - Date.now() - 900000) < 10000);
  const fingerprint = preview.envelope.data.preview.fingerprint;
  const apply = { schemaVersion: 1, handle: preview.envelope.data.handle, fingerprint, accept: [] };
  const staged = join(
    root,
    ".tbspec",
    "previews",
    server.record.instanceId,
    preview.envelope.data.handle,
    "staged-0",
  );
  assert.match(await readFile(staged, "utf8"), /state-machine#State/);
  await assert.rejects(readFile(join(root, "adopted.ttl")), { code: "ENOENT" });
  assert.equal((await call("resource/apply", { fingerprint })).status, 400);
  assert.equal((await call("resource/apply", apply, otherToken)).status, 409);
  assert.equal(
    (await call("resource/apply", { ...apply, fingerprint: `sha256:${"0".repeat(64)}` })).status,
    409,
  );
  const originalStaged = await readFile(staged);
  await writeFile(staged, "tampered staging");
  const tampered = await call("resource/apply", apply);
  assert.equal(tampered.status, 409);
  assert.equal(tampered.envelope.diagnostics[0].code, "PREVIEW_CHANGED");
  await assert.rejects(readFile(join(root, "adopted.ttl")), { code: "ENOENT" });
  await writeFile(staged, originalStaged);
  assert.equal((await call("resource/apply", apply)).status, 200);
  assert.equal((await call("resource/apply", apply)).status, 409);
  await assert.rejects(readFile(staged), { code: "ENOENT" });
  const shown = await call("ontology?selector=adopted.ttl");
  assert.equal(
    shown.envelope.data.resource.provenance[0].sourceGraphIri,
    "https://talby.ai/ontology/state-machine",
  );
  assert.equal(
    (await call("graph?selector=dep:tbspec-state-machine")).envelope.data.sourceText,
    original,
  );
  const external = await privateDirectory(join(tmpdir(), "tb-http-source-"));
  const source = join(external, "source.ttl");
  await writeFile(
    source,
    "<urn:external> a <http://www.w3.org/2002/07/owl#Ontology> . <urn:Term> a <http://www.w3.org/2002/07/owl#Class> .",
  );
  const immutable = await call("ontology/import", { source, path: "immutable.ttl" });
  await writeFile(source, "external source changed after preview");
  assert.equal(
    (
      await call("resource/apply", {
        schemaVersion: 1,
        handle: immutable.envelope.data.handle,
        fingerprint: immutable.envelope.data.preview.fingerprint,
        accept: [],
      })
    ).status,
    200,
  );
  assert.match(await readFile(join(root, "immutable.ttl"), "utf8"), /urn:Term/);
  const stale = await call("model/import", {
    source: "machine.ttl",
    path: "stale.ttl",
    type: "state-machine",
  });
  await writeFile(
    join(root, "tbspec.toml"),
    `${await readFile(join(root, "tbspec.toml"), "utf8")}\n# external edit\n`,
  );
  const rejected = await call("resource/apply", {
    schemaVersion: 1,
    handle: stale.envelope.data.handle,
    fingerprint: stale.envelope.data.preview.fingerprint,
    accept: [],
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.envelope.diagnostics[0].code, "REVISION_CONFLICT");
  await assert.rejects(readFile(join(root, "stale.ttl")), { code: "ENOENT" });
  const cancelled = await call("ontology/create", { path: "cancelled.ttl" });
  const cancellation = { schemaVersion: 1, handle: cancelled.envelope.data.handle };
  assert.equal((await call("resource/cancel", cancellation, otherToken)).status, 409);
  assert.equal((await call("resource/cancel", cancellation)).status, 200);
  assert.equal(
    (
      await call("resource/apply", {
        ...cancellation,
        fingerprint: cancelled.envelope.data.preview.fingerprint,
        accept: [],
      })
    ).status,
    409,
  );
  await assert.rejects(readFile(join(root, "cancelled.ttl")), { code: "ENOENT" });
});

test("preview expiry cleans staging while idle and cannot interrupt publication", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-preview-expiry-"));
  await initializeProject({ directory: root, baseIri: "urn:expiry:/" });
  const instanceId = opaqueToken();
  const worker = new Worker(
    `
    const { mock } = await import("node:test");
    const { parentPort } = await import("node:worker_threads");
    const fs = await import("node:fs/promises");
    const { syncBuiltinESMExports } = await import("node:module");
    const originalRead = fs.default.readFile;
    let duringApply = false;
    fs.default.readFile = async (path, ...args) => {
      if (duringApply && /staged-0$/.test(String(path))) {
        duringApply = false;
        mock.timers.tick(900001);
      }
      return originalRead(path, ...args);
    };
    syncBuiltinESMExports();
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    const original = parentPort.on.bind(parentPort);
    parentPort.on = (event, handler) => original(event, event === "message" ? (request) => {
      if (request.advance) { mock.timers.tick(request.advance); parentPort.postMessage({ advanced: true }); }
      else if (request.duringApply) { duringApply = true; parentPort.postMessage({ armed: true }); }
      else handler(request);
    } : handler);
    await import(${JSON.stringify(new URL("../src/inspection-worker.ts", import.meta.url).href)});
  `,
    { eval: true },
  );
  t.after(() => worker.terminate());
  await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  async function send(request: Record<string, unknown>) {
    return new Promise<{ json?: string }>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.postMessage(request);
    });
  }
  const response = await send({
    project: root,
    authoring: {
      mode: "preview",
      session: "tab",
      instanceId,
      options: { command: "ontology.create", path: "expired.ttl" },
    },
  });
  const preview = JSON.parse(response.json ?? "{}");
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  const workspace = join(root, ".tbspec/previews", instanceId, preview.data.handle);
  await send({ advance: 900001 });
  let removed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await readdir(workspace);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        removed = true;
        break;
      }
      throw error;
    }
    await delay(25);
  }
  assert.equal(removed, true, "Expired staging must be removed without another preview request");
  const applied = await send({
    project: root,
    authoring: {
      mode: "apply",
      session: "tab",
      instanceId,
      handle: preview.data.handle,
      fingerprint: preview.data.preview.fingerprint,
      accept: [],
    },
  });
  assert.equal(JSON.parse(applied.json ?? "{}").diagnostics[0].code, "PREVIEW_CHANGED");
  await assert.rejects(readFile(join(root, "expired.ttl")), { code: "ENOENT" });
  const next = await send({
    project: root,
    authoring: {
      mode: "preview",
      session: "tab",
      instanceId,
      options: { command: "ontology.create", path: "applied.ttl" },
    },
  });
  const active = JSON.parse(next.json ?? "{}");
  assert.equal(active.status, "preview", JSON.stringify(active));
  await send({ duringApply: true });
  const published = await send({
    project: root,
    authoring: {
      mode: "apply",
      session: "tab",
      instanceId,
      handle: active.data.handle,
      fingerprint: active.data.preview.fingerprint,
      accept: [],
    },
  });
  assert.equal(JSON.parse(published.json ?? "{}").status, "ok", published.json);
  assert.match(await readFile(join(root, "applied.ttl"), "utf8"), /urn:expiry:\/applied/);
});

test("server startup and stop clean obsolete preview artifacts and preserve unknown files", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-preview-lifecycle-"));
  await initializeProject({ directory: root, baseIri: "urn:lifecycle:/" });
  const obsolete = join(root, ".tbspec/previews", opaqueToken(), opaqueToken());
  const unknown = join(root, ".tbspec/previews", opaqueToken(), opaqueToken());
  await mkdir(obsolete, { recursive: true });
  await writeFile(join(obsolete, "staged-0"), "partial staging");
  await mkdir(unknown, { recursive: true });
  await writeFile(join(unknown, "original.ttl"), "preserve unknown content");
  const recovery = join(root, ".tbspec/transactions/pending");
  await mkdir(recovery, { recursive: true });
  await writeFile(join(recovery, "original"), "preserve transaction evidence");
  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  await assert.rejects(readdir(obsolete), { code: "ENOENT" });
  assert.equal(await readFile(join(unknown, "original.ttl"), "utf8"), "preserve unknown content");
  assert.equal(await readFile(join(recovery, "original"), "utf8"), "preserve transaction evidence");
  const status = await fetch(new URL("api/control/v1/status", server.record.baseUrl ?? ""), {
    headers: { Authorization: `Bearer ${server.record.controlToken}` },
  });
  assert.ok(
    (await status.json()).diagnostics.some(
      (diagnostic: { code: string }) => diagnostic.code === "CLEANUP_RETAINED",
    ),
  );
  const current = join(root, ".tbspec/previews", server.record.instanceId, opaqueToken());
  await mkdir(current, { recursive: true });
  await writeFile(join(current, "staged-0"), "current staging");
  await server.stop();
  await assert.rejects(readdir(current), { code: "ENOENT" });
  assert.equal(await readFile(join(unknown, "original.ttl"), "utf8"), "preserve unknown content");
});

test("failed preview staging removes partial files and reports retained cleanup failures", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-preview-stage-fault-"));
  await initializeProject({ directory: root, baseIri: "urn:fault:/" });
  const instanceId = opaqueToken();
  const worker = new Worker(
    `
    const fs = (await import("node:fs/promises")).default;
    const { syncBuiltinESMExports } = await import("node:module");
    const originalWrite = fs.writeFile;
    const originalUnlink = fs.unlink;
    let denyCleanup = false;
    fs.writeFile = async (path, ...args) => {
      if (String(path).endsWith("record.json") && String(path).includes("previews")) {
        throw Object.assign(new Error("Injected staging failure"), { code: "EIO" });
      }
      return originalWrite(path, ...args);
    };
    fs.unlink = async (path, ...args) => {
      if (denyCleanup && String(path).endsWith("staged-0")) throw Object.assign(new Error("Injected cleanup failure"), { code: "EACCES" });
      return originalUnlink(path, ...args);
    };
    syncBuiltinESMExports();
    const { parentPort } = await import("node:worker_threads");
    const originalOn = parentPort.on.bind(parentPort);
    parentPort.on = (event, handler) => originalOn(event, event === "message" ? (request) => {
      denyCleanup = request.denyCleanup === true;
      handler(request);
    } : handler);
    await import(${JSON.stringify(new URL("../src/inspection-worker.ts", import.meta.url).href)});
  `,
    { eval: true },
  );
  t.after(() => worker.terminate());
  await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  for (const denyCleanup of [false, true]) {
    const response = await new Promise<{ json: string }>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.postMessage({
        project: root,
        denyCleanup,
        authoring: {
          mode: "preview",
          session: "tab",
          instanceId,
          options: { command: "ontology.create", path: "failed.ttl" },
        },
      });
    });
    const result = JSON.parse(response.json);
    assert.equal(result.status, "unavailable", response.json);
    assert.equal(
      result.diagnostics.some(
        (diagnostic: { code: string }) => diagnostic.code === "CLEANUP_RETAINED",
      ),
      denyCleanup,
    );
    assert.equal(
      (await readdir(join(root, ".tbspec/previews", instanceId))).length,
      denyCleanup ? 1 : 0,
    );
    await assert.rejects(readFile(join(root, "failed.ttl")), { code: "ENOENT" });
  }
});
