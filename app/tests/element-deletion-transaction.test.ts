import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareElementDeletion, showEditor } from "../src/editing.ts";
import type { FileSystem } from "../src/filesystem.ts";
import { initializeProject } from "../src/project.ts";
import { publishPlan } from "../src/transactions.ts";
import { prepareEditWithViews, showView } from "../src/views.ts";
import { privateDirectory } from "./private-directory.ts";

function failOnPresentationPublication(): { adapter: FileSystem; injected: () => boolean } {
  let failed = false;
  const adapter = new Proxy(fs, {
    get(target, key) {
      if (key === "rename")
        return async (...args: Parameters<typeof fs.rename>) => {
          const destination = String(args[1]).replaceAll("\\", "/");
          if (!failed && destination.endsWith("views/main.presentation.ttl")) {
            failed = true;
            throw Object.assign(new Error("injected deletion publication failure"), {
              code: "EIO",
            });
          }
          return Reflect.apply(target.rename, target, args);
        };
      return Reflect.get(target, key);
    },
  });
  return { adapter, injected: () => failed };
}

test("element deletion restores source, view and presentation bytes when coupled publication fails", async () => {
  const root = await privateDirectory(join(tmpdir(), "tb-element-delete-rollback-"));
  await initializeProject({ directory: root, baseIri: "urn:delete-rollback:/" });
  await fs.writeFile(
    join(root, "source.ttl"),
    `<urn:source> a <http://www.w3.org/2002/07/owl#Ontology> .\n` +
      "<urn:deleted> <urn:p> <urn:keep> .\n",
  );
  const created = await prepareEditWithViews({
    project: root,
    action: "create",
    path: "views/main.ttl",
    source: "source.ttl",
  });
  await publishPlan(root, created.plan);
  const view = await showView({ project: root, selector: "views/main.ttl" });
  assert.equal(view.status, "ok", JSON.stringify(view));
  assert.ok(view.data, JSON.stringify(view));
  const selected = await prepareEditWithViews({
    project: root,
    action: "edit",
    selector: "views/main.ttl",
    sourceRevision: view.data.sourceRevision,
    viewRevision: view.data.resource.revision,
    presentationRevision: view.data.presentation.resource.revision,
    members: ["urn:deleted", "urn:keep"],
    relationships: [],
    positions: [
      { element: "urn:deleted", x: "1", y: "2" },
      { element: "urn:keep", x: "3", y: "4" },
    ],
  });
  await publishPlan(root, selected.plan);
  const shown = await showEditor({ project: root, selector: "source.ttl" });
  assert.equal(shown.status, "ok", JSON.stringify(shown));
  assert.ok(shown.data, JSON.stringify(shown));
  const prepared = await prepareElementDeletion({
    project: root,
    selector: "source.ttl",
    revision: shown.data.resource.revision,
    element: { kind: "iri", value: "urn:deleted" },
  });
  assert.deepEqual(
    prepared.plan.writes.map((write) => write.file),
    ["source.ttl", "views/main.ttl", "views/main.presentation.ttl"],
  );
  const files = ["source.ttl", "views/main.ttl", "views/main.presentation.ttl"];
  const before = await Promise.all(files.map((file) => fs.readFile(join(root, file))));
  const publicationFault = failOnPresentationPublication();
  await assert.rejects(
    publishPlan(root, prepared.plan, publicationFault.adapter),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "EIO");
      assert.match(error.message, /injected deletion publication failure/);
      return true;
    },
  );
  assert.equal(
    publicationFault.injected(),
    true,
    "expected the presentation publication fault to fire",
  );
  for (const [index, file] of files.entries())
    assert.deepEqual(await fs.readFile(join(root, file)), before[index], file);
  await fs.access(join(root, "source.ttl"));
});
