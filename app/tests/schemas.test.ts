import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonical, digest, graphSignature, hash, sortedSet } from "../src/canonical.ts";
import { initializeProject, readProject, setProjectBaseIri } from "../src/project.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";

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
    locator: "https://example.org/download?format=ttl",
    effective_locator: "https://example.org/download?format=ttl",
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
    assert.throws(() => parseLock(writeToml(urlLock)), /credential|Unsafe effective URL/);
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
