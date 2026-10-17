import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonical, digest, graphSignature, hash, sortedSet } from "../src/canonical.ts";
import { ProjectError } from "../src/output.ts";
import { initializeProject, readProject, setProjectBaseIri } from "../src/project.ts";
import {
  editDesignChoice,
  editManifestSelectors,
  editModelType,
  editOntologyChoice,
  interpretationSignature,
  parseLock,
  parseManifest,
  removeDependencyChoices,
  removeModelType,
  writeToml,
} from "../src/schemas.ts";

test("manifest editors preserve unrelated TOML floats and datetimes", () => {
  const custom =
    "# keep custom values\r\n[custom]\r\nratio = 1.5\r\npositive = inf\r\nnegative = -inf\r\nundefined = nan\r\ndate = 2026-10-14\r\ntime = 13:45:11\r\nstamp = 2026-10-14T13:45:11Z\r\n";
  const text =
    'schema_version = 1\r\n[model_types.custom]\r\nontology = "ontology.ttl"\r\nenabled = true\r\n[ontology_choices]\r\n"urn:ontology" = "chosen"\r\n[design_choices]\r\n"urn:concept" = "dep:chosen"\r\n' +
    custom;
  for (const edit of [
    () => editOntologyChoice(text, "urn:ontology", "other"),
    () => editDesignChoice(text, "urn:concept", "design.ttl"),
    () => editModelType(text, "custom", { ontology: "ontology.ttl", enabled: false }),
    () => removeModelType(text, "custom"),
    () => editManifestSelectors(text, { "ontology.ttl": "moved.ttl" }),
    () => removeDependencyChoices(text, "chosen"),
  ]) {
    const changed = edit();
    assert.ok(changed.endsWith(custom));
    assert.deepEqual(parseManifest(changed).custom, parseManifest(text).custom);
  }
});

test("malformed TOML diagnostics report positions without source excerpts", () => {
  const text =
    'schema_version = 1\nlocator = "https://user:synthetic-secret@example.org/?token=synthetic-secret" trailing';
  for (const [parse, file, code] of [
    [parseManifest, "tbspec.toml", "MANIFEST_INVALID"],
    [parseLock, "tbspec.lock", "LOCK_INVALID"],
    [(text: string) => parseLock(text, true), "inventory.toml", "LOCK_INVALID"],
  ] as const) {
    assert.throws(
      () => parse(text),
      (error: unknown) => {
        assert.ok(error instanceof ProjectError);
        assert.equal(error.diagnostic.file, file);
        assert.equal(error.diagnostic.code, code);
        assert.match(error.message, /line 2, column \d+/);
        assert.ok(!JSON.stringify(error.diagnostic).includes("synthetic-secret"));
        assert.ok(!error.message.includes("https://"));
        return true;
      },
    );
  }
});

test("schema versions and integer fields reject TOML floats while preserving numeric callers", async () => {
  const inventory = await readFile(
    new URL("../starters/0.1.0/inventory.toml", import.meta.url),
    "utf8",
  );
  for (const float of ["1.0", "1e0"]) {
    assert.throws(
      () => parseManifest(`schema_version = ${float}`),
      /requires integer schema_version/,
    );
    assert.throws(
      () => parseLock(inventory.replace("schema_version = 1", `schema_version = ${float}`), true),
      /requires integer schema_version/,
    );
  }
  for (const field of [
    "max_graph_bytes",
    "max_total_bytes",
    "max_files",
    "max_redirects",
    "deadline_ms",
    "max_git_workspace_bytes",
  ]) {
    for (const float of ["1000.0", "1e3"]) {
      assert.throws(
        () => parseManifest(`schema_version = 1\n[acquisition]\n${field} = ${float}`),
        /safe integer/,
      );
    }
  }
  for (const float of ["9210.0", "9.210e3"]) {
    assert.throws(
      () => parseLock(inventory.replace("byte_length = 9210", `byte_length = ${float}`), true),
      /safe integer/,
    );
  }
  const manifest = parseManifest(
    "schema_version = 0x1\ncustom = [1.0, 1e0, -9007199254740991, { count = 9007199254740991 }]\n[acquisition]\nmax_files = 1_000\nmax_redirects = 0",
  );
  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(manifest)), {
    schema_version: 1,
    acquisition: { max_files: 1000, max_redirects: 0 },
    custom: [1, 1, -9007199254740991, { count: 9007199254740991 }],
  });
  assert.equal(parseLock(inventory, true).schema_version, 1);
  assert.equal(
    parseLock(inventory, true).dependencies["tbspec-metadata"]?.files[0]?.byte_length,
    9210,
  );
  for (const integer of ["9007199254740992", "-9007199254740992"]) {
    assert.throws(
      () => parseManifest(`schema_version = 1\ncustom = [{ count = ${integer} }]`),
      /exact wire range/,
    );
  }
});

