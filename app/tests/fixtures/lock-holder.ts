import * as fs from "node:fs/promises";
import { acquireLock, releaseLock } from "../../src/lock.ts";
const root = process.argv[2]; const mode = process.argv[3];
if (!root) throw new Error("Missing project root.");
async function message() { await new Promise<void>((resolve) => process.once("message", () => resolve())); }
const adapter = mode === "partial" ? new Proxy(fs, { get(target, key) {
  if (key !== "open") return Reflect.get(target, key);
  return async (...args: Parameters<typeof fs.open>) => {
    const handle = await fs.open(...args);
    return new Proxy(handle, { get(current, member) {
      if (member === "writeFile") return async (...values: Parameters<typeof handle.writeFile>) => { process.send?.("partial"); await message(); return handle.writeFile(...values); };
      const value = Reflect.get(current, member); return typeof value === "function" ? value.bind(current) : value;
    } });
  };
} }) : fs;
const owner = await acquireLock(root, adapter);
process.send?.("owned");
await message();
await releaseLock(root, owner);
process.send?.("released");
process.disconnect?.();
