import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { capture, preparePlan, publishPlan } from "../src/transactions.ts";

test("owned operations reject traversal, drive/UNC, streams, device names and case-equivalent destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-paths-"));
  for (const path of [
    "../outside.ttl",
    "a/../outside.ttl",
    "/absolute.ttl",
    "C:\\drive.ttl",
    "\\\\server\\share\\x.ttl",
    "a.ttl:stream",
    "NUL.ttl",
    "COM1",
    "file. ",
    "a//b",
    "a/./b",
    "a\u0000b",
  ])
    await assert.rejects(capture(root, [path]));
  await writeFile(join(root, "Existing.ttl"), "preserved");
  await assert.rejects(capture(root, ["existing.ttl"]), /equivalent path collision/);
  const snapshot = await capture(root, ["new.ttl", "New.ttl"]);
  assert.throws(
    () =>
      preparePlan(snapshot, "create", [
        { file: "new.ttl", bytes: Buffer.from("one") },
        { file: "New.ttl", bytes: Buffer.from("two") },
      ]),
    /aliased publication target/,
  );
  assert.equal(await readFile(join(root, "Existing.ttl"), "utf8"), "preserved");
});
test("internal junctions and multiply linked writable files cannot redirect or alias a publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "tbspec-links-"));
  const outside = await mkdtemp(join(tmpdir(), "tbspec-outside-"));
  await symlink(outside, join(root, "redirect"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(capture(root, ["redirect/new.ttl"]), /Links or special files/);
  await writeFile(join(root, "file.ttl"), "shared original");
  await link(join(root, "file.ttl"), join(outside, "alias.ttl"));
  const plan = preparePlan(await capture(root, ["file.ttl"]), "source.save", [
    { file: "file.ttl", bytes: Buffer.from("replacement") },
  ]);
  await assert.rejects(publishPlan(root, plan), /Links or special files/);
  assert.equal(await readFile(join(outside, "alias.ttl"), "utf8"), "shared original");
});
test("selected root junctions canonicalize to one project and publish independently from other projects", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tbspec-root-link-"));
  const root = join(parent, "root");
  await mkdir(root);
  const alias = join(parent, "alias");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  const snapshot = await capture(alias, ["new.ttl"]);
  assert.equal(snapshot.projectRoot, root);
  const plan = preparePlan(snapshot, "source.save", [
    { file: "new.ttl", bytes: Buffer.from("published through canonical root") },
  ]);
  await publishPlan(alias, plan);
  assert.equal(await readFile(join(root, "new.ttl"), "utf8"), "published through canonical root");
});
