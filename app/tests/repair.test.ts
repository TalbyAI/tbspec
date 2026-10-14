import assert from "node:assert/strict";
import * as filesystem from "node:fs/promises";
import { mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import type { BaseQuad } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { digest, graphSignature } from "../src/canonical.ts";
import type { FileSystem } from "../src/filesystem.ts";
import { initializeProject } from "../src/project.ts";
import { parseRdf } from "../src/rdf.ts";
import {
  collectGarbage,
  listReferences,
  prepareRefactorIri,
  publishRepair,
  rdfGraphsAreIsomorphic,
  redirectReferences,
  refactorIri,
  removeReferences,
} from "../src/repair.ts";
import { removeResource } from "../src/resource-lifecycle.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";

const metadata = "https://talby.ai/ontology/tbspec#";

function resultItems(result: { data?: Record<string, unknown> | null }) {
  assert.ok(result.data);
  const items = result.data.items;
  assert.ok(Array.isArray(items));
  return items as Record<string, unknown>[];
}

function previewFingerprint(result: { data?: Record<string, unknown> | null }): string {
  assert.ok(result.data);
  const preview = result.data.preview;
  assert.ok(preview && typeof preview === "object");
  const fingerprint = (preview as { fingerprint?: unknown }).fingerprint;
  assert.equal(typeof fingerprint, "string");
  return fingerprint as string;
}

async function project() {
  const root = await mkdtemp(join(tmpdir(), "tb-repair-"));
  assert.equal((await initializeProject({ directory: root })).status, "ok");
  return root;
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
    Buffer.from(`\n<urn:locked:subject> <urn:locked:predicate> <${target}> .\n`),
  ]);
  record.byte_digest = digest(bytes);
  record.byte_length = bytes.length;
  record.graph_signature = graphSignature(record);
  dependency.interpretation_signature = interpretationSignature(dependency);
  await writeFile(file, bytes);
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
}

test("RDF graph isomorphism ignores blank labels but preserves connectivity", async () => {
  const original = await parseRdf(
    Buffer.from(
      "<urn:a> <urn:link> _:leftA .\n" +
        "<urn:b> <urn:link> _:leftB .\n" +
        "_:leftA <urn:next> _:leftB .\n",
    ),
    "text/turtle",
    "urn:isomorphism:test",
  );
  const relabeled = await parseRdf(
    Buffer.from(
      "<urn:b> <urn:link> _:rightB .\n" +
        "<urn:a> <urn:link> _:rightA .\n" +
        "_:rightA <urn:next> _:rightB .\n",
    ),
    "text/turtle",
    "urn:isomorphism:test",
  );
  const reversed = await parseRdf(
    Buffer.from(
      "<urn:a> <urn:link> _:otherA .\n" +
        "<urn:b> <urn:link> _:otherB .\n" +
        "_:otherB <urn:next> _:otherA .\n",
    ),
    "text/turtle",
    "urn:isomorphism:test",
  );

  assert.equal(rdfGraphsAreIsomorphic(original, relabeled), true);
  assert.equal(rdfGraphsAreIsomorphic(original, reversed), false);
});

test("blank-node refinement visits indexed neighbours within a linear work budget", () => {
  const size = 1000;
  let predicateReads = 0;
  const factory = {
    ...DataFactory,
    quad: (...terms: Parameters<typeof DataFactory.quad>) =>
      new Proxy(DataFactory.quad<BaseQuad>(...terms), {
        get(target, property, receiver) {
          if (property === "predicate") predicateReads++;
          return Reflect.get(target, property, receiver);
        },
      }),
  };
  const graph = (prefix: string) =>
    new Store(
      Array.from({ length: size }, (_, index) =>
        DataFactory.quad(
          DataFactory.blankNode(`${prefix}${index}`),
          DataFactory.namedNode("urn:restriction"),
          DataFactory.literal(`restriction ${index}`),
        ),
      ),
      { factory },
    );
  const left = graph("left");
  const right = graph("right");
  predicateReads = 0;
  assert.equal(rdfGraphsAreIsomorphic(left, right), true);
  assert.ok(
    predicateReads < size * 50,
    `${predicateReads} quad predicate reads for ${size} blank nodes`,
  );
});

