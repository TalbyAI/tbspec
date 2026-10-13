import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createServer, get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { hasCode, ProjectError } from "../src/output.ts";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest, webProject } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

test("an explicit HTTP default port reuses the successfully started server", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-port80-"));
  await initializeProject({ directory: root });
  let server: Awaited<ReturnType<typeof startWebServer>>;
  try {
    server = await startWebServer(await realpath(root), 80);
  } catch (error) {
    if (
      hasCode(error, "EACCES") ||
      (error instanceof ProjectError && error.diagnostic.code === "WEB_PORT_CONFLICT")
    ) {
      t.skip("Loopback port 80 is occupied or requires OS privileges.");
      return;
    }
    throw error;
  }
  t.after(() => server.stop());
  const result = await webProject({ project: root, action: "start", port: 80 });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(result.data?.server.instanceId, server.record.instanceId);
  const different = await webProject({ project: root, action: "start", port: 81 });
  assert.equal(different.diagnostics[0]?.code, "WEB_PORT_CONFLICT");
});

test("authenticated HTTP exposes saved query lifecycle and execution", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-query-"));
  await initializeProject({ directory: root });
  await writeFile(
    join(root, "data.ttl"),
    `@prefix owl: <http://www.w3.org/2002/07/owl#> . <urn:web:data> a owl:Ontology; <urn:web:value> "ok" .`,
  );
  const server = await startWebServer(await realpath(root), 0);
  t.after(() => server.stop());
  const baseUrl = server.record.baseUrl;
  assert.ok(baseUrl);
  const link = await controlRequest(server.record, "opening-link", {});
  const opening = String(link.openingLink);
  const bootstrap = new URL(opening).hash.slice("#tbspec-bootstrap=".length);
  const exchanged = await fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
    method: "POST",
    headers: { Origin: new URL(baseUrl).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  assert.equal(exchanged.status, 200);
  const session = String((await exchanged.json()).data.sessionToken);
  const request = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(new URL(`api/project/v1/${path}`, baseUrl), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${session}`,
        "X-Tbspec-Schema-Version": "1",
        Origin: new URL(baseUrl).origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, envelope: await response.json() };
  };
  assert.equal((await request("queries")).envelope.status, "ok");
  const saved = await request("query/save", {
    name: "web-example",
    queryText: "SELECT ?subject WHERE { ?subject <urn:web:value> ?value }",
    parametersText: "schema_version = 1\nparameters = []\n",
    expectedRevisions: {
      query: { state: "absent" },
      parameters: { state: "absent" },
    },
  });
  assert.equal(saved.envelope.status, "ok", JSON.stringify(saved.envelope));
  const shown = await request("query?name=web-example");
  assert.equal(
    shown.envelope.data.queryText,
    "SELECT ?subject WHERE { ?subject <urn:web:value> ?value }",
  );
  const run = await request("query/run", { saved: "web-example" });
  assert.equal(run.envelope.status, "ok");
  assert.equal(run.envelope.data.rows[0].subject.value, "urn:web:data");

  const queryPath = join(root, "queries/web-example.rq");
  const independentQuery = "ASK { <urn:independent> ?p ?o }";
  await writeFile(queryPath, independentQuery);
  const staleSave = await request("query/save", {
    name: "web-example",
    queryText: "ASK { <urn:browser-draft> ?p ?o }",
    expectedRevisions: shown.envelope.data.revisions,
  });
  assert.equal(staleSave.envelope.status, "conflict");
  assert.equal(await readFile(queryPath, "utf8"), independentQuery);

  const latest = await request("query?name=web-example");
  const declarationPath = join(root, "queries/web-example.query.toml");
  const independentDeclaration =
    "# concurrent declaration edit\nschema_version = 1\nparameters = []\n";
  await writeFile(declarationPath, independentDeclaration);
  const staleRemove = await request("query/remove", {
    name: "web-example",
    confirm: true,
    expectedRevisions: latest.envelope.data.revisions,
  });
  assert.equal(staleRemove.envelope.status, "conflict");
  assert.equal(await readFile(queryPath, "utf8"), independentQuery);
  assert.equal(await readFile(declarationPath, "utf8"), independentDeclaration);

  const refreshed = await request("query?name=web-example");
  assert.equal(
    (
      await request("query/remove", {
        name: "web-example",
        confirm: false,
        expectedRevisions: refreshed.envelope.data.revisions,
      })
    ).envelope.status,
    "preview",
  );
  assert.equal(
    (
      await request("query/remove", {
        name: "web-example",
        confirm: true,
        expectedRevisions: refreshed.envelope.data.revisions,
      })
    ).envelope.status,
    "ok",
  );
  assert.deepEqual((await request("queries")).envelope.data.items, []);
});

test("authenticated HTTP stages, applies, lists and shows an acquired directory dependency", {
  timeout: 60000,
}, async (t) => {
  const parent = await privateDirectory(join(tmpdir(), "tbspec-web-dependency-"));
  const root = join(parent, "project");
  const source = join(parent, "source");
  const supportSource = join(parent, "support");
  await mkdir(source);
  await mkdir(supportSource);
  await initializeProject({ directory: root });
  const original = `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/web-acquired> a owl:Ontology .\n`;
  await writeFile(join(source, "ontology.ttl"), original);
  const server = await startWebServer(await realpath(root), 0);
  t.after(() => server.stop());
  const baseUrl = server.record.baseUrl;
  assert.ok(baseUrl);
  const link = await controlRequest(server.record, "opening-link", {});
  const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const exchanged = await fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
    method: "POST",
    headers: { Origin: new URL(baseUrl).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  const session = String(
    ((await exchanged.json()) as { data: { sessionToken: string } }).data.sessionToken,
  );
  const headers = {
    Authorization: `Bearer ${session}`,
    "X-Tbspec-Schema-Version": "1",
    Origin: new URL(baseUrl).origin,
  };
  const request = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(new URL(`api/project/v1/${path}`, baseUrl), {
      method: body ? "POST" : "GET",
      headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      envelope: (await response.json()) as {
        status: string;
        data: Record<string, unknown> | null;
        diagnostics: { code: string; message: string }[];
      },
    };
  };

  const inventory = await request("dependencies/inspect", { source });
  assert.equal(inventory.envelope.status, "ok", JSON.stringify(inventory.envelope));
  assert.ok(inventory.envelope.data);
  assert.equal(
    (inventory.envelope.data.items as { resource: string }[])[0]?.resource,
    "ontology.ttl",
  );
  const prepared = await request("dependencies/add", {
    id: "web-source",
    kind: "ontology",
    source,
    resource: "ontology.ttl",
    operationId: "acquisition-preview-0001",
  });
  assert.equal(prepared.envelope.status, "preview", JSON.stringify(prepared.envelope));
  const staged = prepared.envelope.data as { handle: string; preview: { fingerprint: string } };
  assert.equal(typeof staged.handle, "string");
  assert.match(staged.preview.fingerprint, /^sha256:[a-f0-9]{64}$/);
  await writeFile(join(source, "ontology.ttl"), "source changed after preview");
  const secondLink = await controlRequest(server.record, "opening-link", {});
  const secondBootstrap = new URL(String(secondLink.openingLink)).hash.slice(
    "#tbspec-bootstrap=".length,
  );
  const secondExchange = await fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
    method: "POST",
    headers: { Origin: new URL(baseUrl).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap: secondBootstrap }),
  });
  const secondSession = String(
    ((await secondExchange.json()) as { data: { sessionToken: string } }).data.sessionToken,
  );
  const wrongOwner = await fetch(new URL("api/project/v1/dependencies/apply", baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secondSession}`,
      "X-Tbspec-Schema-Version": "1",
      Origin: new URL(baseUrl).origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      schemaVersion: 1,
      handle: staged.handle,
      fingerprint: staged.preview.fingerprint,
      accept: [],
    }),
  });
  assert.equal(wrongOwner.status, 409);
  assert.equal(((await wrongOwner.json()) as { status: string }).status, "conflict");
  const applied = await request("dependencies/apply", {
    schemaVersion: 1,
    handle: staged.handle,
    fingerprint: staged.preview.fingerprint,
    accept: [],
  });
  assert.equal(applied.envelope.status, "ok", JSON.stringify(applied.envelope));
  const reused = await request("dependencies/apply", {
    schemaVersion: 1,
    handle: staged.handle,
    fingerprint: staged.preview.fingerprint,
    accept: [],
  });
  assert.equal(reused.envelope.status, "conflict");

  const updated = `@prefix owl: <http://www.w3.org/2002/07/owl#> .\n<https://example.org/web-acquired> a owl:Ontology; <urn:web:version> "staged-update" .\n`;
  await writeFile(join(source, "ontology.ttl"), updated);
  const updatePreview = await request("dependencies/update", {
    id: "web-source",
    operationId: "acquisition-update-0001",
  });
  assert.equal(updatePreview.envelope.status, "preview", JSON.stringify(updatePreview.envelope));
  const updateStaged = updatePreview.envelope.data as {
    handle: string;
    preview: { fingerprint: string; impact: { acceptance: string[] } };
  };
  assert.ok(updateStaged.preview.impact.acceptance.includes("apply"));
  const changedAfterPreview = `${updated}# changed after preview\n`;
  await writeFile(join(source, "ontology.ttl"), changedAfterPreview);
  const updateApplied = await request("dependencies/apply", {
    schemaVersion: 1,
    handle: updateStaged.handle,
    fingerprint: updateStaged.preview.fingerprint,
    accept: ["apply"],
  });
  assert.equal(updateApplied.envelope.status, "ok", JSON.stringify(updateApplied.envelope));
  assert.equal(
    await readFile(join(root, ".tbspec/dependencies/web-source/source/ontology.ttl"), "utf8"),
    updated,
  );

  const shape = `@prefix sh: <http://www.w3.org/ns/shacl#> .\n@prefix t: <https://talby.ai/ontology/tbspec#> .\n<urn:web:shapes> a t:ShapesGraph .\n<urn:web:shape> a sh:NodeShape; sh:targetNode <https://example.org/web-acquired> .\n`;
  await writeFile(join(supportSource, "rules.ttl"), shape);
  const supportPreview = await request("dependencies/support/set", {
    id: "web-source",
    target: "dep:web-source/source/ontology.ttl",
    role: "shacl",
    source: supportSource,
    resource: "rules.ttl",
    operationId: "support-set-preview-0001",
  });
  assert.equal(supportPreview.envelope.status, "preview", JSON.stringify(supportPreview.envelope));
  const supportStaged = supportPreview.envelope.data as {
    handle: string;
    preview: { fingerprint: string };
  };
  await writeFile(join(supportSource, "rules.ttl"), "changed after staging");
  const supportApplied = await request("dependencies/apply", {
    schemaVersion: 1,
    handle: supportStaged.handle,
    fingerprint: supportStaged.preview.fingerprint,
    accept: [],
  });
  assert.equal(supportApplied.envelope.status, "ok", JSON.stringify(supportApplied.envelope));
  const supportPath = join(
    root,
    ".tbspec/dependencies/web-source/manual/attachment-1/source/rules.ttl",
  );
  assert.equal(await readFile(supportPath, "utf8"), shape);
  const clearPreview = await request("dependencies/support/clear", {
    id: "web-source",
    target: "dep:web-source/source/ontology.ttl",
    role: "shacl",
    resource: "dep:web-source/manual/attachment-1/source/rules.ttl",
    operationId: "support-clear-preview-0001",
  });
  assert.equal(clearPreview.envelope.status, "preview", JSON.stringify(clearPreview.envelope));
  const clearStaged = clearPreview.envelope.data as {
    handle: string;
    preview: { fingerprint: string };
  };
  const clearApplied = await request("dependencies/apply", {
    schemaVersion: 1,
    handle: clearStaged.handle,
    fingerprint: clearStaged.preview.fingerprint,
    accept: [],
  });
  assert.equal(clearApplied.envelope.status, "ok", JSON.stringify(clearApplied.envelope));
  assert.equal(await readFile(supportPath, "utf8"), shape);
  const afterClear = await request("dependency?id=web-source");
  const clearedDependency = afterClear.envelope.data?.dependency as {
    attachments: { id: string; active: boolean }[];
    files: { key: string }[];
  };
  assert.equal(clearedDependency.attachments[0]?.active, false);
  assert.ok(
    clearedDependency.files.some((file) => file.key === "manual/attachment-1/source/rules.ttl"),
  );
  const listed = await request("dependencies");
  assert.ok(listed.envelope.data);
  const listedSource = (
    listed.envelope.data.items as {
      id: string;
      ontologies: { graphIri: string; effective: boolean; choice: string | null }[];
    }[]
  ).find((item) => item.id === "web-source");
  assert.ok(
    listedSource?.ontologies.some((item) => item.graphIri === "https://example.org/web-acquired"),
  );
  const selected = await request("dependencies/select", {
    ontologyIri: "https://example.org/web-acquired",
    id: "web-source",
  });
  assert.equal(selected.envelope.status, "ok", JSON.stringify(selected.envelope));
  const selectedListing = await request("dependencies");
  assert.ok(selectedListing.envelope.data);
  const selectedItem = (
    selectedListing.envelope.data.items as {
      id: string;
      ontologies: { graphIri: string; effective: boolean; choice: string | null }[];
    }[]
  ).find((item) => item.id === "web-source");
  assert.ok(
    selectedItem?.ontologies.some(
      (item) =>
        item.graphIri === "https://example.org/web-acquired" &&
        item.effective &&
        item.choice === "web-source",
    ),
  );
  const cleared = await request("dependencies/clear", {
    ontologyIri: "https://example.org/web-acquired",
  });
  assert.equal(cleared.envelope.status, "ok", JSON.stringify(cleared.envelope));
  const checked = await request("dependencies/check", {
    id: "web-source",
    operationId: "web-source-check-0001",
  });
  assert.equal(checked.status, 422);
  assert.equal(checked.envelope.status, "invalid");
  assert.ok(checked.envelope.data);
  const checkedItem = (checked.envelope.data.items as { state: string; comparison: string }[])[0];
  assert.equal(checkedItem?.state, "changed");
  assert.equal(checkedItem?.comparison, "complete");
  const checkedAll = await request("dependencies/check", {
    operationId: "web-source-check-all-0001",
  });
  assert.equal(checkedAll.status, 422);
  assert.ok(checkedAll.envelope.data);
  assert.ok(
    (checkedAll.envelope.data.items as { id: string }[]).some((item) => item.id === "web-source"),
  );
  assert.ok(
    (listed.envelope.data.items as { id: string }[]).some((item) => item.id === "web-source"),
  );
  const shown = await request("dependency?id=web-source");
  assert.ok(shown.envelope.data);
  assert.equal(
    (shown.envelope.data.dependency as { primarySelector: string }).primarySelector,
    "dep:web-source/source/ontology.ttl",
  );
  assert.equal(
    await readFile(join(root, ".tbspec/dependencies/web-source/source/ontology.ttl"), "utf8"),
    updated,
  );
  const lockedBytesBeforeRename = await readFile(
    join(root, ".tbspec/dependencies/web-source/source/ontology.ttl"),
  );
  const lockBeforeRename = await readFile(join(root, "tbspec.lock"));
  const renamePreview = await request("dependencies/rename", {
    from: "web-source",
    to: "web-renamed",
    operationId: "dependency-rename-preview-0001",
  });
  assert.equal(renamePreview.envelope.status, "preview", JSON.stringify(renamePreview.envelope));
  const renameStaged = renamePreview.envelope.data as {
    handle: string;
    preview: {
      operation: string;
      fingerprint: string;
      arguments: { selectors: Record<string, string> };
    };
  };
  assert.equal(renameStaged.preview.operation, "dependency.rename");
  assert.equal(
    renameStaged.preview.arguments.selectors["dep:web-source/source/ontology.ttl"],
    "dep:web-renamed/source/ontology.ttl",
  );
  assert.deepEqual(await readFile(join(root, "tbspec.lock")), lockBeforeRename);
  assert.deepEqual(
    await readFile(join(root, ".tbspec/dependencies/web-source/source/ontology.ttl")),
    lockedBytesBeforeRename,
  );
  const renameApplied = await request("dependencies/apply", {
    schemaVersion: 1,
    handle: renameStaged.handle,
    fingerprint: renameStaged.preview.fingerprint,
    accept: [],
  });
  assert.equal(renameApplied.envelope.status, "ok", JSON.stringify(renameApplied.envelope));
  assert.equal(renameApplied.envelope.data?.operation, "dependency.rename");
  assert.deepEqual(
    await readFile(join(root, ".tbspec/dependencies/web-renamed/source/ontology.ttl")),
    lockedBytesBeforeRename,
  );
  await assert.rejects(
    readFile(join(root, ".tbspec/dependencies/web-source/source/ontology.ttl")),
    { code: "ENOENT" },
  );
  const removePreview = await request("dependencies/remove", {
    id: "web-renamed",
    operationId: "dependency-remove-preview-0001",
  });
  assert.equal(removePreview.envelope.status, "preview", JSON.stringify(removePreview.envelope));
  const removeStaged = removePreview.envelope.data as {
    handle: string;
    preview: { fingerprint: string; impact: { acceptance: string[] } };
  };
  assert.ok(removeStaged.preview.impact.acceptance.includes("confirm"));
  const removeApplied = await request("dependencies/apply", {
    schemaVersion: 1,
    handle: removeStaged.handle,
    fingerprint: removeStaged.preview.fingerprint,
    accept: ["confirm"],
  });
  assert.equal(removeApplied.envelope.status, "ok", JSON.stringify(removeApplied.envelope));
  assert.equal(removeApplied.envelope.data?.removed, true);
  await assert.rejects(
    readFile(join(root, ".tbspec/dependencies/web-renamed/source/ontology.ttl")),
    { code: "ENOENT" },
  );
  const afterRemoval = await request("dependencies");
  assert.ok(afterRemoval.envelope.data);
  assert.ok(
    !(afterRemoval.envelope.data.items as { id: string }[]).some(
      (item) => item.id === "web-renamed",
    ),
  );
  const invalid = await request("dependencies/inspect", { source, unknown: true });
  assert.equal(invalid.envelope.status, "invalid_arguments");
  assert.equal(invalid.status, 400);
});

