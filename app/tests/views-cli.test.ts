import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
