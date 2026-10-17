import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { initializeProject } from "../src/project.ts";
import { readRuntime } from "../src/runtime.ts";
import { webProject } from "../src/web.ts";
import { privateDirectory } from "./private-directory.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
function launch(root: string, args: string[]) {
  const child = spawn(process.execPath, [cli, "--project", root, ...args], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PATH: "" },
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (bytes) => {
    stdout += String(bytes);
  });
  child.stderr.on("data", (bytes) => {
    stderr += String(bytes);
  });
  const exited = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve({ code, stdout, stderr }));
    },
  );
  return { child, exited, output: () => stdout };
}
async function outputContains(client: ReturnType<typeof launch>, text: string) {
  const deadline = Date.now() + 20000;
  while (!client.output().includes(text) && Date.now() < deadline) await delay(50);
  assert.ok(client.output().includes(text), client.output());
}
test("JSON startup is one envelope; non-TTY consoles survive EOF and independent detach/stop", {
  timeout: 90000,
}, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-console-"));
  await initializeProject({ directory: root });
  t.after(async () => {
    await webProject({ project: root, action: "stop" });
  });
  const json = await launch(root, ["web", "--json"]).exited;
  assert.equal(json.code, 0, json.stderr);
  assert.equal(json.stdout.trim().split("\n").length, 1);
  const started = JSON.parse(json.stdout);
  assert.equal(started.data.server.state, "running");
  const instance = started.data.server.instanceId;
  const first = launch(root, ["web"]);
  const second = launch(root, ["web"]);
  await outputContains(first, "Server running.");
  await outputContains(second, "Server running.");
  first.child.stdin.end();
  assert.equal((await first.exited).code, 0);
  assert.equal(
    (await webProject({ project: root, action: "status" })).data?.server.instanceId,
    instance,
  );
  assert.equal(second.child.exitCode, null);
  const registration = await readRuntime(started.data.server.projectRoot);
  assert.ok(registration?.baseUrl);
  const detached = await fetch(new URL("api/control/v1/console", registration.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${registration.controlToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      protocolVersion: 1,
      instanceId: instance,
      sequence: 1,
      type: "detach",
      data: {},
    }),
  });
  assert.equal(detached.status, 200);
  assert.equal(second.child.exitCode, null);
  const stopped = await launch(root, ["web", "stop", "--json"]).exited;
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.equal(JSON.parse(stopped.stdout).data.server.state, "stopped");
  assert.equal((await second.exited).code, 0);
  assert.equal(
    (await webProject({ project: root, action: "status" })).data?.server.state,
    "stopped",
  );
});

test("a lost console process does not stop the detached server", { timeout: 60000 }, async (t) => {
  const root = await privateDirectory(join(tmpdir(), "tbspec-console-loss-"));
  await initializeProject({ directory: root });
  t.after(async () => {
    await webProject({ project: root, action: "stop" });
  });
  const attached = launch(root, ["web"]);
  await outputContains(attached, "Server running.");
  attached.child.kill();
  await attached.exited;
  assert.equal(
    (await webProject({ project: root, action: "status" })).data?.server.state,
    "running",
  );
});