test("reference inspection separates exact occurrences from demonstrably dangling managed uses", async () => {
  const root = await project();
  const exact = "urn:repair:Shared";
  const missingClass = "urn:repair:MissingClass";
  await writeFile(
    join(root, "tbspec.toml"),
    `${await readFile(join(root, "tbspec.toml"), "utf8")}\n[ontology_choices]\n"${exact}" = "tbspec-metadata"\n`,
  );
  await writeFile(
    join(root, "models.ttl"),
    `<urn:repair:model> a <${metadata}ConcreteDataModel>; <${metadata}modelType> "data" .\n` +
      `<${exact}> <${exact}> <urn:repair:model> .\n` +
      `<urn:repair:model> <urn:repair:uses> <${exact}> .\n` +
      `<urn:repair:person> a <${missingClass}> .\n` +
      `<urn:repair:team> <urn:repair:ordinaryLink> <${missingClass}> .\n` +
      `<urn:repair:team> <urn:repair:member> <urn:repair:DeletedIndividual> .\n`,
  );
  await addLockedReference(root, exact);

  const exactResult = await listReferences({ project: root, target: exact });
  assert.equal(exactResult.status, "ok", JSON.stringify(exactResult));
  assert.ok(exactResult.data);
  const exactItems = exactResult.data.items as {
    file: string;
    position: string;
    targetIri: string;
    configurationPath?: string;
  }[];
  assert.deepEqual(
    exactItems
      .map((item) => [item.file, item.position])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    [
      [".tbspec/dependencies/tbspec-metadata/source/tbspec.ttl", "object"],
      ["models.ttl", "object"],
      ["models.ttl", "predicate"],
      ["models.ttl", "subject"],
      ["tbspec.toml", "configuration"],
    ],
  );
  assert.ok(exactItems.every((item) => item.targetIri === exact));
  assert.ok(
    exactItems.some(
      (item) =>
        item.file === "tbspec.toml" && item.configurationPath === `ontology_choices.${exact}`,
    ),
  );
  assert.ok(!exactItems.some((item) => item.file === "tbspec.toml" && "selector" in item));
  const unfiltered = await listReferences({ project: root });
  assert.equal(unfiltered.status, "ok", JSON.stringify(unfiltered));
  assert.ok(
    (resultItems(unfiltered) as { targetIri: string }[]).some(
      (item) => item.targetIri === "urn:repair:DeletedIndividual",
    ),
  );

  const danglingResult = await listReferences({ project: root, dangling: true });
  assert.equal(danglingResult.status, "ok", JSON.stringify(danglingResult));
  assert.ok(danglingResult.data);
  const danglingItems = danglingResult.data.items as {
    file: string;
    position: string;
    targetIri: string;
    subject?: { value: string };
    predicate?: { value: string };
    object?: { value: string };
  }[];
  assert.ok(
    danglingItems.some(
      (item) =>
        item.file === "models.ttl" &&
        item.position === "object" &&
        item.targetIri === missingClass &&
        item.subject?.value === "urn:repair:person",
    ),
  );
  assert.ok(
    !danglingItems.some(
      (item) =>
        item.file === "models.ttl" &&
        item.targetIri === missingClass &&
        item.subject?.value === "urn:repair:team",
    ),
    "an ordinary individual-valued link must not become dangling because the IRI is also used as a missing class",
  );
  assert.ok(
    !danglingItems.some((item) => item.targetIri === "urn:repair:DeletedIndividual"),
    "the current project contains no managed requirement for this ordinary individual value",
  );
});

test("reference listing returns explicit partial coverage for a malformed inventoried graph", async () => {
  const root = await project();
  await writeFile(join(root, "broken.ttl"), "<urn:repair:broken> <urn:repair:predicate> [ .\n");

  const listed = await listReferences({ project: root });
  assert.equal(listed.status, "invalid", JSON.stringify(listed));
  assert.ok(listed.data);
  assert.ok(
    listed.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "REFERENCE_COVERAGE_INCOMPLETE" && diagnostic.file === "broken.ttl",
    ),
  );
  assert.ok((listed.data.items as { targetIri: string }[]).length > 0);
});

