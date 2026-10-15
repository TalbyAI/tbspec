import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Term } from "@rdfjs/types";
import { Parser, Store } from "n3";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

function nonPositionPresentationTriples(bytes: Buffer): string[] {
  const store = new Store(new Parser().parse(bytes.toString("utf8")));
  const presentationType = "https://talby.ai/ontology/tbspec#PresentationGraph";
  const root = [...store].find(
    (statement) =>
      statement.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
      statement.object.value === presentationType,
  )?.subject;
  assert.ok(root);
  const recordNames = new Map<string, string>();
  for (const record of store.getObjects(
    root,
    "https://talby.ai/ontology/tbspec#nodePresentation",
    null,
  )) {
    const element = store.getObjects(record, "https://talby.ai/ontology/tbspec#element", null)[0];
    if (element?.termType === "NamedNode" && record.termType === "BlankNode")
      recordNames.set(record.value, `node:${element.value}`);
  }
  for (const record of store.getObjects(
    root,
    "https://talby.ai/ontology/tbspec#relationshipPresentation",
    null,
  )) {
    const subject = store.getObjects(
      record,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#subject",
      null,
    )[0];
    const predicate = store.getObjects(
      record,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate",
      null,
    )[0];
    const object = store.getObjects(
      record,
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#object",
      null,
    )[0];
    if (
      record.termType === "BlankNode" &&
      subject?.termType === "NamedNode" &&
      predicate?.termType === "NamedNode" &&
      object?.termType === "NamedNode"
    )
      recordNames.set(
        record.value,
        `edge:${JSON.stringify([subject.value, predicate.value, object.value])}`,
      );
  }
  const termIdentity = (term: Term) => {
    if (term.termType === "BlankNode") return ["record", recordNames.get(term.value) ?? "unlinked"];
    if (term.termType === "Literal")
      return ["literal", term.value, term.datatype.value, term.language];
    return [term.termType, term.value];
  };
  return [...store]
    .filter(
      (statement) =>
        statement.predicate.value !== "https://talby.ai/ontology/tbspec#x" &&
        statement.predicate.value !== "https://talby.ai/ontology/tbspec#y",
    )
    .map((statement) =>
      JSON.stringify([
        termIdentity(statement.subject),
        statement.predicate.value,
        termIdentity(statement.object),
      ]),
    )
    .sort();
}

