import { canonical } from "./canonical.ts";
import type { Diagnostic } from "./output.ts";

interface ImpactCheck {
  selector: string;
  kind: string;
  state: "passed" | "failed" | "skipped";
  blockedBy: string[];
  shapesSelector?: string;
}
interface ImpactCoverage {
  baselineChecks: ImpactCheck[];
  proposedChecks: ImpactCheck[];
  changedFiles: string[];
}

const severity = { error: 3, warning: 2, info: 1 } as const;

function identity(diagnostic: Diagnostic): string | undefined {
  const target = diagnostic.selector ?? diagnostic.file;
  if (!target) return undefined;
  const condition =
    diagnostic.code === "SHACL_RESULT"
      ? diagnostic.shacl
        ? [
            diagnostic.shacl.selector,
            diagnostic.shacl.focusNode ?? null,
            diagnostic.shacl.sourceShape ?? null,
            diagnostic.shacl.constraintComponent ?? null,
            diagnostic.shacl.path ?? null,
            diagnostic.shacl.value ?? null,
          ]
        : undefined
      : diagnostic.details?.identity;
  if (condition === undefined) return undefined;
  return canonical([target, diagnostic.code, diagnostic.check?.kind ?? null, condition]);
}

function targetOf(check: ImpactCheck): string {
  return check.selector;
}

function coverageKey(check: ImpactCheck): string {
  return canonical([targetOf(check), check.kind, check.shapesSelector ?? null]);
}

export function compareDiagnosticImpact(
  baseline: Diagnostic[],
  proposed: Diagnostic[],
  changedGraphs: string[] = [],
  coverage?: ImpactCoverage,
) {
  const changed = new Set(changedGraphs);
  const changedFiles = new Set(coverage?.changedFiles ?? []);
  const affected = (diagnostic: Diagnostic) => {
    if (!coverage) return true;
    if (diagnostic.selector && changed.has(diagnostic.selector)) return true;
    if (diagnostic.shacl && changed.has(diagnostic.shacl.selector)) return true;
    if (diagnostic.file && changedFiles.has(diagnostic.file)) return true;
    if (diagnostic.check?.blockedBy.some((path) => changed.has(path) || changedFiles.has(path)))
      return true;
    return (
      hasAnonymousScope(diagnostic.shacl, changed) || hasAnonymousScope(diagnostic.details, changed)
    );
  };
  const unassessable = (diagnostic: Diagnostic) =>
    affected(diagnostic) && isDiagnosticIdentityUnassessable(diagnostic, [...changed]);
  const comparableBaseline = baseline.filter(
    (diagnostic) => diagnostic.code !== "CHECK_SKIPPED" && !unassessable(diagnostic),
  );
  const comparableProposed = proposed.filter(
    (diagnostic) => diagnostic.code !== "CHECK_SKIPPED" && !unassessable(diagnostic),
  );
  const baselineByIdentity = new Map<string, Diagnostic[]>();
  const proposedByIdentity = new Map<string, Diagnostic[]>();
  for (const [items, diagnostics] of [
    [baselineByIdentity, comparableBaseline],
    [proposedByIdentity, comparableProposed],
  ] as const)
    for (const diagnostic of diagnostics) {
      const key = identity(diagnostic);
      if (!key) continue;
      items.set(key, [...(items.get(key) ?? []), diagnostic]);
    }

  const introducedErrors: Diagnostic[] = [];
  const worsenedErrors: Diagnostic[] = [];
  for (const [key, newOccurrences] of proposedByIdentity) {
    const oldOccurrences = [...(baselineByIdentity.get(key) ?? [])];
    const remaining = [...newOccurrences];
    for (const level of ["error", "warning", "info"] as const) {
      let count = oldOccurrences.filter((item) => item.severity === level).length;
      for (let index = remaining.length - 1; index >= 0 && count > 0; index--)
        if (remaining[index]?.severity === level) {
          remaining.splice(index, 1);
          count--;
        }
      oldOccurrences.splice(
        0,
        oldOccurrences.length,
        ...oldOccurrences.filter((item) => item.severity !== level),
      );
    }
    const oldCount = (baselineByIdentity.get(key) ?? []).length;
    for (const diagnostic of remaining.sort(
      (left, right) => severity[right.severity] - severity[left.severity],
    ))
      if (diagnostic.severity === "error") {
        if (oldCount) worsenedErrors.push(diagnostic);
        else introducedErrors.push(diagnostic);
      }
  }

  const diagnostics = [...baseline, ...proposed];
  const unassessableDiagnostics = [
    ...new Map(
      diagnostics
        .filter(unassessable)
        .map(
          (diagnostic) =>
            [
              canonical([
                diagnostic.selector ?? diagnostic.file,
                diagnostic.code,
                diagnostic.check?.kind ?? null,
                diagnostic.shacl?.selector ?? null,
              ]),
              diagnostic,
            ] as const,
        ),
    ).values(),
  ];
  const skippedChecks = proposed.filter(
    (diagnostic) => diagnostic.code === "CHECK_SKIPPED" && affected(diagnostic),
  );
  let unassessableCheck = false;
  if (coverage) {
    const before = new Map(coverage.baselineChecks.map((check) => [coverageKey(check), check]));
    const after = new Map(coverage.proposedChecks.map((check) => [coverageKey(check), check]));
    for (const [key, check] of before) {
      const current = after.get(key);
      if (check.state !== "skipped" && current?.state !== "skipped") continue;
      if (
        !isAffectedCheck(check, changed, changedFiles) &&
        !(current && isAffectedCheck(current, changed, changedFiles))
      )
        continue;
      unassessableCheck = true;
      if (current?.state === "skipped" && skippedChecks.some((item) => matchesCheck(item, current)))
        continue;
      const item = current?.state === "skipped" ? current : check;
      skippedChecks.push({
        code: "CHECK_SKIPPED",
        severity: "error",
        message: "Affected required validation coverage is incomplete and cannot be compared.",
        file: item.selector,
        selector: item.selector,
        check: { kind: item.kind, state: "skipped", blockedBy: item.blockedBy },
        ...(item.shapesSelector ? { shacl: { graphIri: "", selector: item.shapesSelector } } : {}),
        details: { reason: "impact_identity_unassessable", identity: { kind: "file" } },
      });
    }
    for (const [key, check] of after) {
      if (check.state !== "skipped" || before.has(key)) continue;
      if (!isAffectedCheck(check, changed, changedFiles)) continue;
      unassessableCheck = true;
      if (!skippedChecks.some((item) => matchesCheck(item, check)))
        skippedChecks.push({
          code: "CHECK_SKIPPED",
          severity: "error",
          message: "An affected required validation check was skipped by the proposed update.",
          file: check.selector,
          selector: check.selector,
          check: { kind: check.kind, state: "skipped", blockedBy: check.blockedBy },
          ...(check.shapesSelector
            ? { shacl: { graphIri: "", selector: check.shapesSelector } }
            : {}),
          details: { identity: { kind: "file" } },
        });
    }
  }

  return {
    baselineErrors: baseline.filter((diagnostic) => diagnostic.severity === "error"),
    introducedErrors,
    worsenedErrors,
    skippedChecks,
    unassessableDiagnostics,
    requiresAcceptance: unassessableDiagnostics.length > 0 || unassessableCheck,
  };
}

