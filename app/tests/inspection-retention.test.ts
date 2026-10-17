import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Parser, Store } from "n3";
import { captureInspection, inspectSnapshot, type Resource } from "../src/inspection.ts";
import { initializeProject } from "../src/project.ts";
import { parseLock, parseManifest } from "../src/schemas.ts";
import { listSupport } from "../src/support.ts";
import { validateInspection } from "../src/validation.ts";

const model = (name: string) =>
  `<urn:${name}> a <https://talby.ai/ontology/tbspec#ConcreteDataModel>; <https://talby.ai/ontology/tbspec#modelType> "data" .`;

async function project() {
  const root = await mkdtemp(join(tmpdir(), "tb-retention-"));
  assert.equal((await initializeProject({ directory: root })).status, "ok");
  await writeFile(join(root, "selected.ttl"), model("selected"));
  await writeFile(join(root, "other.ttl"), model("other"));
  return realpath(root);
}

test("validation captures bind all owned revisions without retaining unrelated graph bytes", async () => {
  const root = await project();
  for (const options of [
    { command: "validate", selector: "selected.ttl" },
    { command: "validate" },
    { command: "graph.list" },
  ] as const) {
    const snapshot = await captureInspection(
      root,
      options.command,
      "selector" in options ? options.selector : undefined,
    );
    assert.ok(snapshot.reads.some((read) => read.kind === "file" && read.path === "other.ttl"));
    assert.equal(snapshot.files["other.ttl"], undefined);
    const result = await inspectSnapshot(root, snapshot, options);
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(snapshot.files["other.ttl"], undefined);
  }
});

test("validation releases parsed target and prerequisite stores after the operation", async () => {
  const root = await project();
  const snapshot = await captureInspection(root, "validate", "selected.ttl");
  const resources: Resource[] = ["selected", "other"].map((name) => ({
    selector: `${name}.ttl`,
    file: `${name}.ttl`,
    graphIri: `urn:${name}`,
    identity: "declared",
    kind: "concrete-data-model",
    classification: "declared",
    ownership: "project",
    revision: snapshot.reads.find((read) => read.kind === "file" && read.path === `${name}.ttl`)
      ?.revision ?? { state: "absent" },
    associations: [],
  }));
  const stores = new Map(
    resources.map((resource) => [
      resource.selector,
      new Store(new Parser().parse(model(resource.graphIri?.slice(4) ?? ""))),
    ]),
  );
  const result = await validateInspection({
    root,
    snapshot,
    manifest: parseManifest((await readFile(join(root, "tbspec.toml"))).toString()),
    lock: parseLock((await readFile(join(root, "tbspec.lock"))).toString()),
    resources,
    stores,
    validation: { validity: "invalid", validationComplete: false, resources: [] },
    diagnostics: [],
    target: "selected.ttl",
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(stores.size, 0);
});

test("support listings do not inspect unrelated locked ontology bytes", async () => {
  const root = await project();
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const dependency = lock.dependencies["tbspec-metadata"];
  assert.ok(dependency);
  await writeFile(
    join(root, dependency.snapshot_path, dependency.primary),
    "corrupt unrelated ontology",
  );
  const result = await listSupport({ project: root, command: "shapes.list" });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.ok(!result.diagnostics.some((diagnostic) => diagnostic.code === "SNAPSHOT_INTEGRITY"));
});

test("deferred graph reads reject revisions changed after capture", async () => {
  const root = await project();
  const snapshot = await captureInspection(root, "validate", "selected.ttl");
  await writeFile(join(root, "other.ttl"), model("changed"));
  const result = await inspectSnapshot(root, snapshot, {
    command: "validate",
    selector: "selected.ttl",
  });
  assert.equal(result.status, "conflict", JSON.stringify(result));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "REVISION_CONFLICT"));
});

test("whole validation retains only the current owned target between prerequisite closures", async () => {
  const root = await project();
  const snapshot = await captureInspection(root, "validate");
  const listed = await inspectSnapshot(root, snapshot, { command: "graph.list" });
  const stores = new Map<string, Store>();
  const checked: string[] = [];
  const result = await validateInspection({
    root,
    snapshot,
    manifest: parseManifest(snapshot.files["tbspec.toml"]?.toString() ?? ""),
    lock: parseLock(snapshot.files["tbspec.lock"]?.toString() ?? ""),
    resources: listed.data?.items ?? [],
    stores,
    validation: { validity: "invalid", validationComplete: false, resources: [] },
    diagnostics: [],
    onVocabulary(resource) {
      if (resource.ownership !== "project") return;
      checked.push(resource.selector);
      assert.deepEqual(
        [...stores.keys()].filter((key) => !key.startsWith("dep:")),
        [resource.selector],
      );
    },
  });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(checked.sort(), ["other.ttl", "selected.ttl"]);
  assert.equal(stores.size, 0);
});

test("proposed graph bytes override deferred disk reads without rewriting the project", async () => {
  const root = await project();
  const snapshot = await captureInspection(root, "validate", "selected.ttl");
  snapshot.files["selected.ttl"] = Buffer.from(
    `${model("selected")} <urn:item> a <urn:Unavailable> .`,
  );
  const result = await inspectSnapshot(root, snapshot, {
    command: "validate",
    selector: "selected.ttl",
  });
  assert.equal(result.status, "invalid", JSON.stringify(result));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "VOCABULARY_UNKNOWN"));
  assert.equal(await readFile(join(root, "selected.ttl"), "utf8"), model("selected"));
});
