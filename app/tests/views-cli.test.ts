import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { initializeProject } from "../src/project.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const offline = new URL("fixtures/offline.ts", import.meta.url).href;

function invoke(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, ["--import", offline, cli, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.stdout.trim().split("\n").length, 1, result.stdout);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schemaVersion, 1);
  return { ...result, envelope };
}

test("view CLI creates independent pairs, lists and shows associations, then confirms one removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-view-cli-"));
  await initializeProject({ directory: root, baseIri: "urn:view-cli:/" });
  await writeFile(
    join(root, "source.ttl"),
    "<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n<urn:a> <urn:p> <urn:b> .\n",
  );
  await writeFile(
    join(root, "protocol.ttl"),
    "<urn:protocol> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );

  const created = invoke(
    ["view", "create", "views/one.ttl", "--source", "source.ttl", "--protocol", "protocol.ttl"],
    root,
  );
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.envelope.status, "ok", JSON.stringify(created.envelope));
  assert.equal(
    await readFile(join(root, "views/one.presentation.ttl"), "utf8").then(Boolean),
    true,
  );
  const second = invoke(["view", "create", "views/two.ttl", "--source", "source.ttl"], root);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.envelope.status, "ok", JSON.stringify(second.envelope));
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  assert.match(manifest, /\[\[views\]\]/);
  assert.match(manifest, /protocol = "protocol\.ttl"/);
  assert.deepEqual(
    invoke(["view", "list"], root).envelope.data.items.map(
      (view: { selector: string }) => view.selector,
    ),
    ["views/one.ttl", "views/two.ttl"],
  );
  const shown = invoke(["view", "show", "views/one.ttl"], root);
  assert.equal(shown.envelope.status, "ok", JSON.stringify(shown.envelope));
  assert.equal(shown.envelope.data.source, "source.ttl");
  assert.equal(shown.envelope.data.presentation.selector, "views/one.presentation.ttl");

  const preview = invoke(["view", "remove", "views/one.ttl"], root);
  assert.equal(preview.envelope.status, "preview", JSON.stringify(preview.envelope));
  assert.deepEqual(
    preview.envelope.data.preview.changes.map((change: { file: string }) => change.file).sort(),
    ["tbspec.toml", "views/one.presentation.ttl", "views/one.ttl"],
  );
  const removed = invoke(
    [
      "view",
      "remove",
      "views/one.ttl",
      "--confirm",
      "--accepted-preview",
      preview.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(removed.envelope.status, "ok", JSON.stringify(removed.envelope));
  assert.deepEqual(
    invoke(["view", "list"], root).envelope.data.items.map(
      (view: { selector: string }) => view.selector,
    ),
    ["views/two.ttl"],
  );
  await readFile(join(root, "views/two.presentation.ttl"));
});

test("design CLI lists reusable designs and creates an inspectable owned design", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-design-cli-"));
  await initializeProject({ directory: root, baseIri: "urn:design-cli:/" });

  const listed = invoke(["design", "list"], root);
  assert.equal(listed.status, 0, listed.stderr);
  assert.ok(
    listed.envelope.data.items.some(
      (item: { selector: string }) => item.selector === "dep:tbspec-data-design",
    ),
  );

  const created = invoke(
    ["design", "create", "designs/custom.ttl", "--iri", "urn:custom-design"],
    root,
  );
  assert.equal(created.envelope.status, "ok", JSON.stringify(created.envelope));
  const shown = invoke(["design", "show", "designs/custom.ttl"], root);
  assert.equal(shown.envelope.data.resource.graphIri, "urn:custom-design");
  assert.deepEqual(shown.envelope.data.rules, []);
});

