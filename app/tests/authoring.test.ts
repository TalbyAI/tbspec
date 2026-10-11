import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource, prepareResource, publishResource } from "../src/authoring.ts";
import { digest, graphSignature } from "../src/canonical.ts";
import { inspectProject } from "../src/inspection.ts";
import { initializeProject } from "../src/project.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";

test("authoring reads only selected dependency content and binds every owned identity check", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-author-scope-"));
  await initializeProject({ directory: root, baseIri: "urn:scope:/" });
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const unused = lock.dependencies["tbspec-state-machine"];
  assert.ok(unused);
  await writeFile(join(root, unused.snapshot_path, unused.primary), "malformed unused snapshot");
  await writeFile(
    join(root, "owned.ttl"),
    "<urn:owned> a <http://www.w3.org/2002/07/owl#Ontology> .",
  );
  for (const command of ["ontology.create", "model.create"] as const) {
    const prepared = await prepareResource({
      project: root,
      command,
      path: `${command}.ttl`,
      ...(command === "model.create" ? { type: "data" } : {}),
    });
    assert.ok(prepared.plan.preview.reads.some((read) => read.path === "owned.ttl"));
    assert.ok(
      !prepared.plan.preview.reads.some((read) => read.path.startsWith(unused.snapshot_path)),
    );
    await writeFile(
      join(root, "owned.ttl"),
      "<urn:changed> a <http://www.w3.org/2002/07/owl#Ontology> .",
    );
    assert.equal((await publishResource(prepared)).status, "conflict");
    await writeFile(
      join(root, "owned.ttl"),
      "<urn:owned> a <http://www.w3.org/2002/07/owl#Ontology> .",
    );
  }
  await writeFile(join(root, "owned.ttl"), "malformed owned graph");
  const refused = await authorResource({
    project: root,
    command: "ontology.create",
    path: "blocked.ttl",
  });
  assert.equal(refused.status, "invalid");
  assert.equal(refused.diagnostics[0]?.code, "RDF_SYNTAX");
  await assert.rejects(readFile(join(root, "blocked.ttl")), { code: "ENOENT" });
  await writeFile(
    join(root, "owned.ttl"),
    "<urn:owned> a <http://www.w3.org/2002/07/owl#Ontology> .",
  );
  const required = lock.dependencies["tbspec-metadata"];
  assert.ok(required);
  await writeFile(
    join(root, required.snapshot_path, required.primary),
    "damaged receiving vocabulary",
  );
  const damaged = await authorResource({
    project: root,
    command: "model.create",
    path: "damaged.ttl",
    type: "data",
  });
  assert.equal(damaged.status, "invalid");
  assert.equal(damaged.diagnostics[0]?.code, "SNAPSHOT_INTEGRITY");
  await assert.rejects(readFile(join(root, "damaged.ttl")), { code: "ENOENT" });
});

test("authoring reports invalid configuration before parsing owned identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-author-config-"));
  await initializeProject({ directory: root, baseIri: "urn:config:/" });
  await writeFile(join(root, "owned.ttl"), "malformed owned graph");
  await writeFile(join(root, "tbspec.lock"), "schema_version = 999\n");
  const result = await authorResource({
    project: root,
    command: "ontology.create",
    path: "new.ttl",
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.diagnostics[0]?.code, "SCHEMA_UNSUPPORTED");
  await assert.rejects(readFile(join(root, "new.ttl")), { code: "ENOENT" });
});

