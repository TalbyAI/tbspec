import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
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
    concrete.envelope.data.resource.associations.some(
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