test("design show preserves foreign namespace triples without projecting them as appearance", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-design-fields-"));
  await initializeProject({ directory: root, baseIri: "urn:design-fields:/" });
  const created = invoke(
    ["design", "create", "designs/custom.ttl", "--iri", "urn:custom-design"],
    root,
  );
  assert.equal(created.envelope.status, "ok", JSON.stringify(created.envelope));

  const vocabulary = "https://talby.ai/ontology/tbspec#";
  const rule = "urn:custom-design#node-rule";
  const foreignFillColor = `x${vocabulary.slice(1)}fillColor`;
  const file = join(root, "designs/custom.ttl");
  const source = await readFile(file, "utf8");
  await writeFile(
    file,
    `${source}\n<urn:custom-design> <${vocabulary}rule> <${rule}> .\n` +
      `<${rule}> a <${vocabulary}NodeVisualRule> ; <${vocabulary}targetConcept> <urn:Thing> ; ` +
      `<${foreignFillColor}> "preserved value" .\n`,
  );

  const shown = invoke(["design", "show", "designs/custom.ttl"], root);
  assert.equal(shown.envelope.status, "ok", JSON.stringify(shown.envelope));
  assert.ok(
    shown.envelope.data.triples.some(
      (triple: { predicate: { value: string } }) => triple.predicate.value === foreignFillColor,
    ),
  );
  assert.equal(Object.hasOwn(shown.envelope.data.rules[0].appearance, "fillColor"), false);
});

test("design import creates new rule identities and provenance without choosing the design", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-design-import-"));
  await initializeProject({ directory: root, baseIri: "urn:design-import:/" });
  const vocabulary = "https://talby.ai/ontology/tbspec#";
  await writeFile(
    join(root, "source-design.ttl"),
    `<urn:source-design> a <${vocabulary}VisualDesignModel>; <${vocabulary}rule> <urn:source-design#rule> .\n` +
      `<urn:source-design#rule> a <${vocabulary}NodeVisualRule>; <${vocabulary}targetConcept> <http://www.w3.org/2002/07/owl#Class>; <${vocabulary}fillColor> "#abcdef" .\n`,
  );

  const imported = invoke(
    [
      "design",
      "import",
      "source-design.ttl",
      "designs/imported.ttl",
      "--iri",
      "urn:imported-design",
    ],
    root,
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.envelope.status, "ok", JSON.stringify(imported.envelope));
  const shown = invoke(["design", "show", "designs/imported.ttl"], root);
  assert.equal(shown.envelope.data.resource.graphIri, "urn:imported-design");
  assert.equal(shown.envelope.data.rules[0].iri, "urn:imported-design#rule");
  assert.equal(shown.envelope.data.provenance[0].sourceGraphIri, "urn:source-design");
  assert.equal(shown.envelope.data.provenance[0].sourceSelector, "source-design.ttl");
  assert.doesNotMatch(await readFile(join(root, "tbspec.toml"), "utf8"), /\[design_choices\]/);

  const selected = invoke(
    ["design", "select", "http://www.w3.org/2002/07/owl#Class", "designs/imported.ttl"],
    root,
  );
  assert.equal(selected.envelope.status, "ok", JSON.stringify(selected.envelope));
  assert.match(await readFile(join(root, "tbspec.toml"), "utf8"), /\[design_choices\]/);
  const cleared = invoke(["design", "clear", "http://www.w3.org/2002/07/owl#Class"], root);
  assert.equal(cleared.envelope.status, "ok", JSON.stringify(cleared.envelope));
  assert.doesNotMatch(await readFile(join(root, "tbspec.toml"), "utf8"), /\[design_choices\]/);
});