test("dependency acquisition cancellation leaves status responsive and aborts source reads", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-dependency-cancel-"));
  await initializeProject({ directory: root });
  let sourceRequested = () => {};
  const requested = new Promise<void>((resolve) => {
    sourceRequested = resolve;
  });
  const sourceServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/turtle" });
    response.flushHeaders();
    sourceRequested();
  });
  await new Promise<void>((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => sourceServer.close(() => resolve())));
  const address = sourceServer.address();
  assert.ok(address && typeof address !== "string");
  const locator = `http://127.0.0.1:${address.port}/ontology.ttl`;
  const server = await startWebServer(await realpath(root), 0);
  t.after(() => server.stop());
  const baseUrl = server.record.baseUrl;
  assert.ok(baseUrl);
  const link = await controlRequest(server.record, "opening-link", {});
  const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const exchanged = await fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
    method: "POST",
    headers: { Origin: new URL(baseUrl).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  const session = String(
    ((await exchanged.json()) as { data: { sessionToken: string } }).data.sessionToken,
  );
  const headers = {
    Authorization: `Bearer ${session}`,
    "X-Tbspec-Schema-Version": "1",
    Origin: new URL(baseUrl).origin,
  };
  const operationId = "cancel-acquisition-0001";
  const pending = fetch(new URL("api/project/v1/dependencies/inspect", baseUrl), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ source: locator, operationId }),
  }).then(async (response) => ({
    status: response.status,
    envelope: (await response.json()) as { status: string; diagnostics: { code: string }[] },
  }));
  await requested;
  const status = await fetch(new URL("api/project/v1/status", baseUrl), { headers });
  assert.equal(status.status, 200);
  const cancelled = await fetch(new URL("api/project/v1/dependencies/cancel", baseUrl), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ operationId }),
  });
  assert.equal(cancelled.status, 200);
  const result = await pending;
  assert.equal(result.envelope.status, "conflict");
  assert.ok(
    result.envelope.diagnostics.some((diagnostic) => diagnostic.code === "ACQUISITION_CANCELLED"),
  );
});

