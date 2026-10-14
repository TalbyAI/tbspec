import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { authorResource } from "../src/authoring.ts";
import { digest, graphSignature } from "../src/canonical.ts";
import { configureModelType } from "../src/configuration.ts";
import type { FileSystem } from "../src/filesystem.ts";
import { initializeProject, inspectRecovery } from "../src/project.ts";
import { parseRdf } from "../src/rdf.ts";
import {
  inspectImpact,
  moveResource,
  prepareResourceLifecycle,
  removeResource,
} from "../src/resource-lifecycle.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";
import { capture, publishPlan } from "../src/transactions.ts";
import { showView, viewOperation } from "../src/views.ts";

const owl = "http://www.w3.org/2002/07/owl#";

async function project() {
  const root = await mkdtemp(join(tmpdir(), "tb-resource-lifecycle-"));
  assert.equal((await initializeProject({ directory: root })).status, "ok");
  return fs.realpath(root);
}

async function addLockedReference(root: string, target: string) {
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const dependency = lock.dependencies["tbspec-metadata"];
  assert.ok(dependency);
  const record = dependency.files.find((file) => file.key === dependency.primary);
  assert.ok(record);
  const file = join(root, dependency.snapshot_path, record.key);
  const bytes = Buffer.concat([
    await readFile(file),
    Buffer.from(`\n<urn:locked:subject> <urn:locked:uses> <${target}> .\n`),
  ]);
  record.byte_digest = digest(bytes);
  record.byte_length = bytes.length;
  record.graph_signature = graphSignature(record);
  dependency.interpretation_signature = interpretationSignature(dependency);
  await writeFile(file, bytes);
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
}

function fault(
  method: keyof FileSystem,
  replace: (...args: unknown[]) => Promise<unknown>,
): FileSystem {
  return new Proxy(fs, {
    get(target, key) {
      return key === method ? replace : Reflect.get(target, key);
    },
  });
}

test("impact discloses every known IRI occurrence, including ordinary values and locked graphs", async () => {
  const root = await project();
  const target = "urn:owned:Alice";
  await authorResource({
    project: root,
    command: "ontology.create",
    path: "vocabulary.ttl",
    iri: "urn:owned:vocabulary",
  });
  await writeFile(
    join(root, "vocabulary.ttl"),
    `<urn:owned:vocabulary> a <${owl}Ontology> . <${target}> a <${owl}NamedIndividual> .\n`,
  );
  await writeFile(
    join(root, "data.ttl"),
    `<urn:owned:data> a <https://talby.ai/ontology/tbspec#ConcreteDataModel>; <https://talby.ai/ontology/tbspec#modelType> "data" . <urn:owned:team> <urn:owned:member> <${target}> .\n`,
  );
  await addLockedReference(root, target);

  const impact = await inspectImpact({
    project: root,
    kind: "ontology",
    selector: "vocabulary.ttl",
  });
  assert.equal(impact.status, "ok", JSON.stringify(impact));
  const references = impact.data?.items as {
    file: string;
    selector?: string;
    position: string;
    targetIri: string;
  }[];
  assert.ok(references.some((item) => item.file === "data.ttl" && item.position === "object"));
  assert.ok(
    references.some(
      (item) =>
        item.file.endsWith("/tbspec.ttl") &&
        item.position === "object" &&
        item.targetIri === target,
    ),
  );
  assert.ok(impact.data);
  assert.ok((impact.data.affectedFiles as string[]).includes("data.ttl"));
});

test("impact and removal preview report incomplete reference coverage", async () => {
  const root = await project();
  await authorResource({
    project: root,
    command: "ontology.create",
    path: "vocabulary.ttl",
    iri: "urn:owned:vocabulary",
  });
  await writeFile(join(root, "broken.ttl"), "<urn:broken> <urn:predicate> [ .\n");

  const impact = await inspectImpact({
    project: root,
    kind: "ontology",
    selector: "vocabulary.ttl",
  });
  assert.ok(
    impact.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "REFERENCE_COVERAGE_INCOMPLETE" && diagnostic.file === "broken.ttl",
    ),
    JSON.stringify(impact),
  );

  const removal = await removeResource({
    project: root,
    kind: "ontology",
    selector: "vocabulary.ttl",
  });
  assert.equal(removal.status, "preview", JSON.stringify(removal));
  assert.ok(
    removal.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "REFERENCE_COVERAGE_INCOMPLETE" && diagnostic.file === "broken.ttl",
    ),
    JSON.stringify(removal),
  );
});

