import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

test("authenticated editors stage exact source, enforce session ownership and retain conflict drafts", {
  timeout: 60000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tb-edit-http-"));
  await initializeProject({ directory: root });
  await writeFile(join(root, "edit.ttl"), '<urn:s> <urn:p> "original" .');
  const server = await startWebServer(await realpath(root));
  t.after(() => server.stop());
  const base = server.record.baseUrl ?? "";
  async function session() {
    const link = await controlRequest(server.record, "opening-link", {});
    const response = await fetch(new URL("api/auth/v1/bootstrap", base), {
      method: "POST",
      headers: { Origin: new URL(base).origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 1,
        bootstrap: new URL(String(link.openingLink)).hash.slice("#tbspec-bootstrap=".length),
      }),
    });
    return (await response.json()).data.sessionToken as string;
  }
  const token = await session();
  const other = await session();
  async function call(
    route: string,
    body?: Record<string, unknown>,
    bearer = token,
    origin = new URL(base).origin,
  ) {
    const response = await fetch(new URL(`api/project/v1/${route}`, base), {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "X-Tbspec-Schema-Version": "1",
        Origin: origin,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, result: await response.json() };
  }
  const shown = await call("editor?selector=edit.ttl");
  assert.equal(shown.status, 200);
  const revision = shown.result.data.resource.revision;
  const text = `# ${"large source comment ".repeat(1100)}\n<urn:s> <urn:p> "<img src=x onerror=alert(1)>" .\n`;
  assert.equal(
    (
      await call(
        "editor/save",
        { selector: "edit.ttl", revision, sourceText: text },
        token,
        "https://attacker.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("editor/save", {
        selector: "edit.ttl",
        revision,
        sourceText: text,
        project: tmpdir(),
      })
    ).status,
    400,
  );
  const preview = await call("editor/save", { selector: "edit.ttl", revision, sourceText: text });
  assert.equal(preview.result.status, "preview", JSON.stringify(preview));
  assert.equal(await readFile(join(root, "edit.ttl"), "utf8"), '<urn:s> <urn:p> "original" .');
  const apply = {
    schemaVersion: 1,
    handle: preview.result.data.handle,
    fingerprint: preview.result.data.preview.fingerprint,
    accept: [],
  };
  assert.equal((await call("resource/apply", apply, other)).status, 409);
  assert.equal((await call("resource/apply", apply)).status, 200);
  assert.equal((await call("resource/apply", apply)).status, 409);
  assert.equal(await readFile(join(root, "edit.ttl"), "utf8"), text);
  const stale = await call("editor/save", {
    selector: "edit.ttl",
    revision,
    sourceText: "draft retained by caller",
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.result.diagnostics[0].code, "REVISION_CONFLICT");
  const locked = await call("editor?selector=dep:tbspec-state-machine");
  const lockedBytes = locked.result.data.sourceText;
  const readonly = await call("editor/save", {
    selector: "dep:tbspec-state-machine",
    revision: locked.result.data.resource.revision,
    sourceText: "forbidden",
  });
  assert.equal(readonly.status, 400);
  assert.equal(readonly.result.diagnostics[0].code, "READ_ONLY");
  assert.equal(
    (await call("editor?selector=dep:tbspec-state-machine")).result.data.sourceText,
    lockedBytes,
  );
});