test("a failed stopping registration can be explicitly retried without disabling reads", {
  timeout: 30000,
}, async () => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-stop-retry-"));
  await initializeProject({ directory: root });
  const script = `
    import assert from "node:assert/strict";
    import fs from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import threads from "node:worker_threads";
    import { startWebServer } from ${JSON.stringify(new URL("../src/server.ts", import.meta.url).href)};
    import { controlRequest } from ${JSON.stringify(new URL("../src/web.ts", import.meta.url).href)};
    const Worker = threads.Worker;
    threads.Worker = class extends Worker {
      constructor(url, options) { super(url, { ...options, execArgv: [] }); }
    };
    syncBuiltinESMExports();
    const root = process.argv[1];
    const server = await startWebServer(root);
    const path = join(root, ".tbspec/runtime/web.json");
    const original = await fs.readFile(path, "utf8");
    const rename = fs.rename;
    let fail = true;
    fs.rename = async (from, to) => {
      if (to === path && fail) throw new Error("Transient registration write failure");
      return rename(from, to);
    };
    syncBuiltinESMExports();
    await assert.rejects(server.stop(), /Transient registration write failure/);
    assert.equal(server.record.state, "running");
    assert.equal((await controlRequest(server.record, "status")).state, "running");
    assert.equal(await fs.readFile(path, "utf8"), original);
    const link = await controlRequest(server.record, "opening-link", {});
    const bootstrap = new URL(link.openingLink).hash.slice("#tbspec-bootstrap=".length);
    const exchanged = await fetch(new URL("api/auth/v1/bootstrap", server.record.baseUrl), {
      method: "POST", headers: { Origin: new URL(server.record.baseUrl).origin, "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, bootstrap }),
    });
    const session = (await exchanged.json()).data.sessionToken;
    const response = await fetch(new URL("api/project/v1/config", server.record.baseUrl), {
      headers: { Authorization: "Bearer " + session, "X-Tbspec-Schema-Version": "1" },
    });
    assert.equal(response.status, 200);
    fail = false;
    const retry = server.stop();
    assert.equal(server.stop(), retry);
    await retry;
    await server.stopped;
    await assert.rejects(fs.readFile(path), { code: "ENOENT" });
  `;
  await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "--eval", script, await realpath(root)],
    {
      timeout: 25000,
      windowsHide: true,
    },
  );
});