test("IRI refactoring previews owned and configuration changes while preserving locked bytes", async () => {
  const root = await project();
  const oldIri = "urn:repair:old";
  const newIri = "urn:repair:new";
  await writeFile(
    join(root, "tbspec.toml"),
    `${await readFile(join(root, "tbspec.toml"), "utf8")}\n[ontology_choices]\n"${oldIri}" = "tbspec-metadata"\n`,
  );
  await writeFile(
    join(root, "vocabulary.ttl"),
    `<${oldIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n` +
      `<urn:repair:subject> <${oldIri}> <${oldIri}> .\n`,
  );
  await addLockedReference(root, oldIri);
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const dependency = lock.dependencies["tbspec-metadata"];
  assert.ok(dependency);
  const lockedRecord = dependency.files.find((file) => file.key === dependency.primary);
  assert.ok(lockedRecord);
  const lockedPath = join(root, dependency.snapshot_path, lockedRecord.key);
  const lockedBefore = await readFile(lockedPath);
  const ownedBefore = await readFile(join(root, "vocabulary.ttl"));

  const preview = await refactorIri({ project: root, oldIri, newIri });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const fingerprint = (preview.data.preview as { fingerprint: string }).fingerprint;
  assert.ok(
    (
      preview.data.preview as { arguments: { references: { file: string }[] } }
    ).arguments.references.some(
      (item) => item.file === lockedPath.slice(root.length + 1).replaceAll("\\", "/"),
    ),
    "the preview discloses the locked occurrence",
  );
  assert.deepEqual(await readFile(join(root, "vocabulary.ttl")), ownedBefore);
  assert.deepEqual(await readFile(lockedPath), lockedBefore);

  const applied = await refactorIri({
    project: root,
    oldIri,
    newIri,
    apply: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  assert.match(await readFile(join(root, "vocabulary.ttl"), "utf8"), /urn:repair:new/);
  assert.doesNotMatch(await readFile(join(root, "vocabulary.ttl"), "utf8"), /urn:repair:old/);
  assert.match(await readFile(join(root, "tbspec.toml"), "utf8"), /"urn:repair:new"/);
  assert.doesNotMatch(await readFile(join(root, "tbspec.toml"), "utf8"), /"urn:repair:old"/);
  assert.deepEqual(await readFile(lockedPath), lockedBefore);
});

test("IRI refactoring refuses a declaration collision in another owned graph", async () => {
  const root = await project();
  const oldIri = "urn:repair:collision:old";
  const newIri = "urn:repair:collision:new";
  const before = `<${oldIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`;
  await writeFile(join(root, "old.ttl"), before);
  await writeFile(
    join(root, "other.ttl"),
    `<${newIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`,
  );

  const result = await refactorIri({ project: root, oldIri, newIri, apply: true });
  assert.equal(result.status, "conflict", JSON.stringify(result));
  assert.equal(result.diagnostics[0]?.code, "GRAPH_IRI_COLLISION");
  assert.equal(await readFile(join(root, "old.ttl"), "utf8"), before);
});

test("IRI refactoring refuses a term declaration collision outside graph roots", async () => {
  const root = await project();
  const oldIri = "urn:repair:term-collision:old";
  const newIri = "urn:repair:term-collision:new";
  const before = `<${oldIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`;
  await writeFile(join(root, "old.ttl"), before);
  await writeFile(
    join(root, "other.ttl"),
    `<${newIri}> a <http://www.w3.org/2002/07/owl#Class> .\n`,
  );

  const result = await refactorIri({ project: root, oldIri, newIri, apply: true });
  assert.equal(result.status, "conflict", JSON.stringify(result));
  assert.equal(result.diagnostics[0]?.code, "TERM_IRI_COLLISION");
  assert.equal(await readFile(join(root, "old.ttl"), "utf8"), before);

  await writeFile(
    join(root, "other.ttl"),
    "<urn:repair:ordinary> <urn:repair:link> <" + newIri + "> .\n",
  );
  const ordinaryUse = await refactorIri({ project: root, oldIri, newIri, apply: true });
  assert.equal(ordinaryUse.status, "ok", JSON.stringify(ordinaryUse));
  assert.match(await readFile(join(root, "old.ttl"), "utf8"), new RegExp(newIri));
});

test("IRI refactoring preserves unrelated TOML quoting, comments and CRLF", async () => {
  const root = await project();
  const oldIri = "urn:repair:toml:old";
  const newIri = "urn:repair:toml:new";
  const source =
    `${(await readFile(join(root, "tbspec.toml"), "utf8")).replaceAll("\n", "\r\n")}` +
    `\r\n[other]\r\n'quoted-key' = 'leave this token' # keep comment\r\ncreated = 2026-10-13T00:00:00Z\r\n` +
    `[ontology_choices]\r\n'${oldIri}' = 'tbspec-metadata' # selected choice\r\n`;
  await writeFile(join(root, "tbspec.toml"), source);
  await writeFile(
    join(root, "vocabulary.ttl"),
    `<${oldIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\r\n`,
  );

  const result = await refactorIri({ project: root, oldIri, newIri, apply: true });
  assert.equal(result.status, "ok", JSON.stringify(result));
  const updated = await readFile(join(root, "tbspec.toml"), "utf8");
  assert.match(updated, /'quoted-key' = 'leave this token' # keep comment\r\n/);
  assert.match(updated, /created = 2026-10-13T00:00:00Z\r\n/);
  assert.match(updated, /"urn:repair:toml:new" = 'tbspec-metadata' # selected choice\r\n/);
  assert.ok(updated.includes("\r\n"));
  assert.ok(!updated.includes("\n") || updated.replaceAll("\r\n", "").indexOf("\n") === -1);
});

test("failed multi-file repair restores exact originals and clears completed recovery state", async () => {
  const root = await project();
  const oldIri = "urn:repair:rollback:old";
  const newIri = "urn:repair:rollback:new";
  await writeFile(
    join(root, "vocabulary.ttl"),
    `<${oldIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`,
  );
  const config = await readFile(join(root, "tbspec.toml"));
  const graph = await readFile(join(root, "vocabulary.ttl"));
  const prepared = await prepareRefactorIri({ project: root, oldIri, newIri });
  let injected = false;
  const adapter = new Proxy(filesystem, {
    get(target, key) {
      if (key === "rename")
        return async (...args: Parameters<typeof filesystem.rename>) => {
          const destination = String(args[1]).replaceAll("\\", "/");
          if (!injected && destination.endsWith("/vocabulary.ttl")) {
            injected = true;
            throw Object.assign(new Error("injected repair publication failure"), { code: "EIO" });
          }
          return Reflect.apply(target.rename, target, args);
        };
      return Reflect.get(target, key);
    },
  }) as FileSystem;
  const result = await publishRepair(prepared, adapter);
  assert.notEqual(result.status, "ok", JSON.stringify(result));
  assert.equal(
    injected,
    true,
    "the real transaction publication boundary must receive the injected fault",
  );
  assert.deepEqual(await readFile(join(root, "tbspec.toml")), config);
  assert.deepEqual(await readFile(join(root, "vocabulary.ttl")), graph);
  assert.ok(!(await readdir(join(root, ".tbspec"))).includes("operation.lock"));
  const transactions = await readdir(join(root, ".tbspec/transactions")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  assert.deepEqual(transactions, []);
});

test("RDF/XML refactoring preserves QName predicates, blank nodes, language and datatype terms", async () => {
  const root = await project();
  const oldIri = "urn:repair:old";
  const newIri = "urn:repair:new";
  const source =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:r="urn:repair:">\n' +
    '  <rdf:Description rdf:about="' +
    oldIri +
    '">\n' +
    '    <r:old rdf:resource="' +
    oldIri +
    '"/>\n' +
    '    <r:label xml:lang="en">Preserved label</r:label>\n' +
    '    <r:number rdf:datatype="http://www.w3.org/2001/XMLSchema#integer">7</r:number>\n' +
    '    <r:custom rdf:datatype="' +
    oldIri +
    '">opaque lexical value</r:custom>\n' +
    "  </rdf:Description>\n" +
    '  <rdf:Description rdf:nodeID="blankOne"><r:link rdf:resource="' +
    oldIri +
    '"/></rdf:Description>\n' +
    "</rdf:RDF>\n";
  await writeFile(join(root, "vocabulary.rdf"), source);
  await writeFile(
    join(root, "other.owl"),
    '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:r="urn:repair:"><rdf:Description rdf:about="urn:repair:owl"><r:link rdf:resource="' +
      oldIri +
      '"/></rdf:Description></rdf:RDF>',
  );
  const exactDatatype = await listReferences({ project: root, target: oldIri });
  assert.equal(exactDatatype.status, "ok");
  assert.ok(
    (
      (exactDatatype.data?.items as {
        file: string;
        position: string;
        targetIri: string;
        object?: { kind?: string; datatype?: string };
      }[]) ?? []
    ).some(
      (item) =>
        item.position === "object" &&
        item.targetIri === oldIri &&
        item.object?.kind === "literal" &&
        item.object.datatype === oldIri,
    ),
  );
  const preview = await refactorIri({ project: root, oldIri, newIri });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const previewPlan = preview.data.preview as {
    arguments: { references: { object?: { kind?: string; datatype?: string } }[] };
  };
  assert.ok(
    previewPlan.arguments.references.some(
      (item) => item.object?.kind === "literal" && item.object.datatype === oldIri,
    ),
  );
  const fingerprint = previewFingerprint(preview);
  const applied = await refactorIri({
    project: root,
    oldIri,
    newIri,
    apply: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  const bytes = await readFile(join(root, "vocabulary.rdf"));
  const parsed = await parseRdf(
    bytes,
    "application/rdf+xml",
    pathToFileURL(join(root, "vocabulary.rdf")).href,
  );
  assert.ok(
    ![...parsed].some((quad) =>
      [quad.subject, quad.predicate, quad.object].some(
        (term) => term.termType === "NamedNode" && term.value === oldIri,
      ),
    ),
  );
  assert.equal(parsed.countQuads(null, null, null, null), 5);
  assert.equal(parsed.countQuads(null, "urn:repair:label", null, null), 1);
  assert.equal(parsed.getObjects(null, "urn:repair:label", null)[0]?.value, "Preserved label");
  const label = parsed.getObjects(null, "urn:repair:label", null)[0];
  if (label?.termType === "Literal") assert.equal(label.language, "en");
  const number = parsed.getObjects(null, "urn:repair:number", null)[0];
  assert.equal(number?.value, "7");
  assert.equal(number?.termType, "Literal");
  if (number?.termType === "Literal")
    assert.equal(number.datatype.value, "http://www.w3.org/2001/XMLSchema#integer");
  const custom = parsed.getObjects(null, "urn:repair:custom", null)[0];
  assert.equal(custom?.value, "opaque lexical value");
  if (custom?.termType === "Literal") assert.equal(custom.datatype.value, newIri);
  assert.equal(parsed.countQuads(null, null, null, null), 5);
  const owl = await parseRdf(
    await readFile(join(root, "other.owl")),
    "application/rdf+xml",
    pathToFileURL(join(root, "other.owl")).href,
  );
  assert.equal(owl.getObjects("urn:repair:owl", "urn:repair:link", null)[0]?.value, newIri);
});

test("RDF/XML refactoring accepts blank-node label changes after serialization", async () => {
  const root = await project();
  const oldIri = "urn:repair:old";
  const newIri = "urn:repair:new";
  const source =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:r="urn:repair:">\n' +
    '  <rdf:Description rdf:about="urn:z"><r:link rdf:nodeID="blankZ"/></rdf:Description>\n' +
    '  <rdf:Description rdf:about="urn:a"><r:link rdf:nodeID="blankA"/></rdf:Description>\n' +
    `  <rdf:Description rdf:about="${oldIri}"><rdf:type rdf:resource="http://www.w3.org/2002/07/owl#Ontology"/></rdf:Description>\n` +
    "</rdf:RDF>\n";
  await writeFile(join(root, "vocabulary.rdf"), source);

  const preview = await refactorIri({ project: root, oldIri, newIri });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const applied = await refactorIri({
    project: root,
    oldIri,
    newIri,
    apply: true,
    acceptedPreview: previewFingerprint(preview),
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  const rewritten = await parseRdf(
    await readFile(join(root, "vocabulary.rdf")),
    "application/rdf+xml",
    pathToFileURL(join(root, "vocabulary.rdf")).href,
  );
  assert.ok(
    rewritten.getQuads(null, null, null, null).some((quad) => quad.subject.value === newIri),
  );
});

test("redirect scopes selected files and all; removal deletes only managed statements", async () => {
  const root = await project();
  const oldClass = "urn:repair:missing-class";
  const removableClass = "urn:repair:remove-class";
  const availableClass = "http://www.w3.org/2000/01/rdf-schema#Resource";
  const model = (rootIri: string, person: string) =>
    "<" +
    rootIri +
    "> a <" +
    metadata +
    "ConcreteDataModel>; <" +
    metadata +
    'modelType> "data" .\n' +
    "<" +
    person +
    "> a <" +
    oldClass +
    "> .\n" +
    "<" +
    person +
    "> a <" +
    removableClass +
    "> .\n" +
    "<" +
    person +
    "> <urn:repair:ordinaryLink> <" +
    removableClass +
    "> .\n";
  await writeFile(join(root, "models.ttl"), model("urn:repair:model-one", "urn:repair:person-one"));
  await writeFile(join(root, "other.ttl"), model("urn:repair:model-two", "urn:repair:person-two"));

  const selected = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    files: ["models.ttl"],
  });
  assert.equal(selected.status, "preview", JSON.stringify(selected));
  const selectedPreview = selected.data?.preview as {
    fingerprint: string;
    arguments: { files: string[]; references: { file: string }[] };
  };
  assert.deepEqual(selectedPreview.arguments.files, ["models.ttl"]);
  assert.ok(selectedPreview.arguments.references.every((item) => item.file === "models.ttl"));
  const selectedApply = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    files: ["models.ttl"],
    apply: true,
    acceptedPreview: selectedPreview.fingerprint,
  });
  assert.equal(selectedApply.status, "ok", JSON.stringify(selectedApply));
  assert.match(await readFile(join(root, "models.ttl"), "utf8"), new RegExp(availableClass));
  assert.match(await readFile(join(root, "other.ttl"), "utf8"), new RegExp(oldClass));

  const all = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    all: true,
  });
  assert.equal(all.status, "preview", JSON.stringify(all));
  const allPreview = all.data?.preview as {
    fingerprint: string;
    arguments: { scope: string; references: { file: string }[] };
  };
  assert.equal(allPreview.arguments.scope, "all");
  assert.ok(allPreview.arguments.references.some((item) => item.file === "other.ttl"));
  const allApply = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    all: true,
    apply: true,
    acceptedPreview: allPreview.fingerprint,
  });
  assert.equal(allApply.status, "ok", JSON.stringify(allApply));
  assert.doesNotMatch(await readFile(join(root, "other.ttl"), "utf8"), new RegExp(oldClass));

  const remove = await removeReferences({
    project: root,
    targetIri: removableClass,
    files: ["other.ttl"],
  });
  assert.equal(remove.status, "preview", JSON.stringify(remove));
  const removeFingerprint = previewFingerprint(remove);
  const removed = await removeReferences({
    project: root,
    targetIri: removableClass,
    files: ["other.ttl"],
    apply: true,
    acceptedPreview: removeFingerprint,
  });
  assert.equal(removed.status, "ok", JSON.stringify(removed));
  const remaining = await readFile(join(root, "other.ttl"), "utf8");
  assert.doesNotMatch(remaining, new RegExp("a <" + removableClass + ">"));
  assert.match(remaining, new RegExp("ordinaryLink> <" + removableClass + ">"));
  const dangling = await listReferences({ project: root, dangling: true });
  assert.equal(dangling.status, "ok", JSON.stringify(dangling));
  assert.ok(
    !(resultItems(dangling) as { file: string; targetIri: string }[]).some(
      (item) => item.file === "other.ttl" && item.targetIri === removableClass,
    ),
  );
});

test("repair binds added references, comment-only configuration revisions, and malformed selected graphs", async () => {
  const root = await project();
  const oldClass = "urn:repair:stale-class";
  const availableClass = "http://www.w3.org/2000/01/rdf-schema#Resource";
  const graph = (person: string) =>
    "<urn:repair:stale-model> a <" +
    metadata +
    "ConcreteDataModel>; <" +
    metadata +
    'modelType> "data" .\n' +
    "<" +
    person +
    "> a <" +
    oldClass +
    "> .\n";
  await writeFile(join(root, "models.ttl"), graph("urn:repair:first"));
  const preview = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    files: ["models.ttl"],
  });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  const fingerprint = previewFingerprint(preview);
  await writeFile(join(root, "new-reference.ttl"), graph("urn:repair:second"));
  const staleInventory = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    files: ["models.ttl"],
    apply: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(staleInventory.status, "conflict", JSON.stringify(staleInventory));
  assert.equal(staleInventory.diagnostics[0]?.code, "PREVIEW_CHANGED");
  assert.match(await readFile(join(root, "models.ttl"), "utf8"), new RegExp(oldClass));

  const commentPreview = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    all: true,
  });
  assert.equal(commentPreview.status, "preview", JSON.stringify(commentPreview));
  const commentFingerprint = previewFingerprint(commentPreview);
  await writeFile(
    join(root, "tbspec.toml"),
    (await readFile(join(root, "tbspec.toml"), "utf8")) + "# reviewer note changed\n",
  );
  const staleComment = await redirectReferences({
    project: root,
    targetIri: oldClass,
    newIri: availableClass,
    all: true,
    apply: true,
    acceptedPreview: commentFingerprint,
  });
  assert.equal(staleComment.status, "conflict", JSON.stringify(staleComment));
  assert.equal(staleComment.diagnostics[0]?.code, "PREVIEW_CHANGED");

  const malformed = "<urn:repair:broken> a <";
  await writeFile(join(root, "broken.ttl"), malformed);
  const refused = await removeReferences({
    project: root,
    targetIri: oldClass,
    files: ["broken.ttl"],
  });
  assert.equal(refused.status, "invalid", JSON.stringify(refused));
  assert.equal(refused.diagnostics[0]?.code, "RDF_SYNTAX");
  assert.equal(await readFile(join(root, "broken.ttl"), "utf8"), malformed);
});

