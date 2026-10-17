import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const offline = new URL("fixtures/offline.ts", import.meta.url).href;
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const metadata = "https://talby.ai/ontology/tbspec#";

function invoke(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, ["--import", offline, cli, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PATH: "" },
  });
  assert.ok(result.stdout.trim(), result.stderr);
  const envelope = JSON.parse(result.stdout) as {
    status: string;
    data: { preview: { fingerprint: string } };
    diagnostics: { code: string }[];
  };
  return { status: result.status, envelope, stderr: result.stderr };
}

test("editor inspection returns same-snapshot design resolution after exact type edits", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-editor-design-web-"));
  await initializeProject({ directory: root, baseIri: "urn:editor-design:/" });
  await writeFile(
    join(root, "model.ttl"),
    `@prefix t: <${metadata}> . @prefix ex: <urn:editor-design:> . @prefix owl: <http://www.w3.org/2002/07/owl#> .\n` +
      `ex:model a t:ConcreteDataModel; t:modelType "data" . ex:Thing a owl:Class . ex:Other a owl:Class . ex:item a ex:Thing .\n`,
  );
  await writeFile(
    join(root, "design.ttl"),
    `@prefix t: <${metadata}> . @prefix ex: <urn:editor-design:> .\n` +
      `ex:design a t:VisualDesignModel; t:rule ex:thingRule, ex:otherRule . ` +
      `ex:thingRule a t:NodeVisualRule; t:targetConcept ex:Thing; t:fillColor "#112233" . ` +
      `ex:otherRule a t:NodeVisualRule; t:targetConcept ex:Other; t:fillColor "#334455" .\n`,
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
  async function applyPreview(staged: { envelope: { data: Record<string, unknown> | null } }) {
    const preview = staged.envelope.data as {
      handle: string;
      preview: { fingerprint: string };
    };
    return call("resource/apply", {
      schemaVersion: 1,
      handle: preview.handle,
      fingerprint: preview.preview.fingerprint,
      accept: [],
    });
  }

  const before = await call("editor?selector=model.ttl");
  assert.equal(before.status, 200, JSON.stringify(before));
  const beforeData = before.envelope.data as {
    resource: { revision: { state: string; digest: string } };
    triples: {
      subject: { kind: string; value: string };
      predicate: { kind: string; value: string };
      object: { kind: string; value: string };
    }[];
    designResolution?: {
      effectivePresentation?: {
        nodes: Record<string, { appearance: Record<string, { value: string }> }>;
      };
    };
  };
  assert.equal(
    beforeData.designResolution?.effectivePresentation?.nodes["urn:editor-design:item"]?.appearance
      .fillColor?.value,
    "#112233",
    "normal editor inspection supplies the rendered rule resolution from its captured snapshot",
  );

  const typeTriple = beforeData.triples.find(
    (triple) =>
      triple.subject.value === "urn:editor-design:item" &&
      triple.predicate.value === `${rdf}type` &&
      triple.object.value === "urn:editor-design:Thing",
  );
  assert.ok(typeTriple);
  const staged = await call("editor/save", {
    selector: "model.ttl",
    revision: beforeData.resource.revision,
    edits: [
      {
        action: "replace",
        before: typeTriple,
        after: {
          ...typeTriple,
          object: { kind: "iri", value: "urn:editor-design:Other" },
        },
      },
    ],
  });
  assert.equal(staged.status, 200, JSON.stringify(staged));
  assert.equal(staged.envelope.status, "preview", JSON.stringify(staged));
  const applied = await applyPreview(staged);
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.envelope.status, "ok", JSON.stringify(applied));

  const after = await call("editor?selector=model.ttl");
  assert.equal(after.status, 200, JSON.stringify(after));
  const afterData = after.envelope.data as typeof beforeData;
  assert.equal(
    afterData.designResolution?.effectivePresentation?.nodes["urn:editor-design:item"]?.appearance
      .fillColor?.value,
    "#334455",
    "the editor returns fresh same-snapshot design resolution after the source type changes",
  );
  assert.ok(
    afterData.triples.some(
      (triple) =>
        triple.subject.value === "urn:editor-design:item" &&
        triple.predicate.value === `${rdf}type` &&
        triple.object.value === "urn:editor-design:Other",
    ),
  );
  assert.ok(
    !afterData.triples.some(
      (triple) =>
        triple.subject.value === "urn:editor-design:item" &&
        triple.predicate.value === `${rdf}type` &&
        triple.object.value === "urn:editor-design:Thing",
    ),
  );
});

