import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FileSystem } from "../src/filesystem.ts";
import { initializeProject } from "../src/project.ts";
import { publishPlan } from "../src/transactions.ts";
import { prepareEditWithViews } from "../src/views.ts";

function faultSecondLink(): FileSystem {
  let calls = 0;
  return new Proxy(fs, {
    get(target, key) {
      if (key === "link")
        return async (...args: Parameters<typeof fs.link>) => {
          calls++;
          if (calls === 2)
            throw Object.assign(new Error("second view file link failed"), { code: "EIO" });
          return Reflect.apply(target.link, target, args);
        };
      return Reflect.get(target, key);
    },
  });
}

test("view creation is revision-bound and rolls back its pair and manifest together", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "tb-view-transaction-"));
  await initializeProject({ directory: root, baseIri: "urn:view-transaction:/" });
  await fs.writeFile(
    join(root, "source.ttl"),
    "<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n<urn:a> <urn:p> <urn:b> .\n",
  );

  const stale = await prepareEditWithViews({
    project: root,
    action: "create",
    path: "views/stale.ttl",
    source: "source.ttl",
  });
  await fs.appendFile(join(root, "tbspec.toml"), "\n# intervening manifest edit\n");
  await assert.rejects(publishPlan(root, stale.plan), /changed since capture/);
  await assert.rejects(fs.access(join(root, "views/stale.ttl")), { code: "ENOENT" });
  await assert.rejects(fs.access(join(root, "views/stale.presentation.ttl")), { code: "ENOENT" });

  const manifestBeforeRollback = await fs.readFile(join(root, "tbspec.toml"));
  const rollback = await prepareEditWithViews({
    project: root,
    action: "create",
    path: "views/rollback.ttl",
    source: "source.ttl",
  });
  await assert.rejects(
    publishPlan(root, rollback.plan, faultSecondLink()),
    /second view file link failed/,
  );
  await assert.rejects(fs.access(join(root, "views/rollback.ttl")), { code: "ENOENT" });
  await assert.rejects(fs.access(join(root, "views/rollback.presentation.ttl")), {
    code: "ENOENT",
  });
  assert.deepEqual(await fs.readFile(join(root, "tbspec.toml")), manifestBeforeRollback);
});
