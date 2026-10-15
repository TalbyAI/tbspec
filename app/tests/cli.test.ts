import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { authorResource } from "../src/authoring.ts";
import { parseCli } from "../src/cli-command.ts";
import { dependencyAdd, dependencyList, dependencyRename } from "../src/dependencies.ts";
import { exits, failure } from "../src/output.ts";
import { discoverProject, initializeProject } from "../src/project.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const offline = new URL("fixtures/offline.ts", import.meta.url).href;

test("CLI guidance and argument errors do not load project operation modules", () => {
  for (const args of [
    ["--help"],
    ["--version"],
    ["llms", "views", "designs"],
    ["validate", "--confirm"],
  ]) {
    const script = `
      import { registerHooks } from "node:module";
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (/(?:authoring|configuration|console|dependencies|designs|inspection|project|query|repair|resource-lifecycle|views|web|shacl-execution)\\.ts$/.test(specifier))
          throw new Error("Unexpected project module: " + specifier);
        return nextResolve(specifier, context);
      }});
      process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}, "--json"];
      await import(${JSON.stringify(new URL("../src/cli.ts", import.meta.url).href)});
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: "" },
      timeout: 10000,
    });
    assert.equal(result.status, args[0] === "validate" ? 2 : 0, result.stderr);
    assert.equal(result.stdout.trim().split("\n").length, 1);
    assert.equal(JSON.parse(result.stdout).schemaVersion, 1);
  }
});

test("CLI preparation defers project work and query file reads", () => {
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (/(?:project|query|web)\\.ts$/.test(specifier))
        throw new Error("Preparation loaded an operation: " + specifier);
      return nextResolve(specifier, context);
    }});
    const { parseCli } = await import(${JSON.stringify(new URL("../src/cli-command.ts", import.meta.url).href)});
    const before = process.cwd();
    for (const args of [
      ["init", "not-created-by-preparation"],
      ["query", "save", "example", "--file", "nonexistent-query.rq", "--parameters", "nonexistent-parameters.toml"],
      ["query", "run", "--file", "nonexistent-query.rq", "--bindings", "nonexistent-bindings.json"],
      ["web", "--port", "12345"],
    ]) {
      const invocation = parseCli(args);
      assert.equal(typeof invocation.execute, "function");
    }
    assert.equal(process.cwd(), before);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("CLI inventory and config commands do not load validation or query engines", () => {
  const script = `
    import assert from "node:assert/strict";
    import { mkdtemp } from "node:fs/promises";
    import { registerHooks } from "node:module";
    import { tmpdir } from "node:os";
    import { join } from "node:path";
    const { initializeProject } = await import(${JSON.stringify(new URL("../src/project.ts", import.meta.url).href)});
    const root = await mkdtemp(join(tmpdir(), "tb-cli-inventory-loading-"));
    assert.equal((await initializeProject({ directory: root })).status, "ok");
    registerHooks({ resolve(specifier, context, nextResolve) {
      assert.ok(!/(?:support|validation|shacl-profile|shacl-execution|shacl-regex)\\.ts$/.test(specifier)
        && !/^(?:@comunica\\/|@traqula\\/|xspattern$)/.test(specifier),
        "Unexpected validation dependency: " + specifier);
      return nextResolve(specifier, context);
    }});
    const { parseCli } = await import(${JSON.stringify(new URL("../src/cli-command.ts", import.meta.url).href)});
    for (const args of [["config", "show"], ["model", "list"], ["ontology", "list"], ["graph", "list"]]) {
      const result = await parseCli([...args, "--project", root]).execute();
      assert.equal(result.status, "ok", JSON.stringify(result));
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", offline, "--input-type=module", "--eval", script],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: "" },
      timeout: 20000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("CLI process preserves plain help and version output", () => {
  for (const args of [["--help"], ["--version"]]) {
    const result = spawnSync(process.execPath, ["--import", offline, cli, ...args], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: "" },
      timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.endsWith("\n"));
    assert.ok(result.stdout.trim());
    assert.ok(!result.stdout.startsWith("{"));
  }
});

async function interpret(args: string[]) {
  try {
    return await parseCli(args).execute();
  } catch (error) {
    return failure(error);
  }
}

function invoke(args: string[], cwd: string) {
  const result = spawnSync(process.execPath, ["--import", offline, cli, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PATH: "" },
  });
  assert.equal(result.stdout.trim().split("\n").length, 1, result.stdout);
  assert.ok(result.stdout.trim(), result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schemaVersion, 1);
  assert.deepEqual(Object.keys(envelope).sort(), [
    "data",
    "diagnostics",
    "schemaVersion",
    "status",
  ]);
  return { ...result, envelope };
}

test("CLI validates, lists shapes and confirms schema removal offline with exact signatures", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-validate-"));
  await initializeProject({ directory: root, baseIri: "urn:cli:/" });
  for (const options of [
    { command: "model.create", path: "schema.ttl", type: "data" },
    { command: "model.create", path: "model.ttl", type: "data", profile: "concrete" },
  ] as const)
    assert.equal((await authorResource({ project: root, ...options })).status, "ok");
  for (const args of [
    ["model", "schema", "add", "model.ttl", "schema.ttl"],
    ["shapes", "create", "model.ttl"],
  ])
    assert.equal(invoke(args, root).status, 0);
  assert.deepEqual(
    invoke(["model", "schema", "list", "model.ttl"], root).envelope.data.items.map(
      (r: { selector: string }) => r.selector,
    ),
    ["schema.ttl"],
  );
  assert.equal(
    invoke(["shapes", "list", "--source", "model.ttl"], root).envelope.data.items[0].selector,
    "model.shacl.ttl",
  );
  assert.equal(invoke(["validate", "model.ttl"], root).status, 0);
  const preview = invoke(["model", "schema", "remove", "model.ttl", "schema.ttl"], root);
  assert.equal(preview.envelope.status, "preview", preview.stderr);
  const fingerprint = preview.envelope.data.preview.fingerprint;
  assert.equal(
    invoke(
      [
        "model",
        "schema",
        "remove",
        "model.ttl",
        "schema.ttl",
        "--confirm",
        "--accepted-preview",
        fingerprint,
      ],
      root,
    ).status,
    0,
  );
  await writeFile(join(root, "broken.ttl"), "broken Turtle [");
  assert.equal(invoke(["validate", "model.ttl"], root).status, 0);
  const whole = invoke(["validate"], root);
  assert.equal(whole.status, 1);
  assert.ok(whole.envelope.diagnostics.some((d: { code: string }) => d.code === "RDF_SYNTAX"));
  for (const args of [
    ["validate", "one", "two"],
    ["validate", "--confirm"],
    ["model", "schema", "add", "model.ttl"],
    ["model", "schema", "list", "model.ttl", "--type", "data"],
    ["shapes", "create", "model.ttl", "--source", "schema.ttl"],
  ])
    assert.equal((await interpret(args)).status, "invalid_arguments");
});

test("repair CLI supports bare reference listing, exact IRI refactoring and recursive one-envelope guidance", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-repair-"));
  await initializeProject({ directory: root, baseIri: "urn:repair:cli:/" });
  const oldIri = "urn:repair:cli:old";
  const newIri = "urn:repair:cli:new";
  await writeFile(
    join(root, "vocabulary.ttl"),
    `<${oldIri}> a <http://www.w3.org/2002/07/owl#Ontology> .\n`,
  );

  const bare = invoke(["references", "list"], root);
  assert.equal(bare.status, 0);
  assert.ok(bare.envelope.data.items.length > 0);
  const targeted = invoke(["references", "list", "--target", oldIri], root);
  assert.equal(targeted.status, 0);
  assert.ok(
    targeted.envelope.data.items.some((item: { targetIri: string }) => item.targetIri === oldIri),
  );
  assert.equal(invoke(["references", "list", "--target", oldIri, "--dangling"], root).status, 2);

  const preview = invoke(["refactor", "iri", oldIri, newIri], root);
  assert.equal(preview.status, 0);
  assert.equal(preview.envelope.status, "preview");
  assert.ok((await readFile(join(root, "vocabulary.ttl"), "utf8")).includes(oldIri));
  const applied = invoke(["refactor", "iri", oldIri, newIri, "--apply"], root);
  assert.equal(applied.status, 0);
  assert.ok((await readFile(join(root, "vocabulary.ttl"), "utf8")).includes(newIri));

  const guidance = invoke(["llms", "repair", "references"], root);
  assert.equal(guidance.status, 0);
  assert.match(guidance.envelope.data.text, /Bare listing is read-only/);
});

