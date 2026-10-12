import assert from "node:assert/strict";
import { appendFile, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DataFactory, Parser, Store, Writer } from "n3";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

const metadata = "https://talby.ai/ontology/tbspec#";

async function addPresentationStyle(path: string) {
  const graph = new Store(new Parser().parse(await readFile(path, "utf8")));
  const record = graph.getQuads(
    null,
    `${metadata}element`,
    DataFactory.namedNode("urn:keep"),
    null,
  )[0]?.subject;
  assert.ok(record, "expected a saved presentation record for the retained node");
  graph.addQuad(
    record,
    DataFactory.namedNode("urn:custom-style"),
    DataFactory.literal("preserve-me"),
  );
  const writer = new Writer();
  writer.addQuads([...graph]);
  const text = await new Promise<string>((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
  await writeFile(path, text);
}

async function projectApi(root: string, t: TestContext) {
  const server = await startWebServer(await realpath(root));
  let stopped = false;
  t.after(async () => {
    if (!stopped) {
      stopped = true;
      await server.stop();
    }
  });
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
  return {
    call,
    stop: async () => {
      if (!stopped) {
        stopped = true;
        await server.stop();
      }
    },
  };
}

test("source-element deletion reviews and removes only exact incident statements", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-element-delete-"));
  const target = "urn:delete-me/";
  await initializeProject({ directory: root, baseIri: target });
  const source = `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .
<${target}> a <http://www.w3.org/2002/07/owl#NamedIndividual>;
  <urn:unknown-predicate> <urn:left> .
<urn:left> <urn:from> <${target}> .
<urn:carrier> <${target}> <urn:right> .
<urn:left> <urn:neighbor> <urn:right> .
`;
  await writeFile(join(root, "source.ttl"), source);
  await writeFile(
    join(root, "external.ttl"),
    `<urn:external-subject> <urn:external-property> <${target}> .\n`,
  );
  const { call, stop } = await projectApi(root, t);

  const shown = await call("editor?selector=source.ttl");
  assert.equal(shown.status, 200, JSON.stringify(shown));
  const managedRoot = await call("editor/delete", {
    selector: "source.ttl",
    revision: shown.result.data.resource.revision,
    element: { kind: "iri", value: "urn:source" },
  });
  assert.equal(managedRoot.status, 400, JSON.stringify(managedRoot));
  assert.equal(managedRoot.result.diagnostics[0].code, "MANAGED_ROOT_LIFECYCLE");
  const preview = await call("editor/delete", {
    selector: "source.ttl",
    revision: shown.result.data.resource.revision,
    element: { kind: "iri", value: target },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  assert.equal(preview.result.status, "preview", JSON.stringify(preview.result));
  assert.deepEqual(preview.result.data.preview.impact.acceptance, ["confirm"]);
  const statements = preview.result.data.preview.arguments.statements as {
    subject: { value: string };
    predicate: { value: string };
    object: { value: string };
  }[];
  assert.equal(statements.length, 4);
  assert.ok(statements.some((statement) => statement.predicate.value === "urn:unknown-predicate"));
  const references = preview.result.data.preview.arguments.references as {
    file: string;
    position: string;
  }[];
  assert.ok(
    references.some(
      (reference) => reference.file === "external.ttl" && reference.position === "object",
    ),
  );
  assert.ok(
    references.some(
      (reference) => reference.file === "tbspec.toml" && reference.position === "configuration",
    ),
  );
  assert.deepEqual(await readFile(join(root, "source.ttl"), "utf8"), source);

  const applyBody = {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
  };
  const unaccepted = await call("resource/apply", { ...applyBody, accept: [] });
  assert.equal(unaccepted.status, 409, JSON.stringify(unaccepted));
  assert.equal(unaccepted.result.diagnostics[0].code, "ACCEPTANCE_REQUIRED");
  assert.deepEqual(await readFile(join(root, "source.ttl"), "utf8"), source);

  const applied = await call("resource/apply", { ...applyBody, accept: ["confirm"] });
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.result.status, "ok", JSON.stringify(applied.result));
  const current = await readFile(join(root, "source.ttl"), "utf8");
  assert.doesNotMatch(current, /urn:delete-me\/|urn:unknown-predicate/);
  assert.match(current, /urn:left.*urn:neighbor.*urn:right/s);
  assert.deepEqual(
    await readFile(join(root, "external.ttl"), "utf8"),
    `<urn:external-subject> <urn:external-property> <${target}> .\n`,
  );
  await stop();
  const restarted = await projectApi(root, t);
  const status = await restarted.call("status");
  assert.equal(status.status, 200, JSON.stringify(status));
  assert.equal(status.result.status, "ok", JSON.stringify(status.result));
  assert.ok(
    !status.result.diagnostics.some((diagnostic: { message: string }) =>
      diagnostic.message.includes(target),
    ),
  );
});

test("deletion impact sorts repeated configuration IRI keys and values", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-config-delete-impact-"));
  await initializeProject({ directory: root });
  const target = "urn:repeated-configuration-iri";
  await writeFile(
    join(root, "source.ttl"),
    `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n<${target}> <urn:p> <urn:value> .\n`,
  );
  await appendFile(join(root, "tbspec.toml"), `\n[extensions]\n"${target}" = "${target}"\n`);
  const { call } = await projectApi(root, t);
  const shown = await call("editor?selector=source.ttl");
  assert.equal(shown.status, 200, JSON.stringify(shown));
  const preview = await call("editor/delete", {
    selector: "source.ttl",
    revision: shown.result.data.resource.revision,
    element: { kind: "iri", value: target },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  assert.equal(preview.result.status, "preview", JSON.stringify(preview.result));
  const configurationReferences = preview.result.data.preview.arguments.references.filter(
    (reference: { file: string; position: string }) =>
      reference.file === "tbspec.toml" && reference.position === "configuration",
  );
  assert.equal(configurationReferences.length, 2, JSON.stringify(configurationReferences));
});

test("deletion impact distinguishes synchronized own-source views from unchanged other-source views", {
  timeout: 90000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-cross-view-delete-impact-"));
  await initializeProject({ directory: root });
  const target = "urn:shared-view-target";
  await writeFile(
    join(root, "source.ttl"),
    `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n<${target}> <urn:own-relation> <urn:keep> .\n`,
  );
  await writeFile(
    join(root, "other-source.ttl"),
    `<urn:other-source> a <http://www.w3.org/2002/07/owl#Ontology> .\n<${target}> <urn:other-relation> <urn:other-value> .\n`,
  );
  const { call } = await projectApi(root, t);
  async function apply(route: string, body: Record<string, unknown>) {
    const staged = await call(route, body);
    assert.equal(staged.status, 200, JSON.stringify(staged));
    assert.equal(staged.result.status, "preview", JSON.stringify(staged.result));
    return call("resource/apply", {
      schemaVersion: 1,
      handle: staged.result.data.handle,
      fingerprint: staged.result.data.preview.fingerprint,
      accept: [],
    });
  }
  for (const [path, source] of [
    ["views/own-source.ttl", "source.ttl"],
    ["views/other-source.ttl", "other-source.ttl"],
  ]) {
    const created = await apply("views/create", { path, source });
    assert.equal(created.status, 200, JSON.stringify(created));
    assert.equal(created.result.status, "ok", JSON.stringify(created.result));
  }
  const own = (await call("view?selector=views/own-source.ttl")).result.data;
  const ownEdited = await apply("view/edit", {
    selector: "views/own-source.ttl",
    viewRevision: own.resource.revision,
    presentationRevision: own.presentation.resource.revision,
    members: [target, "urn:keep"],
    relationships: [{ subject: target, predicate: "urn:own-relation", object: "urn:keep" }],
    positions: [{ element: target, x: "10", y: "20" }],
  });
  assert.equal(ownEdited.result.status, "ok", JSON.stringify(ownEdited.result));
  await appendFile(
    join(root, "views/own-source.ttl"),
    `<urn:annotation> <urn:custom-reference> <${target}> .\n`,
  );
  const other = (await call("view?selector=views/other-source.ttl")).result.data;
  const otherEdited = await apply("view/edit", {
    selector: "views/other-source.ttl",
    viewRevision: other.resource.revision,
    presentationRevision: other.presentation.resource.revision,
    members: [target, "urn:other-value"],
    relationships: [
      { subject: target, predicate: "urn:other-relation", object: "urn:other-value" },
    ],
    positions: [{ element: target, x: "30", y: "40" }],
  });
  assert.equal(otherEdited.result.status, "ok", JSON.stringify(otherEdited.result));
  const ownViewPath = join(root, "views/own-source.ttl");
  const ownPresentationPath = join(root, "views/own-source.presentation.ttl");
  const otherViewPath = join(root, "views/other-source.ttl");
  const otherPresentationPath = join(root, "views/other-source.presentation.ttl");
  const otherSourcePath = join(root, "other-source.ttl");
  const ownViewBefore = await readFile(ownViewPath);
  const ownPresentationBefore = await readFile(ownPresentationPath);
  const otherViewBefore = await readFile(otherViewPath);
  const otherPresentationBefore = await readFile(otherPresentationPath);
  const otherSourceBefore = await readFile(otherSourcePath);
  const source = await call("editor?selector=source.ttl");
  const preview = await call("editor/delete", {
    selector: "source.ttl",
    revision: source.result.data.resource.revision,
    element: { kind: "iri", value: target },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  const references = preview.result.data.preview.arguments.references as {
    file: string;
    position: string;
    disposition: string;
    predicate?: { value: string };
  }[];
  assert.ok(
    references.some(
      (reference) =>
        reference.file === "views/own-source.ttl" && reference.disposition === "synchronized",
    ),
    JSON.stringify(references),
  );
  assert.ok(
    references.some(
      (reference) =>
        reference.file === "views/own-source.ttl" &&
        reference.position === "object" &&
        reference.disposition === "unchanged" &&
        reference.predicate?.value === "urn:custom-reference",
    ),
    JSON.stringify(references),
  );
  assert.ok(
    references.some(
      (reference) =>
        reference.file === "views/other-source.ttl" && reference.disposition === "unchanged",
    ),
    JSON.stringify(references),
  );
  assert.ok(
    references.some(
      (reference) =>
        reference.file === "views/other-source.presentation.ttl" &&
        reference.disposition === "unchanged",
    ),
    JSON.stringify(references),
  );
  assert.deepEqual(await readFile(otherViewPath), otherViewBefore);
  assert.deepEqual(await readFile(otherPresentationPath), otherPresentationBefore);
  const applied = await call("resource/apply", {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(applied.result.status, "ok", JSON.stringify(applied.result));
  const ownViewGraph = new Store(new Parser().parse(await readFile(ownViewPath, "utf8")));
  assert.equal(
    ownViewGraph.countQuads(
      null,
      DataFactory.namedNode(`${metadata}member`),
      DataFactory.namedNode(target),
      null,
    ),
    0,
  );
  assert.equal(
    ownViewGraph.countQuads(
      DataFactory.namedNode("urn:annotation"),
      DataFactory.namedNode("urn:custom-reference"),
      DataFactory.namedNode(target),
      null,
    ),
    1,
  );
  assert.notDeepEqual(await readFile(ownViewPath), ownViewBefore);
  assert.notDeepEqual(await readFile(ownPresentationPath), ownPresentationBefore);
  assert.deepEqual(await readFile(otherViewPath), otherViewBefore);
  assert.deepEqual(await readFile(otherPresentationPath), otherPresentationBefore);
  assert.deepEqual(await readFile(otherSourcePath), otherSourceBefore);
});

test("blank-node deletion is bound to the selected graph revision and only removes incident statements", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-blank-delete-"));
  await initializeProject({ directory: root });
  const source = `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .
_:chosen <urn:outgoing> <urn:target> .
<urn:incoming> <urn:points-to> _:chosen .
_:free <urn:unrelated> <urn:retained> .
`;
  await writeFile(join(root, "source.ttl"), source);
  const { call } = await projectApi(root, t);
  const shown = await call("editor?selector=source.ttl");
  assert.equal(shown.status, 200, JSON.stringify(shown));
  const selected = shown.result.data.triples.find(
    (triple: { subject: { kind: string; value: string; scope?: string } }) =>
      triple.subject.kind === "blank",
  );
  assert.ok(selected, JSON.stringify(shown.result.data.triples));
  const blank = selected.subject as { kind: "blank"; value: string; scope: string };
  assert.ok(blank.scope.startsWith("source.ttl@"));
  const stale = await call("editor/delete", {
    selector: "source.ttl",
    revision: shown.result.data.resource.revision,
    element: { ...blank, scope: "source.ttl@sha256:stale" },
  });
  assert.equal(stale.status, 400, JSON.stringify(stale));
  assert.equal(stale.result.diagnostics[0].code, "ARGUMENT_INVALID");
  const preview = await call("editor/delete", {
    selector: "source.ttl",
    revision: shown.result.data.resource.revision,
    element: blank,
  });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  assert.equal(preview.result.status, "preview", JSON.stringify(preview.result));
  assert.deepEqual(preview.result.data.preview.impact.acceptance, ["confirm"]);
  assert.equal(preview.result.data.preview.arguments.statements.length, 2);
  const applied = await call("resource/apply", {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.result.status, "ok", JSON.stringify(applied.result));
  const remaining = await readFile(join(root, "source.ttl"), "utf8");
  assert.doesNotMatch(remaining, /urn:outgoing|urn:points-to/);
  assert.match(remaining, /urn:unrelated.*urn:retained/s);
});

test("deletion synchronizes every source view and preserves unrelated membership and presentation", {
  timeout: 90000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-view-delete-"));
  await initializeProject({ directory: root });
  const sourceText =
    `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n` +
    "<urn:deleted> <urn:p> <urn:keep> .\n" +
    "<urn:keep> <urn:q> <urn:other> .\n" +
    "<urn:other> <urn:r> <urn:deleted> .\n";
  await writeFile(join(root, "source.ttl"), sourceText);
  const { call } = await projectApi(root, t);
  async function apply(route: string, body: Record<string, unknown>) {
    const staged = await call(route, body);
    assert.equal(staged.status, 200, JSON.stringify(staged));
    assert.equal(staged.result.status, "preview", JSON.stringify(staged.result));
    return call("resource/apply", {
      schemaVersion: 1,
      handle: staged.result.data.handle,
      fingerprint: staged.result.data.preview.fingerprint,
      accept: [],
    });
  }
  for (const path of ["views/first.ttl", "views/second.ttl"]) {
    const created = await apply("views/create", { path, source: "source.ttl" });
    assert.equal(created.result.status, "ok", JSON.stringify(created.result));
  }
  const first = (await call("view?selector=views/first.ttl")).result.data;
  const firstSelected = await apply("view/edit", {
    selector: "views/first.ttl",
    viewRevision: first.resource.revision,
    presentationRevision: first.presentation.resource.revision,
    members: ["urn:deleted", "urn:keep", "urn:other"],
    relationships: [
      { subject: "urn:deleted", predicate: "urn:p", object: "urn:keep" },
      { subject: "urn:keep", predicate: "urn:q", object: "urn:other" },
      { subject: "urn:other", predicate: "urn:r", object: "urn:deleted" },
    ],
    positions: [
      { element: "urn:deleted", x: "1", y: "2" },
      { element: "urn:keep", x: "30", y: "40" },
      { element: "urn:other", x: "50", y: "60" },
    ],
  });
  assert.equal(firstSelected.result.status, "ok", JSON.stringify(firstSelected.result));
  await addPresentationStyle(join(root, "views/first.presentation.ttl"));
  const second = (await call("view?selector=views/second.ttl")).result.data;
  const secondSelected = await apply("view/edit", {
    selector: "views/second.ttl",
    viewRevision: second.resource.revision,
    presentationRevision: second.presentation.resource.revision,
    members: ["urn:deleted", "urn:keep"],
    relationships: [{ subject: "urn:deleted", predicate: "urn:p", object: "urn:keep" }],
    positions: [
      { element: "urn:deleted", x: "-1", y: "-2" },
      { element: "urn:keep", x: "70", y: "80" },
    ],
  });
  assert.equal(secondSelected.result.status, "ok", JSON.stringify(secondSelected.result));
  const source = await call("editor?selector=source.ttl");
  const firstPresentationPath = join(root, "views/first.presentation.ttl");
  const firstPresentationBytes = await readFile(firstPresentationPath);
  await writeFile(firstPresentationPath, "malformed Turtle [\n");
  const malformed = await call("editor/delete", {
    selector: "source.ttl",
    revision: source.result.data.resource.revision,
    element: { kind: "iri", value: "urn:deleted" },
  });
  assert.equal(malformed.status, 422, JSON.stringify(malformed));
  assert.ok(
    malformed.result.diagnostics.some((diagnostic: { code: string }) =>
      ["RDF_SYNTAX", "PRESENTATION_INVALID"].includes(diagnostic.code),
    ),
  );
  assert.deepEqual(await readFile(join(root, "source.ttl"), "utf8"), sourceText);
  await writeFile(firstPresentationPath, firstPresentationBytes);
  const deletion = await call("editor/delete", {
    selector: "source.ttl",
    revision: source.result.data.resource.revision,
    element: { kind: "iri", value: "urn:deleted" },
  });
  assert.equal(deletion.status, 200, JSON.stringify(deletion));
  assert.deepEqual(deletion.result.data.preview.impact.affectedFiles, [
    "source.ttl",
    "views/first.presentation.ttl",
    "views/first.ttl",
    "views/second.presentation.ttl",
    "views/second.ttl",
  ]);
  await writeFile(
    firstPresentationPath,
    Buffer.concat([firstPresentationBytes, Buffer.from("\n# intervening presentation edit\n")]),
  );
  const staleApply = await call("resource/apply", {
    schemaVersion: 1,
    handle: deletion.result.data.handle,
    fingerprint: deletion.result.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(staleApply.status, 409, JSON.stringify(staleApply));
  assert.ok(
    staleApply.result.diagnostics.some(
      (diagnostic: { code: string }) => diagnostic.code === "REVISION_CONFLICT",
    ),
  );
  assert.deepEqual(await readFile(join(root, "source.ttl"), "utf8"), sourceText);
  const interveningPresentation = await readFile(firstPresentationPath);
  assert.match(interveningPresentation.toString("utf8"), /intervening presentation edit/);
  await call("resource/cancel", { schemaVersion: 1, handle: deletion.result.data.handle });
  const refreshedSource = await call("editor?selector=source.ttl");
  const refreshedDeletion = await call("editor/delete", {
    selector: "source.ttl",
    revision: refreshedSource.result.data.resource.revision,
    element: { kind: "iri", value: "urn:deleted" },
  });
  const applied = await call("resource/apply", {
    schemaVersion: 1,
    handle: refreshedDeletion.result.data.handle,
    fingerprint: refreshedDeletion.result.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(applied.result.status, "ok", JSON.stringify(applied.result));
  for (const [selector, members] of [
    ["views/first.ttl", ["urn:keep", "urn:other"]],
    ["views/second.ttl", ["urn:keep"]],
  ] as const) {
    const view = (await call(`view?selector=${encodeURIComponent(selector)}`)).result.data;
    assert.deepEqual(view.members, members);
    assert.ok(
      view.relationships.every(
        (triple: { subject: string; object: string }) =>
          triple.subject !== "urn:deleted" && triple.object !== "urn:deleted",
      ),
    );
    assert.ok(
      view.presentation.triples.some(
        (triple: { predicate: { value: string }; object: { value: string } }) =>
          triple.predicate.value === "https://talby.ai/ontology/tbspec#x" &&
          triple.object.value === (selector === "views/first.ttl" ? "30" : "70"),
      ),
    );
    if (selector === "views/first.ttl")
      assert.ok(
        view.presentation.triples.some(
          (triple: { predicate: { value: string }; object: { value: string } }) =>
            triple.predicate.value === "urn:custom-style" && triple.object.value === "preserve-me",
        ),
      );
  }
  const sourceAfter = await readFile(join(root, "source.ttl"), "utf8");
  assert.match(sourceAfter, /urn:keep.*urn:q.*urn:other/s);
});

test("locked and ordinary cross-graph references are disclosed and left untouched", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-locked-delete-"));
  await initializeProject({ directory: root });
  const { call } = await projectApi(root, t);
  const lockedGraph = await call("graph?selector=dep%3Atbspec-state-machine");
  assert.equal(lockedGraph.status, 200, JSON.stringify(lockedGraph));
  const target = lockedGraph.result.data.triples.find(
    (triple: { subject: { kind: string } }) => triple.subject.kind === "iri",
  ).subject.value as string;
  await writeFile(
    join(root, "source.ttl"),
    `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n<urn:item> <urn:relation> <${target}> .\n`,
  );
  await writeFile(join(root, "external.ttl"), `<${target}> <urn:ordinary> <urn:value> .\n`);
  const lockedPath = join(root, lockedGraph.result.data.resource.file as string);
  const lockedBefore = await readFile(lockedPath);
  const shown = await call("editor?selector=source.ttl");
  const preview = await call("editor/delete", {
    selector: "source.ttl",
    revision: shown.result.data.resource.revision,
    element: { kind: "iri", value: target },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview));
  const references = preview.result.data.preview.arguments.references as {
    selector: string;
    position: string;
  }[];
  assert.ok(
    references.some(
      (reference) => reference.selector.startsWith("dep:") && reference.position === "subject",
    ),
  );
  assert.ok(references.some((reference) => reference.selector === "external.ttl"));
  const applied = await call("resource/apply", {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(applied.result.status, "ok", JSON.stringify(applied.result));
  assert.deepEqual(await readFile(lockedPath), lockedBefore);
  assert.deepEqual(
    await readFile(join(root, "external.ttl"), "utf8"),
    `<${target}> <urn:ordinary> <urn:value> .\n`,
  );
});

test("a deletion preview cannot be accepted after a source revision changes", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-stale-delete-"));
  await initializeProject({ directory: root });
  const source = `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n<urn:item> <urn:p> <urn:value> .\n`;
  await writeFile(join(root, "source.ttl"), source);
  const { call } = await projectApi(root, t);
  const shown = await call("editor?selector=source.ttl");
  const preview = await call("editor/delete", {
    selector: "source.ttl",
    revision: shown.result.data.resource.revision,
    element: { kind: "iri", value: "urn:item" },
  });
  assert.equal(preview.result.status, "preview", JSON.stringify(preview.result));
  const intervening = `${source}# accepted preview must be stale\n`;
  await writeFile(join(root, "source.ttl"), intervening);
  const applied = await call("resource/apply", {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(applied.status, 409, JSON.stringify(applied));
  assert.ok(
    applied.result.diagnostics.some((diagnostic: { code: string }) =>
      ["REVISION_CONFLICT", "PREVIEW_CHANGED"].includes(diagnostic.code),
    ),
  );
  assert.deepEqual(await readFile(join(root, "source.ttl"), "utf8"), intervening);
});

test("confirmed deletion may preserve explicitly diagnosed SHACL invalidity across a restart", {
  timeout: 90000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-invalid-delete-"));
  await initializeProject({ directory: root, baseIri: "urn:delete-invalid:/" });
  const source = `@prefix t: <https://talby.ai/ontology/tbspec#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
<urn:model> a t:ConcreteDataModel; t:modelType "data" .
<urn:Person> a owl:Class .
<urn:alice> a <urn:Person>; <urn:name> "Alice" .
`;
  const shapes = `@prefix t: <https://talby.ai/ontology/tbspec#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
<urn:shapes> a t:ShapesGraph .
<urn:required-name> a sh:NodeShape; sh:targetClass <urn:Person>;
  sh:property [ sh:path <urn:name>; sh:minCount 1 ] .
`;
  await writeFile(join(root, "model.ttl"), source);
  await writeFile(join(root, "model.shacl.ttl"), shapes);
  const api = await projectApi(root, t);
  const shown = await api.call("editor?selector=model.ttl");
  assert.equal(shown.status, 200, JSON.stringify(shown));
  const preview = await api.call("editor/delete", {
    selector: "model.ttl",
    revision: shown.result.data.resource.revision,
    element: { kind: "iri", value: "urn:name" },
  });
  assert.equal(preview.result.status, "preview", JSON.stringify(preview.result));
  assert.equal(preview.result.data.projectValidity, "invalid", JSON.stringify(preview.result));
  assert.ok(
    preview.result.diagnostics.some(
      (diagnostic: { code: string; severity: string }) =>
        diagnostic.code === "SHACL_RESULT" && diagnostic.severity === "error",
    ),
    JSON.stringify(preview.result.diagnostics),
  );
  assert.deepEqual(await readFile(join(root, "model.ttl"), "utf8"), source);
  const applied = await api.call("resource/apply", {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.result.status, "ok", JSON.stringify(applied.result));
  assert.equal(applied.result.data.projectValidity, "invalid", JSON.stringify(applied.result));
  assert.deepEqual(await readFile(join(root, "model.shacl.ttl"), "utf8"), shapes);
  await api.stop();
  const restarted = await projectApi(root, t);
  const validated = await restarted.call("validate?selector=model.ttl");
  assert.equal(validated.status, 422, JSON.stringify(validated));
  assert.equal(validated.result.status, "invalid", JSON.stringify(validated.result));
  assert.ok(
    validated.result.diagnostics.some(
      (diagnostic: { code: string }) => diagnostic.code === "SHACL_RESULT",
    ),
  );
});