test("runtime startup preserves shared read access outside its private directory", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-shared-read-"));
  await initializeProject({ directory: root });
  const paths = [root, join(root, ".tbspec"), join(root, ".tbspec/dependencies")];
  const shell = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const literals = paths.map((path) => `'${path.replaceAll("'", "''")}'`).join(",");
  if (process.platform === "win32") {
    await promisify(execFile)(
      shell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference='Stop'; foreach($pathValue in @(${literals})){ $aclValue=[IO.Directory]::GetAccessControl($pathValue); $sidValue=[Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $aclValue.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sidValue,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow')); [IO.Directory]::SetAccessControl($pathValue,$aclValue) }`,
      ],
      { windowsHide: true },
    );
  } else {
    for (const path of paths) await chmod(path, 0o755);
  }
  const permissions = async () => {
    if (process.platform !== "win32")
      return Promise.all(paths.map(async (path) => (await stat(path)).mode));
    const result = await promisify(execFile)(
      shell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference='Stop'; foreach($pathValue in @(${literals})){ [IO.Directory]::GetAccessControl($pathValue).Sddl }`,
      ],
      { windowsHide: true },
    );
    return result.stdout;
  };
  const before = await permissions();
  const server = await startWebServer(await realpath(root), 0);
  t.after(() => server.stop());
  assert.deepEqual(await permissions(), before);
  assert.equal((await controlRequest(server.record, "status")).state, "running");
  assert.equal((await webProject({ project: root, action: "status" })).status, "ok");
  await server.stop();
  assert.deepEqual(await permissions(), before);
});

test("a failed inspection worker recovers without restarting sessions or clearing retained locks", {
  timeout: 30000,
}, async () => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-worker-recovery-"));
  await initializeProject({ directory: root });
  const script = `
    import assert from "node:assert/strict";
    import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    import threads from "node:worker_threads";
    import { startWebServer } from ${JSON.stringify(new URL("../src/server.ts", import.meta.url).href)};
    import { controlRequest } from ${JSON.stringify(new URL("../src/web.ts", import.meta.url).href)};
    const OriginalWorker = threads.Worker;
    let injectedInspectionFailure = false;
    threads.Worker = class extends OriginalWorker {
      constructor(...args) {
        if (String(args[0]).includes("/inspection-worker.") && !injectedInspectionFailure) {
          injectedInspectionFailure = true;
          super('const { parentPort } = require("node:worker_threads"); parentPort.postMessage({ready: true}); parentPort.on("message", () => { throw new Error("Inspection failure"); });', { eval: true, execArgv: [] });
        } else super(args[0], { ...args[1], execArgv: [] });
      }
    };
    syncBuiltinESMExports();
    const root = process.argv[1];
    const server = await startWebServer(root);
    try {
      const registration = join(root, ".tbspec/runtime/web.json");
      const original = await readFile(registration, "utf8");
      const link = await controlRequest(server.record, "opening-link", {});
      const bootstrap = new URL(link.openingLink).hash.slice("#tbspec-bootstrap=".length);
      const exchanged = await fetch(new URL("api/auth/v1/bootstrap", server.record.baseUrl), {
        method: "POST",
        headers: { Origin: new URL(server.record.baseUrl).origin, "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: 1, bootstrap }),
      });
      const session = (await exchanged.json()).data.sessionToken;
      const headers = { Authorization: "Bearer " + session, "X-Tbspec-Schema-Version": "1" };
      const staging = join(root, ".tbspec/previews", server.record.instanceId, ${JSON.stringify("A".repeat(43))});
      await mkdir(staging, { recursive: true });
      await writeFile(join(staging, "staged-0"), "abandoned preview");
      const inspect = async () => (await fetch(new URL("api/project/v1/config", server.record.baseUrl), { headers })).json();
      assert.equal((await inspect()).status, "unavailable");
      assert.equal(injectedInspectionFailure, true);
      assert.equal((await controlRequest(server.record, "status")).state, "running");
      const lock = join(root, ".tbspec/operation.lock");
      await writeFile(lock, "retained ownership");
      const blocked = await inspect();
      assert.equal(blocked.status, "conflict", JSON.stringify(blocked));
      assert.equal(blocked.diagnostics[0].code, "RECOVERY_REQUIRED");
      assert.equal(await readFile(lock, "utf8"), "retained ownership");
      assert.equal(await readFile(join(staging, "staged-0"), "utf8"), "abandoned preview");
      await unlink(lock);
      const recovery = join(root, ".tbspec/transactions/pending");
      await mkdir(recovery, { recursive: true });
      await writeFile(join(recovery, "record.json"), "retained transaction");
      const pending = await inspect();
      assert.equal(pending.diagnostics[0].code, "RECOVERY_REQUIRED", JSON.stringify(pending));
      assert.equal(await readFile(join(recovery, "record.json"), "utf8"), "retained transaction");
      await unlink(join(recovery, "record.json"));
      await rmdir(recovery);
      const recovered = await inspect();
      assert.equal(recovered.status, "ok", JSON.stringify(recovered));
      await assert.rejects(readFile(join(staging, "staged-0")), { code: "ENOENT" });
      assert.equal(await readFile(registration, "utf8"), original);
    } finally { await server.stop(); }
  `;
  await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "--eval", script, await realpath(root)],
    {
      timeout: 25000,
      windowsHide: true,
    },
  );
});

test("shared writable runtime parents fail ownership without replacing registration", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-permissions-"));
  await initializeProject({ directory: root });
  const started = await webProject({ project: root, action: "start" });
  assert.equal(started.status, "ok", JSON.stringify(started));
  const path = join(root, ".tbspec/runtime/web.json");
  const original = await readFile(path, "utf8");
  const shared = async (enable: boolean, parent: string) => {
    if (process.platform !== "win32") return chmod(parent, enable ? 0o777 : 0o700);
    const literal = `'${parent.replaceAll("'", "''")}'`;
    const script = `$ErrorActionPreference='Stop'; $aclValue=[IO.Directory]::GetAccessControl(${literal}); $sidValue=[Security.Principal.SecurityIdentifier]::new('S-1-1-0'); $ruleValue=[Security.AccessControl.FileSystemAccessRule]::new($sidValue,'FullControl','Allow'); $aclValue.${enable ? "AddAccessRule" : "RemoveAccessRuleSpecific"}($ruleValue); [IO.Directory]::SetAccessControl(${literal},$aclValue);`;
    await promisify(execFile)(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
    );
  };
  const parents = [root, join(root, ".tbspec")];
  t.after(async () => {
    for (const parent of parents) await shared(false, parent);
    await webProject({ project: root, action: "stop" });
  });
  for (const parent of parents) {
    await shared(true, parent);
    for (const action of ["start", "status", "stop"] as const) {
      const result = await webProject({ project: root, action });
      assert.equal(result.status, "conflict", JSON.stringify(result));
      assert.equal(result.diagnostics[0]?.code, "RUNTIME_OWNERSHIP_UNKNOWN");
      assert.equal(await readFile(path, "utf8"), original);
    }
    await shared(false, parent);
  }
  assert.equal((await webProject({ project: root, action: "status" })).status, "ok");
});

test("web lifecycle verifies one detached instance and separates browser and control credentials", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-"));
  assert.equal((await initializeProject({ directory: root })).status, "ok");
  const stopped = await webProject({ project: root, action: "status" });
  assert.equal(stopped.data?.server.state, "stopped");
  const started = await webProject({ project: root, action: "start" });
  t.after(async () => {
    await webProject({ project: root, action: "stop" });
  });
  assert.equal(started.status, "ok", JSON.stringify(started));
  const server = started.data?.server;
  assert.ok(server?.baseUrl && server.openingLink);
  const baseUrl = server.baseUrl;
  assert.equal(server.verified, true);
  const again = await webProject({ project: root, action: "start" });
  assert.equal(again.data?.server.instanceId, server.instanceId);
  const registration = JSON.parse(await readFile(join(root, ".tbspec/runtime/web.json"), "utf8"));
  assert.ok(!JSON.stringify(started).includes(registration.controlToken));
  if (process.platform !== "win32")
    assert.equal((await stat(join(root, ".tbspec/runtime/web.json"))).mode & 0o777, 0o600);
  const api = new URL("api/project/v1/graphs", server.baseUrl);
  const publicResponse = await fetch(api);
  assert.equal(publicResponse.status, 401);
  assert.ok(!(await publicResponse.text()).includes(root));
  const nativeAsBrowser = await fetch(api, {
    headers: { Authorization: `Bearer ${registration.controlToken}` },
  });
  assert.equal(nativeAsBrowser.status, 401);
  const bootstrap = new URL(server.openingLink).hash.slice("#tbspec-bootstrap=".length);
  const exchange = () =>
    fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
      method: "POST",
      headers: { Origin: new URL(baseUrl).origin, "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, bootstrap }),
    });
  const response = await exchange();
  assert.equal(response.status, 200);
  const session = (await response.json()).data;
  assert.notEqual(session.sessionToken, registration.controlToken);
  assert.equal((await exchange()).status, 401);
  const headers = {
    Authorization: `Bearer ${session.sessionToken}`,
    "X-Tbspec-Schema-Version": "1",
  };
  assert.equal((await fetch(api, { headers })).status, 200);
  assert.equal(
    (await fetch(api, { headers: { ...headers, Origin: "https://attacker.example" } })).status,
    403,
  );
  const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = get(api, { headers: { ...headers, Host: "attacker.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
  });
  assert.equal(rebindingStatus, 403);
  assert.equal(
    (await fetch(new URL("api/control/v1/status", server.baseUrl), { headers })).status,
    401,
  );
  const stop = await webProject({ project: root, action: "stop" });
  assert.equal(stop.status, "ok", JSON.stringify(stop));
  assert.equal(stop.data?.server.state, "stopped");
  assert.equal((await webProject({ project: root, action: "stop" })).status, "ok");
});

test("bootstrap and tab expiries, origin checks and schema negotiation use the real HTTP boundary", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-expiry-"));
  await initializeProject({ directory: root });
  let now = Date.now();
  const server = await startWebServer(await realpath(root), 0, () => now);
  t.after(() => server.stop());
  const baseUrl = server.record.baseUrl;
  assert.ok(baseUrl);
  const link = await controlRequest(server.record, "opening-link", {});
  const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const exchange = (credential: string, origin?: string) =>
    fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify({ protocolVersion: 1, bootstrap: credential }),
    });
  assert.equal((await exchange(bootstrap)).status, 403);
  assert.equal((await exchange(bootstrap, "null")).status, 403);
  const duplicateFields = await fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: new URL(baseUrl).origin },
    body: '{"protocolVersion":1,"bootstrap":"first","bootstrap":"second"}',
  });
  assert.equal(duplicateFields.status, 400);
  now += 60000;
  assert.equal((await exchange(bootstrap, new URL(baseUrl).origin)).status, 401);
  const fresh = await controlRequest(server.record, "opening-link", {});
  const response = await exchange(
    new URL(String(fresh.openingLink)).hash.slice("#tbspec-bootstrap=".length),
    new URL(baseUrl).origin,
  );
  assert.equal(response.status, 200);
  const session = (await response.json()).data;
  assert.equal(Date.parse(session.expiresAt) - now, 12 * 60 * 60 * 1000);
  const api = new URL("api/project/v1/config", baseUrl);
  const headers = { Authorization: `Bearer ${session.sessionToken}` };
  assert.equal((await fetch(api, { headers })).status, 400);
  assert.equal(
    (await fetch(api, { headers: { ...headers, "X-Tbspec-Schema-Version": "1" } })).status,
    200,
  );
  now += 12 * 60 * 60 * 1000;
  assert.equal((await fetch(api, { headers })).status, 401);
  const publicAsset = await fetch(baseUrl);
  assert.equal(publicAsset.status, 200);
  assert.match(publicAsset.headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.equal(publicAsset.headers.get("Access-Control-Allow-Origin"), null);
  assert.ok(!(await publicAsset.text()).includes(root));
});

