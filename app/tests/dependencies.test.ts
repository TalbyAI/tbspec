import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource } from "../src/authoring.ts";
import {
  dependencyAdd,
  dependencyInspect,
  dependencyList,
  dependencyShow,
} from "../src/dependencies.ts";
import { initializeProject } from "../src/project.ts";
import { parseLock } from "../src/schemas.ts";
import { starterDirectory } from "../src/starters.ts";

test("directory acquisition previews a selected import closure and publishes only after a matching fingerprint", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-directory-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const rootIri = "https://example.org/shop";
  const baseIri = "https://example.org/base";
  const primary = `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${rootIri}> a owl:Ontology; owl:imports <${baseIri}> .\n`;
  const base = `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${baseIri}> a owl:Ontology .\n`;
  const unrelated = `@prefix t: <https://talby.ai/ontology/tbspec#> .\n<https://example.org/unrelated> a t:Model .\n`;
  await writeFile(join(source, "shop.ttl"), primary);
  await writeFile(join(source, "base.ttl"), base);
  await writeFile(join(source, "unrelated.ttl"), unrelated);

  const inventory = await dependencyInspect({ project, source });
  assert.equal(inventory.status, "ok", JSON.stringify(inventory));
  assert.ok(inventory.data);
  assert.deepEqual(
    (inventory.data.items as { resource: string }[]).map((item) => item.resource),
    ["base.ttl", "shop.ttl", "unrelated.ttl"],
  );

  const preview = await dependencyAdd({
    project,
    source,
    id: "shop",
    kind: "ontology",
    resource: "shop.ttl",
  });
  assert.equal(preview.status, "conflict", JSON.stringify(preview));
  assert.ok(preview.data);
  const fingerprint = (preview.data.preview as { fingerprint: string }).fingerprint;
  assert.equal(
    await readFile(join(project, "tbspec.lock"), "utf8").then((text) => text.includes('"shop"')),
    false,
  );

  const added = await dependencyAdd({
    project,
    source,
    id: "shop",
    kind: "ontology",
    resource: "shop.ttl",
    acceptedPreview: fingerprint,
  });
  assert.equal(added.status, "ok", JSON.stringify(added));
  const lock = parseLock(await readFile(join(project, "tbspec.lock"), "utf8"));
  const dependency = lock.dependencies.shop;
  assert.ok(dependency);
  assert.deepEqual(dependency.files.map((file) => file.source_resource).sort(), [
    "base.ttl",
    "shop.ttl",
  ]);
  assert.ok(dependency.edges.some((edge) => edge.from === dependency.primary && edge.to));
  assert.equal(
    await readFile(join(project, dependency.snapshot_path, "source/shop.ttl"), "utf8"),
    primary,
  );

  const listed = await dependencyList({ project });
  assert.equal(listed.status, "ok", JSON.stringify(listed));
  assert.ok(listed.data);
  assert.equal(
    (listed.data.items as { id: string }[]).some((item) => item.id === "shop"),
    true,
  );
  const shown = await dependencyShow({ project, id: "shop" });
  assert.equal(shown.status, "ok", JSON.stringify(shown));
  assert.ok(shown.data);
  assert.equal(
    (shown.data.dependency as { primarySelector: string }).primarySelector,
    "dep:shop/source/shop.ttl",
  );
});

test("invalid UTF-8 RDF is rejected without rewriting source or publishing a snapshot", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-invalid-utf8-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const invalid = Buffer.concat([
    Buffer.from(
      '@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:invalid:utf8> a owl:Ontology; <urn:value> "',
      "utf8",
    ),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('" .\n', "utf8"),
  ]);
  const sourcePath = join(source, "broken.ttl");
  await writeFile(sourcePath, invalid);
  const beforeLock = await readFile(join(project, "tbspec.lock"));
  const inventory = await dependencyInspect({ project, source });
  assert.equal(inventory.status, "ok");
  assert.ok(inventory.data);
  const item = (inventory.data.items as { parseable: boolean; diagnostic?: { code: string } }[])[0];
  assert.equal(item?.parseable, false);
  assert.ok(item?.diagnostic?.code === "RDF_SYNTAX");
  const added = await dependencyAdd({
    project,
    source,
    id: "broken",
    kind: "ontology",
    resource: "broken.ttl",
  });
  assert.notEqual(added.status, "ok");
  assert.deepEqual(await readFile(sourcePath), invalid);
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), beforeLock);
  await assert.rejects(access(join(project, ".tbspec/dependencies/broken")), { code: "ENOENT" });
});