test("a destination occupied during capture is a conflict without parsing or replacing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-author-destination-race-"));
  await initializeProject({ directory: root, baseIri: "urn:race:/" });
  const script = `
    import assert from "node:assert/strict";
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import { authorResource } from ${JSON.stringify(new URL("../src/authoring.ts", import.meta.url).href)};
    const root = process.argv[1];
    const original = fs.readFile;
    let occupied = false;
    fs.readFile = async (path, ...args) => {
      const bytes = await original(path, ...args);
      if (!occupied && String(path) === join(root, "tbspec.lock")) {
        occupied = true;
        await fs.writeFile(join(root, "new.ttl"), "occupied during capture");
      }
      return bytes;
    };
    syncBuiltinESMExports();
    const result = await authorResource({ project: root, command: "ontology.create", path: "new.ttl" });
    assert.equal(result.status, "conflict", JSON.stringify(result));
    assert.equal(result.diagnostics[0].code, "REVISION_CONFLICT");
    assert.equal(await original(join(root, "new.ttl"), "utf8"), "occupied during capture");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script, root], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("authors create explicit and derived ontology identities and inspect owned resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-author-"));
  await initializeProject({ directory: root, baseIri: "https://example.org/project/" });
  for (const [path, iri] of [
    ["ontologies/domain.ttl", "urn:domain"],
    ["ontologies/café.ttl", undefined],
  ] as const) {
    const created = await authorResource({ project: root, command: "ontology.create", path, iri });
    assert.equal(created.status, "ok", JSON.stringify(created));
    const shown = await inspectProject({ project: root, command: "ontology.show", selector: path });
    assert.equal(shown.data?.resource?.graphIri, iri ?? "https://example.org/project/caf%C3%A9");
    assert.equal(shown.data?.resource?.kind, "ontology");
    assert.equal(shown.data?.resource?.ownership, "project");
    assert.match(
      await readFile(join(root, path), "utf8"),
      /http:\/\/www.w3.org\/2002\/07\/owl#Ontology/,
    );
  }
  const listed = await inspectProject({ project: root, command: "ontology.list" });
  assert.equal(listed.data?.items?.length, 2);
});

test("editable import preserves terms, unknown triples and originals while reporting missing vocabulary", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-import-"));
  const sourceDirectory = await mkdtemp(join(tmpdir(), "tb-source-"));
  const source = join(sourceDirectory, "external.ttl");
  const original =
    '<urn:source> a <https://talby.ai/ontology/tbspec#ConcreteDataModel>; <https://talby.ai/ontology/tbspec#modelType> "upstream"; <urn:annotation> "preserved" .\n<urn:Person> a <http://www.w3.org/2002/07/owl#Class> .\n<urn:alice> a <urn:Person>; <urn:unknown-property> "value"; <urn:link> <urn:source> .';
  await writeFile(source, original);
  await initializeProject({ directory: root, baseIri: "urn:copy:/" });
  const imported = await authorResource({
    project: root,
    command: "model.import",
    source,
    path: "models/copy.ttl",
    type: "data",
  });
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  assert.equal(imported.data?.applied, true);
  assert.equal(imported.data?.projectValidity, "invalid");
  assert.ok(
    imported.diagnostics.some(
      (d) =>
        d.code === "VOCABULARY_UNKNOWN" &&
        JSON.stringify(d.details).includes("urn:unknown-property"),
    ),
  );
  assert.ok(!imported.diagnostics.some((d) => JSON.stringify(d.details).includes("urn:Person")));
  const shown = await inspectProject({
    project: root,
    command: "model.show",
    selector: "models/copy.ttl",
  });
  assert.equal(shown.data?.resource?.kind, "concrete-data-model");
  assert.equal(shown.data?.resource?.modelType, "data");
  assert.equal(shown.data?.resource?.graphIri, "urn:copy:/copy");
  assert.equal(shown.data?.resource?.provenance?.[0]?.sourceGraphIri, "urn:source");
  assert.ok(
    shown.data?.triples?.some(
      (q) =>
        q.subject.value === "urn:source" &&
        q.predicate.value === "urn:annotation" &&
        q.object.value === "preserved",
    ),
  );
  assert.ok(
    shown.data?.triples?.some(
      (q) => q.subject.value === "urn:alice" && q.object.value === "urn:source",
    ),
  );
  assert.equal(await readFile(source, "utf8"), original);
  const locked = await inspectProject({
    project: root,
    command: "graph.show",
    selector: "dep:tbspec-state-machine",
  });
  const adopted = await authorResource({
    project: root,
    command: "ontology.import",
    source: "dep:tbspec-state-machine",
    path: "ontologies/state.ttl",
  });
  assert.equal(adopted.status, "ok", JSON.stringify(adopted));
  const copy = await inspectProject({
    project: root,
    command: "ontology.show",
    selector: "ontologies/state.ttl",
  });
  assert.ok(
    copy.data?.triples?.some(
      (q) => q.subject.value === "https://talby.ai/ontology/state-machine#State",
    ),
  );
  const after = await inspectProject({
    project: root,
    command: "graph.show",
    selector: "dep:tbspec-state-machine",
  });
  assert.equal(after.data?.sourceText, locked.data?.sourceText);
  assert.equal(after.data?.resource?.ownership, "dependency");
});

test("receiving vocabulary respects source contexts and configured dependency winners", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-author-context-"));
  const external = await mkdtemp(join(tmpdir(), "tb-context-source-"));
  await initializeProject({ directory: root, baseIri: "urn:context:/" });
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const dependency = lock.dependencies["tbspec-state-machine"];
  assert.ok(dependency);
  const primary = dependency.files.find((file) => file.key === dependency.primary);
  assert.ok(primary);
  const text = `<${primary.graph_iri}> a <http://www.w3.org/2002/07/owl#Ontology> . <urn:Foreign> a <http://www.w3.org/2002/07/owl#Class> .`;
  const foreign = {
    ...primary,
    key: "alternate/foreign.ttl",
    source_resource: "foreign.ttl",
    source: "alternate",
    context: "alternate",
    roles: ["closure"],
    byte_digest: digest(text),
    byte_length: Buffer.byteLength(text),
  };
  foreign.graph_signature = graphSignature(foreign);
  dependency.sources.push({
    id: "alternate",
    kind: "directory",
    locator: external,
    selected_resource: "foreign.ttl",
  });
  dependency.files.push(foreign);
  dependency.edges.push({
    context: "alternate",
    from: primary.key,
    relation: "vocabulary",
    to: foreign.key,
  });
  dependency.choices.push({
    context: primary.context,
    kind: "ontology",
    target_iri: primary.graph_iri,
    selected: primary.key,
  });
  dependency.interpretation_signature = interpretationSignature(dependency);
  await mkdir(join(root, dependency.snapshot_path, "alternate"));
  await writeFile(join(root, dependency.snapshot_path, foreign.key), text);
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  const source = join(external, "model.ttl");
  await writeFile(
    source,
    "<urn:old> a <https://talby.ai/ontology/tbspec#StateMachineModel> . <urn:entity> a <urn:Foreign> .",
  );
  const isolated = await authorResource({
    project: root,
    command: "model.import",
    source,
    path: "isolated.ttl",
    type: "state-machine",
  });
  assert.equal(isolated.status, "ok", JSON.stringify(isolated));
  assert.ok(
    isolated.diagnostics.some(
      (d) => d.code === "VOCABULARY_UNKNOWN" && d.details?.iri === "urn:Foreign",
    ),
  );
  await writeFile(
    join(root, "local.ttl"),
    `<urn:local> a <http://www.w3.org/2002/07/owl#Ontology>; <http://www.w3.org/2002/07/owl#imports> <${primary.graph_iri}> .`,
  );
  await writeFile(
    join(root, "tbspec.toml"),
    `schema_version = 1\nbase_iri = "urn:context:/"\n[model_types.state-machine]\nontology = "local.ttl"\n[ontology_choices]\n"${primary.graph_iri}" = "tbspec-state-machine"\n`,
  );
  const chosen = await authorResource({
    project: root,
    command: "model.create",
    path: "chosen.ttl",
    type: "state-machine",
  });
  assert.equal(chosen.status, "ok", JSON.stringify(chosen));
  assert.match(await readFile(join(root, "chosen.ttl"), "utf8"), /state-machine#StateMachine/);
  dependency.choices = [];
  dependency.interpretation_signature = interpretationSignature(dependency);
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  const ambiguous = await authorResource({
    project: root,
    command: "model.create",
    path: "ambiguous.ttl",
    type: "state-machine",
  });
  assert.equal(ambiguous.status, "conflict", JSON.stringify(ambiguous));
  assert.equal(ambiguous.diagnostics[0]?.code, "GRAPH_IRI_COLLISION");
  assert.equal(ambiguous.diagnostics[0]?.details?.target, primary.graph_iri);
  await assert.rejects(readFile(join(root, "ambiguous.ttl")), { code: "ENOENT" });
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    manifest.slice(0, manifest.indexOf("[ontology_choices]")),
  );
  const direct = await authorResource({
    project: root,
    command: "model.create",
    path: "direct.ttl",
    type: "state-machine",
  });
  assert.equal(direct.status, "ok", JSON.stringify(direct));
  await writeFile(
    join(root, "owned.ttl"),
    `<${primary.graph_iri}> a <http://www.w3.org/2002/07/owl#Ontology> . <urn:Owned> a <http://www.w3.org/2002/07/owl#Class> .`,
  );
  const owned = await authorResource({
    project: root,
    command: "model.create",
    path: "owned-model.ttl",
    type: "state-machine",
  });
  assert.equal(owned.status, "ok", JSON.stringify(owned));
  assert.doesNotMatch(
    await readFile(join(root, "owned-model.ttl"), "utf8"),
    /state-machine#StateMachine/,
  );
  await writeFile(
    join(root, "owned-copy.ttl"),
    `${await readFile(join(root, "owned.ttl"), "utf8")}\n# same triples, different bytes\n`,
  );
  const differentBytes = await authorResource({
    project: root,
    command: "model.create",
    path: "different.ttl",
    type: "state-machine",
  });
  assert.equal(differentBytes.status, "conflict", JSON.stringify(differentBytes));
  assert.equal(differentBytes.diagnostics[0]?.code, "GRAPH_IRI_COLLISION");
  await assert.rejects(readFile(join(root, "different.ttl")), { code: "ENOENT" });
});

