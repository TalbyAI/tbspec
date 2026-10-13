import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dependencyAdd, prepareDependencyRename } from "../src/dependencies.ts";
import type { FileSystem } from "../src/filesystem.ts";
import { initializeProject } from "../src/project.ts";
import { parseLock } from "../src/schemas.ts";
import { publishPlan } from "../src/transactions.ts";

function failSecondMove(targetPath: string): FileSystem {
  const normalizedTarget = targetPath.replaceAll("\\", "/").toLowerCase();
  let failed = false;
  return new Proxy(fs, {
    get(target, key) {
      if (key === "link")
        return async (...args: Parameters<typeof fs.link>) => {
          const destination = String(args[1]).replaceAll("\\", "/").toLowerCase();
          if (!failed && destination === normalizedTarget) {
            failed = true;
            throw Object.assign(new Error("second dependency file move failed"), { code: "EIO" });
          }
          return Reflect.apply(target.link, target, args);
        };
      return Reflect.get(target, key);
    },
  });
}

test("dependency rename rolls back its lock and earlier snapshot moves after a later move fails", async () => {
  const parent = await fs.mkdtemp(join(tmpdir(), "tb-dependency-rename-rollback-"));
  const source = join(parent, "source");
  const project = join(parent, "project");
  await fs.mkdir(source);
  await initializeProject({ directory: project, baseIri: "urn:dependency-rename-rollback:/" });
  const main =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n" +
    "<urn:rename-rollback:main> a owl:Ontology; owl:imports <urn:rename-rollback:base> .\n";
  const base =
    "@prefix owl: <http://www.w3.org/2002/07/owl#> .\n" +
    "<urn:rename-rollback:base> a owl:Ontology .\n";
  await fs.writeFile(join(source, "main.ttl"), main);
  await fs.writeFile(join(source, "base.ttl"), base);
  const preview = await dependencyAdd({
    project,
    source,
    id: "old",
    kind: "ontology",
    resource: "main.ttl",
  });
  assert.equal(preview.status, "conflict", JSON.stringify(preview));
  assert.ok(preview.data);
  const added = await dependencyAdd({
    project,
    source,
    id: "old",
    kind: "ontology",
    resource: "main.ttl",
    acceptedPreview: (preview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(added.status, "ok", JSON.stringify(added));

  const beforeLock = await fs.readFile(join(project, "tbspec.lock"));
  const beforeFiles = new Map<string, Buffer>();
  const lock = parseLock(beforeLock.toString("utf8"));
  const dependency = lock.dependencies.old;
  assert.ok(dependency);
  for (const file of dependency.files)
    beforeFiles.set(
      `${dependency.snapshot_path}/${file.key}`,
      await fs.readFile(join(project, dependency.snapshot_path, file.key)),
    );
  const prepared = await prepareDependencyRename({ project, from: "old", to: "new" });
  const moves = prepared.plan.preview.changes.filter((change) => change.action === "move");
  assert.ok(moves.length >= 2, JSON.stringify(moves));
  const secondMove = moves[1];
  assert.ok(secondMove?.to);
  await assert.rejects(
    publishPlan(project, prepared.plan, failSecondMove(join(project, secondMove.to))),
    /second dependency file move failed/,
  );

  assert.deepEqual(await fs.readFile(join(project, "tbspec.lock")), beforeLock);
  for (const [path, bytes] of beforeFiles) {
    assert.deepEqual(await fs.readFile(join(project, path)), bytes);
    const key = path.slice(`${dependency.snapshot_path}/`.length);
    await assert.rejects(fs.readFile(join(project, ".tbspec/dependencies/new", key)), {
      code: "ENOENT",
    });
  }
});
