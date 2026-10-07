import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FileSystem } from "../src/filesystem.ts";
import { failure } from "../src/output.ts";
import { inspectRecovery, projectDiscoveryScope } from "../src/project.ts";
import { capture, preparePlan, publishPlan } from "../src/transactions.ts";

async function project() {
  const root = await fs.mkdtemp(join(tmpdir(), "tbspec-transaction-"));
  await fs.writeFile(join(root, "a.ttl"), "original A\r\n");
  await fs.writeFile(join(root, "b.ttl"), "original B\n");
  await fs.writeFile(join(root, "c.ttl"), "original C");
  return root;
}
function fault(
  method: keyof FileSystem,
  replace: (...args: unknown[]) => Promise<unknown>,
): FileSystem {
  return new Proxy(fs, {
    get(target, key) {
      return key === method ? replace : Reflect.get(target, key);
    },
  });
}
test("incomplete ownership and contradictory completed journals are reported and block capture", async () => {
  const root = await project();
  await fs.mkdir(join(root, ".tbspec"));
  const lock = join(root, ".tbspec", "operation.lock");
  await fs.writeFile(lock, "{}");
  const report = await inspectRecovery(root);
  assert.equal(report.data?.ownershipIncomplete, true);
  await fs.unlink(lock);
  const transactionId = randomBytes(32).toString("base64url");
  const workspace = join(root, ".tbspec", "transactions", transactionId);
  await fs.mkdir(workspace, { recursive: true });
  await fs.writeFile(
    join(workspace, "record.json"),
    JSON.stringify({
      recordVersion: 1,
      transactionId,
      acquisitionId: randomBytes(32).toString("base64url"),
      state: "complete",
      changes: [
        {
          action: "create",
          file: "a.ttl",
          before: { state: "present", digest: `sha256:${"0".repeat(64)}` },
          after: { state: "present", digest: `sha256:${"0".repeat(64)}` },
          originalPath: "original-0",
          stagedPath: "staged-0",
          destinationBefore: null,
          progress: "applied",
        },
      ],
    }),
  );
  const transactions = (await inspectRecovery(root)).data?.transactions;
  assert.ok(Array.isArray(transactions));
  assert.equal(transactions[0]?.incomplete, true);
  await assert.rejects(capture(root, ["a.ttl"]), /Pending transaction/);
});
test("publication failure and failed lock release retain both diagnostics and exit precedence", async () => {
  const root = await project();
  const plan = preparePlan(await capture(root, ["a.ttl"]), "save", [
    { file: "a.ttl", bytes: Buffer.from("new") },
  ]);
  await fs.appendFile(join(root, "a.ttl"), "outside edit");
  const adapter = fault("unlink", async (...args) => {
    if (String(args[0]).endsWith("operation.lock")) throw new Error("release unavailable");
    return fs.unlink(String(args[0]));
  });
  try {
    await publishPlan(root, plan, adapter);
    assert.fail("Publication must fail");
  } catch (error) {
    const result = failure(error);
    assert.equal(result.status, "unavailable");
    assert.ok(result.diagnostics.some((entry) => entry.code === "REVISION_CONFLICT"));
    assert.ok(result.diagnostics.some((entry) => entry.message === "release unavailable"));
  }
});
test("stale comments and newly discovered resources invalidate a reviewed plan", async () => {
  const root = await project();
  const captured = await capture(root, ["a.ttl"], [projectDiscoveryScope]);
  const plan = preparePlan(captured, "source.save", [
    { file: "a.ttl", bytes: Buffer.from("proposed") },
  ]);
  await fs.writeFile(join(root, "new-view.ttl"), "new reference");
  await assert.rejects(publishPlan(root, plan), /changed since capture/);
  assert.equal(await fs.readFile(join(root, "a.ttl"), "utf8"), "original A\r\n");
  await fs.unlink(join(root, "new-view.ttl"));
  await fs.appendFile(join(root, "a.ttl"), "# comment-only change");
  await assert.rejects(publishPlan(root, plan), /changed since capture/);
});
test("staging failure publishes nothing and normal failure restores replace, delete, move and lock bytes", async () => {
  const root = await project();
  await fs.writeFile(join(root, "tbspec.lock"), "old lock");
  const snap = await capture(root, [
    "a.ttl",
    "b.ttl",
    "c.ttl",
    "moved.ttl",
    "tbspec.lock",
    "last.ttl",
  ]);
  const plan = preparePlan(snap, "coupled.write", [
    { file: "a.ttl", bytes: Buffer.from("new A") },
    { file: "b.ttl", bytes: null },
    { file: "c.ttl", to: "moved.ttl", bytes: Buffer.from("new C") },
    { file: "tbspec.lock", bytes: Buffer.from("new lock") },
    { file: "last.ttl", bytes: Buffer.from("last") },
  ]);
  const failStaging = fault("copyFile", async () => {
    throw Object.assign(new Error("staging I/O failure"), { code: "EIO" });
  });
  await assert.rejects(publishPlan(root, plan, failStaging), /staging I\/O failure/);
  const failPublication = fault("link", async (...args) => {
    if (String(args[1]).endsWith("last.ttl"))
      throw Object.assign(new Error("publication I/O failure"), { code: "EIO" });
    return Reflect.apply(fs.link, fs, args);
  });
  await assert.rejects(publishPlan(root, plan, failPublication), /publication I\/O failure/);
  assert.equal(await fs.readFile(join(root, "a.ttl"), "utf8"), "original A\r\n");
  assert.equal(await fs.readFile(join(root, "b.ttl"), "utf8"), "original B\n");
  assert.equal(await fs.readFile(join(root, "c.ttl"), "utf8"), "original C");
  assert.equal(await fs.readFile(join(root, "tbspec.lock"), "utf8"), "old lock");
  await assert.rejects(fs.access(join(root, "moved.ttl")));
  await assert.rejects(fs.access(join(root, "last.ttl")));
  await capture(root, ["a.ttl"]);
});
test("intervening external edits survive rollback and retained evidence blocks operations", async () => {
  const root = await project();
  const snapshot = await capture(root, ["a.ttl", "new.ttl"]);
  const plan = preparePlan(snapshot, "coupled.write", [
    { file: "a.ttl", bytes: Buffer.from("proposed A") },
    { file: "new.ttl", bytes: Buffer.from("new") },
  ]);
  const fail = fault("link", async (...args) => {
    if (String(args[1]).endsWith("new.ttl")) {
      await fs.writeFile(join(root, "a.ttl"), "external editor");
      throw new Error("publication failed");
    }
    return Reflect.apply(fs.link, fs, args);
  });
  await assert.rejects(publishPlan(root, plan, fail), /rollback was incomplete/);
  assert.equal(await fs.readFile(join(root, "a.ttl"), "utf8"), "external editor");
  await assert.rejects(capture(root, ["a.ttl"]), /Pending transaction/);
  const evidence = await inspectRecovery(root);
  assert.equal(evidence.status, "ok");
  assert.ok(evidence.data);
  assert.equal((evidence.data.transactions as unknown[]).length, 1);
});
test("completed cleanup failure remains successful and does not block a subsequent capture", async () => {
  const root = await project();
  const plan = preparePlan(await capture(root, ["a.ttl"]), "source.save", [
    { file: "a.ttl", bytes: Buffer.from("completed") },
  ]);
  const fail = fault("unlink", async (...args) => {
    if (String(args[0]).endsWith("original-0")) throw new Error("cleanup unavailable");
    return Reflect.apply(fs.unlink, fs, args);
  });
  const diagnostics = await publishPlan(root, plan, fail);
  assert.equal(diagnostics[0]?.code, "CLEANUP_RETAINED");
  assert.equal(diagnostics[0]?.severity, "warning");
  assert.equal(await fs.readFile(join(root, "a.ttl"), "utf8"), "completed");
  await capture(root, ["a.ttl"]);
});
test("failed lock release after completed publication is success with retained-ownership warning", async () => {
  const root = await project();
  const plan = preparePlan(await capture(root, ["a.ttl"]), "source.save", [
    { file: "a.ttl", bytes: Buffer.from("completed") },
  ]);
  const failedRelease = fault("unlink", async (...args) => {
    if (String(args[0]).endsWith("operation.lock")) throw new Error("lock release unavailable");
    return Reflect.apply(fs.unlink, fs, args);
  });
  const diagnostics = await publishPlan(root, plan, failedRelease);
  assert.equal(diagnostics[0]?.code, "CLEANUP_RETAINED");
  assert.equal(diagnostics[0]?.file, ".tbspec/operation.lock");
  assert.equal(await fs.readFile(join(root, "a.ttl"), "utf8"), "completed");
  await assert.rejects(capture(root, ["a.ttl"]), /Another operation/);
});
test("destination absence, prepared byte signatures and repeated reconciliation stay bound", async () => {
  const root = await project();
  const snap = await capture(root, ["new.ttl"]);
  const plan = preparePlan(snap, "source.create", [
    { file: "new.ttl", bytes: Buffer.from("reviewed") },
  ]);
  await fs.writeFile(join(root, "new.ttl"), "outside creator");
  await assert.rejects(publishPlan(root, plan), /changed since capture/);
  const second = preparePlan(await capture(root, ["new.ttl"]), "source.save", [
    { file: "new.ttl", bytes: Buffer.from("reconciled") },
  ]);
  await fs.appendFile(join(root, "new.ttl"), " second edit");
  await assert.rejects(publishPlan(root, second), /changed since capture/);
  const third = preparePlan(await capture(root, ["new.ttl"]), "source.save", [
    { file: "new.ttl", bytes: Buffer.from("reviewed") },
  ]);
  third.writes[0]?.bytes?.fill(0);
  await assert.rejects(publishPlan(root, third), /bytes or paths changed/);
});