test("resource removal previews exact scope, requires confirmation, and retains incoming triples", async () => {
  const root = await project();
  await authorResource({
    project: root,
    command: "ontology.create",
    path: "vocabulary.ttl",
    iri: "urn:owned:vocabulary",
  });
  await writeFile(
    join(root, "data.ttl"),
    "<urn:owned:data> <urn:owned:uses> <urn:owned:vocabulary> .\n",
  );
  const preview = await removeResource({
    project: root,
    kind: "ontology",
    selector: "vocabulary.ttl",
  });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const fingerprint = (preview.data.preview as { fingerprint: string }).fingerprint;
  assert.equal((await readFile(join(root, "vocabulary.ttl"), "utf8")).includes("Ontology"), true);

  const applied = await removeResource({
    project: root,
    kind: "ontology",
    selector: "vocabulary.ttl",
    confirm: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  await assert.rejects(readFile(join(root, "vocabulary.ttl")), { code: "ENOENT" });
  assert.equal(
    (await readFile(join(root, "data.ttl"), "utf8")).includes("urn:owned:vocabulary"),
    true,
  );
});

test("moving a declared graph also moves convention-linked shapes and rewrites selectors", async () => {
  const root = await project();
  await authorResource({
    project: root,
    command: "ontology.create",
    path: "vocabulary.ttl",
    iri: "urn:owned:vocabulary",
  });
  await authorResource({ project: root, command: "shapes.create", path: "vocabulary.ttl" });
  await writeFile(
    join(root, "tbspec.toml"),
    `${await readFile(join(root, "tbspec.toml"), "utf8")}\n[[associations]]\nresource = "vocabulary.ttl"\nsupport = "vocabulary.shacl.ttl"\nrole = "shacl"\n`,
  );
  const moved = await moveResource({
    project: root,
    selector: "vocabulary.ttl",
    destination: "vocabularies/core.ttl",
  });
  assert.equal(moved.status, "preview", JSON.stringify(moved));
  assert.ok(moved.data);
  const fingerprint = (moved.data.preview as { fingerprint: string }).fingerprint;
  const applied = await moveResource({
    project: root,
    selector: "vocabulary.ttl",
    destination: "vocabularies/core.ttl",
    apply: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  assert.match(manifest, /resource = "vocabularies\/core\.ttl"/);
  assert.match(manifest, /support = "vocabularies\/core\.shacl\.ttl"/);
  await assert.rejects(readFile(join(root, "vocabulary.ttl")), { code: "ENOENT" });
  assert.equal(
    (await readFile(join(root, "vocabularies", "core.ttl"), "utf8")).includes(
      "urn:owned:vocabulary",
    ),
    true,
  );
  assert.ok(applied.data);
  assert.ok(
    (applied.data.changes as { action: string }[]).some((change) => change.action === "move"),
  );
});

test("moves preserve N-Triples bytes and Turtle text while retaining the source base", async () => {
  const root = await project();
  const ntBytes = Buffer.from(
    "# keep this comment\r\n<urn:move:subject>  <urn:move:predicate> <urn:move:object> .\r\n",
  );
  await writeFile(join(root, "source.nt"), ntBytes);
  const ntPreview = await moveResource({
    project: root,
    selector: "source.nt",
    destination: "archive/source.nt",
  });
  assert.equal(ntPreview.status, "preview", JSON.stringify(ntPreview));
  assert.ok(ntPreview.data);
  const ntMoved = await moveResource({
    project: root,
    selector: "source.nt",
    destination: "archive/source.nt",
    apply: true,
    acceptedPreview: (ntPreview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(ntMoved.status, "ok", JSON.stringify(ntMoved));
  assert.deepEqual(await readFile(join(root, "archive", "source.nt")), ntBytes);

  const turtleText =
    "# retain authored formatting\r\n" +
    "@prefix ex: <urn:move:> .\r\n" +
    "@base <../relative-base/> .\r\n" +
    "<subject> ex:predicate <object> .\r\n";
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const turtleBytes = Buffer.concat([bom, Buffer.from(turtleText)]);
  await writeFile(join(root, "source.ttl"), turtleBytes);
  const sourceGraph = await parseRdf(
    turtleBytes,
    "text/turtle",
    pathToFileURL(join(root, "source.ttl")).href,
  );
  const turtlePreview = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "archive/source.ttl",
  });
  assert.equal(turtlePreview.status, "preview", JSON.stringify(turtlePreview));
  assert.ok(turtlePreview.data);
  const turtleMoved = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "archive/source.ttl",
    apply: true,
    acceptedPreview: (turtlePreview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(turtleMoved.status, "ok", JSON.stringify(turtleMoved));
  const movedBytes = await readFile(join(root, "archive", "source.ttl"));
  assert.deepEqual(movedBytes.subarray(0, bom.length), bom);
  assert.deepEqual(
    movedBytes.subarray(
      bom.length +
        Buffer.byteLength(`@base <${pathToFileURL(join(root, "source.ttl")).href}> .\r\n`),
    ),
    turtleBytes.subarray(bom.length),
  );
  const movedText = new TextDecoder().decode(movedBytes);
  assert.ok(movedText.startsWith(`@base <${pathToFileURL(join(root, "source.ttl")).href}> .\r\n`));
  const movedGraph = await parseRdf(
    movedBytes,
    "text/turtle",
    pathToFileURL(join(root, "archive", "source.ttl")).href,
  );
  const terms = (store: typeof sourceGraph) =>
    store
      .getQuads(null, null, null, null)
      .map((item) => [item.subject.value, item.predicate.value, item.object.value].join("\u0000"))
      .sort();
  assert.deepEqual(terms(movedGraph), terms(sourceGraph));
});

test("RDF/XML moves find the real root and decode an existing xml:base", async () => {
  const root = await project();
  const sourcePath = join(root, "source.rdf");
  const destinationPath = join(root, "archive", "source.rdf");
  const sourceText =
    '<?xml version="1.0"?>\r\n' +
    "<!-- an example root: <rdf:RDF> -->\r\n" +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ' +
    'xml:base="relative/&amp;escaped/">\r\n' +
    '  <rdf:Description rdf:about="ontology">\r\n' +
    `    <rdf:type rdf:resource="${owl}Ontology"/>\r\n` +
    "  </rdf:Description>\r\n" +
    "</rdf:RDF>\r\n";
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const sourceBytes = Buffer.concat([bom, Buffer.from(sourceText)]);
  const normalizedSourceText = new TextDecoder().decode(sourceBytes);
  await writeFile(sourcePath, sourceBytes);
  const sourceGraph = await parseRdf(
    sourceBytes,
    "application/rdf+xml",
    pathToFileURL(sourcePath).href,
  );
  const preview = await moveResource({
    project: root,
    selector: "source.rdf",
    destination: "archive/source.rdf",
  });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const moved = await moveResource({
    project: root,
    selector: "source.rdf",
    destination: "archive/source.rdf",
    apply: true,
    acceptedPreview: (preview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(moved.status, "ok", JSON.stringify(moved));
  const movedBytes = await readFile(destinationPath);
  assert.deepEqual(movedBytes.subarray(0, bom.length), bom);
  const movedText = new TextDecoder().decode(movedBytes);
  const sourceRootStart = normalizedSourceText.indexOf("<rdf:RDF xmlns:");
  const sourceRootEnd = normalizedSourceText.indexOf(">\r\n", sourceRootStart) + 1;
  const movedRootStart = movedText.indexOf("<rdf:RDF xmlns:");
  const movedRootEnd = movedText.indexOf(">\r\n", movedRootStart) + 1;
  assert.deepEqual(
    movedBytes.subarray(0, bom.length + Buffer.byteLength(movedText.slice(0, movedRootStart))),
    sourceBytes.subarray(
      0,
      bom.length + Buffer.byteLength(normalizedSourceText.slice(0, sourceRootStart)),
    ),
  );
  assert.deepEqual(
    movedBytes.subarray(bom.length + Buffer.byteLength(movedText.slice(0, movedRootEnd))),
    sourceBytes.subarray(
      bom.length + Buffer.byteLength(normalizedSourceText.slice(0, sourceRootEnd)),
    ),
  );
  assert.equal(movedText.replaceAll("\r\n", "").includes("\n"), false);
  assert.ok(movedText.includes("<!-- an example root: <rdf:RDF> -->"));
  const movedGraph = await parseRdf(
    movedBytes,
    "application/rdf+xml",
    pathToFileURL(destinationPath).href,
  );
  const terms = (store: typeof sourceGraph) =>
    store
      .getQuads(null, null, null, null)
      .map((item) => [item.subject.value, item.predicate.value, item.object.value].join("\u0000"))
      .sort();
  assert.deepEqual(terms(movedGraph), terms(sourceGraph));
});

test("RDF/XML moves insert xml:base before a self-closing root slash", async () => {
  const root = await project();
  await writeFile(
    join(root, "empty.rdf"),
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>\n',
  );

  const result = await moveResource({
    project: root,
    selector: "empty.rdf",
    destination: "archive/empty.rdf",
  });
  assert.equal(result.status, "preview", JSON.stringify(result));
});

test("resource moves reject destinations excluded from project discovery", async () => {
  const root = await project();
  await writeFile(join(root, "source.ttl"), "<urn:source:s> <urn:source:p> <urn:source:o> .\n");

  for (const destination of [".git/moved.ttl", "node_modules/moved.ttl", ".tbspec/moved.ttl"]) {
    const result = await moveResource({ project: root, selector: "source.ttl", destination });
    assert.equal(result.status, "invalid_arguments", JSON.stringify(result));
    assert.equal(result.diagnostics[0]?.code, "PATH_UNSAFE");
  }
});

test("moving and removing an owned view source updates selectors and discloses dependent files", async () => {
  const root = await project();
  await authorResource({
    project: root,
    command: "ontology.create",
    path: "vocabulary.ttl",
    iri: "urn:owned:vocabulary",
  });
  const created = await viewOperation({
    project: root,
    action: "create",
    path: "views/vocabulary.ttl",
    source: "vocabulary.ttl",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const manifestPath = join(root, "tbspec.toml");
  const originalManifest = await readFile(manifestPath, "utf8");
  assert.match(originalManifest, /source = "vocabulary\.ttl"/);
  await writeFile(
    manifestPath,
    originalManifest.replace(
      'source = "vocabulary.ttl"',
      'source = "vocabulary.ttl" # preserve this note',
    ),
  );
  const viewPath = join(root, "views", "vocabulary.ttl");
  const presentationPath = join(root, "views", "vocabulary.presentation.ttl");
  const viewBytes = await readFile(viewPath);
  const presentationBytes = await readFile(presentationPath);
  assert.match(viewBytes.toString("utf8"), /#sourceGraph> <urn:owned:vocabulary>/);

  const movePreview = await moveResource({
    project: root,
    selector: "vocabulary.ttl",
    destination: "vocabularies/core.ttl",
  });
  assert.equal(movePreview.status, "preview", JSON.stringify(movePreview));
  assert.ok(movePreview.data);
  const moveArguments = (
    movePreview.data.preview as {
      arguments: { identityChanges?: { selector: string; before: string; after: string }[] };
    }
  ).arguments;
  assert.deepEqual(moveArguments.identityChanges ?? [], []);
  const moved = await moveResource({
    project: root,
    selector: "vocabulary.ttl",
    destination: "vocabularies/core.ttl",
    apply: true,
    acceptedPreview: (movePreview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(moved.status, "ok", JSON.stringify(moved));
  const movedManifest = await readFile(manifestPath, "utf8");
  assert.match(movedManifest, /source = "vocabularies\/core\.ttl" # preserve this note/);
  assert.deepEqual(await readFile(viewPath), viewBytes);
  assert.deepEqual(await readFile(presentationPath), presentationBytes);
  const shown = await showView({ project: root, selector: "views/vocabulary.ttl" });
  assert.equal(shown.status, "ok", JSON.stringify(shown));
  assert.equal(shown.data?.source, "vocabularies/core.ttl");

  const impact = await inspectImpact({
    project: root,
    kind: "ontology",
    selector: "vocabularies/core.ttl",
  });
  assert.equal(impact.status, "ok", JSON.stringify(impact));
  assert.ok(impact.data?.affectedFiles.includes("views/vocabulary.ttl"));
  assert.ok(impact.data?.affectedFiles.includes("views/vocabulary.presentation.ttl"));
  const removal = await removeResource({
    project: root,
    kind: "ontology",
    selector: "vocabularies/core.ttl",
  });
  assert.equal(removal.status, "preview", JSON.stringify(removal));
  assert.ok(removal.data);
  const removalPreview = removal.data?.preview as
    | { impact: { affectedFiles: string[] } }
    | undefined;
  assert.ok(removalPreview?.impact.affectedFiles.includes("views/vocabulary.ttl"));
  assert.ok(removalPreview?.impact.affectedFiles.includes("views/vocabulary.presentation.ttl"));
  const removalFingerprint = (removal.data.preview as { fingerprint: string }).fingerprint;
  const confirmedRemoval = await removeResource({
    project: root,
    kind: "ontology",
    selector: "vocabularies/core.ttl",
    confirm: true,
    acceptedPreview: removalFingerprint,
  });
  assert.equal(confirmedRemoval.status, "ok", JSON.stringify(confirmedRemoval));
  assert.deepEqual(await readFile(viewPath), viewBytes);
  assert.deepEqual(await readFile(presentationPath), presentationBytes);
  await assert.rejects(readFile(join(root, "vocabularies", "core.ttl")), { code: "ENOENT" });
  const brokenView = await showView({ project: root, selector: "views/vocabulary.ttl" });
  assert.notEqual(brokenView.status, "ok", JSON.stringify(brokenView));
  assert.equal(brokenView.diagnostics[0]?.code, "RESOURCE_MISSING");
});

test("moving an unrooted graph discloses its generated identity change", async () => {
  const root = await project();
  await writeFile(join(root, "loose.ttl"), "<urn:s> <urn:p> <urn:o> .\n");
  const moved = await moveResource({
    project: root,
    selector: "loose.ttl",
    destination: "archive/loose.ttl",
  });
  assert.equal(moved.status, "preview", JSON.stringify(moved));
  assert.ok(moved.data);
  const preview = moved.data.preview as {
    arguments: { identityChanges?: { before: string; after: string; identity: string }[] };
  };
  assert.ok(preview.arguments.identityChanges?.some((item) => item.identity === "generated"));
});

test("move rejects occupied and linked destinations without changing its source", async () => {
  const root = await project();
  const outside = await mkdtemp(join(tmpdir(), "tb-resource-linked-destination-"));
  await writeFile(join(root, "source.ttl"), "<urn:source:s> <urn:source:p> <urn:source:o> .\n");
  await writeFile(join(root, "occupied.ttl"), "preserve me\n");
  const occupied = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "occupied.ttl",
  });
  assert.equal(occupied.status, "conflict", JSON.stringify(occupied));
  assert.equal(occupied.diagnostics[0]?.code, "REVISION_CONFLICT");

  await symlink(outside, join(root, "redirect"), process.platform === "win32" ? "junction" : "dir");
  const linked = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "redirect/moved.ttl",
  });
  assert.equal(linked.status, "conflict", JSON.stringify(linked));
  assert.equal(linked.diagnostics[0]?.code, "PATH_UNSAFE");
  assert.match(await readFile(join(root, "source.ttl"), "utf8"), /urn:source:s/);
  assert.equal(await readFile(join(root, "occupied.ttl"), "utf8"), "preserve me\n");
});

test("stale source bytes and newly inventoried graphs invalidate reviewed move fingerprints", async () => {
  const root = await project();
  const source = join(root, "source.ttl");
  const destination = join(root, "archive", "source.ttl");
  await writeFile(source, "<urn:source:s> <urn:source:p> <urn:source:o> .\n");
  const preview = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "archive/source.ttl",
  });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const fingerprint = (preview.data.preview as { fingerprint: string }).fingerprint;
  await writeFile(join(root, "newly-discovered.ttl"), "<urn:new:s> <urn:new:p> <urn:new:o> .\n");
  const staleInventory = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "archive/source.ttl",
    apply: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(staleInventory.status, "conflict", JSON.stringify(staleInventory));
  assert.equal(staleInventory.diagnostics[0]?.code, "PREVIEW_CHANGED");
  await fs.unlink(join(root, "newly-discovered.ttl"));

  const secondPreview = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "archive/source.ttl",
  });
  assert.equal(secondPreview.status, "preview", JSON.stringify(secondPreview));
  assert.ok(secondPreview.data);
  await fs.appendFile(source, "# intervening edit\n");
  const staleSource = await moveResource({
    project: root,
    selector: "source.ttl",
    destination: "archive/source.ttl",
    apply: true,
    acceptedPreview: (secondPreview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(staleSource.status, "conflict", JSON.stringify(staleSource));
  assert.equal(staleSource.diagnostics[0]?.code, "PREVIEW_CHANGED");
  assert.match(await readFile(source, "utf8"), /intervening edit/);
  await assert.rejects(readFile(destination), { code: "ENOENT" });
});

test("coupled graph and support moves preserve intervening edits and recovery evidence on rollback failure", async () => {
  const root = await project();
  const source = join(root, "vocabulary.ttl");
  const support = join(root, "vocabulary.shacl.ttl");
  const sourceBytes = Buffer.from(
    "<urn:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );
  const supportBytes = Buffer.from(
    "<urn:vocabulary/shapes> a <http://www.w3.org/ns/shacl#NodeShape> .\n",
  );
  await writeFile(source, sourceBytes);
  await writeFile(support, supportBytes);
  const prepared = await prepareResourceLifecycle({
    project: root,
    selector: "vocabulary.ttl",
    destination: "vocabularies/core.ttl",
    action: "move",
  });
  assert.equal(
    prepared.plan.preview.changes.filter((change) => change.action === "move").length,
    2,
  );
  const failSupportDestination = fault("link", async (...args) => {
    if (String(args[1]).endsWith("core.shacl.ttl")) {
      await fs.writeFile(source, "external editor change\n");
      throw new Error("support destination publication failed");
    }
    return Reflect.apply(fs.link, fs, args);
  });
  await assert.rejects(
    publishPlan(root, prepared.plan, failSupportDestination),
    /rollback was incomplete/,
  );
  assert.equal(await readFile(source, "utf8"), "external editor change\n");
  assert.deepEqual(await readFile(support), supportBytes);
  await assert.rejects(readFile(join(root, "vocabularies", "core.ttl")), { code: "ENOENT" });
  const recovery = await inspectRecovery(root);
  assert.equal(recovery.status, "ok", JSON.stringify(recovery));
  assert.ok(recovery.data);
  assert.ok(
    (recovery.data.transactions as { record: { state: string } }[]).some(
      (item) => item.record.state === "rolling_back",
    ),
    JSON.stringify(recovery),
  );
  await assert.rejects(capture(root, ["vocabulary.ttl"]), /Pending transaction/);
});

test("custom model-type removal confirms affected models and reports deliberate invalidity", async () => {
  const root = await project();
  await authorResource({
    project: root,
    command: "ontology.create",
    path: "custom.ttl",
    iri: "urn:custom:vocabulary",
  });
  const configured = await configureModelType({
    project: root,
    command: "config.model-type.set",
    name: "custom",
    ontology: "custom.ttl",
  });
  assert.equal(configured.status, "ok", JSON.stringify(configured));
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "model.ttl",
    iri: "urn:custom:model",
    type: "custom",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));

  const preview = await removeResource({ project: root, kind: "model-type", selector: "custom" });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const fingerprint = (preview.data.preview as { fingerprint: string }).fingerprint;
  assert.deepEqual(preview.data?.affectedModels, [{ selector: "model.ttl", file: "model.ttl" }]);
  const applied = await removeResource({
    project: root,
    kind: "model-type",
    selector: "custom",
    confirm: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  assert.equal(applied.data?.projectValidity as string, "invalid");
  assert.ok(
    applied.diagnostics.some((item) => item.code === "ASSOCIATION_BROKEN"),
    JSON.stringify(applied.diagnostics),
  );
  assert.ok((await readFile(join(root, "model.ttl"), "utf8")).includes('"custom"'));
});

test("built-in model types are rejected for removal", async () => {
  const root = await project();
  const removed = await removeResource({
    project: root,
    kind: "model-type",
    selector: "data",
    confirm: true,
  });
  assert.equal(removed.status, "invalid_arguments", JSON.stringify(removed));
  assert.equal(removed.diagnostics[0]?.code, "MODEL_TYPE_UNUSABLE");
});