test("CLI query commands save, inspect, bind, run and confirm removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-query-"));
  await initializeProject({ directory: root, baseIri: "urn:query-cli:/" });
  await writeFile(
    join(root, "data.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> . <urn:cli:data> a owl:Ontology; <urn:cli:value> "7" .`,
  );
  await writeFile(
    join(root, "source.rq"),
    "\uFEFFSELECT ?subject WHERE { ?subject <urn:cli:value> ?value }",
  );
  await writeFile(
    join(root, "parameters.toml"),
    `\uFEFFschema_version = 1\n\n[[parameters]]\nname = "value"\nkind = "literal"\nrequired = true\n`,
  );
  await writeFile(join(root, "bindings.json"), '{"value":{"kind":"literal","value":"7"}}');

  const help = invoke(["query", "--help"], root);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.envelope.data.text, /query run/);
  assert.equal(invoke(["query", "list"], root).status, 0);
  const saved = invoke(
    ["query", "save", "cli-example", "--file", "source.rq", "--parameters", "parameters.toml"],
    root,
  );
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(saved.envelope.data.applied, true);
  const shown = invoke(["query", "show", "cli-example"], root);
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(shown.envelope.data.parameters[0].name, "value");
  assert.equal(
    shown.envelope.data.queryText,
    "\uFEFFSELECT ?subject WHERE { ?subject <urn:cli:value> ?value }",
  );
  assert.deepEqual(
    await readFile(join(root, "queries/cli-example.rq")),
    Buffer.from("\uFEFFSELECT ?subject WHERE { ?subject <urn:cli:value> ?value }"),
  );
  const run = invoke(
    ["query", "run", "--saved", "cli-example", "--bindings", "bindings.json"],
    root,
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.envelope.data.rows[0].subject, { kind: "iri", value: "urn:cli:data" });
  assert.equal(invoke(["query", "run", "--saved", "cli-example"], root).status, 2);
  const preview = invoke(["query", "remove", "cli-example"], root);
  assert.equal(preview.status, 0);
  assert.equal(preview.envelope.status, "preview");
  const removed = invoke(["query", "remove", "cli-example", "--confirm"], root);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(invoke(["query", "list"], root).envelope.data.items.length, 0);
});

test("CLI dependency commands inspect a source and apply its reviewed fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-dependency-"));
  const source = join(root, "source");
  const project = join(root, "project");
  await mkdir(source);
  await initializeProject({ directory: project, baseIri: "urn:dependency-cli:/" });
  await writeFile(
    join(source, "shop.ttl"),
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/shop> a owl:Ontology .\n",
  );
  const inspected = invoke(["dependency", "inspect", "--source", source], project);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(inspected.envelope.data.items[0].resource, "shop.ttl");

  const preview = invoke(
    ["dependency", "add", "shop", "--source", source, "--kind", "ontology"],
    project,
  );
  assert.equal(preview.status, 3, preview.stderr);
  assert.equal(preview.envelope.status, "conflict");
  const fingerprint = preview.envelope.data.preview.fingerprint;
  assert.equal(
    invoke(
      [
        "dependency",
        "add",
        "shop",
        "--source",
        source,
        "--kind",
        "ontology",
        "--accepted-preview",
        fingerprint,
      ],
      project,
    ).status,
    0,
  );
  assert.ok(
    invoke(["dependency", "list"], project).envelope.data.items.some(
      (dependency: { id: string }) => dependency.id === "shop",
    ),
  );
  assert.equal(
    invoke(["dependency", "show", "shop"], project).envelope.data.dependency.primarySelector,
    "dep:shop/source/shop.ttl",
  );
  for (const args of [
    ["dependency", "add", "shop", "--source", source, "--kind", "ontology", "--accept-impact"],
    ["dependency", "inspect", "--resource", "shop.ttl"],
  ]) {
    const rejected = await interpret(args);
    assert.equal(
      rejected.status,
      "invalid_arguments",
      `${args.join(" ")}: ${JSON.stringify(rejected)}`,
    );
  }
});