function matchesCheck(diagnostic: Diagnostic, check: ImpactCheck): boolean {
  return (
    (diagnostic.selector ?? diagnostic.file) === check.selector &&
    diagnostic.check?.kind === check.kind &&
    (diagnostic.shacl?.selector ?? null) === (check.shapesSelector ?? null)
  );
}

function isAffectedCheck(
  check: ImpactCheck,
  changedGraphs: Set<string>,
  changedFiles: Set<string>,
): boolean {
  return (
    changedGraphs.has(check.selector) ||
    (check.shapesSelector !== undefined && changedGraphs.has(check.shapesSelector)) ||
    check.blockedBy.some((path) => changedGraphs.has(path) || changedFiles.has(path))
  );
}

function hasAnonymousScope(value: unknown, changed: Set<string>): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasAnonymousScope(item, changed));
  const row = value as Record<string, unknown>;
  if (row.kind === "blank" && changed.has(String(row.scope))) return true;
  return Object.values(row).some((item) => hasAnonymousScope(item, changed));
}

export function isDiagnosticIdentityUnassessable(
  diagnostic: Diagnostic,
  changedGraphs: string[] = [],
): boolean {
  function anonymous(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if (Array.isArray(value)) return value.some(anonymous);
    const term = value as Record<string, unknown>;
    if (term.kind === "blank")
      return changedGraphs.includes(String(term.scope)) || !/^b\d+$/.test(String(term.value));
    return Object.values(term).some(anonymous);
  }
  return (
    !identity(diagnostic) || anonymous(diagnostic.shacl) || anonymous(diagnostic.details?.identity)
  );
}
