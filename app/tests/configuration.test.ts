import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource } from "../src/authoring.ts";
import { configureModelType } from "../src/configuration.ts";
import { showEditor } from "../src/editing.ts";
import { inspectProject } from "../src/inspection.ts";
import { initializeProject } from "../src/project.ts";
import { editModelType, parseLock, writeToml } from "../src/schemas.ts";

test("custom model types configure creation and disabling preserves existing model bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-model-type-"));
  await initializeProject({ directory: root, baseIri: "urn:config:/" });
  await writeFile(
    join(root, "vocabulary.ttl"),
    "<urn:custom:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );

  const added = await configureModelType({
    project: root,
    command: "config.model-type.set",
    name: "custom",
    ontology: "vocabulary.ttl",
  });
  assert.equal(added.status, "ok", JSON.stringify(added));
  const config = await inspectProject({ project: root, command: "config.show" });
  assert.ok(config.data);
  assert.deepEqual(
    (config.data.modelTypes as { name: string; ontology: string; enabled: boolean }[]).find(
      (row) => row.name === "custom",
    ),
    { name: "custom", enabled: true, ontology: "vocabulary.ttl", design: null, origin: "manifest" },
  );

  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "models/example.ttl",
    type: "custom",
    iri: "urn:config:/example",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const modelBytes = await readFile(join(root, "models/example.ttl"));
  const beforeDisable = await inspectProject({ project: root, command: "status" });
  assert.equal(beforeDisable.data?.project?.validity, "valid");

  const disabled = await configureModelType({
    project: root,
    command: "config.model-type.disable",
    name: "custom",
  });
  assert.equal(disabled.status, "ok", JSON.stringify(disabled));
  assert.deepEqual(await readFile(join(root, "models/example.ttl")), modelBytes);
  const afterDisable = await inspectProject({ project: root, command: "status" });
  assert.equal(afterDisable.data?.project?.validity, "valid");
  assert.equal(
    afterDisable.data?.validation?.resources.find(
      (resource) => resource.selector === "models/example.ttl",
    )?.state,
    beforeDisable.data?.validation?.resources.find(
      (resource) => resource.selector === "models/example.ttl",
    )?.state,
  );
  const rejected = await authorResource({
    project: root,
    command: "model.create",
    path: "models/blocked.ttl",
    type: "custom",
    iri: "urn:config:/blocked",
  });
  assert.equal(rejected.status, "invalid_arguments");
  await assert.rejects(readFile(join(root, "models/blocked.ttl")), { code: "ENOENT" });

  const enabled = await configureModelType({
    project: root,
    command: "config.model-type.enable",
    name: "custom",
  });
  assert.equal(enabled.status, "ok", JSON.stringify(enabled));
  const restored = await authorResource({
    project: root,
    command: "model.create",
    path: "models/restored.ttl",
    type: "custom",
    iri: "urn:config:/restored",
  });
  assert.equal(restored.status, "ok", JSON.stringify(restored));
});

test("shorthand and expanded locked ontology selectors are no-ops for a used model type", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-model-type-selector-alias-"));
  await initializeProject({ directory: root, baseIri: "urn:config-selector-alias:/" });
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const process = lock.dependencies["tbspec-process"];
  assert.ok(process);
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "models/process.ttl",
    type: "process",
    iri: "urn:config-selector-alias:/plans",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const manifestBefore = await readFile(join(root, "tbspec.toml"));
  const modelBefore = await readFile(join(root, "models/process.ttl"));

  for (const ontology of ["dep:tbspec-process", `dep:tbspec-process/${process.primary}`]) {
    const selected = await configureModelType({
      project: root,
      command: "config.model-type.set",
      name: "process",
      ontology,
    });
    assert.equal(selected.status, "ok", JSON.stringify(selected));
    assert.deepEqual(selected.data?.changes, []);
    assert.deepEqual(await readFile(join(root, "tbspec.toml")), manifestBefore);
    assert.deepEqual(await readFile(join(root, "models/process.ttl")), modelBefore);
    const config = await inspectProject({ project: root, command: "config.show" });
    assert.ok(config.data);
    const type = (config.data.modelTypes as { name: string; design: string | null }[]).find(
      (row) => row.name === "process",
    );
    assert.equal(type?.design, "dep:tbspec-process-design");
  }
});

