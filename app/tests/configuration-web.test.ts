import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorResource } from "../src/authoring.ts";
import { initializeProject } from "../src/project.ts";
import { parseLock, writeToml } from "../src/schemas.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

async function session(server: Awaited<ReturnType<typeof startWebServer>>) {
  const link = await controlRequest(server.record, "opening-link", {});
  const base = server.record.baseUrl ?? "";
  const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const response = await fetch(new URL("api/auth/v1/bootstrap", base), {
    method: "POST",
    headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  return (await response.json()).data.sessionToken as string;
}

test("authenticated browser configuration stages reviewed model-type changes and gates intentional invalidity", {
  timeout: 90000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-model-type-web-"));
  await initializeProject({ directory: root, baseIri: "urn:web-model-type:/" });
  const lock = parseLock(await readFile(join(root, "tbspec.lock"), "utf8"));
  const design = lock.dependencies["tbspec-process-design"];
  assert.ok(design);
  const designSelector = `dep:tbspec-process-design/${design.primary}`;
  const created = await authorResource({
    project: root,
    command: "model.create",
    path: "models/process.ttl",
    type: "process",
    iri: "urn:web-model-type:/plans",
  });
  assert.equal(created.status, "ok", JSON.stringify(created));
  const modelPath = join(root, "models/process.ttl");
  await writeFile(
    modelPath,
    `${await readFile(modelPath, "utf8")}\n<urn:web-model-type:/Plan> a <http://purl.org/net/p-plan#Plan> .\n`,
  );
  const modelBytes = await readFile(modelPath);
  await writeFile(
    join(root, "replacement.ttl"),
    "<urn:web-model-type:vocabulary> a <http://www.w3.org/2002/07/owl#Ontology> .\n",
  );
  const manifestPath = join(root, "tbspec.toml");
  const initialManifest = await readFile(manifestPath, "utf8");
  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  const owner = await session(server);
  const other = await session(server);
  async function call(route: string, body?: Record<string, unknown>, bearer = owner) {
    const response = await fetch(new URL(`api/project/v1/${route}`, base), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "X-Tbspec-Schema-Version": "1",
        Origin: new URL(base).origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, envelope: await response.json() };
  }

  assert.equal(
    (
      await call("model-types/configure", {
        command: "config.model-type.disable",
        name: "process",
        bytes: "client supplied replacement",
      })
    ).status,
    400,
  );

  const preview = await call("model-types/configure", {
    command: "config.model-type.set",
    name: "process",
    ontology: "replacement.ttl",
  });
  assert.equal(preview.envelope.status, "preview", JSON.stringify(preview));
  assert.equal(preview.envelope.data.applied, false);
  assert.equal(preview.envelope.data.projectValidity, "invalid");
  assert.ok(Math.abs(Date.parse(preview.envelope.data.expiresAt) - Date.now() - 900000) < 10000);
  assert.deepEqual(preview.envelope.data.preview.impact.acceptance, ["accept-impact"]);
  assert.equal(preview.envelope.data.preview.arguments.affectedModels[0].validityBefore, "passed");
  assert.equal(preview.envelope.data.preview.arguments.affectedModels[0].validityAfter, "failed");
  const staged = join(
    root,
    ".tbspec",
    "previews",
    server.record.instanceId,
    preview.envelope.data.handle,
    "staged-0",
  );
  assert.match(await readFile(staged, "utf8"), /ontology = "replacement\.ttl"/);
  assert.deepEqual(await readFile(manifestPath, "utf8"), initialManifest);
  assert.deepEqual(await readFile(modelPath), modelBytes);
  const apply = {
    schemaVersion: 1,
    handle: preview.envelope.data.handle as string,
    fingerprint: preview.envelope.data.preview.fingerprint as string,
  };
  assert.equal(
    (
      await call("resource/apply", {
        ...apply,
        accept: ["accept-impact"],
        writes: [{ file: "tbspec.toml", bytes: "replacement" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (await call("resource/apply", { ...apply, accept: ["accept-impact"] }, other)).status,
    409,
  );
  const denied = await call("resource/apply", { ...apply, accept: [] });
  assert.equal(denied.status, 409);
  assert.equal(denied.envelope.diagnostics[0].code, "ACCEPTANCE_REQUIRED");
  const applied = await call("resource/apply", { ...apply, accept: ["accept-impact"] });
  assert.equal(applied.status, 200, JSON.stringify(applied));
  assert.equal(applied.envelope.data.projectValidity, "invalid");
  assert.deepEqual(await readFile(modelPath), modelBytes);
  assert.equal(
    (await call("model-types")).envelope.data.items.find(
      (type: { name: string }) => type.name === "process",
    ).design,
    null,
  );

  const locked = await call("model-types/configure", {
    command: "config.model-type.design.set",
    name: "process",
    design: designSelector,
  });
  assert.equal(locked.envelope.status, "preview", JSON.stringify(locked));
  assert.deepEqual(locked.envelope.data.preview.impact.acceptance, []);
  const selected = await call("resource/apply", {
    schemaVersion: 1,
    handle: locked.envelope.data.handle,
    fingerprint: locked.envelope.data.preview.fingerprint,
    accept: [],
  });
  assert.equal(selected.status, 200, JSON.stringify(selected));
  assert.deepEqual(await readFile(modelPath), modelBytes);
  assert.equal(
    (await call("model-types")).envelope.data.items.find(
      (type: { name: string }) => type.name === "process",
    ).design,
    designSelector,
  );

  const stale = await call("model-types/configure", {
    command: "config.model-type.disable",
    name: "process",
  });
  assert.equal(stale.envelope.status, "preview", JSON.stringify(stale));
  await writeFile(manifestPath, (await readFile(manifestPath, "utf8")) + "\n# external edit\n");
  const staleApply = await call("resource/apply", {
    schemaVersion: 1,
    handle: stale.envelope.data.handle,
    fingerprint: stale.envelope.data.preview.fingerprint,
    accept: [],
  });
  assert.equal(staleApply.status, 409);
  assert.equal(staleApply.envelope.diagnostics[0].code, "REVISION_CONFLICT");
  assert.equal(
    (await call("model-types")).envelope.data.items.find(
      (type: { name: string }) => type.name === "process",
    ).enabled,
    true,
  );

  const cancelled = await call("model-types/configure", {
    command: "config.model-type.design.clear",
    name: "process",
  });
  assert.equal(cancelled.envelope.status, "preview", JSON.stringify(cancelled));
  const handle = cancelled.envelope.data.handle as string;
  assert.equal((await call("resource/cancel", { schemaVersion: 1, handle }, other)).status, 409);
  assert.equal((await call("resource/cancel", { schemaVersion: 1, handle })).status, 200);
  assert.equal(
    (
      await call("resource/apply", {
        schemaVersion: 1,
        handle,
        fingerprint: cancelled.envelope.data.preview.fingerprint,
        accept: [],
      })
    ).status,
    409,
  );
  assert.deepEqual(await readFile(modelPath), modelBytes);
  assert.equal(
    (await call("model-types")).envelope.data.items.find(
      (type: { name: string }) => type.name === "process",
    ).design,
    designSelector,
  );

  lock.starters.model_types.process = {
    enabled: true,
    ontology: "dep:tbspec-state-machine",
    design: "dep:tbspec-state-machine-design",
  };
  await writeFile(join(root, "tbspec.lock"), writeToml(lock));
  const reset = await call("model-types/configure", {
    command: "config.model-type.reset",
    name: "process",
  });
  assert.equal(reset.envelope.status, "preview", JSON.stringify(reset));
  assert.deepEqual(reset.envelope.data.preview.impact.acceptance, ["accept-impact"]);
  const resetApply = await call("resource/apply", {
    schemaVersion: 1,
    handle: reset.envelope.data.handle,
    fingerprint: reset.envelope.data.preview.fingerprint,
    accept: ["accept-impact"],
  });
  assert.equal(resetApply.status, 200, JSON.stringify(resetApply));
  assert.deepEqual(await readFile(modelPath), modelBytes);
  const resetType = (await call("model-types")).envelope.data.items.find(
    (type: { name: string }) => type.name === "process",
  );
  assert.equal(resetType.origin, "locked-default");
  assert.equal(resetType.ontology, "dep:tbspec-state-machine");
  assert.equal(resetType.design, "dep:tbspec-state-machine-design");

  assert.equal(
    (
      await call("model-types/configure", {
        command: "config.model-type.disable",
        name: "process",
        project: tmpdir(),
      })
    ).status,
    400,
  );
});
