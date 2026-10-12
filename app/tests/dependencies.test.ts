import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { authorResource } from "../src/authoring.ts";
import { digest, graphSignature } from "../src/canonical.ts";
import {
  dependencyAdd,
  dependencyCheck,
  dependencyClear,
  dependencyInspect,
  dependencyList,
  dependencySelect,
  dependencyShow,
} from "../src/dependencies.ts";
import { inspectProject } from "../src/inspection.ts";
import { initializeProject } from "../src/project.ts";
import { queryRun } from "../src/query.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";
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

test("ontology selection keeps one effective graph, retains the losing selector, and checks read-only drift", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-ontology-resolution-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  const ontologyIri = "https://example.org/choice";
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  for (const [name, value] of [
    ["one", "first"],
    ["two", "second"],
  ] as const) {
    await writeFile(
      join(source, `${name}.ttl`),
      `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${ontologyIri}> a owl:Ontology; <urn:choice:value> "${value}" .\n`,
    );
    const preview = await dependencyAdd({
      project,
      source,
      id: name,
      kind: "ontology",
      resource: `${name}.ttl`,
    });
    assert.equal(preview.status, "conflict", JSON.stringify(preview));
    assert.ok(preview.data);
    const added = await dependencyAdd({
      project,
      source,
      id: name,
      kind: "ontology",
      resource: `${name}.ttl`,
      acceptedPreview: (preview.data.preview as { fingerprint: string }).fingerprint,
    });
    assert.equal(added.status, "ok", JSON.stringify(added));
  }

  const beforeChoice = await queryRun({
    project,
    queryText: "ASK { ?subject ?predicate ?object }",
  });
  assert.equal(beforeChoice.status, "conflict");
  assert.ok(beforeChoice.diagnostics.some((item) => item.code === "ONTOLOGY_CONFLICT"));
  const selected = await dependencySelect({ project, ontologyIri, id: "one" });
  assert.equal(selected.status, "ok", JSON.stringify(selected));
  const listing = await dependencyList({ project });
  assert.equal(listing.status, "ok", JSON.stringify(listing));
  assert.ok(listing.data);
  const selectedListing = (
    listing.data.items as {
      id: string;
      sources: unknown[];
      support: unknown[];
      files: { selector: string }[];
      ontologies: { graphIri: string; effective: boolean; choice: string | null }[];
    }[]
  ).find((item) => item.id === "one");
  assert.ok(selectedListing);
  assert.equal(selectedListing.ontologies[0]?.graphIri, ontologyIri);
  assert.equal(selectedListing.ontologies[0]?.effective, true);
  assert.equal(selectedListing.ontologies[0]?.choice, "one");
  assert.ok(selectedListing.sources.length > 0);
  assert.ok(selectedListing.files.some((file) => file.selector === "dep:one/source/one.ttl"));
  const effective = await queryRun({
    project,
    queryText: 'ASK { <https://example.org/choice> <urn:choice:value> "first" }',
  });
  const losing = await queryRun({
    project,
    graph: "dep:two",
    queryText:
      'ASK { GRAPH <https://example.org/choice> { <https://example.org/choice> <urn:choice:value> "second" } }',
  });
  assert.deepEqual(effective.data, { type: "ask", value: true });
  assert.deepEqual(losing.data, { type: "ask", value: true });

  const lockBeforeCheck = await readFile(join(project, "tbspec.lock"));
  const selectedDependency = await dependencyShow({ project, id: "one" });
  assert.ok(selectedDependency.data);
  const lockedFile = (selectedDependency.data.dependency as { files: { file: string }[] }).files[0];
  assert.ok(lockedFile);
  const snapshotBeforeCheck = await readFile(join(project, lockedFile.file));
  const checked = await dependencyCheck({ project, id: "one" });
  assert.equal(checked.status, "ok", JSON.stringify(checked));
  assert.ok(checked.data);
  assert.equal(
    (checked.data.items as { id: string; state: string }[]).find((item) => item.id === "one")
      ?.state,
    "unchanged",
  );
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBeforeCheck);
  assert.deepEqual(await readFile(join(project, lockedFile.file)), snapshotBeforeCheck);

  const cleared = await dependencyClear({ project, ontologyIri });
  assert.equal(cleared.status, "ok", JSON.stringify(cleared));
  const unresolved = await queryRun({ project, queryText: "ASK { ?subject ?predicate ?object }" });
  assert.equal(unresolved.status, "conflict");
  assert.ok(unresolved.diagnostics.some((item) => item.code === "ONTOLOGY_CONFLICT"));

  const lockPath = join(project, "tbspec.lock");
  const lock = parseLock(await readFile(lockPath, "utf8"));
  const ambiguousDependency = lock.dependencies.one;
  assert.ok(ambiguousDependency);
  const primary = ambiguousDependency.files.find(
    (file) => file.key === ambiguousDependency.primary,
  );
  assert.ok(primary);
  const primaryBytes = Buffer.from(
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${ontologyIri}> a owl:Ontology; owl:imports <${ontologyIri}>; <urn:choice:value> "first" .\n`,
  );
  primary.byte_digest = digest(primaryBytes);
  primary.byte_length = primaryBytes.length;
  primary.graph_signature = graphSignature(primary);
  const alternateBytes = Buffer.from(
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${ontologyIri}> a owl:Ontology; <urn:choice:value> "alternate" .\n`,
  );
  const alternate = {
    ...primary,
    key: "source/alternate.ttl",
    source_resource: "alternate.ttl",
    roles: ["closure"],
    byte_digest: digest(alternateBytes),
    byte_length: alternateBytes.length,
    base_iri: pathToFileURL(join(source, "alternate.ttl")).href,
  };
  alternate.graph_signature = graphSignature(alternate);
  ambiguousDependency.files.push(alternate);
  ambiguousDependency.files.sort((left, right) => left.key.localeCompare(right.key));
  ambiguousDependency.edges.push({
    context: primary.context,
    from: primary.key,
    relation: "import",
    to: alternate.key,
  });
  ambiguousDependency.interpretation_signature = interpretationSignature(ambiguousDependency);
  const ambiguousLock = writeToml(lock);
  assert.doesNotThrow(() => parseLock(ambiguousLock));
  await writeFile(join(project, ambiguousDependency.snapshot_path, primary.key), primaryBytes);
  await writeFile(join(project, ambiguousDependency.snapshot_path, alternate.key), alternateBytes);
  await writeFile(lockPath, ambiguousLock);
  const ambiguous = await dependencySelect({ project, ontologyIri, id: "one" });
  assert.equal(ambiguous.status, "conflict", JSON.stringify(ambiguous));
  assert.ok(ambiguous.diagnostics.some((item) => item.code === "SOURCE_SELECTION_AMBIGUOUS"));
});

