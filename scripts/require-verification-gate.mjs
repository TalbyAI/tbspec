import { isValidReleaseVersion } from "./release-utils.mjs";

const [gate, event = "", ref = ""] = process.argv.slice(2);

function releaseVersion(reference) {
  const match = /^refs\/heads\/release\/(.+)$/.exec(reference);
  return match && isValidReleaseVersion(match[1]) ? match[1] : null;
}

function requiredMode() {
  if (event === "pull_request") return "smoke";
  if (event === "push") {
    if (ref === "refs/heads/main") return "smoke";
    return releaseVersion(ref) ? "full" : null;
  }
  if (event === "workflow_dispatch") {
    const requested = process.env.REQUESTED_MODE || "smoke";
    if (requested === "smoke") return "smoke";
    if (requested === "full" && releaseVersion(ref)) return "full";
  }
  return null;
}

function requireSuccess(name) {
  if (process.env[name] !== "success") throw new Error(`${name} must be success.`);
}

try {
  if (!new Set(["repository-quality", "smoke", "full"]).has(gate))
    throw new Error("Gate must be repository-quality, smoke or full.");
  const diagnostics = ["PACKED_ONLY", "MACOS_REGRESSIONS_ONLY", "MACOS_INTEL_SOURCE_ONLY"];
  if (diagnostics.some((name) => process.env[name] === "true"))
    throw new Error("A diagnostic selection cannot authorize an aggregate gate.");
  const expected = requiredMode();
  if (!expected) throw new Error("This event and ref do not select a complete verification mode.");
  if (gate === "full" && expected !== "full")
    throw new Error("Complete verification requires a release-branch full run.");

  requireSuccess("MODE_RESULT");
  if (process.env.MODE !== expected)
    throw new Error(`Selected mode must be ${expected} for this event and ref.`);

  if (gate === "repository-quality") requireSuccess("QUALITY_RESULT");
  if (gate === "smoke") {
    requireSuccess("BUILD_RESULT");
    requireSuccess("INSTALLED_RESULT");
  }
  if (gate === "full") {
    for (const name of [
      "QUALITY_RESULT",
      "BUILD_RESULT",
      "SOURCE_RESULT",
      "INSTALLED_RESULT",
      "SMOKE_RESULT",
    ])
      requireSuccess(name);
  }

  process.stdout.write(`${JSON.stringify({ gate, mode: expected, accepted: true })}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
