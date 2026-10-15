import { readFileSync } from "node:fs";

const applicationPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name?: unknown; version?: unknown };
if (applicationPackage.name !== "tbspec" || typeof applicationPackage.version !== "string")
  throw new Error("Installed tbspec package metadata is missing its name or version.");
export const applicationVersion = applicationPackage.version;