test("dangling view and presentation references name only unavailable context objects", async () => {
  const root = await project();
  const sourceIri = "urn:repair:context-source";
  const available = "urn:repair:available-member";
  const missingMember = "urn:repair:missing-member";
  const missingSubject = "urn:repair:missing-subject";
  const missingObject = "urn:repair:missing-object";
  const viewIri = "urn:repair:context-view";
  const presentationIri = "urn:repair:context-presentation";
  const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
  await writeFile(
    join(root, "source.ttl"),
    `<${sourceIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n` +
      `<${available}> <urn:repair:edge> <urn:repair:other> .\n` +
      `<urn:repair:present-but-unselected> <urn:repair:p> <urn:repair:o> .\n`,
  );
  await writeFile(
    join(root, "view.ttl"),
    `<${viewIri}> a <${metadata}ViewModel>; <${metadata}sourceGraph> <${sourceIri}>; ` +
      `<${metadata}member> <${missingMember}>; <${metadata}relationship> [ ` +
      `<${rdf}subject> <${missingSubject}>; <${rdf}predicate> <urn:repair:edge>; ` +
      `<${rdf}object> <${missingObject}> ] .\n` +
      `<${viewIri}> <urn:repair:ordinaryLink> <${missingMember}> .\n`,
  );
  await writeFile(
    join(root, "presentation.ttl"),
    `<${presentationIri}> a <${metadata}PresentationGraph>; <${metadata}forView> <${viewIri}>; ` +
      `<${metadata}nodePresentation> [ <${metadata}element> <urn:repair:present-but-unselected>; ` +
      `<${metadata}strokeWidth> "999999999999999999999999"^^<http://www.w3.org/2001/XMLSchema#integer> ] .\n`,
  );
  await writeFile(
    join(root, "tbspec.toml"),
    `${await readFile(join(root, "tbspec.toml"), "utf8")}\n[[views]]\nview = "view.ttl"\nsource = "source.ttl"\npresentation = "presentation.ttl"\n`,
  );

  const listed = await listReferences({ project: root, dangling: true });
  assert.equal(listed.status, "ok", JSON.stringify(listed));
  const dangling = listed.data?.items as {
    file: string;
    position: string;
    targetIri: string;
    predicate?: { value: string };
  }[];
  assert.ok(
    dangling.some(
      (item) =>
        item.file === "view.ttl" &&
        item.targetIri === missingMember &&
        item.predicate?.value === metadata + "member",
    ),
  );
  assert.ok(
    dangling.some(
      (item) =>
        item.file === "view.ttl" &&
        item.targetIri === missingSubject &&
        item.predicate?.value === rdf + "subject",
    ),
    JSON.stringify(dangling),
  );
  assert.ok(
    dangling.some(
      (item) =>
        item.file === "view.ttl" &&
        item.targetIri === missingObject &&
        item.predicate?.value === rdf + "object",
    ),
  );
  assert.ok(
    dangling.some(
      (item) =>
        item.file === "presentation.ttl" &&
        item.targetIri === "urn:repair:present-but-unselected" &&
        item.predicate?.value === metadata + "element",
    ),
  );
  assert.ok(
    !dangling.some(
      (item) =>
        item.targetIri === missingMember &&
        item.file === "view.ttl" &&
        item.predicate?.value === "urn:repair:ordinaryLink",
    ),
  );
  assert.ok(
    !dangling.some(
      (item) => item.targetIri === presentationIri || item.targetIri === "urn:repair:context-view",
    ),
  );
  assert.ok(
    !dangling.some(
      (item) => item.file === "presentation.ttl" && item.targetIri === presentationIri,
    ),
  );

  const redirect = await redirectReferences({
    project: root,
    targetIri: missingMember,
    newIri: available,
    files: ["view.ttl"],
  });
  assert.equal(redirect.status, "preview", JSON.stringify(redirect));
  const fingerprint = previewFingerprint(redirect);
  const applied = await redirectReferences({
    project: root,
    targetIri: missingMember,
    newIri: available,
    files: ["view.ttl"],
    apply: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  const updated = await readFile(join(root, "view.ttl"), "utf8");
  assert.match(updated, new RegExp(metadata + "member> <" + available + ">"));
  assert.match(updated, new RegExp("ordinaryLink> <" + missingMember + ">"));
  const after = await listReferences({ project: root, dangling: true });
  assert.equal(after.status, "ok", JSON.stringify(after));
  assert.ok(
    !(resultItems(after) as { targetIri: string }[]).some(
      (item) => item.targetIri === missingMember,
    ),
  );
});

test("garbage collection selects only orphaned owned support and view pairs", async () => {
  const root = await project();
  const sourceIri = "urn:repair:gc-source";
  const viewIri = "urn:repair:gc-view";
  const presentationIri = "urn:repair:gc-presentation";
  await writeFile(
    join(root, "source.ttl"),
    `<${sourceIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`,
  );
  await writeFile(
    join(root, "source.shacl.ttl"),
    `<urn:repair:gc-shapes> a <${metadata}ShapesGraph> .\n`,
  );
  await writeFile(
    join(root, "manual-shapes.ttl"),
    `<urn:repair:manual-shapes> a <${metadata}ShapesGraph> .\n`,
  );
  await writeFile(
    join(root, "cleared-shapes.ttl"),
    `<urn:repair:cleared-shapes> a <${metadata}ShapesGraph> .\n`,
  );
  await writeFile(
    join(root, "design.ttl"),
    `<urn:repair:independent-design> a <${metadata}VisualDesignModel> .\n`,
  );
  await writeFile(
    join(root, "view.ttl"),
    `<${viewIri}> a <${metadata}ViewModel>; <${metadata}sourceGraph> <${sourceIri}> .\n`,
  );
  await writeFile(
    join(root, "presentation.ttl"),
    `<${presentationIri}> a <${metadata}PresentationGraph>; <${metadata}forView> <${viewIri}> .\n`,
  );
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    `${manifest}\n[[associations]]\nresource = "source.ttl"\nsupport = "manual-shapes.ttl"\nrole = "shacl"\n` +
      `\n[[views]]\nview = "view.ttl"\nsource = "source.ttl"\npresentation = "presentation.ttl"\n`,
  );
  const removed = await removeResource({
    project: root,
    kind: "ontology",
    selector: "source.ttl",
    confirm: true,
  });
  assert.equal(removed.status, "ok", JSON.stringify(removed));
  const unrelatedManifest = `${await readFile(join(root, "tbspec.toml"), "utf8")}\n[unrelated]\ncreated = 2026-10-13T00:00:00Z\nratio = inf\n`;
  await writeFile(join(root, "tbspec.toml"), unrelatedManifest);

  const preview = await collectGarbage({ project: root, all: true });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  const previewData = preview.data as {
    candidates: { file: string; role: string; files?: string[] }[];
    preview: {
      fingerprint: string;
      impact: {
        introducedErrors: { file: string | null }[];
        skippedChecks: { file: string | null }[];
      };
    };
  };
  assert.ok(previewData.candidates.some((item) => item.file === "source.shacl.ttl"));
  assert.ok(previewData.candidates.some((item) => item.file === "manual-shapes.ttl"));
  assert.ok(
    previewData.candidates.some(
      (item) => item.file === "view.ttl" && item.files?.includes("presentation.ttl"),
    ),
  );
  assert.ok(
    !previewData.candidates.some((item) =>
      ["cleared-shapes.ttl", "design.ttl"].includes(item.file),
    ),
  );
  const impact = previewData.preview.impact;
  assert.ok(
    !impact.introducedErrors.some(
      (item) =>
        item.file === "source.shacl.ttl" ||
        item.file === "view.ttl" ||
        item.file === "presentation.ttl",
    ),
  );
  assert.ok(
    !impact.skippedChecks.some(
      (item) =>
        item.file === "source.shacl.ttl" ||
        item.file === "view.ttl" ||
        item.file === "presentation.ttl",
    ),
  );
  assert.ok(unrelatedManifest.includes("created = 2026-10-13T00:00:00Z\nratio = inf"));
  const missingConfirm = await collectGarbage({ project: root, all: true, apply: true });
  assert.equal(missingConfirm.status, "invalid_arguments", JSON.stringify(missingConfirm));
  assert.equal(missingConfirm.diagnostics[0]?.code, "GC_CONFIRM_REQUIRED");
  const applied = await collectGarbage({
    project: root,
    resources: ["view.ttl"],
    apply: true,
    confirm: true,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  assert.ok(
    await readFile(join(root, "source.shacl.ttl")).then(
      () => true,
      () => false,
    ),
  );
  assert.ok(
    await readFile(join(root, "manual-shapes.ttl")).then(
      () => true,
      () => false,
    ),
  );
  assert.ok(
    await readFile(join(root, "view.ttl")).then(
      () => false,
      () => true,
    ),
  );
  assert.ok(
    await readFile(join(root, "presentation.ttl")).then(
      () => false,
      () => true,
    ),
  );
  assert.match(await readFile(join(root, "tbspec.toml"), "utf8"), /support = "manual-shapes\.ttl"/);
  assert.match(
    await readFile(join(root, "tbspec.toml"), "utf8"),
    /created = 2026-10-13T00:00:00Z\nratio = inf/,
  );
  assert.ok(
    await readFile(join(root, "cleared-shapes.ttl")).then(
      () => true,
      () => false,
    ),
  );
  assert.ok(
    await readFile(join(root, "design.ttl")).then(
      () => true,
      () => false,
    ),
  );
});

test("garbage collection retains shared SHACL support while any associated source exists", async () => {
  const root = await project();
  const liveSource = "urn:repair:shared-support-live-source";
  const support = "urn:repair:shared-support-shapes";
  const supportBytes = Buffer.from(`<${support}> a <${metadata}ShapesGraph> .\n`);
  await writeFile(
    join(root, "live-source.ttl"),
    `<${liveSource}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`,
  );
  await writeFile(join(root, "shared.shacl.ttl"), supportBytes);
  await writeFile(
    join(root, "tbspec.toml"),
    `${await readFile(join(root, "tbspec.toml"), "utf8")}\n` +
      `[[associations]]\nresource = "removed-source.ttl"\nsupport = "shared.shacl.ttl"\nrole = "shacl"\n` +
      `\n[[associations]]\nresource = "live-source.ttl"\nsupport = "shared.shacl.ttl"\nrole = "shacl"\n`,
  );

  const preview = await collectGarbage({ project: root });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  const candidates = (preview.data?.candidates as { file: string }[]) ?? [];
  assert.ok(!candidates.some((candidate) => candidate.file === "shared.shacl.ttl"));
  assert.deepEqual(await readFile(join(root, "shared.shacl.ttl")), supportBytes);
});

test("garbage collection preserves saved views selecting nested and bare locked dependency selectors", async () => {
  const root = await project();
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const dependency = lock.dependencies["tbspec-metadata"];
  assert.ok(dependency);
  const originalKey = dependency.primary;
  const nestedKey = originalKey.replace(/^([^/]+)\//, "$1/nested/");
  const record = dependency.files.find((file) => file.key === originalKey);
  assert.ok(record);
  const originalPath = join(root, dependency.snapshot_path, originalKey);
  const nestedPath = join(root, dependency.snapshot_path, nestedKey);
  const nestedBytes = await readFile(originalPath);
  await mkdir(join(root, dependency.snapshot_path, "source", "nested"), { recursive: true });
  await rename(originalPath, nestedPath);
  dependency.primary = nestedKey;
  record.key = nestedKey;
  for (const edge of dependency.edges) {
    if (edge.from === originalKey) edge.from = nestedKey;
    if (edge.to === originalKey) edge.to = nestedKey;
  }
  for (const binding of dependency.bindings) {
    if (binding.resource === originalKey) binding.resource = nestedKey;
    for (const field of ["ontologies", "schemas"]) {
      const values = binding[field];
      assert.ok(Array.isArray(values));
      binding[field] = values.map((key: unknown) => (key === originalKey ? nestedKey : key));
    }
  }
  for (const association of dependency.associations) {
    if (association.resource === originalKey) association.resource = nestedKey;
    if (association.support === originalKey) association.support = nestedKey;
  }
  for (const choice of dependency.choices)
    if (choice.selected === originalKey) choice.selected = nestedKey;
  for (const attachment of dependency.attachments) {
    if (attachment.resource === originalKey) attachment.resource = nestedKey;
    if (attachment.primary === originalKey) attachment.primary = nestedKey;
  }
  dependency.interpretation_signature = interpretationSignature(dependency);
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  const nestedSelector = `dep:tbspec-metadata/${nestedKey}`;
  const sourceIri = record.graph_iri;
  const viewIri = "urn:repair:nested-dependency-view";
  const primaryViewIri = "urn:repair:primary-dependency-view";
  const presentationIri = "urn:repair:nested-dependency-presentation";
  const primaryPresentationIri = "urn:repair:primary-dependency-presentation";
  await writeFile(
    join(root, "nested-view.ttl"),
    `<${viewIri}> a <${metadata}ViewModel>; <${metadata}sourceGraph> <${sourceIri}> .\n`,
  );
  await writeFile(
    join(root, "nested-presentation.ttl"),
    `<${presentationIri}> a <${metadata}PresentationGraph>; <${metadata}forView> <${viewIri}> .\n`,
  );
  await writeFile(
    join(root, "primary-view.ttl"),
    `<${primaryViewIri}> a <${metadata}ViewModel>; <${metadata}sourceGraph> <${sourceIri}> .\n`,
  );
  await writeFile(
    join(root, "primary-presentation.ttl"),
    `<${primaryPresentationIri}> a <${metadata}PresentationGraph>; <${metadata}forView> <${primaryViewIri}> .\n`,
  );
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    `${manifest}\n[[views]]\nview = "nested-view.ttl"\nsource = "${nestedSelector}"\npresentation = "nested-presentation.ttl"\n` +
      `\n[[views]]\nview = "primary-view.ttl"\nsource = "dep:tbspec-metadata"\npresentation = "primary-presentation.ttl"\n`,
  );

  const preview = await collectGarbage({ project: root });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  const candidates = (preview.data?.candidates as { file: string }[]) ?? [];
  assert.ok(
    !candidates.some((candidate) =>
      ["nested-view.ttl", "primary-view.ttl"].includes(candidate.file),
    ),
  );
  assert.deepEqual(await readFile(nestedPath), nestedBytes);
  assert.ok(
    await readFile(join(root, "nested-view.ttl")).then(
      () => true,
      () => false,
    ),
  );
  assert.ok(
    await readFile(join(root, "nested-presentation.ttl")).then(
      () => true,
      () => false,
    ),
  );
});
