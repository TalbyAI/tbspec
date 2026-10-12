import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource } from "../src/authoring.ts";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

const sm = "https://talby.ai/ontology/state-machine#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

test("authenticated state-machine form operations create exact local transitions", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-state-http-"));
  await initializeProject({ directory: root, baseIri: "urn:state-http:/" });
  await writeFile(
    join(root, "tbspec.toml"),
    'schema_version = 1\nbase_iri = "urn:state-http:/"\n\n[model_types.state-machine]\nontology = "dep:tbspec-state-machine"\n',
  );
  const authored = await authorResource({
    project: root,
    command: "model.create",
    path: "machine.ttl",
    type: "state-machine",
  });
  assert.equal(authored.status, "ok", JSON.stringify(authored));
  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  const link = await controlRequest(server.record, "opening-link", {});
  const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const opened = await fetch(new URL("api/auth/v1/bootstrap", base), {
    method: "POST",
    headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  const token = (await opened.json()).data.sessionToken as string;
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
  async function save(body: Record<string, unknown>) {
    const preview = await call("editor/save", body);
    assert.equal(preview.status, 200, JSON.stringify(preview));
    assert.equal(preview.envelope.status, "preview", JSON.stringify(preview));
    const staged = preview.envelope.data;
    return call("resource/apply", {
      schemaVersion: 1,
      handle: staged.handle,
      fingerprint: staged.preview.fingerprint,
      accept: [],
    });
  }
  const editor = await call("editor?selector=machine.ttl");
  assert.equal(editor.status, 200);
  assert.equal(
    editor.envelope.data.resource.associations.some(
      (association: { role: string }) => association.role === "design",
    ),
    false,
  );
  const revision = editor.envelope.data.resource.revision;
  const machine = editor.envelope.data.resource.graphIri as string;
  const initial = "urn:http:initial";
  const membership = {
    action: "add",
    after: {
      subject: { kind: "iri", value: initial },
      predicate: { kind: "iri", value: `${sm}inMachine` },
      object: { kind: "iri", value: machine },
    },
  };
  const createdState = await save({
    selector: "machine.ttl",
    revision,
    creation: { iri: initial, type: `${sm}InitialState` },
    edits: [membership],
  });
  assert.equal(createdState.status, 200, JSON.stringify(createdState));
  assert.equal(createdState.envelope.status, "ok");
  const afterState = await call("editor?selector=machine.ttl");
  assert.equal(
    afterState.envelope.data.triples.some(
      (triple: {
        subject: { value: string };
        predicate: { value: string };
        object: { value: string };
      }) =>
        triple.subject.value === initial &&
        triple.predicate.value === rdfType &&
        triple.object.value === `${sm}State`,
    ),
    false,
  );

  const transition = "urn:http:transition";
  const latestRevision = afterState.envelope.data.resource.revision;
  const transitionApply = await save({
    selector: "machine.ttl",
    revision: latestRevision,
    creation: { iri: transition, type: `${sm}Transition` },
    edits: [
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: transition },
          predicate: { kind: "iri", value: `${sm}inMachine` },
          object: { kind: "iri", value: machine },
        },
      },
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: transition },
          predicate: { kind: "iri", value: `${sm}source` },
          object: { kind: "iri", value: initial },
        },
      },
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: transition },
          predicate: { kind: "iri", value: `${sm}target` },
          object: { kind: "iri", value: initial },
        },
      },
    ],
  });
  assert.equal(transitionApply.status, 200, JSON.stringify(transitionApply));
  const afterTransition = await call("editor?selector=machine.ttl");
  const transitionTriples = afterTransition.envelope.data.triples.filter(
    (triple: { subject: { value: string } }) => triple.subject.value === transition,
  );
  assert.equal(transitionTriples.length, 4);
  assert.deepEqual(
    transitionTriples
      .map((triple: { predicate: { value: string } }) => triple.predicate.value)
      .sort(),
    [rdfType, `${sm}inMachine`, `${sm}source`, `${sm}target`].sort(),
  );
  assert.ok(
    afterTransition.envelope.data.sections.some(
      (section: { type: string }) => section.type === `${sm}Transition`,
    ),
  );

  const bytes = await readFile(join(root, "machine.ttl"));
  const rejected = await call("editor/save", {
    selector: "machine.ttl",
    revision: afterTransition.envelope.data.resource.revision,
    creation: { iri: "urn:http:missing-endpoints", type: `${sm}Transition` },
    edits: [],
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.envelope.diagnostics[0].code, "ARGUMENT_INVALID");
  assert.deepEqual(await readFile(join(root, "machine.ttl")), bytes);

  const stale = await call("editor/save", {
    selector: "machine.ttl",
    revision,
    creation: { iri: "urn:http:stale", type: `${sm}State` },
    edits: [],
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.envelope.diagnostics[0].code, "REVISION_CONFLICT");
});