test("CLI dependency rename and removal preview exact scope and apply accepted fingerprints", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-dependency-rename-"));
  const source = join(root, "source");
  const project = join(root, "project");
  await mkdir(source);
  await initializeProject({ directory: project, baseIri: "urn:dependency-rename-cli:/" });
  const original =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/rename> a owl:Ontology .\n";
  await writeFile(join(source, "rename.ttl"), original);
  for (const id of ["old", "repeated"]) {
    const addPreview = await dependencyAdd({ project, source, id, kind: "ontology" });
    assert.equal(addPreview.status, "conflict", JSON.stringify(addPreview));
    assert.ok(addPreview.data);
    const added = await dependencyAdd({
      project,
      source,
      id,
      kind: "ontology",
      acceptedPreview: (addPreview.data.preview as { fingerprint: string }).fingerprint,
    });
    assert.equal(added.status, "ok", JSON.stringify(added));
  }

  const lockBefore = await readFile(join(project, "tbspec.lock"));
  const sourceBefore = await readFile(join(project, ".tbspec/dependencies/old/source/rename.ttl"));
  const repeatedBefore = await readFile(
    join(project, ".tbspec/dependencies/repeated/source/rename.ttl"),
  );
  const invalidId = await dependencyRename({ project, from: "old", to: "Bad" });
  assert.equal(invalidId.status, "invalid_arguments", JSON.stringify(invalidId));
  assert.equal(invalidId.diagnostics[0]?.code, "ARGUMENT_INVALID");
  const collision = await dependencyRename({ project, from: "old", to: "repeated" });
  assert.equal(collision.status, "conflict", JSON.stringify(collision));
  assert.equal(collision.diagnostics[0]?.code, "DEPENDENCY_ID_COLLISION");
  const destination = join(project, ".tbspec/dependencies/occupied");
  await mkdir(destination);
  const occupied = await dependencyRename({ project, from: "old", to: "occupied" });
  assert.equal(occupied.status, "conflict", JSON.stringify(occupied));
  assert.equal(occupied.diagnostics[0]?.code, "DEPENDENCY_DESTINATION_OCCUPIED");

  const stalePreview = await dependencyRename({ project, from: "old", to: "stale" });
  assert.equal(stalePreview.status, "preview", JSON.stringify(stalePreview));
  assert.ok(stalePreview.data);
  await appendFile(join(project, "tbspec.toml"), "\n# intervening configuration edit\n");
  const staleApply = await dependencyRename({
    project,
    from: "old",
    to: "stale",
    apply: true,
    acceptedPreview: (stalePreview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(staleApply.status, "conflict", JSON.stringify(staleApply));
  assert.equal(staleApply.diagnostics.at(-1)?.code, "PREVIEW_CHANGED");
  await readFile(join(project, ".tbspec/dependencies/old/source/rename.ttl"));
  await assert.rejects(readFile(join(project, ".tbspec/dependencies/stale/source/rename.ttl")), {
    code: "ENOENT",
  });

  const preview = invoke(["dependency", "rename", "old", "new"], project);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.envelope.status, "preview");
  assert.equal(preview.envelope.data.preview.operation, "dependency.rename");
  assert.equal(
    preview.envelope.data.preview.arguments.selectors["dep:old/source/rename.ttl"],
    "dep:new/source/rename.ttl",
  );
  const fingerprint = preview.envelope.data.preview.fingerprint;
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBefore);
  assert.deepEqual(
    await readFile(join(project, ".tbspec/dependencies/old/source/rename.ttl")),
    sourceBefore,
  );
  assert.deepEqual(sourceBefore, Buffer.from(original));
  const applied = invoke(
    ["dependency", "rename", "old", "new", "--apply", "--accepted-preview", fingerprint],
    project,
  );
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.envelope.data.applied, true);
  assert.deepEqual(
    await readFile(join(project, ".tbspec/dependencies/new/source/rename.ttl")),
    sourceBefore,
  );
  await assert.rejects(readFile(join(project, ".tbspec/dependencies/old/source/rename.ttl")), {
    code: "ENOENT",
  });
  assert.deepEqual(
    await readFile(join(project, ".tbspec/dependencies/repeated/source/rename.ttl")),
    repeatedBefore,
  );
  const removePreview = invoke(["dependency", "remove", "new"], project);
  assert.equal(removePreview.status, 0, removePreview.stderr);
  assert.equal(removePreview.envelope.status, "preview");
  assert.deepEqual(removePreview.envelope.data.preview.impact.acceptance, ["confirm"]);
  assert.ok(
    removePreview.envelope.data.directAndDownstreamReferences.some(
      (reference: { ownership: string; file: string }) =>
        reference.ownership === "locked" &&
        reference.file.startsWith(".tbspec/dependencies/repeated/"),
    ),
    JSON.stringify(removePreview.envelope.data.directAndDownstreamReferences),
  );
  const removed = invoke(
    [
      "dependency",
      "remove",
      "new",
      "--confirm",
      "--accepted-preview",
      removePreview.envelope.data.preview.fingerprint,
    ],
    project,
  );
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(removed.envelope.data.removed, true);
  await assert.rejects(readFile(join(project, ".tbspec/dependencies/new/source/rename.ttl")), {
    code: "ENOENT",
  });
  assert.deepEqual(
    await readFile(join(project, ".tbspec/dependencies/repeated/source/rename.ttl")),
    repeatedBefore,
  );
  const listed = await dependencyList({ project });
  assert.ok(listed.data);
  const listedIds = (listed.data.items as { id: string }[]).map((item) => item.id);
  assert.ok(listedIds.includes("repeated"));
  assert.ok(!listedIds.includes("new"));
});

