import { appendFile } from "node:fs/promises";
import { releaseBranchVersion } from "../../scripts/release-utils.mjs";

function parseBoolean(value, label) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${label} must be true or false.`);
}

function selectMode([
  event,
  ref,
  requestedMode = "smoke",
  packed = "false",
  macos = "false",
  intel = "false",
]) {
  const diagnostics = [
    parseBoolean(packed, "packed_only"),
    parseBoolean(macos, "macos_regressions_only"),
    parseBoolean(intel, "macos_intel_source_only"),
  ];
  const diagnosticCount = diagnostics.filter(Boolean).length;

  if (event === "pull_request") return "smoke";
  if (event === "push") {
    if (ref === "refs/heads/main") return "smoke";
    if (releaseBranchVersion(ref)) return "full";
    throw new Error("Application workflow push is not for main or a versioned release branch.");
  }
  if (event !== "workflow_dispatch") throw new Error(`Unsupported workflow event: ${event}.`);
  if (diagnosticCount > 1) throw new Error("Select at most one diagnostic mode.");
  if (!new Set(["smoke", "full"]).has(requestedMode))
    throw new Error("verification_mode must be smoke or full.");
  if (diagnosticCount > 0) {
    if (requestedMode === "full")
      throw new Error("A diagnostic run cannot be combined with full verification.");
    return diagnostics[0] ? "artifact-only" : diagnostics[1] ? "focused" : "intel-partition";
  }
  if (requestedMode === "full" && !releaseBranchVersion(ref))
    throw new Error("Full verification is available only on release/<version> branches.");
  return requestedMode;
}

try {
  const mode = selectMode(process.argv.slice(2));
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `mode=${mode}\n`);
  process.stdout.write(`${JSON.stringify({ mode })}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