test("manual attachments require support kinds and agreement with their associations", async () => {
  const lock = parseLock(
    await readFile(new URL("../starters/0.1.0/inventory.toml", import.meta.url), "utf8"),
    true,
  );
  const dependency = lock.dependencies["tbspec-metadata"];
  assert.ok(dependency);
  const sourceAssociation = dependency.associations[0];
  const support = dependency.files.find((file) => file.key === sourceAssociation?.support);
  assert.ok(sourceAssociation && support);
  const otherSupport = {
    ...support,
    key: "source/other.shacl.ttl",
    source_resource: "other.shacl.ttl",
    graph_iri: "https://example.org/other-shapes",
  };
  dependency.files.push(otherSupport);
  dependency.attachments.push({
    id: "attachment-1",
    role: "shacl",
    resource: dependency.primary,
    source: support.source,
    primary: support.key,
    active: true,
  });
  dependency.associations.push({
    ...sourceAssociation,
    origin: "manual",
    attachment: "attachment-1",
  });
  dependency.interpretation_signature = interpretationSignature(dependency);
  assert.doesNotThrow(() => parseLock(writeToml(lock), true));
  for (const change of [
    { role: "design" },
    { resource: "source/rdf.ttl" },
    { primary: otherSupport.key },
  ]) {
    const copy = structuredClone(lock);
    const dep = copy.dependencies["tbspec-metadata"];
    assert.ok(dep?.attachments[0]);
    Object.assign(dep.attachments[0], change);
    dep.interpretation_signature = interpretationSignature(dep);
    assert.throws(() => parseLock(writeToml(copy), true), /Attachment|attachment/);
  }
  dependency.associations.pop();
  const attachment = dependency.attachments[0];
  assert.ok(attachment);
  attachment.primary = dependency.primary;
  dependency.interpretation_signature = interpretationSignature(dependency);
  assert.throws(() => parseLock(writeToml(lock), true), /Attachment support kind/);
});

