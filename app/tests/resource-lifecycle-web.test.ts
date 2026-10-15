import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { privateDirectory } from "./private-directory.ts";

async function session(server: Awaited<ReturnType<typeof startWebServer>>) {
  const link = await fetch(new URL("api/control/v1/opening-link", server.record.baseUrl ?? ""), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${server.record.controlToken}`,
      Origin: new URL(server.record.baseUrl ?? "").origin,
      "Content-Type": "application/json",
    },
    body: "{}",
  }).then((response) => response.json());
  const bootstrap = new URL(String(link.data.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const exchanged = await fetch(new URL("api/auth/v1/bootstrap", server.record.baseUrl ?? ""), {
    method: "POST",
    headers: {
      Origin: new URL(server.record.baseUrl ?? "").origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  return (await exchanged.json()).data.sessionToken as string;
}

test("authenticated HTTP impact, confirmed removal and fingerprint-bound move share staged previews", {
  timeout: 90000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-http-lifecycle-"));
  await initializeProject({ directory: root, baseIri: "urn:http-lifecycle:/" });
  await writeFile(
    join(root, "vocabulary.ttl"),
    "<urn:http-lifecycle:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n<urn:http-lifecycle:Term> a <http://www.w3.org/2002/07/owl#Class> .\n",
  );
  const dataBytes = Buffer.from(
    "<urn:http-lifecycle:data> <urn:http-lifecycle:uses> <urn:http-lifecycle:Term> .\n",
  );
  await writeFile(join(root, "data.ttl"), dataBytes);
  await writeFile(join(root, "loose.ttl"), "<urn:loose:s> <urn:loose:p> <urn:loose:o> .\n");
  const server = await startWebServer(
    await import("node:fs/promises").then(({ realpath }) => realpath(root)),
  );
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  const token = await session(server);
  async function call(route: string, body?: Record<string, unknown>) {
    const response = await fetch(new URL(`api/project/v1/${route}`, base), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: new URL(base).origin,
        "X-Tbspec-Schema-Version": "1",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, envelope: await response.json() };
  }

  const impact = await call("impact?kind=ontology&selector=vocabulary.ttl");
  assert.equal(impact.status, 200, JSON.stringify(impact));
  assert.ok(
    impact.envelope.data.items.some(
      (item: { file: string; targetIri: string; position: string }) =>
        item.file === "data.ttl" &&
        item.targetIri === "urn:http-lifecycle:Term" &&
        item.position === "object",
    ),
  );

  const removal = await call("resources/remove", { kind: "ontology", selector: "vocabulary.ttl" });
  assert.equal(removal.status, 200, JSON.stringify(removal));
  assert.equal(removal.envelope.status, "preview");
  assert.ok(removal.envelope.data.preview.impact.affectedFiles.includes("data.ttl"));
  assert.match(await readFile(join(root, "vocabulary.ttl"), "utf8"), /owl#Ontology/);
  const removed = await call("resource/apply", {
    schemaVersion: 1,
    handle: removal.envelope.data.handle,
    fingerprint: removal.envelope.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(removed.status, 200, JSON.stringify(removed));
  assert.equal(removed.envelope.data.applied, true);
  await assert.rejects(readFile(join(root, "vocabulary.ttl")), { code: "ENOENT" });
  assert.deepEqual(await readFile(join(root, "data.ttl")), dataBytes);

  const move = await call("resources/move", {
    selector: "loose.ttl",
    destination: "archive/loose.ttl",
  });
  assert.equal(move.status, 200, JSON.stringify(move));
  assert.equal(move.envelope.status, "preview");
  assert.ok(move.envelope.data.preview.arguments.identityChanges.length);
  const moved = await call("resource/apply", {
    schemaVersion: 1,
    handle: move.envelope.data.handle,
    fingerprint: move.envelope.data.preview.fingerprint,
    accept: [],
  });
  assert.equal(moved.status, 200, JSON.stringify(moved));
  await assert.rejects(readFile(join(root, "loose.ttl")), { code: "ENOENT" });
  assert.match(await readFile(join(root, "archive/loose.ttl"), "utf8"), /urn:loose:s/);
});
