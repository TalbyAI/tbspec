import { canonical } from "./canonical.ts";
import type { Diagnostic } from "./output.ts";

export function compareDiagnosticImpact(
  baseline: Diagnostic[],
  proposed: Diagnostic[],
  changedGraphs: string[] = [],
) {
  const changed = new Set(changedGraphs);
  const unassessable = (diagnostic: Diagnostic) =>
    isDiagnosticIdentityUnassessable(diagnostic, [...changed]);
  const identity = (diagnostic: Diagnostic) =>
    canonical([
      diagnostic.selector ?? diagnostic.file,
      diagnostic.code,
      diagnostic.check?.kind ?? null,
      diagnostic.shacl
        ? [
            diagnostic.shacl.selector,
            diagnostic.shacl.focusNode ?? null,
            diagnostic.shacl.sourceShape ?? null,
            diagnostic.shacl.constraintComponent ?? null,
            diagnostic.shacl.path ?? null,
            diagnostic.shacl.value ?? null,
          ]
        : (diagnostic.details?.identity ?? null),
    ]);
  const comparable = baseline.filter((diagnostic) => !unassessable(diagnostic));
  const remaining = [...comparable];
  const baselineKeys = new Set(comparable.map(identity));
  const introducedErrors: Diagnostic[] = [];
  const worsenedErrors: Diagnostic[] = [];
  for (const diagnostic of proposed.filter((item) => item.severity === "error")) {
    if (unassessable(diagnostic)) continue;
    const key = identity(diagnostic);
    const same = remaining.findIndex((item) => identity(item) === key && item.severity === "error");
    if (same >= 0) {
      remaining.splice(same, 1);
      continue;
    }
    const previous = remaining.findIndex((item) => identity(item) === key);
    if (previous >= 0) {
      remaining.splice(previous, 1);
      worsenedErrors.push(diagnostic);
    } else if (baselineKeys.has(key)) worsenedErrors.push(diagnostic);
    else introducedErrors.push(diagnostic);
  }
  return {
    baselineErrors: baseline.filter((diagnostic) => diagnostic.severity === "error"),
    introducedErrors,
    worsenedErrors,
    skippedChecks: proposed.filter((diagnostic) => diagnostic.code === "CHECK_SKIPPED"),
    unassessableDiagnostics: [
      ...new Map(
        [...baseline, ...proposed]
          .filter(unassessable)
          .map((diagnostic) => [canonical(diagnostic), diagnostic] as const),
      ).values(),
    ],
    requiresAcceptance: [...baseline, ...proposed].some(unassessable),
  };
}

export function isDiagnosticIdentityUnassessable(
  diagnostic: Diagnostic,
  changedGraphs: string[] = [],
): boolean {
  const changed = new Set(changedGraphs);
  function anonymous(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const term = value as Record<string, unknown>;
    if (term.kind === "blank")
      return changed.has(String(term.scope)) || !/^b\d+$/.test(String(term.value));
    return Object.values(term).some(anonymous);
  }
  return (
    (!diagnostic.selector && !diagnostic.file) ||
    (!diagnostic.shacl && !diagnostic.details?.identity) ||
    anonymous(diagnostic.shacl) ||
    anonymous(diagnostic.details?.identity)
  );
}