test("CLI dependencies select and clear an ontology winner and check source drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-dependency-resolution-"));
  const source = join(root, "source");
  const project = join(root, "project");
  const ontologyIri = "https://example.org/selected-vocabulary";
  await mkdir(source);
  await initializeProject({ directory: project, baseIri: "urn:dependency-resolution-cli:/" });
  await writeFile(
    join(source, "vocabulary.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<${ontologyIri}> a owl:Ontology .\n`,
  );
  const preview = invoke(
    ["dependency", "add", "vocabulary", "--source", source, "--kind", "ontology"],
    project,
  );
  assert.equal(preview.status, 3, preview.stderr);
  assert.equal(
    invoke(
      [
        "dependency",
        "add",
        "vocabulary",
        "--source",
        source,
        "--kind",
        "ontology",
        "--accepted-preview",
        preview.envelope.data.preview.fingerprint,
      ],
      project,
    ).status,
    0,
  );

  const selected = invoke(["dependency", "select", ontologyIri, "vocabulary"], project);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.envelope.data.applied, true);
  assert.match(await readFile(join(project, "tbspec.toml"), "utf8"), /\[ontology_choices\]/);

  const cleared = invoke(["dependency", "clear", ontologyIri], project);
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(cleared.envelope.data.applied, true);
  assert.equal(
    await readFile(join(project, "tbspec.toml"), "utf8").then((text) =>
      text.includes(`"${ontologyIri}"`),
    ),
    false,
  );

  const lockBefore = await readFile(join(project, "tbspec.lock"));
  const checked = invoke(["dependency", "check", "vocabulary"], project);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(checked.envelope.data.items[0].state, "unchanged");
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBefore);
  assert.equal(invoke(["dependency", "check"], project).status, 0);
});

test("dependency CLI accepts canonical source forms and resolves omitted support selectors only when unique", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-dependency-canonical-"));
  const source = join(root, "source");
  const support = join(root, "support");
  const ambiguousSupport = join(root, "ambiguous-support");
  const project = join(root, "project");
  await mkdir(source);
  await mkdir(support);
  await mkdir(ambiguousSupport);
  await initializeProject({ directory: project, baseIri: "urn:dependency-canonical-cli:/" });
  await writeFile(
    join(source, "vocabulary.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<urn:canonical:vocabulary> a owl:Ontology .\n`,
  );
  const shape = `@prefix t: <https://talby.ai/ontology/tbspec#> .\n<urn:canonical:shapes> a t:ShapesGraph .\n`;
  await writeFile(join(support, "rules.ttl"), shape);
  await writeFile(join(ambiguousSupport, "one.ttl"), shape);
  await writeFile(
    join(ambiguousSupport, "two.ttl"),
    `@prefix t: <https://talby.ai/ontology/tbspec#> .\n<urn:other-shapes> a t:ShapesGraph .\n`,
  );

  assert.equal(invoke(["dependency", "inspect", source], project).status, 0);
  assert.equal(invoke(["dependency", "inspect", source, "--source", source], project).status, 2);

  const addPreview = invoke(
    ["dependency", "add", source, "--id", "canonical", "--kind", "ontology"],
    project,
  );
  assert.equal(addPreview.status, 3, addPreview.stderr);
  assert.equal(addPreview.envelope.data.preview.operation, "dependency.add");
  assert.equal(
    invoke(
      ["dependency", "add", source, "--id", "canonical", "--source", source, "--kind", "ontology"],
      project,
    ).status,
    2,
  );
  assert.equal(
    invoke(
      [
        "dependency",
        "add",
        source,
        "--id",
        "canonical",
        "--kind",
        "ontology",
        "--accepted-preview",
        addPreview.envelope.data.preview.fingerprint,
      ],
      project,
    ).status,
    0,
  );

  const supportPreview = invoke(
    ["dependency", "support", "set", "canonical", "--role", "shacl", "--source", support],
    project,
  );
  assert.equal(supportPreview.status, 3, supportPreview.stderr);
  assert.ok(
    supportPreview.envelope.diagnostics.some(
      (item: { code: string }) => item.code === "PREVIEW_REQUIRED",
    ),
  );
  const attached = invoke(
    [
      "dependency",
      "support",
      "set",
      "canonical",
      "--role",
      "shacl",
      "--source",
      support,
      "--accepted-preview",
      supportPreview.envelope.data.preview.fingerprint,
    ],
    project,
  );
  assert.equal(attached.status, 0, attached.stderr);
  const shown = invoke(["dependency", "show", "canonical"], project);
  const supportFile = shown.envelope.data.dependency.files.find(
    (file: { roles: string[]; key: string }) =>
      file.roles.includes("shacl") && file.key.includes("attachment-1"),
  );
  assert.ok(supportFile);
  const cleared = invoke(
    [
      "dependency",
      "support",
      "clear",
      "canonical",
      "--role",
      "shacl",
      "--resource",
      `dep:canonical/${supportFile.key}`,
    ],
    project,
  );
  assert.equal(cleared.status, 0, cleared.stderr);
  const ambiguous = invoke(
    ["dependency", "support", "set", "canonical", "--role", "shacl", "--source", ambiguousSupport],
    project,
  );
  assert.ok(
    ambiguous.envelope.diagnostics.some(
      (item: { code: string }) => item.code === "SOURCE_SELECTION_AMBIGUOUS",
    ),
    JSON.stringify(ambiguous.envelope),
  );
});

