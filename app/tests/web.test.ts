import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { initializeProject } from "../src/project.ts";
import { startWebServer } from "../src/server.ts";
import { controlRequest, webProject } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

test("shared writable project roots fail runtime ownership without replacing registration", {
  timeout: 30000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-web-permissions-"));
  await initializeProject({ directory: root });
  const started = await webProject({ project: root, action: "start" });
  assert.equal(started.status, "ok", JSON.stringify(started));
  const path = join(root, ".tbspec/runtime/web.json");
  const original = await readFile(path, "utf8");
  const shared = async (enable: boolean) => {
    if (process.platform !== "win32") return chmod(root, enable ? 0o777 : 0o700);
    const literal = `'${root.replaceAll("'", "''")}'`;
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
  t.after(async () => {
    await shared(false);
    await webProject({ project: root, action: "stop" });
  });
  await shared(true);
  for (const action of ["start", "status", "stop"] as const) {
    const result = await webProject({ project: root, action });
    assert.equal(result.status, "conflict", JSON.stringify(result));
    assert.equal(result.diagnostics[0]?.code, "RUNTIME_OWNERSHIP_UNKNOWN");
    assert.equal(await readFile(path, "utf8"), original);
  }
  await shared(false);
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
  process.kill(old.pid);
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
});