test("authenticated layout edits reject stale sources and keep decimal coordinates lexical", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-view-layout-http-"));
  await initializeProject({ directory: root, baseIri: "urn:view-layout:/" });
  await writeFile(
    join(root, "source.ttl"),
    `<urn:view-layout:ontology> a <http://www.w3.org/2002/07/owl#Ontology> .\n` +
      `<urn:view-layout:a> <urn:view-layout:p> <urn:view-layout:b> ; ` +
      `<urn:view-layout:q> <urn:view-layout:b> .\n` +
      `<urn:view-layout:b> <urn:view-layout:p> <urn:view-layout:b> .\n`,
  );

  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  const link = await controlRequest(server.record, "opening-link", {});
  const opened = await fetch(new URL("api/auth/v1/bootstrap", base), {
    method: "POST",
    headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: 1,
      bootstrap: new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length),
    }),
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
  async function stage(body: Record<string, unknown>) {
    const result = await call("view/edit", body);
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.envelope.status, "preview", JSON.stringify(result));
    return result.envelope.data as {
      handle: string;
      preview: { fingerprint: string; changes: { file: string }[] };
    };
  }
  async function apply(preview: { handle: string; preview: { fingerprint: string } }) {
    return call("resource/apply", {
      schemaVersion: 1,
      handle: preview.handle,
      fingerprint: preview.preview.fingerprint,
      accept: [],
    });
  }
  async function cancel(handle: string) {
    return call("resource/cancel", { schemaVersion: 1, handle });
  }

  const created = await call("views/create", { path: "views/layout.ttl", source: "source.ttl" });
  assert.equal(created.status, 200, JSON.stringify(created));
  assert.equal(created.envelope.status, "preview", JSON.stringify(created));
  const createdData = created.envelope.data as { handle: string; preview: { fingerprint: string } };
  const appliedCreation = await call("resource/apply", {
    schemaVersion: 1,
    handle: createdData.handle,
    fingerprint: createdData.preview.fingerprint,
    accept: [],
  });
  assert.equal(appliedCreation.envelope.status, "ok", JSON.stringify(appliedCreation));

  const originalSource = await call("graph?selector=source.ttl");
  assert.equal(originalSource.status, 200, JSON.stringify(originalSource));
  const originalRevision = originalSource.envelope.data.resource.revision;
  const sourceBytes = await readFile(join(root, "source.ttl"));
  await writeFile(join(root, "source.ttl"), `${sourceBytes.toString("utf8")}# label edit\n`);
  const changedSourceBytes = await readFile(join(root, "source.ttl"));

  const shown = await call("view?selector=views/layout.ttl");
  assert.equal(shown.status, 200, JSON.stringify(shown));
  const current = shown.envelope.data as {
    resource: { revision: unknown };
    presentation: { resource: { revision: unknown } };
    members: string[];
    relationships: { subject: string; predicate: string; object: string }[];
  };
  const viewBytes = await readFile(join(root, "views/layout.ttl"));
  const presentationBytes = await readFile(join(root, "views/layout.presentation.ttl"));
  const stale = await call("view/edit", {
    selector: "views/layout.ttl",
    sourceRevision: originalRevision,
    viewRevision: current.resource.revision,
    presentationRevision: current.presentation.resource.revision,
    members: ["urn:view-layout:a", "urn:view-layout:b"],
    relationships: [
      { subject: "urn:view-layout:a", predicate: "urn:view-layout:p", object: "urn:view-layout:b" },
      { subject: "urn:view-layout:a", predicate: "urn:view-layout:q", object: "urn:view-layout:b" },
      { subject: "urn:view-layout:b", predicate: "urn:view-layout:p", object: "urn:view-layout:b" },
    ],
    positions: [
      { element: "urn:view-layout:a", x: "-12.375", y: "4.5" },
      { element: "urn:view-layout:b", x: "0.125", y: "-8.75" },
    ],
  });
  assert.equal(stale.status, 409, JSON.stringify(stale));
  assert.equal(stale.envelope.diagnostics[0]?.code, "REVISION_CONFLICT");
  assert.deepEqual(await readFile(join(root, "views/layout.ttl")), viewBytes);
  assert.deepEqual(await readFile(join(root, "views/layout.presentation.ttl")), presentationBytes);

  const currentSource = await call("graph?selector=source.ttl");
  assert.equal(currentSource.status, 200, JSON.stringify(currentSource));
  const staged = await stage({
    selector: "views/layout.ttl",
    sourceRevision: currentSource.envelope.data.resource.revision,
    viewRevision: current.resource.revision,
    presentationRevision: current.presentation.resource.revision,
    members: ["urn:view-layout:a", "urn:view-layout:b"],
    relationships: [
      { subject: "urn:view-layout:a", predicate: "urn:view-layout:p", object: "urn:view-layout:b" },
      { subject: "urn:view-layout:a", predicate: "urn:view-layout:q", object: "urn:view-layout:b" },
      { subject: "urn:view-layout:b", predicate: "urn:view-layout:p", object: "urn:view-layout:b" },
    ],
    positions: [
      { element: "urn:view-layout:a", x: "-12.375", y: "4.5" },
      { element: "urn:view-layout:b", x: "0.125", y: "-8.75" },
    ],
  });
  assert.match(staged.preview.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.ok(
    staged.preview.changes.some((change) => change.file === "views/layout.presentation.ttl"),
  );
  const cancelled = await cancel(staged.handle);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled));
  assert.equal(cancelled.envelope.status, "ok", JSON.stringify(cancelled));
  assert.deepEqual(await readFile(join(root, "views/layout.ttl")), viewBytes);
  assert.deepEqual(await readFile(join(root, "views/layout.presentation.ttl")), presentationBytes);

  const accepted = await stage({
    selector: "views/layout.ttl",
    sourceRevision: currentSource.envelope.data.resource.revision,
    viewRevision: current.resource.revision,
    presentationRevision: current.presentation.resource.revision,
    members: ["urn:view-layout:a", "urn:view-layout:b"],
    relationships: [
      { subject: "urn:view-layout:a", predicate: "urn:view-layout:p", object: "urn:view-layout:b" },
      { subject: "urn:view-layout:a", predicate: "urn:view-layout:q", object: "urn:view-layout:b" },
      { subject: "urn:view-layout:b", predicate: "urn:view-layout:p", object: "urn:view-layout:b" },
    ],
    positions: [
      { element: "urn:view-layout:a", x: "-12.375", y: "4.5" },
      { element: "urn:view-layout:b", x: "0.125", y: "-8.75" },
    ],
    nodeAppearances: [
      { element: "urn:view-layout:a", fillColor: "#AABBCC", group: "layout group" },
    ],
    relationshipAppearances: [
      {
        subject: "urn:view-layout:a",
        predicate: "urn:view-layout:p",
        object: "urn:view-layout:b",
        strokeColor: "#112233",
      },
    ],
  });
  const applied = await apply(accepted);
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.envelope.status, "ok", JSON.stringify(applied));
  const after = await call("view?selector=views/layout.ttl");
  assert.equal(after.status, 200, JSON.stringify(after));
  const coordinates = (
    after.envelope.data.presentation.triples as {
      predicate: { value: string };
      object: { value: string };
    }[]
  ).map((triple) => triple.object.value);
  assert.ok(coordinates.includes("-12.375"));
  assert.ok(coordinates.includes("4.5"));
  assert.ok(coordinates.includes("0.125"));
  assert.ok(coordinates.includes("-8.75"));
  assert.deepEqual(await readFile(join(root, "source.ttl")), changedSourceBytes);

  const otherCreation = await call("views/create", {
    path: "views/other.ttl",
    source: "source.ttl",
  });
  assert.equal(otherCreation.status, 200, JSON.stringify(otherCreation));
  const otherCreated = otherCreation.envelope.data as {
    handle: string;
    preview: { fingerprint: string };
  };
  const otherApplied = await call("resource/apply", {
    schemaVersion: 1,
    handle: otherCreated.handle,
    fingerprint: otherCreated.preview.fingerprint,
    accept: [],
  });
  assert.equal(otherApplied.status, 200, JSON.stringify(otherApplied));
  const otherViewBytes = await readFile(join(root, "views/other.ttl"));

  const layoutPath = join(root, "views/layout.ttl");
  const formattedViewBytes = Buffer.concat([
    Buffer.from("\n# Keep this harmless source comment during reorganization.\n\n"),
    await readFile(layoutPath),
  ]);
  await writeFile(layoutPath, formattedViewBytes);
  const reorgView = await call("view?selector=views/layout.ttl");
  assert.equal(reorgView.status, 200, JSON.stringify(reorgView));
  const reorgData = reorgView.envelope.data as {
    resource: { revision: unknown };
    members: string[];
    relationships: { subject: string; predicate: string; object: string }[];
    presentation: {
      resource: { revision: unknown };
    };
  };
  const priorPresentationBytes = await readFile(join(root, "views/layout.presentation.ttl"));
  const priorStablePresentation = nonPositionPresentationTriples(priorPresentationBytes);
  const reorg = await stage({
    selector: "views/layout.ttl",
    sourceRevision: currentSource.envelope.data.resource.revision,
    viewRevision: reorgData.resource.revision,
    presentationRevision: reorgData.presentation.resource.revision,
    members: reorgData.members,
    relationships: reorgData.relationships,
    positions: [
      { element: "urn:view-layout:a", x: "99.125", y: "-22.75" },
      { element: "urn:view-layout:b", x: "0.5", y: "17.25" },
    ],
    nodeAppearances: [],
    relationshipAppearances: [],
  });
  assert.deepEqual(
    reorg.preview.changes.map((change) => change.file),
    ["views/layout.presentation.ttl"],
  );
  const reorgApplied = await apply(reorg);
  assert.equal(reorgApplied.status, 200, JSON.stringify(reorgApplied));
  assert.deepEqual(await readFile(layoutPath), formattedViewBytes);
  assert.deepEqual(await readFile(join(root, "views/other.ttl")), otherViewBytes);
  assert.deepEqual(await readFile(join(root, "source.ttl")), changedSourceBytes);
  const currentPresentationBytes = await readFile(join(root, "views/layout.presentation.ttl"));
  assert.notDeepEqual(currentPresentationBytes, priorPresentationBytes);
  assert.deepEqual(
    nonPositionPresentationTriples(currentPresentationBytes),
    priorStablePresentation,
  );
});