test("schema identity collisions block concrete model authoring without merging vocabulary", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tb-schema-collision-"));
  const external = await mkdtemp(join(tmpdir(), "tb-schema-source-"));
  await initializeProject({ directory: root, baseIri: "urn:schema-copy:/" });
  const first =
    "<urn:schema> a <https://talby.ai/ontology/tbspec#ConceptualDataModel> . <urn:First> a <http://www.w3.org/2002/07/owl#Class> .";
  const second = first.replace("urn:First", "urn:Second");
  const source = join(external, "model.ttl");
  const original =
    "<urn:source> a <https://talby.ai/ontology/tbspec#ConcreteDataModel>; <https://talby.ai/ontology/tbspec#schema> <urn:schema> . <urn:entity> a <urn:Second> .";
  await writeFile(join(root, "first.ttl"), first);
  await writeFile(join(root, "second.ttl"), second);
  await writeFile(source, original);
  const manifest = await readFile(join(root, "tbspec.toml"));
  const lock = await readFile(join(root, "tbspec.lock"));
  for (const command of ["model.create", "model.import"] as const) {
    await t.test(command, async () => {
      const path = `${command}.ttl`;
      const result = await authorResource({
        project: root,
        command,
        path,
        type: "data",
        ...(command === "model.create"
          ? { profile: "concrete", schemas: ["first.ttl"] }
          : { source }),
      });
      assert.equal(result.status, "conflict", JSON.stringify(result));
      assert.equal(result.diagnostics[0]?.code, "GRAPH_IRI_COLLISION");
      assert.equal(result.diagnostics[0]?.details?.target, "urn:schema");
      await assert.rejects(readFile(join(root, path)), { code: "ENOENT" });
      assert.equal(await readFile(join(root, "first.ttl"), "utf8"), first);
      assert.equal(await readFile(join(root, "second.ttl"), "utf8"), second);
      assert.equal(await readFile(source, "utf8"), original);
      assert.deepEqual(await readFile(join(root, "tbspec.toml")), manifest);
      assert.deepEqual(await readFile(join(root, "tbspec.lock")), lock);
    });
  }
  await unlink(join(root, "second.ttl"));
  const imported = await authorResource({
    project: root,
    command: "model.import",
    source,
    path: "single.ttl",
    type: "data",
  });
  assert.equal(imported.status, "ok", JSON.stringify(imported));
  assert.ok(
    imported.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "VOCABULARY_UNKNOWN" && diagnostic.details?.iri === "urn:Second",
    ),
  );
});

