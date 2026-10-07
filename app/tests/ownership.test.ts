import assert from "node:assert/strict";
import { fork, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acquireLock, releaseLock } from "../src/lock.ts";
import { capture, preparePlan, publishPlan } from "../src/transactions.ts";

const holder = fileURLToPath(new URL("fixtures/lock-holder.ts", import.meta.url));
const interrupted = fileURLToPath(new URL("fixtures/transaction-holder.ts", import.meta.url));
async function root() {
  return fs.mkdtemp(join(tmpdir(), "tbspec-ownership-"));
}
test("unavailable process identity fails before creating coordination files and preserves existing evidence", async () => {
  const lockModule = new URL("../src/lock.ts", import.meta.url).href;
  const script = `
    Object.defineProperty(process, "platform", { value: "unsupported-test-platform" });
    const { acquireLock } = await import(${JSON.stringify(lockModule)});
    try {
      await acquireLock(process.argv[1]);
      process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ status: error.status, message: error.message }));
    }
  `;
  for (const existing of [false, true]) {
    const project = await root();
    const directory = join(project, ".tbspec");
    const filename = join(directory, "operation.lock");
    const partial = '{"recordVersion":1,';
    if (existing) {
      await fs.mkdir(directory);
      await fs.writeFile(filename, partial);
    }
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, project], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, "unavailable");
    if (existing) assert.equal(await fs.readFile(filename, "utf8"), partial);
    else await assert.rejects(fs.access(directory), { code: "ENOENT" });
    assert.match(result.message, /identity.*unavailable/i);
    assert.doesNotMatch(result.message, /clearing|manual recovery/i);
  }
});