test("simultaneous starts converge, projects stay independent and runtime failures preserve records", {
  timeout: 90000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-concurrent-"));
  await initializeProject({ directory: root });
  t.after(async () => {
    await webProject({ project: root, action: "stop" });
  });
  const pair = await Promise.all([
    webProject({ project: root, action: "start" }),
    webProject({ project: root, action: "start" }),
  ]);
  for (const result of pair) assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(pair[0]?.data?.server.instanceId, pair[1]?.data?.server.instanceId);
  const port = Number(new URL(pair[0]?.data?.server.baseUrl ?? "").port);
  const conflict = await webProject({
    project: root,
    action: "start",
    port: port === 65535 ? 65534 : port + 1,
  });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.diagnostics[0]?.code, "WEB_PORT_CONFLICT");
  const other = await privateDirectory(join(tmpdir(), "tbspec-web-other-"));
  await initializeProject({ directory: other });
  t.after(async () => {
    await webProject({ project: other, action: "stop" });
  });
  const occupied = await webProject({ project: other, action: "start", port });
  assert.equal(occupied.status, "conflict", JSON.stringify(occupied));
  assert.equal(occupied.diagnostics[0]?.code, "WEB_PORT_CONFLICT");
  const independent = await webProject({ project: other, action: "start" });
  assert.equal(independent.status, "ok", JSON.stringify(independent));
  assert.notEqual(independent.data?.server.instanceId, pair[0]?.data?.server.instanceId);
  const path = join(root, ".tbspec/runtime/web.json");
  const original = await readFile(path, "utf8");
  const record = JSON.parse(original);
  for (const patch of [
    { controlProtocolVersion: 2 },
    { hostId: "os:v1:unknown" },
    { baseUrl: "http://127.0.0.1:1/" },
  ]) {
    const altered = JSON.stringify({ ...record, ...patch });
    await writeFile(path, altered);
    const result = await webProject({ project: root, action: "status" });
    assert.equal(
      result.status,
      "baseUrl" in patch ? "unavailable" : "conflict",
      JSON.stringify(result),
    );
    assert.equal(result.data?.server.verified, false);
    assert.equal(result.data?.server.baseUrl, null);
    assert.ok(!JSON.stringify(result).includes(record.controlToken));
    assert.equal(await readFile(path, "utf8"), altered);
  }
  await writeFile(path, original);
});

