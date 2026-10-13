import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

const metadata = "https://talby.ai/ontology/tbspec#";

test("authenticated repair API stages IRI refactor, scoped removal and separately selected GC", {
  timeout: 120000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-repair-http-"));
  await initializeProject({ directory: root, baseIri: "urn:http-repair:/" });
  const oldIri = "urn:http-repair:old";
  const newIri = "urn:http-repair:new";
  const missing = "urn:http-repair:missing-class";
  await writeFile(
    join(root, "vocabulary.ttl"),
    `<${oldIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `<urn:http-repair:model> a <${metadata}ConcreteDataModel>; <${metadata}modelType> "data" .\n` +
      `<urn:http-repair:Person> a <${missing}> .\n`,
  );
  await writeFile(
    join(root, "orphan.shacl.ttl"),
    `<urn:http-repair:shapes> a <${metadata}ShapesGraph> .\n`,
  );

  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  const opening = await controlRequest(server.record, "opening-link", {});
  const bootstrap = await fetch(new URL("api/auth/v1/bootstrap", base), {
    method: "POST",
    headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: 1,
      bootstrap: new URL(String(opening.openingLink)).hash.slice("#tbspec-bootstrap=".length),
    }),
  });
  const token = (await bootstrap.json()).data.sessionToken as string;
  async function call(route: string, body?: Record<string, unknown>) {
    const response = await fetch(new URL(`api/project/v1/${route}`, base), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Tbspec-Schema-Version": "1",
        Origin: new URL(base).origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, envelope: await response.json() };
  }
  async function apply(staged: Awaited<ReturnType<typeof call>>) {
    assert.equal(staged.status, 200, JSON.stringify(staged));
    assert.equal(staged.envelope.status, "preview", JSON.stringify(staged));
    return call("repair/apply", {
      schemaVersion: 1,
      handle: staged.envelope.data.handle,
      fingerprint: staged.envelope.data.preview.fingerprint,
      accept: staged.envelope.data.preview.impact.acceptance,
    });
  }

  const all = await call("references");
  assert.equal(all.status, 200, JSON.stringify(all));
  assert.ok(all.envelope.data.items.length > 0);
  const exact = await call(`references?target=${encodeURIComponent(oldIri)}`);
  assert.ok(
    exact.envelope.data.items.some(
      (item: { file: string; targetIri: string }) =>
        item.file === "vocabulary.ttl" && item.targetIri === oldIri,
    ),
  );
  assert.equal(
    (await call(`references?target=${encodeURIComponent(oldIri)}&dangling=true`)).status,
    400,
  );

  const refactor = await call("repair/refactor/iri", { oldIri, newIri });
  assert.equal(refactor.status, 200, JSON.stringify(refactor));
  assert.equal(refactor.envelope.status, "preview", JSON.stringify(refactor));
  assert.ok(
    refactor.envelope.data.preview.changes.some(
      (change: { file: string }) => change.file === "vocabulary.ttl",
    ),
  );
  assert.match(await readFile(join(root, "vocabulary.ttl"), "utf8"), /urn:http-repair:old/);
  const wrongApplyRoute = await call("resource/apply", {
    schemaVersion: 1,
    handle: refactor.envelope.data.handle,
    fingerprint: refactor.envelope.data.preview.fingerprint,
    accept: [],
  });
  assert.equal(wrongApplyRoute.status, 409, JSON.stringify(wrongApplyRoute));
  const refactored = await call("repair/apply", {
    schemaVersion: 1,
    handle: refactor.envelope.data.handle,
    fingerprint: refactor.envelope.data.preview.fingerprint,
    accept: [],
  });
  assert.equal(refactored.status, 200, JSON.stringify(refactored));
  assert.equal(refactored.envelope.status, "ok", JSON.stringify(refactored));
  assert.match(await readFile(join(root, "vocabulary.ttl"), "utf8"), /urn:http-repair:new/);

  const listedDangling = await call("references?dangling=true");
  assert.ok(
    listedDangling.envelope.data.items.some(
      (item: { targetIri: string }) => item.targetIri === missing,
    ),
  );
  const remove = await call("repair/references/remove", {
    targetIri: missing,
    files: ["model.ttl"],
  });
  const removed = await apply(remove);
  assert.equal(removed.status, 200, JSON.stringify(removed));
  assert.equal(removed.envelope.status, "ok", JSON.stringify(removed));
  assert.doesNotMatch(await readFile(join(root, "model.ttl"), "utf8"), new RegExp(missing));

  const candidates = await call("repair/gc");
  assert.equal(candidates.status, 200, JSON.stringify(candidates));
  assert.ok(
    candidates.envelope.data.candidates.some(
      (candidate: { file: string }) => candidate.file === "orphan.shacl.ttl",
    ),
  );
  const collection = await call("repair/gc", { resources: ["orphan.shacl.ttl"] });
  assert.equal(collection.status, 200, JSON.stringify(collection));
  assert.equal(collection.envelope.status, "preview", JSON.stringify(collection));
  assert.deepEqual(
    collection.envelope.data.preview.changes.map((change: { file: string }) => change.file),
    ["orphan.shacl.ttl"],
  );
  const collected = await apply(collection);
  assert.equal(collected.status, 200, JSON.stringify(collected));
  assert.equal(collected.envelope.status, "ok", JSON.stringify(collected));
  await assert.rejects(readFile(join(root, "orphan.shacl.ttl")), { code: "ENOENT" });
});