test("CLI manual support uses an accepted source preview and remains attached through update and clear", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-dependency-support-"));
  const source = join(root, "source");
  const support = join(root, "support");
  const designSupport = join(root, "design-support");
  const project = join(root, "project");
  await mkdir(source);
  await mkdir(support);
  await mkdir(designSupport);
  await initializeProject({ directory: project, baseIri: "urn:dependency-support-cli:/" });
  const model = (label: string, includeRequired = true) =>
    `@prefix t: <https://talby.ai/ontology/tbspec#> .\n<urn:manual:model> a t:Model; <urn:label> "${label}"${includeRequired ? '; <urn:manual:required> "present"' : ""} .\n`;
  await writeFile(join(source, "model.ttl"), model("first"));
  const shape = `@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix t: <https://talby.ai/ontology/tbspec#> .\n<urn:manual:shapes> a t:ShapesGraph .\n<urn:manual:shape> a sh:NodeShape; sh:targetNode <urn:manual:model>; sh:property [ sh:path <urn:manual:required>; sh:minCount 1 ] .\n`;
  await writeFile(join(support, "rules.ttl"), shape);
  const design = `@prefix t: <https://talby.ai/ontology/tbspec#> .\n<urn:manual:design> a t:VisualDesignModel .\n`;
  await writeFile(join(designSupport, "design.ttl"), design);
  const addPreview = invoke(
    ["dependency", "add", "manual-model", "--source", source, "--kind", "model"],
    project,
  );
  assert.equal(addPreview.status, 3);
  assert.equal(
    invoke(
      [
        "dependency",
        "add",
        "manual-model",
        "--source",
        source,
        "--kind",
        "model",
        "--accepted-preview",
        addPreview.envelope.data.preview.fingerprint,
      ],
      project,
    ).status,
    0,
  );

  const review = invoke(
    [
      "dependency",
      "support",
      "set",
      "manual-model",
      "--target",
      "dep:manual-model/source/model.ttl",
      "--role",
      "shacl",
      "--source",
      support,
      "--resource",
      "rules.ttl",
    ],
    project,
  );
  assert.equal(review.status, 3, review.stderr);
  assert.ok(
    review.envelope.diagnostics.some((item: { code: string }) => item.code === "PREVIEW_REQUIRED"),
  );
  const lockBeforeSupport = await readFile(join(project, "tbspec.lock"));
  const unapprovedImpactFlag = invoke(
    [
      "dependency",
      "support",
      "set",
      "manual-model",
      "--target",
      "dep:manual-model/source/model.ttl",
      "--role",
      "shacl",
      "--source",
      support,
      "--resource",
      "rules.ttl",
      "--accepted-preview",
      review.envelope.data.preview.fingerprint,
      "--accept-impact",
    ],
    project,
  );
  assert.equal(unapprovedImpactFlag.status, 2);
  assert.ok(
    unapprovedImpactFlag.envelope.diagnostics.some(
      (item: { code: string }) => item.code === "ARGUMENT_INVALID",
    ),
  );
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBeforeSupport);
  const updatedShape = `${shape}# reviewed inventory change\n`;
  await writeFile(join(support, "rules.ttl"), updatedShape);
  const stale = invoke(
    [
      "dependency",
      "support",
      "set",
      "manual-model",
      "--target",
      "dep:manual-model/source/model.ttl",
      "--role",
      "shacl",
      "--source",
      support,
      "--resource",
      "rules.ttl",
      "--accepted-preview",
      review.envelope.data.preview.fingerprint,
    ],
    project,
  );
  assert.equal(stale.status, 3, stale.stderr);
  assert.ok(
    stale.envelope.diagnostics.some((item: { code: string }) => item.code === "PREVIEW_CHANGED"),
  );
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBeforeSupport);
  const attached = invoke(
    [
      "dependency",
      "support",
      "set",
      "manual-model",
      "--target",
      "dep:manual-model/source/model.ttl",
      "--role",
      "shacl",
      "--source",
      support,
      "--resource",
      "rules.ttl",
      "--accepted-preview",
      stale.envelope.data.preview.fingerprint,
    ],
    project,
  );
  assert.equal(attached.status, 0, attached.stderr);

  const designPreview = invoke(
    [
      "dependency",
      "support",
      "set",
      "manual-model",
      "--target",
      "dep:manual-model/source/model.ttl",
      "--role",
      "design",
      "--source",
      designSupport,
      "--resource",
      "design.ttl",
    ],
    project,
  );
  assert.equal(designPreview.status, 3, designPreview.stderr);
  assert.ok(
    designPreview.envelope.diagnostics.some(
      (item: { code: string }) => item.code === "PREVIEW_REQUIRED",
    ),
  );
  const designAttached = invoke(
    [
      "dependency",
      "support",
      "set",
      "manual-model",
      "--target",
      "dep:manual-model/source/model.ttl",
      "--role",
      "design",
      "--source",
      designSupport,
      "--resource",
      "design.ttl",
      "--accepted-preview",
      designPreview.envelope.data.preview.fingerprint,
    ],
    project,
  );
  assert.equal(designAttached.status, 0, designAttached.stderr);

  const unchangedCheck = invoke(["dependency", "check", "manual-model"], project);
  assert.equal(unchangedCheck.status, 0, unchangedCheck.stderr);
  assert.equal(unchangedCheck.envelope.data.items[0].state, "unchanged");

  await writeFile(join(support, "rules.ttl"), `${updatedShape}# changed support bytes\n`);
  const changedSupportCheck = invoke(["dependency", "check", "manual-model"], project);
  assert.equal(changedSupportCheck.status, 1, changedSupportCheck.stderr);
  assert.equal(changedSupportCheck.envelope.data.items[0].state, "changed");
  await writeFile(join(support, "rules.ttl"), updatedShape);

  const supportPath = join(
    project,
    ".tbspec/dependencies/manual-model/manual/attachment-1/source/rules.ttl",
  );
  assert.equal(await readFile(supportPath, "utf8"), updatedShape);
  const lockBeforeImpactAcceptance = await readFile(join(project, "tbspec.lock"));
  const modelSnapshotPath = join(project, ".tbspec/dependencies/manual-model/source/model.ttl");
  const modelSnapshotBeforeImpactAcceptance = await readFile(modelSnapshotPath);
  await writeFile(join(source, "model.ttl"), model("updated", false));
  const update = invoke(["dependency", "update", "manual-model"], project);
  assert.equal(update.status, 0, update.stderr);
  assert.equal(update.envelope.status, "preview");
  assert.equal(update.envelope.data.preview.operation, "dependency.update");
  assert.deepEqual(
    update.envelope.data.preview.acquired.map((item: { selector: string }) => item.selector).sort(),
    [
      "dep:manual-model/manual/attachment-1/source/rules.ttl",
      "dep:manual-model/manual/attachment-2/source/design.ttl",
      "dep:manual-model/source/model.ttl",
    ],
  );
  assert.deepEqual(update.envelope.data.preview.impact.acceptance, ["apply", "accept-impact"]);
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBeforeImpactAcceptance);
  assert.deepEqual(await readFile(modelSnapshotPath), modelSnapshotBeforeImpactAcceptance);
  assert.ok(
    update.envelope.data.dependency.attachments.some(
      (attachment: { id: string; active: boolean }) =>
        attachment.id === "attachment-1" && attachment.active,
    ),
  );
  const reacquiredModel = model("reacquired", false);
  await writeFile(join(source, "model.ttl"), reacquiredModel);
  const changedUpdate = invoke(
    [
      "dependency",
      "update",
      "manual-model",
      "--apply",
      "--accepted-preview",
      update.envelope.data.preview.fingerprint,
      "--accept-impact",
    ],
    project,
  );
  assert.equal(changedUpdate.status, 3, changedUpdate.stderr);
  assert.ok(
    changedUpdate.envelope.diagnostics.some(
      (item: { code: string }) => item.code === "PREVIEW_CHANGED",
    ),
  );
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBeforeImpactAcceptance);
  assert.deepEqual(await readFile(modelSnapshotPath), modelSnapshotBeforeImpactAcceptance);
  const withoutImpactAcceptance = invoke(
    [
      "dependency",
      "update",
      "manual-model",
      "--apply",
      "--accepted-preview",
      changedUpdate.envelope.data.preview.fingerprint,
    ],
    project,
  );
  assert.equal(withoutImpactAcceptance.status, 3);
  assert.ok(
    withoutImpactAcceptance.envelope.diagnostics.some(
      (item: { code: string }) => item.code === "ACCEPTANCE_REQUIRED",
    ),
  );
  assert.deepEqual(await readFile(join(project, "tbspec.lock")), lockBeforeImpactAcceptance);
  assert.deepEqual(await readFile(modelSnapshotPath), modelSnapshotBeforeImpactAcceptance);
  const appliedUpdate = invoke(
    [
      "dependency",
      "update",
      "manual-model",
      "--apply",
      "--accepted-preview",
      changedUpdate.envelope.data.preview.fingerprint,
      "--accept-impact",
    ],
    project,
  );
  assert.equal(appliedUpdate.status, 0, appliedUpdate.stderr);
  assert.equal(appliedUpdate.envelope.data.applied, true);
  assert.equal(await readFile(modelSnapshotPath, "utf8"), reacquiredModel);
  assert.ok(
    appliedUpdate.envelope.data.dependency.attachments.some(
      (attachment: { id: string; active: boolean }) =>
        attachment.id === "attachment-1" && attachment.active,
    ),
  );
  assert.equal(
    await readFile(supportPath, "utf8"),
    await readFile(join(support, "rules.ttl"), "utf8"),
  );

  const cleared = invoke(
    [
      "dependency",
      "support",
      "clear",
      "manual-model",
      "--target",
      "dep:manual-model/source/model.ttl",
      "--role",
      "shacl",
      "--resource",
      "dep:manual-model/manual/attachment-1/source/rules.ttl",
    ],
    project,
  );
  assert.equal(cleared.status, 0, cleared.stderr);
  assert.equal(
    await readFile(supportPath, "utf8"),
    await readFile(join(support, "rules.ttl"), "utf8"),
  );
  const shown = invoke(["dependency", "show", "manual-model"], project);
  const dependency = shown.envelope.data.dependency;
  assert.equal(
    dependency.attachments.find((attachment: { role: string }) => attachment.role === "shacl")
      .active,
    false,
  );
  assert.equal(
    dependency.attachments.find((attachment: { role: string }) => attachment.role === "design")
      .active,
    true,
  );
  assert.ok(
    dependency.files.some(
      (file: { key: string }) => file.key === "manual/attachment-1/source/rules.ttl",
    ),
  );
  assert.ok(
    dependency.files.some(
      (file: { key: string }) => file.key === "manual/attachment-2/source/design.ttl",
    ),
  );
});