test("canonical signature golden vectors retain UTF-8, null, integer and escape semantics", () => {
  assert.equal(
    graphSignature({
      byte_digest: `sha256:${"0".repeat(64)}`,
      media_type: "text/turtle",
      base_iri: "https://example.org/source/",
      parser_profile: "turtle-strict-v1",
    }),
    "sha256:808e079d912f790d3b64faed187944e9dd698a358fccd067332fac1d44f22cb2",
  );
  assert.equal(
    canonical({ "😀": null, é: ["\n\t\u0001", -9007199254740991, true], z: "line\r\n" }),
    '{"z":"line\\u000d\\u000a","é":["\\u000a\\u0009\\u0001",-9007199254740991,true],"😀":null}',
  );
  assert.equal(
    hash(null),
    "sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b",
  );
  assert.deepEqual(sortedSet(["é", "z", "a"]), ["a", "z", "é"]);
  assert.throws(() => sortedSet([null, null]), /Duplicate/);
  for (const value of [9007199254740992, 0.5, Number.NaN, "\ud800"])
    assert.throws(() => canonical(value));
  assert.notEqual(digest("# comment\n"), digest("# comment\r\n"));
});
test("human configuration edits preserve unrelated keys, comments and CRLF exactly", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-manifest-"));
  assert.equal((await initializeProject({ directory: root })).status, "ok");
  const text =
    '# owner comment\r\nschema_version = 1\r\nbase_iri = "https://example.org/old/" # keep inline\r\ncustom = "untouched"\r\n\r\n[custom_table]\r\nvalue = 7\r\n';
  await writeFile(join(root, "tbspec.toml"), text);
  const result = await setProjectBaseIri({ project: root, baseIri: "https://example.org/new/" });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(
    await readFile(join(root, "tbspec.toml"), "utf8"),
    text.replace("https://example.org/old/", "https://example.org/new/"),
  );
  const project = await readProject({ project: root });
  assert.equal(project.lock.starters.common_contract, "dep:tbspec-metadata");
  assert.equal(project.manifest.custom, "untouched");
});
test("ontology choices are edited surgically without changing neighboring TOML", () => {
  const text =
    '# owner comment\r\nschema_version = 1\r\n\r\n[ontology_choices] # winners\r\n"urn:old" = "old" # keep me\r\n"urn:keep" = "keep"\r\n\r\n[custom_table]\r\nvalue = 7\r\n';
  const selected = editOntologyChoice(text, "urn:old", "new");
  assert.equal(
    selected,
    text.replace('"urn:old" = "old" # keep me', '"urn:old" = "new" # keep me'),
  );
  const cleared = editOntologyChoice(selected, "urn:old");
  assert.equal(cleared, selected.replace('"urn:old" = "new" # keep me', " # keep me"));
  assert.equal(
    canonical(parseManifest(cleared).ontology_choices),
    canonical({ "urn:keep": "keep" }),
  );
  assert.equal(
    editOntologyChoice("schema_version = 1\n", "urn:new", "dependency"),
    'schema_version = 1\n[ontology_choices]\n"urn:new" = "dependency"\n',
  );
});
test("missing and incompatible schemas, malformed semantic locks and corruption fail without repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-schema-"));
  await initializeProject({ directory: root });
  const originalManifest = await readFile(join(root, "tbspec.toml"), "utf8");
  for (const version of [
    "",
    'schema_version = "1"',
    "schema_version = 2",
    "schema_version = 9007199254740992",
  ]) {
    await writeFile(join(root, "tbspec.toml"), version);
    await assert.rejects(
      readProject({ project: root }),
      /requires integer schema_version|cannot be represented losslessly/,
    );
    assert.equal(await readFile(join(root, "tbspec.toml"), "utf8"), version);
  }
  await writeFile(join(root, "tbspec.toml"), originalManifest);
  const originalLock = await readFile(join(root, "tbspec.lock"), "utf8");
  const lock = parseLock(originalLock);
  for (const mutate of [
    (copy: typeof lock) => {
      Object.assign(copy.dependencies["tbspec-metadata"] ?? {}, { unknown_semantics: true });
    },
    (copy: typeof lock) => {
      const file = copy.dependencies["tbspec-metadata"]?.files[0];
      if (file) file.byte_length = -1;
    },
    (copy: typeof lock) => {
      const file = copy.dependencies["tbspec-metadata"]?.files[0];
      if (file) file.source = "absent-source";
    },
    (copy: typeof lock) => {
      copy.starters.common_contract = "dep:tbspec-process";
    },
    (copy: typeof lock) => {
      const source = copy.dependencies["tbspec-metadata"]?.sources[0];
      if (source) {
        source.kind = "directory";
        source.locator = "relative/source";
        delete source.release;
        delete source.inventory_digest;
      }
    },
    (copy: typeof lock) => {
      const source = copy.dependencies["tbspec-metadata"]?.sources[0];
      if (source) {
        source.kind = "url";
        source.locator = "https://example.org/source.ttl";
        source.effective_locator = source.locator;
        delete source.release;
        delete source.inventory_digest;
      }
    },
    (copy: typeof lock) => {
      const source = copy.dependencies["tbspec-metadata"]?.sources[0];
      if (source) source.selected_resource = "different.ttl";
    },
    (copy: typeof lock) => {
      const dependency = copy.dependencies["tbspec-process"];
      if (dependency)
        dependency.edges.push({
          context: "source",
          from: dependency.primary,
          relation: "import",
          to: "source/missing.ttl",
        });
    },
  ]) {
    const copy = structuredClone(lock);
    mutate(copy);
    assert.throws(() => parseLock(writeToml(copy)));
  }
  const renamed = structuredClone(lock.dependencies["tbspec-metadata"]);
  const urlLock = structuredClone(lock);
  const urlDependency = urlLock.dependencies["tbspec-data-design"];
  assert.ok(urlDependency);
  const urlSource = urlDependency.sources[0];
  const urlFile = urlDependency.files[0];
  assert.ok(urlSource && urlFile);
  Object.assign(urlSource, {
    kind: "url",
    locator: "https://example.org/download.ttl",
    effective_locator: "https://example.org/download.ttl",
    selected_resource: "resource.ttl",
  });
  delete urlSource.release;
  delete urlSource.inventory_digest;
  urlFile.key = "source/resource.ttl";
  urlFile.source_resource = "resource.ttl";
  urlDependency.primary = urlFile.key;
  urlDependency.interpretation_signature = interpretationSignature(urlDependency);
  assert.doesNotThrow(() => parseLock(writeToml(urlLock)));
  for (const field of ["locator", "effective_locator"]) {
    const safe = urlSource[field];
    urlSource[field] = "https://example.org/download?api_key=private";
    assert.throws(() => parseLock(writeToml(urlLock)), /query strings/);
    urlSource[field] = safe;
  }
  urlSource.selected_resource = "resource.json";
  assert.throws(() => parseLock(writeToml(urlLock)), /resource/);
  assert.ok(renamed);
  renamed.snapshot_path = ".tbspec/dependencies/renamed";
  for (const source of renamed.sources) source.locator = "tbspec:bundle/relocated/0.1.0";
  assert.equal(
    interpretationSignature(renamed),
    lock.dependencies["tbspec-metadata"]?.interpretation_signature,
  );
  const filename = join(root, ".tbspec", "dependencies", "tbspec-metadata", "source", "tbspec.ttl");
  await writeFile(filename, "corrupted snapshot");
  await assert.rejects(readProject({ project: root }), /snapshot bytes differ/);
  assert.equal(await readFile(filename, "utf8"), "corrupted snapshot");
  assert.equal(await readFile(join(root, "tbspec.lock"), "utf8"), originalLock);
});
