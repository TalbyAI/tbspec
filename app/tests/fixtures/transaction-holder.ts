import * as fs from "node:fs/promises";
import { capture, preparePlan, publishPlan } from "../../src/transactions.ts";
const root = process.argv[2];
if (!root) throw new Error("Missing project root.");
const plan = preparePlan(await capture(root, ["a.ttl", "b.ttl"]), "interrupted.save", [{ file: "a.ttl", bytes: Buffer.from("published A") }, { file: "b.ttl", bytes: Buffer.from("published B") }]);
const adapter = new Proxy(fs, { get(target, key) {
  if (key !== "rename") return Reflect.get(target, key);
  return async (...args: Parameters<typeof fs.rename>) => {
    const result = await fs.rename(...args);
    if (String(args[1]).endsWith("a.ttl") && String(args[0]).includes("staged-")) { process.send?.("applied"); await new Promise<void>((resolve) => process.once("message", () => resolve())); }
    return result;
  };
} });
await publishPlan(root, plan, adapter);
process.disconnect?.();