test("ontology resolution prefers owned then nearest candidates and preserves equal-signature contexts", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-priority-"));
  const project = join(parent, "project");
  const transitiveSource = join(parent, "transitive-source");
  const directSource = join(parent, "direct-source");
  await mkdir(transitiveSource);
  await mkdir(directSource);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const iri = "https://example.org/priority/shared";
  await writeFile(
    join(transitiveSource, "primary.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:priority:root> a owl:Ontology; owl:imports <${iri}> .\n`,
  );
  await writeFile(
    join(transitiveSource, "shared.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${iri}> a owl:Ontology; <urn:priority:value> "transitive" .\n`,
  );
  const add = async (source: string, dependencyId: string, resource: string) => {
    const preview = await dependencyAdd({
      project,
      source,
      id: dependencyId,
      kind: "ontology",
      resource,
    });
    assert.equal(preview.status, "conflict", JSON.stringify(preview));
    assert.ok(preview.data);
    const applied = await dependencyAdd({
      project,
      source,
      id: dependencyId,
      kind: "ontology",
      resource,
      acceptedPreview: (preview.data.preview as { fingerprint: string }).fingerprint,
    });
    assert.equal(applied.status, "ok", JSON.stringify(applied));
  };
  await add(transitiveSource, "transitive", "primary.ttl");
  await writeFile(
    join(directSource, "shared.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${iri}> a owl:Ontology; <urn:priority:value> "direct" .\n`,
  );
  await add(directSource, "direct-one", "shared.ttl");
  await add(directSource, "direct-two", "shared.ttl");

  const candidates = await dependencyList({ project });
  assert.equal(candidates.status, "ok", JSON.stringify(candidates));
  assert.ok(candidates.data);
  const listed = candidates.data.items as {
    id: string;
    ontologies: { graphIri: string; effective: boolean }[];
  }[];
  for (const dependencyId of ["direct-one", "direct-two"])
    assert.ok(
      listed
        .find((item) => item.id === dependencyId)
        ?.ontologies.some((item) => item.graphIri === iri && item.effective),
    );
  assert.equal(
    listed
      .find((item) => item.id === "transitive")
      ?.ontologies.find((item) => item.graphIri === iri)?.effective,
    false,
  );
  const direct = await queryRun({
    project,
    queryText: `ASK { <${iri}> <urn:priority:value> "direct" }`,
  });
  const transitive = await queryRun({
    project,
    queryText: `ASK { <${iri}> <urn:priority:value> "transitive" }`,
  });
  assert.deepEqual(direct.data, { type: "ask", value: true });
  assert.deepEqual(transitive.data, { type: "ask", value: false });

  await writeFile(
    join(project, "owned.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${iri}> a owl:Ontology; <urn:priority:value> "owned" .\n`,
  );
  const owned = await queryRun({
    project,
    queryText: `ASK { <${iri}> <urn:priority:value> "owned" }`,
  });
  const shadowed = await queryRun({
    project,
    queryText: `ASK { <${iri}> <urn:priority:value> "direct" }`,
  });
  assert.deepEqual(owned.data, { type: "ask", value: true });
  assert.deepEqual(shadowed.data, { type: "ask", value: false });
});

test("unused source choices do not activate retained files in query, validation, or drift checks", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-dependency-unused-choice-"));
  const project = join(parent, "project");
  const source = join(parent, "source");
  await mkdir(source);
  assert.equal((await initializeProject({ directory: project })).status, "ok");
  const rootIri = "https://example.org/unused-choice/root";
  const inactiveIri = "https://example.org/unused-choice/inactive";
  await writeFile(
    join(source, "root.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${rootIri}> a owl:Ontology; <urn:unused-choice:value> "root" .\n`,
  );
  const preview = await dependencyAdd({
    project,
    source,
    id: "unused-choice",
    kind: "ontology",
    resource: "root.ttl",
  });
  assert.equal(preview.status, "conflict", JSON.stringify(preview));
  assert.ok(preview.data);
  const added = await dependencyAdd({
    project,
    source,
    id: "unused-choice",
    kind: "ontology",
    resource: "root.ttl",
    acceptedPreview: (preview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(added.status, "ok", JSON.stringify(added));

  const lockPath = join(project, "tbspec.lock");
  const lock = parseLock(await readFile(lockPath, "utf8"));
  const dependency = lock.dependencies["unused-choice"];
  assert.ok(dependency);
  const primary = dependency.files.find((file) => file.key === dependency.primary);
  assert.ok(primary);
  const inactiveBytes = Buffer.from("malformed RDF that is retained but unreachable");
  const inactiveFile = {
    ...primary,
    key: "source/inactive.ttl",
    source_resource: "inactive.ttl",
    roles: ["closure"],
    graph_iri: inactiveIri,
    source_graph_iri: inactiveIri,
    byte_digest: digest(inactiveBytes),
    byte_length: inactiveBytes.length,
    base_iri: pathToFileURL(join(source, "inactive.ttl")).href,
  };
  inactiveFile.graph_signature = graphSignature(inactiveFile);
  dependency.files.push(inactiveFile);
  dependency.files.sort((left, right) => left.key.localeCompare(right.key));
  dependency.choices.push({
    context: primary.context,
    kind: "ontology",
    target_iri: inactiveIri,
    selected: inactiveFile.key,
  });
  dependency.interpretation_signature = interpretationSignature(dependency);
  const updatedLock = writeToml(lock);
  assert.doesNotThrow(() => parseLock(updatedLock));
  await writeFile(lockPath, updatedLock);
  await writeFile(join(project, dependency.snapshot_path, inactiveFile.key), inactiveBytes);
  await writeFile(
    join(project, "consumer.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:unused-choice:consumer> a owl:Ontology; owl:imports <${inactiveIri}> .\n`,
  );

  const full = await queryRun({
    project,
    queryText: `ASK { <${inactiveIri}> <urn:unused-choice:value> "inactive" }`,
  });
  assert.deepEqual(full.data, { type: "ask", value: false });
  const exact = await queryRun({
    project,
    graph: "dep:unused-choice",
    queryText: `ASK { <${rootIri}> <urn:unused-choice:value> "root" }`,
  });
  assert.deepEqual(exact.data, { type: "ask", value: true });
  const exactNamed = await queryRun({
    project,
    graph: "dep:unused-choice",
    queryText: `ASK { GRAPH <${rootIri}> { <${rootIri}> <urn:unused-choice:value> "root" } }`,
  });
  assert.deepEqual(exactNamed.data, { type: "ask", value: true });
  const otherNamed = await queryRun({
    project,
    graph: "dep:unused-choice",
    queryText: "ASK { GRAPH <urn:unused-choice:not-loaded> { ?s ?p ?o } }",
  });
  assert.deepEqual(otherNamed.data, { type: "ask", value: false });
  const validated = await inspectProject({
    project,
    command: "validate",
    selector: "consumer.ttl",
  });
  assert.equal(validated.status, "invalid");
  assert.ok(validated.diagnostics.some((item) => item.code === "ASSOCIATION_BROKEN"));
  assert.ok(validated.diagnostics.every((item) => item.code !== "RDF_SYNTAX"));
  const checked = await dependencyCheck({ project, id: "unused-choice" });
  assert.equal(checked.status, "ok", JSON.stringify(checked));
  assert.ok(checked.data);
  assert.equal(
    (checked.data.items as { state: string }[])[0]?.state,
    "unchanged",
    JSON.stringify(checked),
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
  const upstream = sourceLock.dependencies["tbspec-process"];
  assert.ok(upstream);
  const activeOntology = upstream.files.find((file) => file.kind === "ontology");
  assert.ok(activeOntology);
  const inactiveBytes = Buffer.from("malformed but not selected by any source edge");
  const inactiveFile = {
    ...activeOntology,
    key: "source/inactive.ttl",
    source_resource: "inactive.ttl",
    roles: ["closure"],
    graph_iri: "urn:source-model:unused-choice",
    source_graph_iri: "urn:source-model:unused-choice",
    byte_digest: digest(inactiveBytes),
    byte_length: inactiveBytes.length,
    base_iri: pathToFileURL(join(source, "inactive.ttl")).href,
  };
  inactiveFile.graph_signature = graphSignature(inactiveFile);
  const signatureBeforeUnusedChoice = upstream.interpretation_signature;
  upstream.files.push(inactiveFile);
  upstream.files.sort((left, right) => left.key.localeCompare(right.key));
  upstream.choices.push({
    context: activeOntology.context,
    kind: "ontology",
    target_iri: "urn:source-model:unused-choice",
    selected: inactiveFile.key,
  });
  upstream.interpretation_signature = interpretationSignature(upstream);
  assert.equal(upstream.interpretation_signature, signatureBeforeUnusedChoice);
  await writeFile(join(source, upstream.snapshot_path, inactiveFile.key), inactiveBytes);
  await writeFile(join(source, "tbspec.lock"), writeToml(sourceLock));
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
    dependency.files.every(
      (file) => file.key !== "source/locked/tbspec-process/source/inactive.ttl",
    ),
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
