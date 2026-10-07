import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverProject, initializeProject } from "../src/project.ts";

test("offline initialization supplies locked defaults and discovers them from a child", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-init-"));
  const root = join(parent, "project");
  const result = await initializeProject({
    directory: root,
    baseIri: "https://example.org/project/",
  });
  assert.equal(result.status, "ok");
  assert.equal(result.data?.applied, true);
  const manifest = await readFile(join(root, "tbspec.toml"), "utf8");
  assert.match(manifest, /schema_version = 1/);
  assert.match(manifest, /\[model_types.state-machine\]/);
  assert.match(manifest, /https:\/\/example.org\/project\//);
  await assert.rejects(access(join(root, ".git")));
  const child = join(root, "models", "nested");
  await mkdir(child, { recursive: true });
  assert.equal(await discoverProject({ cwd: child }), root);
  assert.equal(await discoverProject({ cwd: parent, project: root }), root);
  const repeated = await initializeProject({ directory: root });
  assert.equal(repeated.status, "conflict");
  assert.equal(await readFile(join(root, "tbspec.toml"), "utf8"), manifest);
});