test("ended runtime ownership is cleaned only on start and restart invalidates credentials", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-ended-"));
  await initializeProject({ directory: root });
  t.after(async () => {
    await webProject({ project: root, action: "stop" });
  });
  const first = await webProject({ project: root, action: "start" });
  assert.equal(first.status, "ok", JSON.stringify(first));
  const recordPath = join(root, ".tbspec/runtime/web.json");
  const original = await readFile(recordPath, "utf8");
  const old = JSON.parse(original);
  assert.ok(first.data?.server.openingLink);
  const bootstrap = new URL(first.data.server.openingLink).hash.slice("#tbspec-bootstrap=".length);
  const exchanged = await fetch(new URL("api/auth/v1/bootstrap", old.baseUrl), {
    method: "POST",
    headers: { Origin: new URL(old.baseUrl).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  const session = (await exchanged.json()).data.sessionToken;
  process.kill(old.pid, "SIGKILL");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      process.kill(old.pid, 0);
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await webProject({ project: root, action: "status" })).status, "conflict");
  assert.equal((await webProject({ project: root, action: "stop" })).status, "conflict");
  assert.equal(await readFile(recordPath, "utf8"), original);
  const recovered = await Promise.all([
    webProject({ project: root, action: "start" }),
    webProject({ project: root, action: "start" }),
  ]);
  assert.ok(
    recovered.every((r) => r.status === "ok"),
    JSON.stringify(recovered),
  );
  assert.equal(recovered[0]?.data?.server.instanceId, recovered[1]?.data?.server.instanceId);
  const next = recovered[0];
  assert.ok(next);
  assert.equal(next.status, "ok", JSON.stringify(next));
  assert.notEqual(next.data?.server.instanceId, old.instanceId);
  const baseUrl = next.data?.server.baseUrl;
  assert.ok(baseUrl);
  const browser = await fetch(new URL("api/project/v1/config", baseUrl), {
    headers: { Authorization: `Bearer ${session}`, "X-Tbspec-Schema-Version": "1" },
  });
  assert.equal(browser.status, 401);
  const native = await fetch(new URL("api/control/v1/status", baseUrl), {
    headers: { Authorization: `Bearer ${old.controlToken}` },
  });
  assert.equal(native.status, 401);
});