test("publication rejects stale inputs, occupied destinations and identity collisions without rewriting files", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-stale-"));
  await initializeProject({ directory: root, baseIri: "urn:test:/" });
  const prepared = await prepareResource({
    project: root,
    command: "ontology.create",
    path: "new.ttl",
  });
  const mismatch = await authorResource({
    project: root,
    command: "ontology.create",
    path: "new.ttl",
    acceptedPreview: `sha256:${"0".repeat(64)}`,
  });
  assert.equal(mismatch.status, "conflict");
  assert.equal(mismatch.data?.applied, false);
  assert.ok(mismatch.data);
  assert.equal(
    (mismatch.data.preview as { fingerprint: string }).fingerprint,
    prepared.plan.preview.fingerprint,
  );
  await assert.rejects(readFile(join(root, "new.ttl")), { code: "ENOENT" });
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(join(root, "tbspec.toml"), `${manifest}\n# user edit\n`);
  const failed = await publishResource(prepared);
  assert.equal(failed.status, "conflict");
  await assert.rejects(readFile(join(root, "new.ttl")), { code: "ENOENT" });
  await writeFile(
    join(root, "occupied.ttl"),
    "<urn:existing> a <http://www.w3.org/2002/07/owl#Ontology> .",
  );
  for (const [path, iri, status, code] of [
    ["occupied.ttl", "urn:other", "conflict", "REVISION_CONFLICT"],
    ["collision.ttl", "urn:existing", "conflict", "GRAPH_IRI_COLLISION"],
    ["../escape.ttl", "urn:other", "invalid_arguments", "PATH_UNSAFE"],
    [".tbspec/dependencies/changed.ttl", "urn:other", "invalid_arguments", "PATH_UNSAFE"],
  ]) {
    const rejected = await authorResource({
      project: root,
      command: "ontology.create",
      path: path ?? "",
      iri,
    });
    assert.equal(rejected.status, status, JSON.stringify(rejected));
    assert.equal(rejected.diagnostics[0]?.code, code);
  }
  assert.equal(
    await readFile(join(root, "occupied.ttl"), "utf8"),
    "<urn:existing> a <http://www.w3.org/2002/07/owl#Ontology> .",
  );
});