test("used type replacement previews validity, disconnects design and preserves model and TOML bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-vocabulary-replacement-"));
  await initializeProject({ directory: root, baseIri: "urn:replacement:/" });
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "models/process.ttl",
    type: "process",
    iri: "urn:replacement:/concepts",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const modelPath = join(root, "models/process.ttl");
  await writeFile(
    modelPath,
    `${await readFile(modelPath, "utf8")}\n<urn:replacement:/Plan> a <http://purl.org/net/p-plan#Plan> .\n`,
  );
  const modelBytes = await readFile(modelPath);
  const manifest =
    'schema_version = 1\r\n# unrelated project comment\r\n[unrelated]\r\nkeep = "yes" # keep this value\r\n\r\n[model_types.process]\r\nenabled = true # preserve enablement\r\nontology = "dep:tbspec-process"\r\ndesign = "dep:tbspec-process-design" # old design comment\r\n';
  await writeFile(join(root, "tbspec.toml"), manifest);
  await writeFile(
    join(root, "replacement.ttl"),
    "<urn:replacement:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );

  const preview = await configureModelType({
    project: root,
    command: "config.model-type.set",
    name: "process",
    ontology: "replacement.ttl",
  });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.deepEqual(await readFile(modelPath), modelBytes);
  assert.equal(await readFile(join(root, "tbspec.toml"), "utf8"), manifest);
  assert.ok(preview.data);
  const proposed = preview.data.preview as {
    arguments: {
      affectedModels: { selector: string; validityBefore: string; validityAfter: string }[];
    };
    impact: { acceptance: string[]; introducedErrors: { code: string }[] };
  };
  assert.deepEqual(proposed.impact.acceptance, ["accept-impact"]);
  assert.equal(proposed.arguments.affectedModels[0]?.selector, "models/process.ttl");
  assert.equal(proposed.arguments.affectedModels[0]?.validityBefore, "passed");
  assert.equal(proposed.arguments.affectedModels[0]?.validityAfter, "failed");
  assert.ok(proposed.impact.introducedErrors.some((item) => item.code === "VOCABULARY_UNKNOWN"));

  const applied = await configureModelType({
    project: root,
    command: "config.model-type.set",
    name: "process",
    ontology: "replacement.ttl",
    acceptImpact: true,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  assert.equal(applied.data?.projectValidity, "invalid");
  assert.deepEqual(await readFile(modelPath), modelBytes);
  const changed = await readFile(join(root, "tbspec.toml"), "utf8");
  assert.ok(
    changed.includes(
      '# unrelated project comment\r\n[unrelated]\r\nkeep = "yes" # keep this value\r\n',
    ),
  );
  assert.ok(changed.includes("enabled = true # preserve enablement\r\n"));
  assert.ok(changed.includes('ontology = "replacement.ttl"\r\n'));
  assert.ok(changed.includes("# old design comment\r\n"));
  assert.equal(changed.replaceAll("\r\n", "").includes("\n"), false);
  const effective = await inspectProject({ project: root, command: "config.show" });
  assert.ok(effective.data);
  const type = (effective.data.modelTypes as { name: string; design: string | null }[]).find(
    (row) => row.name === "process",
  );
  assert.equal(type?.design, null);
  const editor = await showEditor({ project: root, selector: "models/process.ttl" });
  assert.equal(editor.data?.parseable, true);
  assert.ok(editor.diagnostics.some((item) => item.code === "VOCABULARY_UNKNOWN"));

  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const design = lock.dependencies["tbspec-process-design"];
  assert.ok(design);
  const selectedDesign = `dep:tbspec-process-design/${design.primary}`;
  const linked = await configureModelType({
    project: root,
    command: "config.model-type.design.set",
    name: "process",
    design: selectedDesign,
  });
  assert.equal(linked.status, "ok", JSON.stringify(linked));
  assert.deepEqual(await readFile(modelPath), modelBytes);
  const disconnected = await configureModelType({
    project: root,
    command: "config.model-type.design.clear",
    name: "process",
  });
  assert.equal(disconnected.status, "ok", JSON.stringify(disconnected));
});

test("a compatible local ontology copy preserves known terms and can explicitly reuse locked design", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-compatible-copy-"));
  await initializeProject({ directory: root, baseIri: "urn:compatible-copy:/" });
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const processDependency = lock.dependencies["tbspec-process"];
  const designDependency = lock.dependencies["tbspec-process-design"];
  assert.ok(processDependency);
  assert.ok(designDependency);
  const processBytes = await readFile(
    join(root, processDependency.snapshot_path, processDependency.primary),
  );
  await writeFile(join(root, "process-copy.ttl"), processBytes);
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "models/process.ttl",
    type: "process",
    iri: "urn:compatible-copy:/plans",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const modelPath = join(root, "models/process.ttl");
  const modelBytes = await readFile(modelPath);
  const replacement = await configureModelType({
    project: root,
    command: "config.model-type.set",
    name: "process",
    ontology: "process-copy.ttl",
  });
  assert.equal(replacement.status, "preview", JSON.stringify(replacement));
  assert.equal(replacement.data?.projectValidity, "valid");
  const impacted = replacement.data?.affectedModels as {
    validityBefore: string;
    validityAfter: string;
  }[];
  assert.equal(impacted[0]?.validityBefore, "passed");
  assert.equal(impacted[0]?.validityAfter, "passed");
  const accepted = await configureModelType({
    project: root,
    command: "config.model-type.set",
    name: "process",
    ontology: "process-copy.ttl",
    acceptImpact: true,
  });
  assert.equal(accepted.status, "ok", JSON.stringify(accepted));
  assert.deepEqual(await readFile(join(root, "process-copy.ttl")), processBytes);
  assert.deepEqual(await readFile(modelPath), modelBytes);
  const linked = await configureModelType({
    project: root,
    command: "config.model-type.design.set",
    name: "process",
    design: "dep:tbspec-process-design/" + designDependency.primary,
  });
  assert.equal(linked.status, "ok", JSON.stringify(linked));
  const configuration = await inspectProject({ project: root, command: "config.show" });
  assert.ok(configuration.data);
  const effective = (
    configuration.data.modelTypes as {
      name: string;
      ontology: string;
      design: string | null;
    }[]
  ).find((row) => row.name === "process");
  assert.equal(effective?.ontology, "process-copy.ttl");
  assert.equal(effective?.design, "dep:tbspec-process-design/" + designDependency.primary);
});

