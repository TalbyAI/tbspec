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
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

test("authenticated views keep independent membership and presentation and include exact endpoints", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-views-http-"));
  await initializeProject({ directory: root, baseIri: "urn:views-http:/" });
  await writeFile(
    join(root, "source.ttl"),
    "<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n" +
      "<urn:a> <urn:p> <urn:b>; <urn:q> <urn:b>; <urn:p> <urn:a> .\n<urn:b> <urn:q> <urn:c> .\n",
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
  async function apply(route: string, body: Record<string, unknown>) {
    const staged = await call(route, body);
    assert.equal(staged.status, 200, JSON.stringify(staged));
    assert.equal(staged.envelope.status, "preview", JSON.stringify(staged));
    const preview = staged.envelope.data;
    return call("resource/apply", {
      schemaVersion: 1,
      handle: preview.handle,
      fingerprint: preview.preview.fingerprint,
      accept: [],
    });
  }

  const initialViews = await call("views");
  assert.equal(initialViews.status, 200, JSON.stringify(initialViews));
  const firstCreated = await apply("views/create", { path: "views/one.ttl", source: "source.ttl" });
  assert.equal(firstCreated.status, 200, JSON.stringify(firstCreated));
  assert.equal(firstCreated.envelope.status, "ok", JSON.stringify(firstCreated));
  const secondCreated = await apply("views/create", {
    path: "views/two.ttl",
    source: "source.ttl",
  });
  assert.equal(secondCreated.envelope.status, "ok", JSON.stringify(secondCreated));
  const views = await call("views?source=source.ttl");
  assert.deepEqual(
    views.envelope.data.items.map((view: { selector: string }) => view.selector),
    ["views/one.ttl", "views/two.ttl"],
  );

  const one = (await call("view?selector=views/one.ttl")).envelope.data;
  const sourceBytesBeforeAppearanceEdit = await readFile(join(root, "source.ttl"));
  const rejectedAppearance = await call("view/edit", {
    selector: "views/one.ttl",
    viewRevision: one.resource.revision,
    presentationRevision: one.presentation.resource.revision,
    members: ["urn:a", "urn:b"],
    relationships: [],
    nodeAppearances: [{ element: "urn:a", backgroundImage: "url(https://example.test/x)" }],
  });
  assert.equal(rejectedAppearance.status, 400, JSON.stringify(rejectedAppearance));
  const rejectedNumber = await call("view/edit", {
    selector: "views/one.ttl",
    viewRevision: one.resource.revision,
    presentationRevision: one.presentation.resource.revision,
    members: ["urn:a", "urn:b"],
    relationships: [],
    nodeAppearances: [{ element: "urn:a", fontSize: 15.5 }],
  });
  assert.equal(rejectedNumber.status, 400, JSON.stringify(rejectedNumber));
  const rejectedFractionalWeight = await call("view/edit", {
    selector: "views/one.ttl",
    viewRevision: one.resource.revision,
    presentationRevision: one.presentation.resource.revision,
    members: ["urn:a", "urn:b"],
    relationships: [],
    nodeAppearances: [{ element: "urn:a", fontWeight: "500.5" }],
  });
  assert.equal(rejectedFractionalWeight.status, 400, JSON.stringify(rejectedFractionalWeight));
  const selected = await apply("view/edit", {
    selector: "views/one.ttl",
    viewRevision: one.resource.revision,
    presentationRevision: one.presentation.resource.revision,
    members: ["urn:a", "urn:b"],
    relationships: [{ subject: "urn:a", predicate: "urn:p", object: "urn:a" }],
    positions: [
      { element: "urn:a", x: "-1.5", y: "2.25" },
      { element: "urn:b", x: "8", y: "9" },
    ],
    nodeAppearances: [
      {
        element: "urn:a",
        fillColor: "#abcdef80",
        group: "Primary",
        fontSize: "15.5",
        fontWeight: "500",
      },
    ],
    relationshipAppearances: [
      {
        subject: "urn:a",
        predicate: "urn:p",
        object: "urn:a",
        strokeWidth: "2.5",
        edgeRouting: "straight",
      },
    ],
  });
  assert.equal(selected.envelope.status, "ok", JSON.stringify(selected));
  const oneAfter = (await call("view?selector=views/one.ttl")).envelope.data;
  assert.deepEqual(oneAfter.members, ["urn:a", "urn:b"]);
  assert.deepEqual(
    oneAfter.relationships.map((tuple: { subject: string; predicate: string; object: string }) => [
      tuple.subject,
      tuple.predicate,
      tuple.object,
    ]),
    [
      ["urn:a", "urn:p", "urn:a"],
      ["urn:a", "urn:p", "urn:b"],
      ["urn:a", "urn:q", "urn:b"],
    ],
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { object: { value: string } }) => triple.object.value === "-1.5",
    ),
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { object: { value: string } }) => triple.object.value === "2.25",
    ),
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}fillColor` && triple.object.value === "#abcdef80",
    ),
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}group` && triple.object.value === "Primary",
    ),
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}fontSize` && triple.object.value === "15.5",
    ),
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}fontWeight` && triple.object.value === "500",
    ),
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}strokeWidth` && triple.object.value === "2.5",
    ),
  );
  assert.ok(
    oneAfter.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}edgeRouting` && triple.object.value === "straight",
    ),
  );
  assert.deepEqual(await readFile(join(root, "source.ttl")), sourceBytesBeforeAppearanceEdit);
  const staleWrite = await call("view/edit", {
    selector: "views/one.ttl",
    viewRevision: one.resource.revision,
    presentationRevision: one.presentation.resource.revision,
    members: ["urn:a", "urn:b"],
    relationships: [{ subject: "urn:a", predicate: "urn:p", object: "urn:a" }],
    positions: [
      { element: "urn:a", x: "-1.5", y: "2.25" },
      { element: "urn:b", x: "8", y: "9" },
    ],
    nodeAppearances: [{ element: "urn:a", fillColor: "#ff0000" }],
  });
  assert.equal(staleWrite.status, 409, JSON.stringify(staleWrite));
  const afterStaleWrite = (await call("view?selector=views/one.ttl")).envelope.data;
  assert.ok(
    afterStaleWrite.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}fillColor` && triple.object.value === "#abcdef80",
    ),
  );
  const two = (await call("view?selector=views/two.ttl")).envelope.data;
  const secondSelection = await apply("view/edit", {
    selector: "views/two.ttl",
    viewRevision: two.resource.revision,
    presentationRevision: two.presentation.resource.revision,
    members: ["urn:b", "urn:c"],
    relationships: [{ subject: "urn:b", predicate: "urn:q", object: "urn:c" }],
    positions: [{ element: "urn:b", x: "7.5", y: "-8.25" }],
    nodeAppearances: [{ element: "urn:b", fillColor: "#ffccaa" }],
  });
  assert.equal(secondSelection.envelope.status, "ok", JSON.stringify(secondSelection));
  const oneCurrent = (await call("view?selector=views/one.ttl")).envelope.data;
  const removeLocalMember = await apply("view/edit", {
    selector: "views/one.ttl",
    viewRevision: oneCurrent.resource.revision,
    presentationRevision: oneCurrent.presentation.resource.revision,
    members: ["urn:a"],
    relationships: [{ subject: "urn:a", predicate: "urn:p", object: "urn:a" }],
    positions: [{ element: "urn:a", x: "-1.5", y: "2.25" }],
  });
  assert.equal(removeLocalMember.envelope.status, "ok", JSON.stringify(removeLocalMember));
  const oneAfterRemoval = (await call("view?selector=views/one.ttl")).envelope.data;
  assert.deepEqual(oneAfterRemoval.members, ["urn:a"]);
  assert.ok(
    !oneAfterRemoval.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        ["urn:b", "urn:c"].includes(triple.object.value) &&
        [`${metadata}element`, `${rdf}subject`, `${rdf}object`].includes(triple.predicate.value),
    ),
  );
  const twoAfter = (await call("view?selector=views/two.ttl")).envelope.data;
  assert.deepEqual(twoAfter.members, ["urn:b", "urn:c"]);
  assert.deepEqual(twoAfter.relationships, [
    { subject: "urn:b", predicate: "urn:q", object: "urn:c" },
  ]);
  assert.ok(
    twoAfter.presentation.triples.some(
      (triple: { object: { value: string } }) => triple.object.value === "-8.25",
    ),
  );
  assert.ok(
    twoAfter.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}fillColor` && triple.object.value === "#ffccaa",
    ),
  );
  assert.equal(
    (await call("view?selector=views/one.ttl")).envelope.data.presentation.triples.some(
      (triple: { predicate: { value: string }; object: { value: string } }) =>
        triple.predicate.value === `${metadata}fillColor` && triple.object.value === "#abcdef80",
    ),
    true,
  );

  const lockedGraph = await call("graph?selector=dep%3Atbspec-state-machine");
  assert.equal(lockedGraph.status, 200, JSON.stringify(lockedGraph));
  const lockedTerm = lockedGraph.envelope.data.triples.find(
    (triple: { subject: { kind: string } }) => triple.subject.kind === "iri",
  );
  assert.ok(lockedTerm);
  const lockedMember = lockedTerm.subject.value as string;
  const lockedSourceBytes = await readFile(join(root, lockedGraph.envelope.data.resource.file));
  const lockedCreated = await apply("views/create", {
    path: "views/locked.ttl",
    source: "dep:tbspec-state-machine",
  });
  assert.equal(lockedCreated.envelope.status, "ok", JSON.stringify(lockedCreated));
  const lockedView = (await call("view?selector=views/locked.ttl")).envelope.data;
  const lockedEdited = await apply("view/edit", {
    selector: "views/locked.ttl",
    viewRevision: lockedView.resource.revision,
    presentationRevision: lockedView.presentation.resource.revision,
    members: [lockedMember],
    relationships: [],
    positions: [{ element: lockedMember, x: "-3.25", y: "4.5" }],
  });
  assert.equal(lockedEdited.envelope.status, "ok", JSON.stringify(lockedEdited));
  assert.deepEqual(
    await readFile(join(root, lockedGraph.envelope.data.resource.file)),
    lockedSourceBytes,
  );
});