test("authors create distinct data profiles and empty descriptive process and state-machine models", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-families-"));
  await initializeProject({ directory: root, baseIri: "urn:example:/" });
  for (const [type, profile, kind, businessType] of [
    ["data", undefined, "conceptual-data-model", undefined],
    ["data", "concrete", "concrete-data-model", undefined],
    ["process", undefined, "process-model", "http://purl.org/net/p-plan#Plan"],
    [
      "state-machine",
      undefined,
      "state-machine-model",
      "https://talby.ai/ontology/state-machine#StateMachine",
    ],
  ] as const) {
    const path = `models/${kind}.ttl`;
    const created = await authorResource({
      project: root,
      command: "model.create",
      path,
      type,
      profile,
    });
    assert.equal(created.status, "ok", JSON.stringify(created));
    const shown = await inspectProject({ project: root, command: "model.show", selector: path });
    assert.equal(shown.data?.resource?.kind, kind);
    assert.equal(shown.data?.resource?.modelType, type);
    assert.ok(shown.data?.resource?.associations.some((a) => a.role === "ontology"));
    if (businessType) assert.match(shown.data?.sourceText ?? "", new RegExp(businessType));
  }
  const concrete = await authorResource({
    project: root,
    command: "model.create",
    path: "models/instance.ttl",
    type: "data",
    profile: "concrete",
    schemas: ["models/conceptual-data-model.ttl"],
  });
  assert.equal(concrete.status, "ok", JSON.stringify(concrete));
  const shown = await inspectProject({
    project: root,
    command: "model.show",
    selector: "models/instance.ttl",
  });
  assert.deepEqual(shown.data?.resource?.schemaIris, ["urn:example:/conceptual-data-model"]);
  const inventory = await inspectProject({ project: root, command: "graph.list" });
  assert.ok(
    inventory.data?.items
      ?.find((item) => item.selector === "models/instance.ttl")
      ?.associations.some(
        (a) => a.role === "schema" && a.selector === "models/conceptual-data-model.ttl",
      ),
  );
  const manifest = join(root, "tbspec.toml");
  const original = await readFile(manifest, "utf8");
  await writeFile(manifest, original.replace("enabled = true", "enabled = false"));
  for (const type of ["data", "missing"]) {
    const result = await authorResource({
      project: root,
      command: "model.create",
      path: "rejected.ttl",
      type,
    });
    assert.equal(result.status, "invalid_arguments", JSON.stringify(result));
    assert.equal(result.diagnostics[0]?.code, "MODEL_TYPE_UNUSABLE");
    await assert.rejects(readFile(join(root, "rejected.ttl")), { code: "ENOENT" });
  }
});

