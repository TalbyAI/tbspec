import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function sanitizeDiagnosticMessage(message, temporaryRoots) {
  if (typeof message !== "string") return null;
  let sanitized = message;
  for (const root of temporaryRoots) {
    if (typeof root === "string" && root.length > 0)
      sanitized = sanitized.replaceAll(root, "<temporary>");
  }
  return sanitized
    .replace(/https?:\/\/[^\s"<>]+/gi, "<url>")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<redacted-token>");
}

export function sanitizeVerifierDiagnostics(diagnostics, temporaryRoots = []) {
  if (!Array.isArray(diagnostics)) return [];
  return diagnostics
    .filter(
      (diagnostic) =>
        typeof diagnostic?.code === "string" &&
        (diagnostic.code.startsWith("RUNTIME_") || diagnostic.code === "IO_FAILURE"),
    )
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: sanitizeDiagnosticMessage(diagnostic.message, temporaryRoots),
    }));
}

export function finalizeWindowsVerificationEvidence(evidence, result) {
  const cleanupFailures = Array.isArray(result.cleanupFailures) ? result.cleanupFailures : [];
  const outerCleanupPassed =
    result.accountRemoved === true &&
    result.sharedDirectoryRemoved === true &&
    cleanupFailures.length === 0;
  const operationFailed = result.operationFailed === true || result.operationExitCode !== 0;
  const budgetExceeded = result.smokeBudgetExceeded === true;

  evidence.verification.startedAt = result.startedAt;
  evidence.verification.completedAt = result.completedAt;
  evidence.verification.durationMs = result.durationMs;
  evidence.verification.durationScope = "windows-standard-user-installed-verification-and-cleanup";
  evidence.cleanup = [
    ...(Array.isArray(evidence.cleanup) ? evidence.cleanup : []),
    {
      state: result.accountRemoved
        ? "standard-user-account-removed"
        : "standard-user-account-removal-failed",
    },
    {
      state: result.sharedDirectoryRemoved
        ? "shared-test-directory-removed"
        : "shared-test-directory-removal-failed",
    },
  ];
  evidence.assertions = [
    ...(Array.isArray(evidence.assertions) ? evidence.assertions : []),
    {
      name: "windows-standard-user-cleanup-verified",
      passed: outerCleanupPassed,
    },
  ];

  if (!outerCleanupPassed || budgetExceeded) {
    evidence.state = "failed";
    evidence.failure = {
      step: budgetExceeded ? "smoke-budget" : "windows-outer-cleanup",
      code: budgetExceeded ? "SMOKE_BUDGET_EXCEEDED" : "WINDOWS_OUTER_VERIFICATION_FAILED",
      errorName: "VerificationFailure",
    };
  } else if (operationFailed) {
    evidence.state = "failed";
    if (!evidence.failure) {
      evidence.failure = {
        step: "windows-installed-verification",
        code: "WINDOWS_VERIFIER_PROCESS_FAILED",
        errorName: "VerificationFailure",
      };
    }
  }

  return evidence;
}

async function finalizeWindowsEvidenceFile() {
  const [evidencePath, serializedResult] = process.argv.slice(2);
  if (!evidencePath || !serializedResult)
    throw new Error("Usage: verification-evidence.mjs <evidence-file> <finalization-json>");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const result = JSON.parse(serializedResult);
  finalizeWindowsVerificationEvidence(evidence, result);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  finalizeWindowsEvidenceFile().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