test("locked model editor inspection resolves manual design support and remains read-only", {
  // Provisioning two locked dependencies runs four isolated CLI subprocesses.
  timeout: 180000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-locked-editor-design-web-"));
  const project = join(root, "project");
  const source = join(root, "source");
  const designSource = join(root, "design-source");
  await initializeProject({ directory: project, baseIri: "urn:locked-editor-design:/" });
  await mkdir(source, { recursive: true });
  await mkdir(designSource, { recursive: true });
  await writeFile(
    join(source, "model.ttl"),
    `@prefix t: <${metadata}> . @prefix ex: <urn:locked-editor-design:> . @prefix owl: <http://www.w3.org/2002/07/owl#> .\n` +
      `ex:model a t:Model . ex:Thing a owl:Class . ex:item a ex:Thing .\n`,
  );
  await writeFile(
    join(designSource, "design.ttl"),
    `@prefix t: <${metadata}> . @prefix ex: <urn:locked-editor-design:> .\n` +
      `ex:design a t:VisualDesignModel; t:rule ex:thingRule . ` +
      `ex:thingRule a t:NodeVisualRule; t:targetConcept ex:Thing; t:fillColor "#224466" .\n`,
  );
  const added = invoke(
    ["dependency", "add", "manual-model", "--source", source, "--kind", "model"],
    project,
  );
  assert.equal(added.status, 3, added.stderr);
  const acceptedAdd = invoke(
    [
      "dependency",
      "add",
      "manual-model",
      "--source",
      source,
      "--kind",
      "model",
      "--accepted-preview",
      added.envelope.data.preview.fingerprint,
    ],
    project,
  );
  assert.equal(acceptedAdd.status, 0, acceptedAdd.stderr);
  const support = [
    "dependency",
    "support",
    "set",
    "manual-model",
    "--target",
    "dep:manual-model/source/model.ttl",
    "--role",
    "design",
    "--source",
    designSource,
    "--resource",
    "design.ttl",
  ];
  const supportPreview = invoke(support, project);
  assert.equal(supportPreview.status, 3, supportPreview.stderr);
  const acceptedSupport = invoke(
    [...support, "--accepted-preview", supportPreview.envelope.data.preview.fingerprint],
    project,
  );
  assert.equal(acceptedSupport.status, 0, acceptedSupport.stderr);

  const serverProject = await realpath(project);
  const serverStarting = startWebServer(serverProject);
  t.after(async () => (await serverStarting).stop());
  const server = await serverStarting;
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

  const selector = "dep:manual-model/source/model.ttl";
  const shown = await call(`editor?selector=${encodeURIComponent(selector)}`);
  assert.equal(shown.status, 200, JSON.stringify(shown));
  const data = shown.envelope.data as {
    resource: {
      ownership: string;
      file: string;
      revision: { state: string; digest: string };
    };
    sourceText: string;
    designResolution?: {
      effectivePresentation?: {
        nodes: Record<string, { appearance: Record<string, { value: string }> }>;
      };
    };
  };
  assert.equal(data.resource.ownership, "dependency");
  assert.equal(
    data.designResolution?.effectivePresentation?.nodes["urn:locked-editor-design:item"]?.appearance
      .fillColor?.value,
    "#224466",
    "locked editor inspection resolves the manually attached winning design rule",
  );
  const lockedPath = join(project, data.resource.file);
  const lockedBytes = await readFile(lockedPath);
  const edit = await call("editor/save", {
    selector,
    revision: data.resource.revision,
    sourceText: "<urn:locked-editor-design:item> <urn:blocked> true .",
  });
  assert.equal(edit.status, 400, JSON.stringify(edit));
  assert.equal(edit.envelope.diagnostics[0]?.code, "READ_ONLY");
  const creation = await call("editor/save", {
    selector,
    revision: data.resource.revision,
    creation: { iri: "urn:locked-editor-design:new", type: "urn:locked-editor-design:Thing" },
  });
  assert.equal(creation.status, 400, JSON.stringify(creation));
  assert.equal(creation.envelope.diagnostics[0]?.code, "READ_ONLY");
  assert.deepEqual(await readFile(lockedPath), lockedBytes);
});
