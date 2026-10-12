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

test("authenticated editors stage exact source, enforce session ownership and retain conflict drafts", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-edit-http-"));
  await initializeProject({ directory: root });
  await writeFile(join(root, "edit.ttl"), '<urn:s> <urn:p> "original" .');
  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  async function session() {
    const link = await controlRequest(server.record, "opening-link", {});
    const response = await fetch(new URL("api/auth/v1/bootstrap", base), {
      method: "POST",
      headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 1,
        bootstrap: new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length),
      }),
    });
    return (await response.json()).data.sessionToken as string;
  }
  const token = await session();
  const other = await session();
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
    return { status: response.status, result: await response.json() };
  }
  const shown = await call("editor?selector=edit.ttl");
  assert.equal(shown.status, 200);
  const revision = shown.result.data.resource.revision;
  const text = `# ${"large source comment ".repeat(1100)}\n<urn:s> <urn:p> "<img src=x onerror=alert(1)>" .\n`;
  assert.equal(
    (
      await call(
        "editor/save",
        { selector: "edit.ttl", revision, sourceText: text },
        token,
        "https://attacker.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("editor/save", {
        selector: "edit.ttl",
        revision,
        sourceText: text,
        project: tmpdir(),
      })
    ).status,
    400,
  );
  const preview = await call("editor/save", { selector: "edit.ttl", revision, sourceText: text });
  assert.equal(preview.result.status, "preview", JSON.stringify(preview));
  assert.equal(await readFile(join(root, "edit.ttl"), "utf8"), '<urn:s> <urn:p> "original" .');
  const apply = {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: [],
  };
  assert.equal((await call("resource/apply", apply, other)).status, 409);
  assert.equal((await call("resource/apply", apply)).status, 200);
  assert.equal((await call("resource/apply", apply)).status, 409);
  assert.equal(await readFile(join(root, "edit.ttl"), "utf8"), text);
  const stale = await call("editor/save", {
    selector: "edit.ttl",
    revision,
    sourceText: "draft retained by caller",
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.result.diagnostics[0].code, "REVISION_CONFLICT");
  const locked = await call("editor?selector=dep:tbspec-state-machine");
  const lockedBytes = locked.result.data.sourceText;
  const readonly = await call("editor/save", {
    selector: "dep:tbspec-state-machine",
    revision: locked.result.data.resource.revision,
    sourceText: "forbidden",
  });
  assert.equal(readonly.status, 400);
  assert.equal(readonly.result.diagnostics[0].code, "READ_ONLY");
  assert.equal(
    (await call("editor?selector=dep:tbspec-state-machine")).result.data.sourceText,
    lockedBytes,
  );
});

test("process editor HTTP exposes explicit associations and applies reviewed exact edits", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-process-edit-http-"));
  await initializeProject({ directory: root, baseIri: "urn:process-http:/" });
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "process.ttl",
    type: "process",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const file = join(root, "process.ttl");
  await writeFile(
    file,
    `${await readFile(file, "utf8")}
@prefix p: <http://purl.org/net/p-plan#> .
@prefix proc: <https://talby.ai/ontology/process#> .
<urn:plan> a p:Plan .
<urn:step> a p:Step; p:isStepOfPlan <urn:plan> .
<urn:inverse-only> a p:Variable; p:isVariableOfPlan <urn:plan>; p:isInputVarOf <urn:step> .
<urn:both> a p:Variable; p:isVariableOfPlan <urn:plan>; p:isOutputVarOf <urn:step> .
<urn:step> p:hasOutputVar <urn:both> .
<urn:flow> a proc:Flow; proc:inPlan <urn:plan>; proc:source <urn:step>; proc:target <urn:step> .
`,
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
    return { status: response.status, result: await response.json() };
  }

  const shown = await call("editor?selector=process.ttl");
  assert.equal(shown.status, 200);
  const data = shown.result.data;
  assert.equal(data.resource.kind, "process-model");
  assert.equal(
    data.processAssociations.filter(
      (association: { kind: string; variable: { value: string } }) =>
        association.kind === "input" && association.variable.value === "urn:inverse-only",
    ).length,
    1,
  );
  assert.ok(
    data.processElements.flows.some((flow: { value: string }) => flow.value === "urn:flow"),
  );
  const inverse = data.processAssociations.find(
    (association: { kind: string; variable: { value: string }; statements: unknown[] }) =>
      association.kind === "input" && association.variable.value === "urn:inverse-only",
  );
  assert.ok(inverse);
  assert.equal(inverse.statements.length, 1);
  const original = await readFile(file);
  const pPlan = "http://purl.org/net/p-plan#";
  const preview = await call("editor/save", {
    selector: "process.ttl",
    revision: data.resource.revision,
    edits: [
      ...inverse.statements.map((before: unknown) => ({ action: "remove", before })),
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: "urn:step" },
          predicate: { kind: "iri", value: `${pPlan}hasInputVar` },
          object: { kind: "iri", value: "urn:inverse-only" },
        },
      },
    ],
  });
  assert.equal(preview.result.status, "preview", JSON.stringify(preview.result));
  assert.deepEqual(await readFile(file), original);
  const apply = await call("resource/apply", {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: [],
  });
  assert.equal(apply.status, 200, JSON.stringify(apply));
  const current = await call("editor?selector=process.ttl");
  assert.equal(current.status, 200);
  assert.equal(
    current.result.data.processAssociations.find(
      (association: { kind: string; variable: { value: string } }) =>
        association.kind === "input" && association.variable.value === "urn:inverse-only",
    ).statements[0].predicate.value,
    `${pPlan}hasInputVar`,
  );
  assert.equal(
    current.result.data.processAssociations.find(
      (association: { kind: string; variable: { value: string } }) =>
        association.kind === "output" && association.variable.value === "urn:both",
    ).statements.length,
    2,
  );

  await writeFile(file, `${await readFile(file, "utf8")}# concurrent source change\n`);
  const stale = await call("editor/save", {
    selector: "process.ttl",
    revision: current.result.data.resource.revision,
    edits: [
      {
        action: "add",
        after: {
          subject: { kind: "iri", value: "urn:step" },
          predicate: { kind: "iri", value: `${pPlan}hasOutputVar` },
          object: { kind: "iri", value: "urn:inverse-only" },
        },
      },
    ],
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.result.diagnostics[0].code, "REVISION_CONFLICT");
  const locked = await call("editor?selector=dep:tbspec-process/source/proc.ttl");
  assert.equal(locked.status, 200);
  const readonly = await call("editor/save", {
    selector: "dep:tbspec-process/source/proc.ttl",
    revision: locked.result.data.resource.revision,
    sourceText: "forbidden",
  });
  assert.equal(readonly.status, 400);
  assert.equal(readonly.result.diagnostics[0].code, "READ_ONLY");
});
