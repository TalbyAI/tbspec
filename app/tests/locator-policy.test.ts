import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { graphSignature } from "../src/canonical.ts";
import { interpretationSignature, parseLock, writeToml } from "../src/schemas.ts";

async function urlInventory() {
  const lock = parseLock(
    await readFile(new URL("../starters/0.1.0/inventory.toml", import.meta.url), "utf8"),
    true,
  );
  const dependency = lock.dependencies["tbspec-data-design"];
  assert.ok(dependency);
  const source = dependency.sources[0];
  const file = dependency.files[0];
  assert.ok(source && file);
  Object.assign(source, {
    kind: "url",
    locator: "https://example.org/path@name/resource.ttl",
    effective_locator: "https://cdn.example.org/resource.ttl",
    selected_resource: "resource.ttl",
  });
  delete source.release;
  delete source.inventory_digest;
  file.key = "source/resource.ttl";
  file.source_resource = "resource.ttl";
  dependency.primary = file.key;
  dependency.interpretation_signature = interpretationSignature(dependency);
  return { lock, dependency, source, file };
}

test("HTTP source URLs reject all queries, fragments and userinfo without exposing their values", async () => {
  const { lock, source } = await urlInventory();
  assert.doesNotThrow(() => parseLock(writeToml(lock), true));
  for (const field of ["locator", "effective_locator"]) {
    const original = source[field];
    for (const unsafe of [
      "https://example.org/resource.ttl?session=synthetic-secret",
      "https://example.org/resource.ttl?format=ttl",
      "https://example.org/resource.ttl?",
      "https://example.org/resource.ttl#synthetic-secret",
      "https://example.org/resource.ttl#",
      "https://user:synthetic-secret@example.org/resource.ttl",
      "https://user@example.org/resource.ttl",
      "https://@example.org/resource.ttl",
      "https://:@example.org/resource.ttl",
      " ht\ttps://:@example.org/resource.ttl",
      "https:\\\\@example.org/resource.ttl",
      "https:@example.org/resource.ttl",
      "https:example.org/resource.ttl?session=synthetic-secret",
    ]) {
      source[field] = unsafe;
      assert.throws(
        () => parseLock(writeToml(lock), true),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /query|fragment|userinfo|credential/i);
          assert.ok(!error.message.includes("synthetic-secret"));
          assert.ok(!error.message.includes(unsafe));
          return true;
        },
        `${field} must reject ${unsafe}`,
      );
    }
    source[field] = original;
  }
});

test("HTTP parser bases cannot persist transport credentials and RDF identities remain exact", async () => {
  const { lock, dependency, file } = await urlInventory();
  const original = file.base_iri;
  for (const base of [
    "https://example.org/resource.ttl?session=synthetic-secret",
    "https://user:synthetic-secret@example.org/resource.ttl",
    "https://@example.org/resource.ttl",
    "https://:@example.org/resource.ttl",
  ]) {
    file.base_iri = base;
    file.graph_signature = graphSignature(file);
    dependency.interpretation_signature = interpretationSignature(dependency);
    assert.throws(() => parseLock(writeToml(lock), true), /query|userinfo|credential/i);
  }
  file.base_iri = original;
  file.source_graph_iri = "https://example.org/identity?format=ttl#design";
  file.graph_signature = graphSignature(file);
  dependency.interpretation_signature = interpretationSignature(dependency);
  const parsed = parseLock(writeToml(lock), true);
  assert.equal(
    parsed.dependencies["tbspec-data-design"]?.files[0]?.source_graph_iri,
    file.source_graph_iri,
  );
});

test("Git HTTPS provenance follows the same query policy and SSH account names remain usable", async () => {
  const { lock, source } = await urlInventory();
  source.kind = "git";
  delete source.effective_locator;
  source.revision_kind = "default";
  source.resolved_commit = "a".repeat(40);
  for (const locator of [
    "https://example.org/repo.git?session=synthetic-secret",
    "https://example.org/repo.git?format=public",
    " https://example.org/repo.git?session=synthetic-secret",
    "ht\ttps://example.org/repo.git?session=synthetic-secret",
    "ssh://git:synthetic-secret@example.org/repo.git",
    "ssh://git@example.org/repo.git#synthetic-secret",
    "git+ssh://git:synthetic-secret@example.org/repo.git",
    "https://@example.org/repo.git",
    "https://:@example.org/repo.git",
  ]) {
    source.locator = locator;
    assert.throws(() => parseLock(writeToml(lock), true), /query|userinfo|credential/i);
  }
  for (const locator of [
    "https://example.org/repo.git",
    "git@example.org:repo.git",
    "ssh://git@example.org/repo.git",
    "git+ssh://git@example.org/repo.git",
  ]) {
    source.locator = locator;
    assert.doesNotThrow(() => parseLock(writeToml(lock), true));
  }
});

test("Git requested refs require nonempty strings and obey revision policy", async () => {
  const { lock, source } = await urlInventory();
  source.kind = "git";
  delete source.effective_locator;
  source.revision_kind = "ref";
  source.resolved_commit = "a".repeat(40);
  for (const ref of [true, 42, {}, ""]) {
    source.requested_ref = ref;
    assert.throws(() => parseLock(writeToml(lock), true), /string|ref/i);
  }
  source.requested_ref = "refs/heads/main";
  assert.doesNotThrow(() => parseLock(writeToml(lock), true));
  delete source.requested_ref;
  assert.throws(() => parseLock(writeToml(lock), true), /ref/i);
  source.revision_kind = "default";
  assert.doesNotThrow(() => parseLock(writeToml(lock), true));
  source.requested_ref = "refs/heads/main";
  assert.throws(() => parseLock(writeToml(lock), true), /ref/i);
  source.revision_kind = "commit";
  assert.throws(() => parseLock(writeToml(lock), true), /Commit policy/);
  source.requested_ref = source.resolved_commit;
  assert.doesNotThrow(() => parseLock(writeToml(lock), true));
});