test("CLI authors and inspects every model family and imports locked vocabulary offline", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-cli-author-"));
  await initializeProject({ directory: root, baseIri: "urn:cli:/" });
  for (const args of [
    ["ontology", "create", "vocabulary.ttl", "--iri", "urn:cli:vocabulary"],
    ["ontology", "import", "dep:tbspec-state-machine", "adopted.ttl"],
    ["model", "create", "concepts.ttl", "--type", "data"],
    [
      "model",
      "create",
      "individuals.ttl",
      "--type",
      "data",
      "--profile",
      "concrete",
      "--schema",
      "concepts.ttl",
      "--schema",
      "concepts.ttl",
    ],
    ["model", "create", "process.ttl", "--type", "process"],
    ["model", "create", "states.ttl", "--type", "state-machine"],
    ["model", "import", "individuals.ttl", "imported.ttl", "--type", "data"],
    ["ontology", "list"],
    ["ontology", "show", "adopted.ttl"],
    ["model", "list"],
    ["model", "show", "individuals.ttl"],
    ["ontology", "--help"],
    ["model", "--help"],
    ["llms", "modeling", "models", "import"],
  ]) {
    const result = invoke(args, root);
    assert.equal(result.status, 0, result.stderr);
  }
  for (const args of [
    ["ontology", "list", "--iri", "urn:extra"],
    ["status", "--type", "data"],
  ])
    assert.equal((await interpret(args)).status, "invalid_arguments");
  for (const args of [
    ["model", "create", "missing.ttl"],
    ["model", "create", "invalid.ttl", "--type", "process", "--profile", "concrete"],
    [
      "model",
      "import",
      "states.ttl",
      "invalid.ttl",
      "--type",
      "state-machine",
      "--schema",
      "concepts.ttl",
    ],
  ])
    assert.equal(invoke(args, root).status, 2);
  assert.equal(invoke(["ontology", "create", "vocabulary.ttl"], root).status, 3);
  const review = invoke(
    ["ontology", "create", "reviewed.ttl", "--accepted-preview", `sha256:${"0".repeat(64)}`],
    root,
  );
  assert.equal(review.status, 3);
  assert.equal(review.envelope.data.applied, false);
  await assert.rejects(readFile(join(root, "reviewed.ttl")), { code: "ENOENT" });
  const accepted = invoke(
    [
      "ontology",
      "create",
      "reviewed.ttl",
      "--accepted-preview",
      review.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(accepted.status, 0, accepted.stderr);
});
test("help/version, argument errors and recursive llms produce exactly one envelope without a project", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tbspec-cli-"));
  for (const args of [
    ["--help"],
    ["init", "--help"],
    ["llms", "--help"],
    ["--version"],
    ["llms"],
    ...["project", "modeling", "views", "dependencies", "queries", "repair"].map((topic) => [
      "llms",
      topic,
    ]),
    ["llms", "dependencies", "update"],
    ["llms", "dependencies", "support"],
    ["dependency", "--help"],
    ["llms", "projects"],
    ["llms", "projects", "init"],
    ["llms", "views", "designs"],
    ["llms", "safety", "recovery"],
  ]) {
    const result = await interpret(args);
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.deepEqual(Object.keys(result).sort(), [
      "data",
      "diagnostics",
      "schemaVersion",
      "status",
    ]);
    assert.equal(result.schemaVersion, 1);
    assert.deepEqual(result.diagnostics, []);
    if (args.join(" ") === "llms views designs") {
      assert.match(JSON.stringify(result.data), /design import/);
      assert.match(JSON.stringify(result.data), /nearest inherited dependency/);
      assert.match(JSON.stringify(result.data), /presentation graph/);
    }
  }
  for (const args of [
    ["unknown"],
    ["init", "--base-iri"],
    ["init", "a", "b"],
    ["--unknown", "--help"],
    ["llms", "projects", "missing"],
    ["init", "--project", cwd, "other"],
  ]) {
    const result = await interpret(args);
    assert.equal(result.status, "invalid_arguments", JSON.stringify(result));
    assert.equal(exits[result.status], 2);
    assert.equal(result.diagnostics[0]?.code, "ARGUMENT_INVALID");
  }
  for (const args of [
    ["--help"],
    ["--version"],
    ["--unknown", "--help"],
    ["init", "--base-iri", "relative/"],
    ["init", "--base-iri", "https://example.org/no-trailing-slash"],
  ]) {
    const result = invoke(args, cwd);
    const invalid = args.includes("--unknown") || args.includes("--base-iri");
    assert.equal(result.status, invalid ? 2 : 0, result.stderr);
    assert.equal(result.envelope.status, invalid ? "invalid_arguments" : "ok");
    if (invalid) assert.match(result.stderr, /ARGUMENT_INVALID/);
    else assert.equal(result.stderr, "");
  }
});
test("CLI init works with Node alone, preserves ignore bytes and explicit root overrides discovery", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-cli-init-"));
  const root = join(parent, "one");
  await mkdir(root);
  const ignore = "# human rules\r\nartifacts/\r\n";
  await writeFile(join(root, ".gitignore"), ignore);
  const result = invoke(["init", root, "--base-iri", "urn:example:knowledge/"], parent);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.envelope.data.projectValidity, "unchecked");
  assert.equal(
    await readFile(join(root, ".gitignore"), "utf8"),
    `${ignore}.tbspec/runtime/\r\n.tbspec/previews/\r\n.tbspec/transactions/\r\n.tbspec/operation.lock\r\n`,
  );
  const repeated = invoke(["init", root], parent);
  assert.equal(repeated.status, 3);
  assert.equal(repeated.envelope.status, "conflict");
  const manifestBefore = await readFile(join(root, "tbspec.toml"), "utf8");
  await writeFile(
    join(root, "tbspec.toml"),
    manifestBefore.replace("schema_version = 1", "schema_version = 2"),
  );
  const incompatible = invoke(["init", root], parent);
  assert.equal(incompatible.status, 1);
  assert.equal(incompatible.envelope.status, "invalid");
  assert.equal(incompatible.envelope.diagnostics[0].code, "SCHEMA_UNSUPPORTED");
  await writeFile(join(root, "tbspec.toml"), manifestBefore);
  const other = join(parent, "two");
  await initializeProject({ directory: other });
  const child = join(root, "subdirectory");
  await mkdir(child);
  assert.equal(await discoverProject({ cwd: child, project: other }), await realpath(other));
  await assert.rejects(discoverProject({ cwd: child, project: parent }), /Explicit directory/);
  const missingParent = invoke(["init", join(root, "tbspec.toml", "cannot-be-directory")], parent);
  assert.equal(missingParent.status, 4);
  assert.equal(missingParent.envelope.status, "unavailable");
});

