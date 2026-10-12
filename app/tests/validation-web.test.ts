import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

test("authenticated validation and schema/shapes previews share exact bytes, confirmation and session ownership", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-http-validation-"));
  await initializeProject({ directory: root, baseIri: "urn:http:/" });
  const prefix =
    "@prefix t: <https://talby.ai/ontology/tbspec#> . @prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix ex: <urn:ex:> .";
  await writeFile(
    join(root, "schema.ttl"),
    `${prefix} ex:schema a t:ConceptualDataModel; t:modelType "data" . ex:Thing a owl:Class .`,
  );
  await writeFile(
    join(root, "model.ttl"),
    `${prefix} ex:model a t:ConcreteDataModel; t:modelType "data" . ex:item a ex:Thing .`,
  );
  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  async function session() {
    const link = await controlRequest(server.record, "opening-link", {});
    const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
    const response = await fetch(new URL("api/auth/v1/bootstrap", base), {
      method: "POST",
      headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, bootstrap }),
    });
    return (await response.json()).data.sessionToken as string;
  }
  const token = await session();
  const foreign = await session();
  async function call(route: string, body?: Record<string, unknown>, bearer = token) {
    const response = await fetch(new URL(`api/project/v1/${route}`, base), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "X-Tbspec-Schema-Version": "1",
        Origin: new URL(base).origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, envelope: await response.json() };
  }
  function application(preview: Awaited<ReturnType<typeof call>>, accept: string[] = []) {
    return {
      schemaVersion: 1,
      handle: preview.envelope.data.handle,
      fingerprint: preview.envelope.data.preview.fingerprint,
      accept,
    };
  }
  assert.equal((await call("validate?selector=model.ttl")).status, 422);
  assert.equal(
    (await call("model/schema/add", { path: "model.ttl", source: "schema.ttl", project: tmpdir() }))
      .status,
    400,
  );
  const added = await call("model/schema/add", { path: "model.ttl", source: "schema.ttl" });
  assert.equal(added.envelope.status, "preview", JSON.stringify(added));
  assert.equal((await call("resource/apply", application(added), foreign)).status, 409);
  assert.equal((await call("resource/apply", application(added))).status, 200);
  assert.equal(
    (await call("model-schemas?selector=model.ttl")).envelope.data.items[0].selector,
    "schema.ttl",
  );
  const shapes = await call("shapes/create", { path: "model.ttl" });
  assert.equal(shapes.envelope.status, "preview", JSON.stringify(shapes));
  assert.equal((await call("resource/apply", application(shapes))).status, 200);
  assert.equal(
    (await call("shapes?selector=model.ttl")).envelope.data.items[0].selector,
    "model.shacl.ttl",
  );
  assert.equal((await call("validate?selector=model.ttl")).status, 200);
  await writeFile(
    join(root, "view.ttl"),
    `${prefix} ex:view a t:ViewModel; t:sourceGraph ex:model; t:member ex:model, ex:schema; t:relationship [ <http://www.w3.org/1999/02/22-rdf-syntax-ns#subject> ex:model; <http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate> t:schema; <http://www.w3.org/1999/02/22-rdf-syntax-ns#object> ex:schema ] .`,
  );
  await writeFile(
    join(root, "presentation.ttl"),
    `${prefix} ex:presentation a t:PresentationGraph; t:forView ex:view .`,
  );
  assert.equal((await call("validate?selector=view.ttl")).status, 200);
  const removed = await call("model/schema/remove", { path: "model.ttl", source: "schema.ttl" });
  assert.ok(
    removed.envelope.data.preview.impact.introducedErrors.some(
      (d: { code: string }) => d.code === "VOCABULARY_UNKNOWN",
    ),
  );
  assert.ok(
    removed.envelope.data.preview.impact.introducedErrors.some(
      (d: { code: string; selector: string }) =>
        d.code === "VIEW_INVALID" && d.selector === "view.ttl",
    ),
  );
  assert.ok(removed.envelope.data.preview.impact.affectedFiles.includes("presentation.ttl"));
  assert.equal(
    (await call("resource/apply", application(removed))).envelope.diagnostics[0].code,
    "ACCEPTANCE_REQUIRED",
  );
  const bytes = await readFile(join(root, "model.ttl"), "utf8");
  await writeFile(join(root, "model.ttl"), `${bytes}\n# outside edit\n`);
  assert.equal(
    (await call("resource/apply", application(removed, ["confirm"]))).envelope.diagnostics[0].code,
    "REVISION_CONFLICT",
  );
  const fresh = await call("model/schema/remove", { path: "model.ttl", source: "schema.ttl" });
  const applied = await call("resource/apply", application(fresh, ["confirm"]));
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.envelope.data.projectValidity, "invalid");
  assert.equal((await call("resource/apply", application(fresh, ["confirm"]))).status, 409);
  await writeFile(join(root, "unrelated.ttl"), "broken Turtle [");
  const selected = await call("validate?selector=model.ttl");
  assert.ok(
    !selected.envelope.diagnostics.some((d: { file: string }) => d.file === "unrelated.ttl"),
  );
  const validating = call("validate");
  assert.equal((await controlRequest(server.record, "status")).state, "running");
  assert.ok(
    (await validating).envelope.diagnostics.some((d: { code: string }) => d.code === "RDF_SYNTAX"),
  );
  const cancellable = await call("model/schema/add", { path: "model.ttl", source: "schema.ttl" });
  assert.equal(
    (await call("resource/cancel", { schemaVersion: 1, handle: cancellable.envelope.data.handle }))
      .status,
    200,
  );
  assert.equal((await call("resource/apply", application(cancellable))).status, 409);
});