test("directory acquisition bounds retained state, honors closure-only caps, and cancels between files", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-inventory-limit-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const primary =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:bounded:shop> a owl:Ontology .\n";
  const unrelated =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:bounded:unrelated> a owl:Ontology .\n";
  await writeFile(join(source, "shop.ttl"), primary);
  await writeFile(join(source, "unrelated.ttl"), unrelated);
  const manifestPath = join(project, "tbspec.toml");
  const manifest = await readFile(manifestPath, "utf8");
  await writeFile(
    manifestPath,
    `${manifest}\n[acquisition]\nmax_graph_bytes = 256\nmax_total_bytes = 96\nmax_files = 1\n`,
  );

  assert.ok(Buffer.byteLength(primary) < 96);
  assert.ok(Buffer.byteLength(primary) + Buffer.byteLength(unrelated) > 96);
  const preview = await dependencyAdd({
    project,
    source,
    id: "bounded",
    kind: "ontology",
    resource: "shop.ttl",
  });
  assert.equal(preview.status, "conflict", JSON.stringify(preview));
  assert.ok(preview.data);
  assert.equal((preview.data.dependency as { files: unknown[] }).files.length, 1);

  const linked =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:bounded:linked> a owl:Ontology; owl:imports <urn:bounded:base> .\n";
  const base =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:bounded:base> a owl:Ontology .\n";
  await writeFile(join(source, "linked.ttl"), linked);
  await writeFile(join(source, "base.ttl"), base);
  const linkedLimit = Buffer.byteLength(linked) + 1;
  assert.ok(Buffer.byteLength(linked) + Buffer.byteLength(base) > linkedLimit);
  const updatedManifest = await readFile(manifestPath, "utf8");
  await writeFile(
    manifestPath,
    updatedManifest
      .replace("max_total_bytes = 96", `max_total_bytes = ${linkedLimit}`)
      .replace("max_files = 1", "max_files = 10"),
  );
  const beforeLimitedLock = await readFile(join(project, "tbspec.lock"));
  const overLimit = await dependencyAdd({
    project,
    source,
    id: "over-limit",
    kind: "ontology",
    resource: "linked.ttl",
  });
  assert.notEqual(overLimit.status, "ok", JSON.stringify(overLimit));
  assert.ok(overLimit.diagnostics.some((item) => item.code === "ACQUISITION_LIMIT"));
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), beforeLimitedLock);
  await assert.rejects(access(join(project, ".tbspec/dependencies/over-limit")), {
    code: "ENOENT",
  });

  const before = await readFile(join(project, "tbspec.lock"));
  let abortChecks = 0;
  const signal = Object.defineProperty({}, "aborted", {
    get: () => ++abortChecks >= 3,
  }) as AbortSignal;
  const cancelled = await dependencyAdd({
    project,
    source,
    id: "cancelled",
    kind: "ontology",
    resource: "shop.ttl",
    signal,
  });
  assert.equal(cancelled.status, "conflict", JSON.stringify(cancelled));
  assert.ok(cancelled.diagnostics.some((item) => item.code === "ACQUISITION_CANCELLED"));
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), before);
  await assert.rejects(access(join(project, ".tbspec/dependencies/cancelled")), {
    code: "ENOENT",
  });
});

test("directory lazy reads detect a source change without publishing canonical state", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-lazy-revision-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const sourcePath = join(source, "shop.ttl");
  const original =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:lazy:shop> a owl:Ontology .\n";
  await writeFile(sourcePath, original);
  const beforeLock = await readFile(join(project, "tbspec.lock"));
  let changed = false;
  let lastSignalStack = "";
  const controller = new AbortController();
  Object.defineProperty(controller.signal, "aborted", {
    get: () => {
      const stack = new Error().stack ?? "";
      lastSignalStack = stack;
      if (!changed && stack.includes("readIndexedEntry")) {
        changed = true;
        writeFileSync(sourcePath, `${original}# changed after compact indexing\n`);
      }
      return false;
    },
  });
  const signal = controller.signal;
  const result = await dependencyAdd({
    project,
    source,
    id: "stale",
    kind: "ontology",
    resource: "shop.ttl",
    signal,
  });
  assert.equal(changed, true, lastSignalStack);
  assert.equal(result.status, "conflict", JSON.stringify(result));
  assert.ok(result.diagnostics.some((item) => item.code === "REVISION_CONFLICT"));
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), beforeLock);
  await assert.rejects(access(join(project, ".tbspec/dependencies/stale")), { code: "ENOENT" });
});

