import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { release } from "node:os";
import test from "node:test";
import * as ownership from "../src/ownership.ts";

const host = '"IOPlatformUUID" = "6C35B22D-367D-4F39-9D4C-189212846AC2"';
function timeval(seconds: bigint, micros: number) {
  const bytes = Buffer.alloc(16, 0xab);
  bytes.writeBigInt64LE(seconds, 0);
  bytes.writeInt32LE(micros, 8);
  return bytes;
}
function record(pid: number, micros = 123456) {
  const bytes = Buffer.alloc(648);
  timeval(1780000000n, micros).copy(bytes);
  bytes.writeInt8(3, 36);
  bytes.writeInt32LE(pid, 40);
  return bytes;
}
const adapter = ownership;
function value(wire: string) {
  return JSON.parse(Buffer.from(wire.slice(6), "base64url").toString("utf8"));
}

test("macOS identity keeps microseconds and ignores timeval padding", () => {
  assert.equal(typeof adapter.parseMacOSIdentity, "function", "macOS identity adapter must exist");
  const boot = timeval(1770000000n, 654321);
  const first = adapter.parseMacOSIdentity(host, boot, record(42), 42);
  const second = adapter.parseMacOSIdentity(host, boot, record(42, 123457), 42);
  assert.equal(first.pid, 42);
  assert.deepEqual(value(first.hostId), {
    provider: "macos-platform-uuid",
    value: "6C35B22D-367D-4F39-9D4C-189212846AC2",
  });
  assert.deepEqual(value(first.bootId), {
    provider: "macos-kernel-boot-time",
    value: "1770000000:654321",
  });
  assert.deepEqual(value(first.processStartId), {
    provider: "macos-kinfo-proc64-start-time",
    value: "1780000000:123456",
  });
  assert.notEqual(first.processStartId, second.processStartId);
});

test("macOS identity rejects missing, malformed, mismatched and nonlive process observations", () => {
  assert.equal(typeof adapter.parseMacOSIdentity, "function", "macOS identity adapter must exist");
  const boot = timeval(1770000000n, 0);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(647), Buffer.alloc(649), record(43)])
    assert.throws(() => adapter.parseMacOSIdentity(host, boot, bytes, 42));
  for (const state of [0, 1, 5, 127]) {
    const bytes = record(42);
    bytes.writeInt8(state, 36);
    assert.throws(() => adapter.parseMacOSIdentity(host, boot, bytes, 42));
  }
  for (const micros of [-1, 1000000]) {
    assert.throws(() => adapter.parseMacOSIdentity(host, boot, record(42, micros), 42));
    assert.throws(() =>
      adapter.parseMacOSIdentity(host, timeval(1770000000n, micros), record(42), 42),
    );
  }
  for (const seconds of [0n, -1n, 9007199254740992n]) {
    const bytes = record(42);
    bytes.writeBigInt64LE(seconds);
    assert.throws(() => adapter.parseMacOSIdentity(host, boot, bytes, 42));
  }
  for (const badHost of ["", '"IOPlatformUUID" = "bad"', `${host}\n${host}`])
    assert.throws(() => adapter.parseMacOSIdentity(badHost, boot, record(42), 42));
  for (const badBoot of [Buffer.alloc(0), Buffer.alloc(15), Buffer.alloc(17)])
    assert.throws(() => adapter.parseMacOSIdentity(host, badBoot, record(42), 42));
});

test("native macOS verifies independent processes and rejects a terminated owner", {
  skip: process.platform !== "darwin",
}, async (context) => {
  const self = await ownership.processIdentity();
  assert.equal(await ownership.verifyIdentity(self), true);
  const bytes = await ownership.readMacOSProcessRecord(process.pid);
  const boot = execFileSync("/usr/sbin/sysctl", ["-b", "kern.boottime"]);
  context.diagnostic(
    `Darwin ${release()} ${process.arch}: kinfo_proc=${bytes.length}, timeval=${boot.length}`,
  );
  const child = spawn(
    process.execPath,
    ["-e", 'console.log("ready"); setInterval(() => {}, 1000)'],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: "" },
    },
  );
  try {
    assert.ok(child.stdout);
    await once(child.stdout, "data");
    assert.ok(child.pid);
    const identity = await ownership.processIdentity(child.pid);
    assert.equal(identity.hostId, self.hostId);
    assert.equal(identity.bootId, self.bootId);
    assert.equal(await ownership.verifyIdentity(identity), true);
    const ended = once(child, "exit");
    child.kill();
    await ended;
    assert.equal(await ownership.verifyIdentity(identity), false);
  } finally {
    child.kill();
  }
});