test("inspection CLI routes exact signatures, portable selectors and complete offline status", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-cli-inspect-"));
  await initializeProject({ directory: root });
  await mkdir(join(root, "models"));
  await writeFile(join(root, "models/plain.ttl"), '<urn:a> <urn:p> "value" .');
  const cwd = join(root, "models");
  for (const args of [
    ["graph", "list"],
    ["graph", "show", "models\\plain.ttl"],
    ["graph", "show", "dep:tbspec-metadata"],
    ["config", "show"],
    ["config", "model-type", "list"],
  ]) {
    const result = invoke(args, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.envelope.status, "ok");
  }
  const status = invoke(["status"], cwd);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.envelope.data.project.validationComplete, true);
  assert.equal(status.envelope.data.counts.resources, 1);
  for (const args of [
    ["status", "extra"],
    ["graph", "show"],
    ["graph", "list", "extra"],
    ["config", "model-type", "set", "new"],
    ["web", "status", "--background"],
    ["web", "--port", "0"],
    ["web", "--port", "1e3"],
  ])
    assert.equal((await interpret(args)).status, "invalid_arguments");
  for (const args of [
    ["graph", "--help"],
    ["config", "--help"],
    ["web", "--help"],
    ["llms", "project", "inspect"],
    ["llms", "project", "web"],
  ])
    assert.equal(invoke(args, tmpdir()).status, 0);
});