test("authenticated saved-view edits accept a measured 1,000-member layout payload", {
  timeout: 120000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-view-layout-large-http-"));
  await initializeProject({ directory: root, baseIri: "urn:view-layout-large:/" });
  const members = Array.from(
    { length: 1000 },
    (_, index) => `urn:view-layout-large:node:${String(index).padStart(4, "0")}`,
  );
  const relationships = members.map((subject, index) => ({
    subject,
    predicate: "urn:view-layout-large:next",
    object: members[(index + 1) % members.length] ?? members[0] ?? "",
  }));
  for (let index = 1; index <= 30; index++) {
    relationships.push({
      subject: members[0] ?? "",
      predicate: "urn:view-layout-large:hub",
      object: members[index] ?? "",
    });
  }
  relationships.push(
    {
      subject: members[5] ?? "",
      predicate: "urn:view-layout-large:parallel-a",
      object: members[6] ?? "",
    },
    {
      subject: members[5] ?? "",
      predicate: "urn:view-layout-large:parallel-b",
      object: members[6] ?? "",
    },
    {
      subject: members[10] ?? "",
      predicate: "urn:view-layout-large:self",
      object: members[10] ?? "",
    },
  );
  const sourceLines = [
    `<${members[0]}> a <http://www.w3.org/2002/07/owl#Ontology> .`,
    ...["next", "hub", "parallel-a", "parallel-b", "self"].map(
      (property) =>
        `<urn:view-layout-large:${property}> a <http://www.w3.org/2002/07/owl#ObjectProperty> .`,
    ),
    ...members.map(
      (member, index) =>
        `<${member}> <http://www.w3.org/2000/01/rdf-schema#label> "Node ${index}" .`,
    ),
    ...relationships.map((tuple) => `<${tuple.subject}> <${tuple.predicate}> <${tuple.object}> .`),
  ];
  await writeFile(join(root, "source.ttl"), `${sourceLines.join("\n")}\n`);

  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  const link = await controlRequest(server.record, "opening-link", {});
  const opened = await fetch(new URL("api/auth/v1/bootstrap", base), {
    method: "POST",
    headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: 1,
      bootstrap: new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length),
    }),
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
  async function apply(handle: string, fingerprint: string) {
    return call("resource/apply", { schemaVersion: 1, handle, fingerprint, accept: [] });
  }

  const created = await call("views/create", {
    path: "views/large-layout.ttl",
    source: "source.ttl",
  });
  assert.equal(created.status, 200, JSON.stringify(created));
  assert.equal(created.envelope.status, "preview", JSON.stringify(created));
  const createData = created.envelope.data as {
    handle: string;
    preview: { fingerprint: string };
  };
  const appliedCreate = await apply(createData.handle, createData.preview.fingerprint);
  assert.equal(appliedCreate.envelope.status, "ok", JSON.stringify(appliedCreate));
  const source = await call("graph?selector=source.ttl");
  const viewResult = await call("view?selector=views/large-layout.ttl");
  assert.equal(source.status, 200, JSON.stringify(source));
  assert.equal(viewResult.status, 200, JSON.stringify(viewResult));
  const view = viewResult.envelope.data as {
    resource: { revision: unknown };
    presentation: { resource: { revision: unknown } };
  };
  const body = {
    selector: "views/large-layout.ttl",
    sourceRevision: source.envelope.data.resource.revision,
    viewRevision: view.resource.revision,
    presentationRevision: view.presentation.resource.revision,
    members,
    relationships,
    positions: members.map((element, index) => ({
      element,
      x: String(-index * 0.125),
      y: String(index * 0.375),
    })),
    nodeAppearances: [],
    relationshipAppearances: [],
  };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 65_536);
  const emptyViewBytes = await readFile(join(root, "views/large-layout.ttl"));
  const presentationBytes = await readFile(join(root, "views/large-layout.presentation.ttl"));
  const staged = await call("view/edit", body);
  assert.equal(staged.status, 200, JSON.stringify(staged));
  assert.equal(staged.envelope.status, "preview", JSON.stringify(staged));
  const stagedData = staged.envelope.data as {
    handle: string;
    preview: { fingerprint: string };
  };
  const applied = await apply(stagedData.handle, stagedData.preview.fingerprint);
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.envelope.status, "ok", JSON.stringify(applied));
  const populatedViewBytes = await readFile(join(root, "views/large-layout.ttl"));
  assert.equal(populatedViewBytes.equals(emptyViewBytes), false);
  const acceptedPresentationBytes = await readFile(
    join(root, "views/large-layout.presentation.ttl"),
  );
  assert.equal(acceptedPresentationBytes.equals(presentationBytes), false);
  assert.match(acceptedPresentationBytes.toString("utf8"), /-124\.875/);
  assert.match(acceptedPresentationBytes.toString("utf8"), /374\.625/);
  const populated = await call("view?selector=views/large-layout.ttl");
  assert.equal(populated.status, 200, JSON.stringify(populated));
  const populatedData = populated.envelope.data as {
    resource: { revision: unknown };
    presentation: { resource: { revision: unknown } };
  };
  const repositioned = await call("view/edit", {
    ...body,
    viewRevision: populatedData.resource.revision,
    presentationRevision: populatedData.presentation.resource.revision,
    positions: members.map((element, index) => ({
      element,
      x: String(-index * 0.25 - 7),
      y: String(index * 0.5 + 3),
    })),
  });
  assert.equal(repositioned.status, 200, JSON.stringify(repositioned));
  assert.equal(repositioned.envelope.status, "preview", JSON.stringify(repositioned));
  const repositionedData = repositioned.envelope.data as {
    handle: string;
    preview: { fingerprint: string; changes: { file: string }[] };
  };
  assert.deepEqual(
    repositionedData.preview.changes.map((change) => change.file),
    ["views/large-layout.presentation.ttl"],
  );
  const appliedRepositioning = await apply(
    repositionedData.handle,
    repositionedData.preview.fingerprint,
  );
  assert.equal(appliedRepositioning.status, 200, JSON.stringify(appliedRepositioning));
  assert.equal(appliedRepositioning.envelope.status, "ok", JSON.stringify(appliedRepositioning));
  assert.equal(
    (await readFile(join(root, "views/large-layout.ttl"))).equals(populatedViewBytes),
    true,
  );
  const status = await call("status");
  assert.equal(status.status, 200, JSON.stringify(status));
  assert.equal(status.envelope.status, "ok", JSON.stringify(status));
  const validated = await call("validate");
  assert.equal(validated.status, 200, JSON.stringify(validated));
  assert.equal(validated.envelope.status, "ok", JSON.stringify(validated));
  const shown = await call("view?selector=views/large-layout.ttl");
  assert.equal(shown.status, 200, JSON.stringify(shown));
  assert.equal((shown.envelope.data as { members: string[] }).members.length, 1000);
  const oversized = await call("view/edit", { ...body, unexpected: "x".repeat(4_194_304) });
  assert.equal(oversized.status, 400, JSON.stringify(oversized));
  assert.equal(oversized.envelope.diagnostics[0]?.message, "Request body exceeds the limit.");
});