test("dependency closure is cycle-safe and accepts only exact vetted P-Plan RDF/XML", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-cycle-xml-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const first = `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:cycle:first> a owl:Ontology; owl:imports <urn:cycle:second> .\n`;
  const second = `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:cycle:second> a owl:Ontology; owl:imports <urn:cycle:first> .\n`;
  await writeFile(join(source, "first.ttl"), first);
  await writeFile(join(source, "second.ttl"), second);
  const preview = await dependencyAdd({
    project,
    source,
    id: "cycle",
    kind: "ontology",
    resource: "first.ttl",
  });
  assert.equal(preview.status, "conflict", JSON.stringify(preview));
  assert.ok(preview.data);
  assert.equal((preview.data.dependency as { files: unknown[] }).files.length, 2);
  const fingerprint = (preview.data.preview as { fingerprint: string }).fingerprint;
  const applied = await dependencyAdd({
    project,
    source,
    id: "cycle",
    kind: "ontology",
    resource: "first.ttl",
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));

  const pPlan = await readFile(new URL("source/p-plan.owl", starterDirectory));
  await writeFile(join(source, "p-plan.owl"), pPlan);
  const vetted = await dependencyAdd({
    project,
    source,
    id: "vetted-p-plan",
    kind: "ontology",
    resource: "p-plan.owl",
  });
  assert.equal(vetted.status, "conflict", JSON.stringify(vetted));
  assert.ok(vetted.data);
  const vettedFingerprint = (vetted.data.preview as { fingerprint: string }).fingerprint;
  const accepted = await dependencyAdd({
    project,
    source,
    id: "vetted-p-plan",
    kind: "ontology",
    resource: "p-plan.owl",
    acceptedPreview: vettedFingerprint,
  });
  assert.equal(accepted.status, "ok", JSON.stringify(accepted));

  const modified = Buffer.from(pPlan);
  modified[modified.length - 1] = modified.at(-1) === 0x0a ? 0x20 : 0x0a;
  await writeFile(join(source, "p-plan.owl"), modified);
  const modifiedInventory = await dependencyInspect({ project, source });
  assert.ok(modifiedInventory.data);
  const item = (
    modifiedInventory.data.items as {
      resource: string;
      parseable: boolean;
      diagnostic?: { code: string };
    }[]
  ).find((candidate) => candidate.resource === "p-plan.owl");
  assert.equal(item?.parseable, false);
  assert.equal(item?.diagnostic?.code, "RDF_FORMAT_UNSUPPORTED");
  const before = await readFile(join(project, "tbspec.lock"));
  const rejected = await dependencyAdd({
    project,
    source,
    id: "modified-p-plan",
    kind: "ontology",
    resource: "p-plan.owl",
  });
  assert.notEqual(rejected.status, "ok");
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), before);
});

test("acquiring a source-project model retains its source bindings and locked snapshot bytes", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-inherited-model-"));
  const source = join(parent, "source-project");
  const consumer = join(parent, "consumer");
  assert.equal(
    (await initializeProject({ directory: source, baseIri: "urn:source-model:/" })).status,
    "ok",
  );
  assert.equal((await initializeProject({ directory: consumer })).status, "ok");
  const model = await authorResource({
    project: source,
    command: "model.create",
    path: "models/process.ttl",
    type: "process",
  });
  assert.equal(model.status, "ok", JSON.stringify(model));
  const sourceLock = parseLock(await readFile(join(source, "tbspec.lock"), "utf8"));
  const inheritedFile = sourceLock.dependencies["tbspec-process"]?.files.find(
    (file) => file.source_resource === "p-plan.owl",
  );
  assert.ok(inheritedFile);
  const inheritedBytes = await readFile(
    join(source, sourceLock.dependencies["tbspec-process"]?.snapshot_path ?? "", inheritedFile.key),
  );

  const preview = await dependencyAdd({
    project: consumer,
    source,
    id: "external-process",
    kind: "model",
    resource: "models/process.ttl",
  });
  assert.equal(preview.status, "conflict", JSON.stringify(preview));
  assert.ok(preview.data);
  const accepted = await dependencyAdd({
    project: consumer,
    source,
    id: "external-process",
    kind: "model",
    resource: "models/process.ttl",
    acceptedPreview: (preview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(accepted.status, "ok", JSON.stringify(accepted));
  const lock = parseLock(await readFile(join(consumer, "tbspec.lock"), "utf8"));
  const dependency = lock.dependencies["external-process"];
  assert.ok(dependency);
  assert.ok(dependency.bindings.some((binding) => binding.model_type === "process"));
  assert.ok(
    dependency.files.some((file) => file.key === "source/locked/tbspec-process/source/p-plan.owl"),
  );
  assert.ok(
    dependency.sources.some((sourceRecord) => sourceRecord.id === "upstream/tbspec-process/source"),
  );
  assert.deepEqual(
    await readFile(
      join(consumer, dependency.snapshot_path, "source/locked/tbspec-process/source/p-plan.owl"),
    ),
    inheritedBytes,
  );
});