test("reset uses project-locked defaults after a simulated starter package upgrade", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-locked-reset-"));
  await initializeProject({ directory: root, baseIri: "urn:locked-reset:/" });
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  lock.starters.model_types.process = {
    enabled: true,
    ontology: "dep:tbspec-state-machine",
    design: "dep:tbspec-state-machine-design",
  };
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  await writeFile(
    join(root, "replacement.ttl"),
    "<urn:upgrade:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );
  const replaced = await configureModelType({
    project: root,
    command: "config.model-type.set",
    name: "process",
    ontology: "replacement.ttl",
  });
  assert.equal(replaced.status, "ok", JSON.stringify(replaced));
  const reset = await configureModelType({
    project: root,
    command: "config.model-type.reset",
    name: "process",
  });
  assert.equal(reset.status, "ok", JSON.stringify(reset));
  const configuration = await inspectProject({ project: root, command: "config.show" });
  assert.ok(configuration.data);
  const effective = (
    configuration.data.modelTypes as {
      name: string;
      enabled: boolean;
      ontology: string;
      design: string | null;
      origin: string;
    }[]
  ).find((row) => row.name === "process");
  assert.deepEqual(effective, {
    name: "process",
    enabled: true,
    ontology: "dep:tbspec-state-machine",
    design: "dep:tbspec-state-machine-design",
    origin: "locked-default",
  });
});

test("model-type surgical edits retain unknown row keys or reject an unsafe reset", () => {
  const manifest =
    'schema_version = 1\n[model_types.process]\nenabled = true\nontology = "dep:tbspec-process"\nlocal_note = "retain me" # comment\n';
  const changed = editModelType(manifest, "process", {
    enabled: false,
    ontology: "dep:tbspec-process",
    local_note: "retain me",
  });
  assert.match(changed, /local_note = "retain me" # comment/);
  assert.throws(() => editModelType(manifest, "process"), /changed unrelated configuration/);
});