test("CLI configures model types and requires explicit acceptance for incompatible used vocabulary", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-cli-model-type-"));
  await initializeProject({ directory: root, baseIri: "urn:cli-model-type:/" });
  const local = "<urn:cli-model-type:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n";
  await writeFile(join(root, "replacement.ttl"), local);
  const added = invoke(
    ["config", "model-type", "set", "custom", "--ontology", "replacement.ttl"],
    root,
  );
  assert.equal(added.envelope.status, "ok", added.stderr);
  assert.deepEqual(
    invoke(["config", "model-type", "show", "custom"], root).envelope.data.modelType,
    {
      name: "custom",
      enabled: true,
      ontology: "replacement.ttl",
      design: null,
      origin: "manifest",
    },
  );
  assert.equal(invoke(["config", "model-type", "disable", "custom"], root).status, 0);
  assert.equal(
    invoke(["config", "model-type", "show", "custom"], root).envelope.data.modelType.enabled,
    false,
  );
  assert.equal(invoke(["config", "model-type", "enable", "custom"], root).status, 0);
  assert.equal(invoke(["config", "model-type", "reset", "custom"], root).status, 2);
  assert.equal(
    invoke(["config", "model-type", "set", "custom", "--ontology", "missing.ttl"], root).status,
    1,
  );

  assert.equal(invoke(["model", "create", "models/plan.ttl", "--type", "process"], root).status, 0);
  const modelBytes = await readFile(join(root, "models/plan.ttl"));
  const preview = invoke(
    ["config", "model-type", "set", "process", "--ontology", "replacement.ttl"],
    root,
  );
  assert.equal(preview.envelope.status, "preview", preview.stderr);
  assert.deepEqual(await readFile(join(root, "models/plan.ttl")), modelBytes);
  assert.deepEqual(preview.envelope.data.preview.impact.acceptance, ["accept-impact"]);
  assert.equal(
    invoke(
      [
        "config",
        "model-type",
        "set",
        "process",
        "--ontology",
        "replacement.ttl",
        "--accept-impact",
        "--accepted-preview",
        preview.envelope.data.preview.fingerprint,
      ],
      root,
    ).status,
    0,
  );
  assert.deepEqual(await readFile(join(root, "models/plan.ttl")), modelBytes);
  assert.equal(
    invoke(["config", "model-type", "show", "process"], root).envelope.data.modelType.design,
    null,
  );
  assert.equal(
    invoke(["config", "model-type", "design", "set", "process", "dep:tbspec-process-design"], root)
      .status,
    0,
  );
  assert.equal(invoke(["config", "model-type", "design", "clear", "process"], root).status, 0);
  for (const args of [
    ["config", "model-type", "set", "process", "--ontology", "replacement.ttl", "--confirm"],
    ["config", "model-type", "disable", "process", "--accept-impact"],
    ["config", "model-type", "design", "set", "process"],
  ])
    assert.equal((await interpret(args)).status, "invalid_arguments");
});

test("CLI inventories impact and confirms removals and fingerprint-bound resource moves", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-cli-lifecycle-"));
  await initializeProject({ directory: root, baseIri: "urn:cli-lifecycle:/" });
  assert.equal(
    invoke(["ontology", "create", "vocabulary.ttl", "--iri", "urn:cli-lifecycle:vocabulary"], root)
      .status,
    0,
  );
  await writeFile(
    join(root, "vocabulary.ttl"),
    "<urn:cli-lifecycle:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n<urn:cli-lifecycle:Term> a <http://www.w3.org/2002/07/owl#Class> .\n",
  );
  await writeFile(
    join(root, "model.ttl"),
    '<urn:cli-lifecycle:model> a <https://talby.ai/ontology/tbspec#ConceptualDataModel>; <https://talby.ai/ontology/tbspec#modelType> "data" .\n<urn:cli-lifecycle:data> <urn:cli-lifecycle:uses> <urn:cli-lifecycle:Term> .\n',
  );
  const impact = invoke(["impact", "ontology", "vocabulary.ttl"], root);
  assert.equal(impact.envelope.status, "ok", impact.stderr);
  assert.ok(impact.envelope.data.targetIris.includes("urn:cli-lifecycle:vocabulary"));

  const removal = invoke(["ontology", "remove", "vocabulary.ttl"], root);
  assert.equal(removal.envelope.status, "preview", removal.stderr);
  assert.ok(
    removal.envelope.data.preview.impact.affectedFiles.includes("model.ttl"),
    JSON.stringify(removal.envelope.data.preview),
  );
  const removed = invoke(
    [
      "ontology",
      "remove",
      "vocabulary.ttl",
      "--confirm",
      "--accepted-preview",
      removal.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(await readFile(join(root, "model.ttl"), "utf8"), /urn:cli-lifecycle:Term/);
  await assert.rejects(readFile(join(root, "vocabulary.ttl")), { code: "ENOENT" });

  await writeFile(join(root, "loose.ttl"), "<urn:loose:s> <urn:loose:p> <urn:loose:o> .\n");
  const move = invoke(["resource", "move", "loose.ttl", "archive/loose.ttl"], root);
  assert.equal(move.envelope.status, "preview", move.stderr);
  assert.ok(
    move.envelope.data.preview.arguments.identityChanges.some(
      (item: { identity: string }) => item.identity === "generated",
    ),
  );
  const moved = invoke(
    [
      "resource",
      "move",
      "loose.ttl",
      "archive/loose.ttl",
      "--apply",
      "--accepted-preview",
      move.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(moved.status, 0, moved.stderr);
  await assert.rejects(readFile(join(root, "loose.ttl")), { code: "ENOENT" });
  assert.match(await readFile(join(root, "archive/loose.ttl"), "utf8"), /urn:loose:s/);

  await writeFile(
    join(root, "custom.ttl"),
    "<urn:cli-lifecycle:custom> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );
  assert.equal(
    invoke(["config", "model-type", "set", "custom", "--ontology", "custom.ttl"], root).status,
    0,
  );
  assert.equal(invoke(["model", "create", "custom-model.ttl", "--type", "custom"], root).status, 0);
  const typePreview = invoke(["config", "model-type", "remove", "custom"], root);
  assert.equal(typePreview.envelope.status, "preview", typePreview.stderr);
  assert.deepEqual(typePreview.envelope.data.affectedModels, [
    { selector: "custom-model.ttl", file: "custom-model.ttl" },
  ]);
  const typeRemoval = invoke(
    [
      "config",
      "model-type",
      "remove",
      "custom",
      "--confirm",
      "--accepted-preview",
      typePreview.envelope.data.preview.fingerprint,
    ],
    root,
  );
  assert.equal(typeRemoval.status, 0, typeRemoval.stderr);
  assert.ok(
    typeRemoval.envelope.diagnostics.some((d: { code: string }) => d.code === "ASSOCIATION_BROKEN"),
  );
  await readFile(join(root, "custom-model.ttl"));
  assert.equal(invoke(["config", "model-type", "remove", "data", "--confirm"], root).status, 2);
});