test("creation uses replacement vocabulary without inventing starter classes and rejects unusable types", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-replacement-"));
  await initializeProject({ directory: root });
  const missingBase = await authorResource({
    project: root,
    command: "ontology.create",
    path: "missing-base.ttl",
  });
  assert.equal(missingBase.status, "invalid_arguments");
  await authorResource({
    project: root,
    command: "ontology.create",
    path: "replacement.ttl",
    iri: "urn:replacement",
  });
  await writeFile(
    join(root, "tbspec.toml"),
    'schema_version = 1\n[model_types.process]\nontology = "replacement.ttl"\n[model_types.custom]\nontology = "replacement.ttl"\n[model_types.broken]\nontology = "absent.ttl"\n',
  );
  for (const type of ["process", "custom"]) {
    const result = await authorResource({
      project: root,
      command: "model.create",
      path: `${type}.ttl`,
      iri: `urn:model:${type}`,
      type,
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    const shown = await inspectProject({
      project: root,
      command: "model.show",
      selector: `${type}.ttl`,
    });
    assert.equal(shown.data?.triples?.length, 2);
    assert.equal(shown.data?.resource?.kind, type === "process" ? "process-model" : "model");
  }
  assert.equal(
    (
      await authorResource({
        project: root,
        command: "model.create",
        path: "bad.ttl",
        iri: "urn:bad",
        type: "broken",
      })
    ).status,
    "invalid",
  );
  await assert.rejects(readFile(join(root, "bad.ttl")), { code: "ENOENT" });
  await mkdir(join(root, "directory.ttl"));
  assert.equal(
    (
      await authorResource({
        project: root,
        command: "ontology.create",
        path: "directory.ttl",
        iri: "urn:directory",
      })
    ).status,
    "conflict",
  );
});

test("failed parse/classification imports preserve originals and successful copies report owned term collisions", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-import-errors-"));
  const external = await mkdtemp(join(tmpdir(), "tb-bad-source-"));
  const source = join(external, "source.ttl");
  await initializeProject({ directory: root, baseIri: "urn:errors:/" });
  const manifest = await readFile(join(root, "tbspec.toml"));
  for (const [text, code] of [
    ["invalid turtle", "RDF_SYNTAX"],
    [
      "<urn:one> a <http://www.w3.org/2002/07/owl#Ontology> . <urn:two> a <http://www.w3.org/2002/07/owl#Ontology> .",
      "GRAPH_CLASSIFICATION",
    ],
    [
      "<urn:one> a <https://talby.ai/ontology/tbspec#ProcessModel>, <https://talby.ai/ontology/tbspec#StateMachineModel> .",
      "GRAPH_CLASSIFICATION",
    ],
  ]) {
    await writeFile(source, text ?? "");
    const result = await authorResource({
      project: root,
      command: "ontology.import",
      source,
      path: "rejected.ttl",
    });
    assert.equal(result.status, "invalid");
    assert.equal(result.diagnostics[0]?.code, code);
    await assert.rejects(readFile(join(root, "rejected.ttl")), { code: "ENOENT" });
    assert.equal(await readFile(source, "utf8"), text);
    assert.deepEqual(await readFile(join(root, "tbspec.toml")), manifest);
  }
  await writeFile(
    source,
    "<urn:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> . <urn:Person> a <http://www.w3.org/2002/07/owl#Class> .",
  );
  await authorResource({ project: root, command: "ontology.import", source, path: "first.ttl" });
  const second = await authorResource({
    project: root,
    command: "ontology.import",
    source,
    path: "second.ttl",
  });
  assert.equal(second.status, "ok");
  assert.ok(
    second.diagnostics.some(
      (d) => d.code === "TERM_IRI_COLLISION" && d.details?.iri === "urn:Person",
    ),
  );
});

test("concurrent identity claims publish once and native publication failure leaves authored inputs intact", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-author-fault-"));
  await initializeProject({ directory: root, baseIri: "urn:fault:/" });
  const requests = await Promise.all(
    ["first.ttl", "second.ttl"].map((path) =>
      authorResource({ project: root, command: "ontology.create", path, iri: "urn:claim" }),
    ),
  );
  assert.equal(requests.filter((result) => result.status === "ok").length, 1);
  assert.equal(requests.filter((result) => result.status === "conflict").length, 1);
  const script = `
    import assert from "node:assert/strict";
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import { authorResource } from ${JSON.stringify(new URL("../src/authoring.ts", import.meta.url).href)};
    const root = process.argv[1];
    const manifest = await fs.readFile(join(root, "tbspec.toml"));
    const original = fs.link;
    fs.link = async (from, to) => { if (to === join(root, "failed.ttl")) throw new Error("Native publication fault"); return original(from, to); };
    syncBuiltinESMExports();
    const failed = await authorResource({ project: root, command: "ontology.create", path: "failed.ttl" });
    assert.equal(failed.status, "unavailable", JSON.stringify(failed));
    await assert.rejects(fs.readFile(join(root, "failed.ttl")), { code: "ENOENT" });
    assert.deepEqual(await fs.readFile(join(root, "tbspec.toml")), manifest);
    fs.link = original; syncBuiltinESMExports();
    assert.equal((await authorResource({ project: root, command: "ontology.create", path: "retried.ttl" })).status, "ok");
  `;
  const processResult = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", script, root],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
  assert.equal(processResult.status, 0, processResult.stderr);
});