test("authenticated control stays responsive while the bounded RDF worker is busy", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-worker-"));
  await initializeProject({ directory: root });
  await writeFile(
    join(root, "large.nt"),
    Array.from({ length: 80000 }, (_, i) => `<urn:s${i}> <urn:p> "value ${i}" .`).join("\n"),
  );
  const server = await startWebServer(await realpath(root), 0);
  t.after(() => server.stop());
  const baseUrl = server.record.baseUrl;
  assert.ok(baseUrl);
  const link = await controlRequest(server.record, "opening-link", {});
  const bootstrap = new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length);
  const response = await fetch(new URL("api/auth/v1/bootstrap", baseUrl), {
    method: "POST",
    headers: { Origin: new URL(baseUrl).origin, "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: 1, bootstrap }),
  });
  const session = (await response.json()).data.sessionToken;
  const headers = { Authorization: `Bearer ${session}`, "X-Tbspec-Schema-Version": "1" };
  let completed = false;
  const inspection = fetch(new URL("api/project/v1/graphs", baseUrl), { headers }).then(
    async (r) => {
      const envelope = await r.json();
      completed = true;
      return envelope;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const concurrent = await fetch(new URL("api/project/v1/config", baseUrl), { headers });
  assert.equal(concurrent.status, 409);
  assert.equal((await concurrent.json()).diagnostics[0].code, "PROJECT_BUSY");
  assert.equal((await controlRequest(server.record, "status")).state, "running");
  assert.equal(completed, false);
  const result = await inspection;
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.equal(result.data.items[0].selector, "large.nt");
  const stringify = JSON.stringify;
  const serialization = t.mock.method(JSON, "stringify", (value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      "data" in value &&
      value.data &&
      typeof value.data === "object" &&
      "triples" in value.data
    )
      throw new Error("RDF response serialization reached the control listener.");
    return stringify(value);
  });
  const shown = await fetch(new URL("api/project/v1/graph?selector=large.nt", baseUrl), {
    headers,
  });
  const graph = await shown.json();
  serialization.mock.restore();
  assert.equal(shown.status, 200, JSON.stringify(graph));
  assert.equal(graph.data.triples.length, 80000);
});