test("process interruption retains before-images and blocks normal operations without replay", async () => {
  const project = await root();
  await fs.writeFile(join(project, "a.ttl"), "original A");
  await fs.writeFile(join(project, "b.ttl"), "original B");
  const child = fork(interrupted, [project], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const [state] = await once(child, "message");
  assert.equal(state, "applied");
  const exited = once(child, "exit");
  child.kill();
  await exited;
  const transactionNames = await fs.readdir(join(project, ".tbspec", "transactions"));
  assert.equal(transactionNames.length, 1);
  const workspace = join(project, ".tbspec", "transactions", transactionNames[0] ?? "");
  assert.equal(await fs.readFile(join(workspace, "original-0"), "utf8"), "original A");
  assert.equal(await fs.readFile(join(workspace, "original-1"), "utf8"), "original B");
  assert.equal(
    JSON.parse(await fs.readFile(join(workspace, "record.json"), "utf8")).state,
    "publishing",
  );
  await assert.rejects(capture(project, ["a.ttl"]), /unknown or abandoned/);
  assert.equal(await fs.readFile(join(project, "a.ttl"), "utf8"), "published A");
  assert.equal(await fs.readFile(join(project, "b.ttl"), "utf8"), "original B");
});
test("independent processes fail immediately on verified contention and initializing records stay untouched", async () => {
  for (const mode of ["full", "partial"]) {
    const project = await root();
    const independent = await root();
    const child = fork(holder, [project, mode], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    try {
      const [state] = await once(child, "message");
      assert.equal(state, mode === "full" ? "owned" : "partial");
      const before = await fs.readFile(join(project, ".tbspec", "operation.lock"));
      if (mode === "full") {
        await assert.rejects(
          releaseLock(project, JSON.parse(before.toString())),
          /ownership changed/,
        );
        assert.deepEqual(await fs.readFile(join(project, ".tbspec", "operation.lock")), before);
      }
      const start = Date.now();
      await assert.rejects(
        capture(project, ["tbspec.toml"]),
        mode === "full" ? /Another operation/ : /ownership is unknown/,
      );
      assert.ok(Date.now() - start < 8000, "Contention must not wait for the holder.");
      assert.deepEqual(await fs.readFile(join(project, ".tbspec", "operation.lock")), before);
      await capture(independent, ["tbspec.toml"]);
      if (mode === "partial") {
        child.send("finish record");
        const [owned] = await once(child, "message");
        assert.equal(owned, "owned");
      }
      const exited = once(child, "exit");
      child.send("release");
      await exited;
      await capture(project, ["tbspec.toml"]);
    } finally {
      child.kill();
    }
  }
});
test("terminated owners, changed tokens, PID reuse and unknown providers never authorize clearing", async () => {
  const project = await root();
  const child = fork(holder, [project, "full"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  await once(child, "message");
  const exited = once(child, "exit");
  child.kill();
  await exited;
  const filename = join(project, ".tbspec", "operation.lock");
  const original = await fs.readFile(filename);
  await assert.rejects(capture(project, ["a.ttl"]), /unknown or abandoned/);
  assert.deepEqual(await fs.readFile(filename), original);
  await fs.unlink(filename);
  const owner = await acquireLock(project);
  for (const patch of [
    { acquisitionId: "different" },
    { processStartId: "os:v1:dW5rbm93bg" },
    { hostId: "os:v1:dW5rbm93bg" },
  ]) {
    await fs.writeFile(filename, JSON.stringify({ ...owner, ...patch }));
    await assert.rejects(releaseLock(project, owner), /ownership changed/);
    await assert.rejects(capture(project, ["a.ttl"]));
  }
  await fs.writeFile(filename, JSON.stringify(owner));
  await releaseLock(project, owner);
});
test("ownership write/close failures abort before staging and only full token-owned records are released", async () => {
  for (const mode of ["write", "close"]) {
    const project = await root();
    const adapter = new Proxy(fs, {
      get(target, key) {
        if (key !== "open") return Reflect.get(target, key);
        return async (...args: Parameters<typeof fs.open>) => {
          const handle = await fs.open(...args);
          let failed = false;
          return new Proxy(handle, {
            get(current, member) {
              if (mode === "write" && member === "writeFile")
                return async () => {
                  await handle.writeFile('{"recordVersion":1,');
                  throw new Error("ownership write failed");
                };
              if (mode === "close" && member === "close")
                return async () => {
                  await handle.close();
                  if (!failed) {
                    failed = true;
                    throw new Error("ownership close failed");
                  }
                };
              const value = Reflect.get(current, member);
              return typeof value === "function" ? value.bind(current) : value;
            },
          });
        };
      },
    });
    await assert.rejects(
      capture(project, ["a.ttl"], [], adapter),
      /Ownership record could not be completed/,
    );
    await assert.rejects(fs.access(join(project, ".tbspec", "transactions")));
    await assert.rejects(fs.access(join(project, "a.ttl")));
    if (mode === "write") {
      assert.equal(
        await fs.readFile(join(project, ".tbspec", "operation.lock"), "utf8"),
        '{"recordVersion":1,',
      );
      await assert.rejects(capture(project, ["a.ttl"]), /unknown/);
    } else await capture(project, ["a.ttl"]);
  }
});
test("a real Windows sharing error during publication restores earlier files", {
  skip: process.platform !== "win32",
}, async () => {
  const project = await root();
  const a = join(project, "a.ttl");
  const b = join(project, "b.ttl");
  await fs.writeFile(a, "before A");
  await fs.writeFile(b, "before B");
  const plan = preparePlan(await capture(project, ["a.ttl", "b.ttl"]), "coupled.save", [
    { file: "a.ttl", bytes: Buffer.from("after A") },
    { file: "b.ttl", bytes: Buffer.from("after B") },
  ]);
  // Hold the second live file at the actual OS boundary only after its before-image has been copied.
  let child: ReturnType<typeof spawn> | undefined;
  const adapter = new Proxy(fs, {
    get(target, key) {
      if (key !== "rename") return Reflect.get(target, key);
      return async (...args: Parameters<typeof fs.rename>) => {
        if (String(args[1]) === a && String(args[0]).includes("staged-")) {
          const result = await fs.rename(...args);
          child = spawn(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-File",
              fileURLToPath(new URL("fixtures/hold-file.ps1", import.meta.url)),
              "-Path",
              b,
            ],
            { stdio: ["pipe", "pipe", "pipe"] },
          );
          assert.ok(child.stdout);
          const [output] = await once(child.stdout, "data");
          assert.match(String(output), /holding/);
          return result;
        }
        return fs.rename(...args);
      };
    },
  });
  try {
    await assert.rejects(publishPlan(project, plan, adapter));
    assert.equal(await fs.readFile(a, "utf8"), "before A");
  } finally {
    if (child) {
      const exited = once(child, "exit");
      child.stdin?.end("release\n");
      await exited;
    }
  }
  assert.equal(await fs.readFile(b, "utf8"), "before B");
  await capture(project, ["a.ttl"]);
});
