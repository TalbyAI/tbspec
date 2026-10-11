import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { token } from "../src/ownership.ts";
import { cleanupPreviews, discardPreview } from "../src/previews.ts";

test("preview cleanup refuses linked artifacts and preserves all files in unknown workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "tb-preview-confinement-"));
  const workspace = `.tbspec/previews/${token()}/${token()}`;
  await mkdir(join(root, workspace), { recursive: true });
  const outside = join(root, "owned.ttl");
  await writeFile(outside, "owned content");
  await writeFile(join(root, workspace, "record.json"), "preview metadata");
  await link(outside, join(root, workspace, "staged-0"));
  await assert.rejects(discardPreview(root, workspace));
  assert.equal(await readFile(outside, "utf8"), "owned content");
  assert.equal(await readFile(join(root, workspace, "record.json"), "utf8"), "preview metadata");
  assert.equal((await cleanupPreviews(root))[0]?.code, "CLEANUP_RETAINED");
  await assert.rejects(discardPreview(root, ".tbspec/transactions/pending"));
  assert.equal((await readdir(join(root, workspace))).length, 2);
});
