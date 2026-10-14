import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dependencyAdd, dependencyRemove, dependencyRename } from "../src/dependencies.ts";
import { prepareEdit, showEditor } from "../src/editing.ts";
import type { FileSystem } from "../src/filesystem.ts";
import { initializeProject } from "../src/project.ts";
import { parseLock, parseManifest } from "../src/schemas.ts";
import { publishPlan } from "../src/transactions.ts";
import { listViews, prepareEditWithViews, showView, viewOperation } from "../src/views.ts";

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

test("dependency ID rename preserves a locked-source view and updates its exact selector", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "tb-view-dependency-rename-"));
  const source = join(root, "source");
  const project = join(root, "project");
  await fs.mkdir(source);
  await initializeProject({ directory: project, baseIri: "urn:view-dependency-rename:/" });
  await fs.writeFile(
    join(project, "local.ttl"),
    "<urn:local:ontology> a <http://www.w3.org/2002/07/owl#Ontology> .\n" +
      "<urn:local:a> <urn:local:p> <urn:local:b> .\n",
  );
  await fs.writeFile(
    join(source, "ontology.ttl"),
    "<urn:rename-view:ontology> a <http://www.w3.org/2002/07/owl#Ontology> .\n" +
      "<urn:rename-view:Class> a <http://www.w3.org/2002/07/owl#Class> .\n",
  );
  const addPreview = await dependencyAdd({
    project,
    source,
    id: "old",
    kind: "ontology",
  });
  assert.equal(addPreview.status, "conflict", JSON.stringify(addPreview));
  assert.ok(addPreview.data);
  const added = await dependencyAdd({
    project,
    source,
    id: "old",
    kind: "ontology",
    acceptedPreview: (addPreview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(added.status, "ok", JSON.stringify(added));

  const created = await viewOperation({
    project,
    action: "create",
    path: "views/locked.ttl",
    source: "dep:old/source/ontology.ttl",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const independentView = await viewOperation({
    project,
    action: "create",
    path: "views/local.ttl",
    source: "local.ttl",
  });
  assert.equal(independentView.status, "ok", JSON.stringify(independentView));
  const oldLock = parseLock(await fs.readFile(join(project, "tbspec.lock"), "utf8"));
  const oldDependency = oldLock.dependencies.old;
  assert.ok(oldDependency);
  const oldRecord = oldDependency.files.find((file) => file.key === oldDependency.primary);
  assert.ok(oldRecord);
  const oldBytes = await fs.readFile(join(project, oldDependency.snapshot_path, oldRecord.key));
  const viewBytes = await fs.readFile(join(project, "views/locked.ttl"));
  const presentationBytes = await fs.readFile(join(project, "views/locked.presentation.ttl"));

  const preview = await dependencyRename({ project, from: "old", to: "new" });
  assert.equal(preview.status, "preview", JSON.stringify(preview));
  assert.ok(preview.data);
  const fingerprint = (preview.data.preview as { fingerprint: string }).fingerprint;
  const selectorChanges = (
    preview.data.preview as {
      arguments: { selectorChanges: { field: string; from: string; to: string }[] };
    }
  ).arguments.selectorChanges;
  assert.ok(
    selectorChanges.some(
      (change) =>
        change.field === "views[0].source" &&
        change.from === "dep:old/source/ontology.ttl" &&
        change.to === "dep:new/source/ontology.ttl",
    ),
    JSON.stringify(selectorChanges),
  );
  assert.deepEqual(await fs.readFile(join(project, "views/locked.ttl")), viewBytes);
  assert.deepEqual(
    await fs.readFile(join(project, "views/locked.presentation.ttl")),
    presentationBytes,
  );
  assert.deepEqual(
    await fs.readFile(join(project, oldDependency.snapshot_path, oldRecord.key)),
    oldBytes,
  );

  const applied = await dependencyRename({
    project,
    from: "old",
    to: "new",
    apply: true,
    acceptedPreview: fingerprint,
  });
  assert.equal(applied.status, "ok", JSON.stringify(applied));
  const newLock = parseLock(await fs.readFile(join(project, "tbspec.lock"), "utf8"));
  assert.equal(newLock.dependencies.old, undefined);
  const renamed = newLock.dependencies.new;
  assert.ok(renamed);
  const newRecord = renamed.files.find((file) => file.key === renamed.primary);
  assert.ok(newRecord);
  assert.equal(newRecord.graph_iri, oldRecord.graph_iri);
  assert.equal(newRecord.context, oldRecord.context);
  assert.equal(newRecord.graph_signature, oldRecord.graph_signature);
  assert.equal(renamed.interpretation_signature, oldDependency.interpretation_signature);
  assert.deepEqual(
    await fs.readFile(join(project, renamed.snapshot_path, newRecord.key)),
    oldBytes,
  );
  assert.deepEqual(await fs.readFile(join(project, "views/locked.ttl")), viewBytes);
  assert.deepEqual(
    await fs.readFile(join(project, "views/locked.presentation.ttl")),
    presentationBytes,
  );
  const shown = await showView({ project, selector: "views/locked.ttl" });
  assert.equal(shown.status, "ok", JSON.stringify(shown));
  assert.equal(shown.data?.source, "dep:new/source/ontology.ttl");

  const removePreview = await dependencyRemove({ project, id: "new" });
  assert.equal(removePreview.status, "preview", JSON.stringify(removePreview));
  assert.ok(removePreview.data);
  const references = removePreview.data.directAndDownstreamReferences as {
    ownership: string;
    file: string;
    selector?: string;
  }[];
  assert.ok(
    references.some(
      (reference) =>
        reference.ownership === "owned" &&
        reference.file === "tbspec.toml" &&
        reference.selector === "dep:new/source/ontology.ttl",
    ),
    JSON.stringify(references),
  );
  assert.ok(
    references.some(
      (reference) => reference.ownership === "owned" && reference.file === "views/locked.ttl",
    ),
    JSON.stringify(references),
  );
  const removed = await dependencyRemove({
    project,
    id: "new",
    confirm: true,
    acceptedPreview: (removePreview.data.preview as { fingerprint: string }).fingerprint,
  });
  assert.equal(removed.status, "ok", JSON.stringify(removed));
  assert.equal(removed.data?.projectValidity, "invalid");
  assert.ok(
    removed.diagnostics.some((diagnostic) => {
      const details = diagnostic.details as { identity?: { target?: unknown } } | undefined;
      return (
        diagnostic.code === "ASSOCIATION_BROKEN" &&
        diagnostic.file === "views/locked.ttl" &&
        details?.identity?.target === newRecord.graph_iri
      );
    }),
    JSON.stringify(removed.diagnostics),
  );
  assert.deepEqual(await fs.readFile(join(project, "views/locked.ttl")), viewBytes);
  assert.deepEqual(
    await fs.readFile(join(project, "views/locked.presentation.ttl")),
    presentationBytes,
  );
  await assert.rejects(fs.readFile(join(project, renamed.snapshot_path, newRecord.key)), {
    code: "ENOENT",
  });
  const retainedManifest = parseManifest(await fs.readFile(join(project, "tbspec.toml"), "utf8"));
  assert.equal(
    (retainedManifest.views as { source: string }[])[0]?.source,
    "dep:new/source/ontology.ttl",
  );
  const broken = await showView({ project, selector: "views/locked.ttl" });
  assert.equal(broken.status, "unavailable", JSON.stringify(broken));
  assert.equal(broken.diagnostics[0]?.code, "RESOURCE_MISSING");
  assert.equal(broken.diagnostics[0]?.message, "Dependency selector is unavailable.");

  const listed = await listViews({ project });
  assert.ok(listed.data, JSON.stringify(listed));
  const listedItems = listed.data.items as { selector: string; source: string }[];
  assert.deepEqual(
    listedItems.map((item) => item.selector),
    ["views/locked.ttl", "views/local.ttl"],
  );
  assert.equal(
    listedItems.find((item) => item.selector === "views/locked.ttl")?.source,
    "dep:new/source/ontology.ttl",
  );
  assert.ok(
    listed.diagnostics.some(
      (diagnostic) =>
        ["ASSOCIATION_BROKEN", "RESOURCE_MISSING"].includes(diagnostic.code) &&
        diagnostic.file === "views/locked.ttl",
    ),
    JSON.stringify(listed.diagnostics),
  );

  const localEditor = await showEditor({ project, selector: "local.ttl" });
  assert.ok(localEditor.data, JSON.stringify(localEditor));
  const localStatement = localEditor.data.triples.find(
    (triple) => triple.subject.value === "urn:local:a" && triple.predicate.value === "urn:local:p",
  );
  assert.ok(localStatement);
  const unrelatedEdit = await prepareEdit({
    project,
    selector: "local.ttl",
    revision: localEditor.data.resource.revision,
    edits: [{ action: "remove", before: localStatement }],
  });
  assert.ok(unrelatedEdit.plan.writes.some((write) => write.file === "local.ttl"));
});