test("design impact and moves identify selectors while removal preserves unresolved choices", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-design-lifecycle-"));
  await initializeProject({ directory: root, baseIri: "urn:design-lifecycle:/" });
  const vocabulary = "https://talby.ai/ontology/tbspec#";
  const classIri = "http://www.w3.org/2002/07/owl#Class";
  await mkdir(join(root, "designs"), { recursive: true });
  await mkdir(join(root, "views"), { recursive: true });
  await writeFile(
    join(root, "model.ttl"),
    `<urn:model> a <${vocabulary}ConcreteDataModel>; <${vocabulary}modelType> "data" .\n<urn:item> a <${classIri}> .\n`,
  );
  await writeFile(
    join(root, "designs/custom.ttl"),
    `<urn:custom-design> a <${vocabulary}VisualDesignModel>; <${vocabulary}rule> <urn:custom-design#rule> .\n` +
      `<urn:custom-design#rule> a <${vocabulary}NodeVisualRule>; <${vocabulary}targetConcept> <${classIri}> .\n`,
  );
  await writeFile(
    join(root, "views/one.ttl"),
    `<urn:view> a <${vocabulary}ViewModel>; <${vocabulary}sourceGraph> <urn:model>; <${vocabulary}member> <urn:item> .\n`,
  );
  await writeFile(
    join(root, "views/one.presentation.ttl"),
    `<urn:presentation> a <${vocabulary}PresentationGraph>; <${vocabulary}forView> <urn:view>; <${vocabulary}nodePresentation> [ <${vocabulary}element> <urn:item>; <${vocabulary}chosenRule> <urn:custom-design#rule> ] .\n`,
  );
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    `${manifest}\n[[views]]\nview = "views/one.ttl"\nsource = "model.ttl"\npresentation = "views/one.presentation.ttl"\n`,
  );
  assert.equal(
    invoke(["design", "select", classIri, "designs/custom.ttl"], root).envelope.status,
    "ok",
  );

  const impact = invoke(["impact", "design", "designs/custom.ttl"], root);
  assert.equal(impact.envelope.status, "ok", impact.stderr);
  assert.ok(
    impact.envelope.data.items.some(
      (item: { file: string; targetIri: string; position: string }) =>
        item.file === "views/one.presentation.ttl" &&
        item.targetIri === "urn:custom-design#rule" &&
        item.position === "object",
    ),
  );
  assert.ok(
    impact.envelope.data.items.some(
      (item: { file: string; configurationPath?: string; targetSelector?: string }) =>
        item.file === "tbspec.toml" &&
        item.configurationPath === `design_choices.${classIri}` &&
        item.targetSelector === "designs/custom.ttl",
    ),
  );

  const move = invoke(["resource", "move", "designs/custom.ttl", "archive/custom.ttl"], root);
  assert.equal(move.envelope.status, "preview", move.stderr);
  assert.ok(
    move.envelope.data.preview.changes.some(
      (change: { file: string }) => change.file === "tbspec.toml",
    ),
  );
  const moved = invoke(
    [
      "resource",
      "move",
      "designs/custom.ttl",
      "archive/custom.ttl",
      "--apply",
      "--accepted-preview",
      move.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(moved.envelope.status, "ok", JSON.stringify(moved.envelope));
  assert.match(await readFile(join(root, "tbspec.toml"), "utf8"), /archive\/custom\.ttl/);
  assert.match(
    await readFile(join(root, "views/one.presentation.ttl"), "utf8"),
    /urn:custom-design#rule/,
  );

  const removal = invoke(["design", "remove", "archive/custom.ttl"], root);
  assert.equal(removal.envelope.status, "preview", removal.stderr);
  assert.ok(removal.envelope.data.preview.impact.affectedFiles.includes("tbspec.toml"));
  const removed = invoke(
    [
      "design",
      "remove",
      "archive/custom.ttl",
      "--confirm",
      "--accepted-preview",
      removal.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(removed.envelope.status, "ok", JSON.stringify(removed.envelope));
  assert.match(await readFile(join(root, "tbspec.toml"), "utf8"), /archive\/custom\.ttl/);
  assert.match(
    await readFile(join(root, "views/one.presentation.ttl"), "utf8"),
    /urn:custom-design#rule/,
  );
  await assert.rejects(readFile(join(root, "archive/custom.ttl")), { code: "ENOENT" });
});
