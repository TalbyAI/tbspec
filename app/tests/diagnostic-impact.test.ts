import assert from "node:assert/strict";
import test from "node:test";
import { compareDiagnosticImpact } from "../src/diagnostic-impact.ts";

test("diagnostic impact exposes anonymous identities that cannot be compared", () => {
  const anonymous = {
    code: "SHACL_VIOLATION",
    severity: "error" as const,
    message: "A blank focus node failed a constraint.",
    file: "models/example.ttl",
    selector: "models/example.ttl",
    shacl: {
      selector: "dep:shapes/source/shapes.ttl",
      graphIri: "urn:shapes",
      focusNode: { kind: "blank", value: "b0", scope: "models/example.ttl" },
    },
  };

  const impact = compareDiagnosticImpact([], [anonymous], ["models/example.ttl"]);

  assert.deepEqual(impact.introducedErrors, []);
  assert.deepEqual(impact.unassessableDiagnostics, [anonymous]);
  assert.equal(impact.requiresAcceptance, true);
});

test("stable diagnostics remain comparable and do not require impact acceptance", () => {
  const stable = {
    code: "VOCABULARY_UNKNOWN",
    severity: "error" as const,
    message: "Term is not in the configured vocabulary.",
    file: "models/example.ttl",
    selector: "models/example.ttl",
    details: { identity: { kind: "iri", value: "urn:example:term" } },
  };

  const impact = compareDiagnosticImpact([], [stable]);

  assert.deepEqual(impact.introducedErrors, [stable]);
  assert.deepEqual(impact.unassessableDiagnostics, []);
  assert.equal(impact.requiresAcceptance, false);
});

test("impact accepts a baseline skipped affected check as unassessable but ignores unrelated skips", () => {
  const unrelated = {
    selector: "models/unrelated.ttl",
    kind: "shacl",
    state: "skipped" as const,
    blockedBy: ["shapes/missing.ttl"],
    shapesSelector: "shapes/missing.ttl",
  };
  const affected = {
    selector: "models/affected.ttl",
    kind: "vocabulary",
    state: "skipped" as const,
    blockedBy: [".tbspec/dependencies/shop/source/shop.ttl"],
  };
  const impact = compareDiagnosticImpact([], [], ["dep:shop/source/shop.ttl"], {
    baselineChecks: [unrelated, affected],
    proposedChecks: [],
    changedFiles: [".tbspec/dependencies/shop/source/shop.ttl"],
  });

  assert.equal(impact.requiresAcceptance, true);
  assert.deepEqual(
    impact.skippedChecks.map((diagnostic) => ({
      selector: diagnostic.selector,
      reason: diagnostic.details?.reason,
    })),
    [{ selector: "models/affected.ttl", reason: "impact_identity_unassessable" }],
  );
});

test("impact pairs semantic conditions by severity and multiplicity, independent of prose and locations", () => {
  const item = (severity: "error" | "warning" | "info", term: string, message = term) => ({
    code: "VOCABULARY_UNKNOWN",
    severity,
    message,
    file: "models/example.ttl",
    selector: "models/example.ttl",
    line: message === term ? 1 : 2,
    details: {
      identity: {
        kind: "term",
        term: { kind: "iri", value: `urn:${term}` },
        position: "type",
      },
    },
  });
  const impact = (before: ReturnType<typeof item>[], after: ReturnType<typeof item>[]) =>
    compareDiagnosticImpact(before, after);

  const messageOnly = impact(
    [item("error", "same", "old prose")],
    [item("error", "same", "new prose")],
  );
  assert.deepEqual([messageOnly.introducedErrors, messageOnly.worsenedErrors], [[], []]);

  const promoted = impact([item("warning", "promoted")], [item("error", "promoted")]);
  assert.deepEqual(
    [promoted.introducedErrors, promoted.worsenedErrors],
    [[], [item("error", "promoted")]],
  );

  const increased = impact(
    [item("error", "many"), item("error", "many")],
    [item("error", "many"), item("error", "many"), item("error", "many")],
  );
  assert.equal(increased.worsenedErrors.length, 1);

  const decreased = impact(
    [item("error", "many"), item("error", "many"), item("error", "many")],
    [item("error", "many"), item("error", "many")],
  );
  assert.deepEqual([decreased.introducedErrors, decreased.worsenedErrors], [[], []]);

  const replacement = impact([item("error", "resolved")], [item("error", "new")]);
  assert.deepEqual(replacement.introducedErrors, [item("error", "new")]);
  assert.deepEqual(replacement.worsenedErrors, []);

  const warningOnly = impact([], [item("warning", "warning")]);
  assert.deepEqual([warningOnly.introducedErrors, warningOnly.worsenedErrors], [[], []]);
  assert.equal(warningOnly.requiresAcceptance, false);
});

test("anonymous diagnostic identities compare only while their source graph signature is unchanged", () => {
  const diagnostic = {
    code: "SHACL_RESULT",
    severity: "error" as const,
    message: "An anonymous shape matched.",
    file: "models/example.ttl",
    selector: "models/example.ttl",
    shacl: {
      selector: "dep:shop/source/shapes.ttl",
      graphIri: "urn:shop:shapes",
      focusNode: { kind: "iri", value: "urn:focus" },
      sourceShape: { kind: "blank", value: "b0", scope: "dep:shop/source/shapes.ttl" },
      constraintComponent: { kind: "iri", value: "urn:constraint" },
    },
  };

  const unchanged = compareDiagnosticImpact([diagnostic], [diagnostic]);
  assert.deepEqual(unchanged.unassessableDiagnostics, []);
  assert.equal(unchanged.requiresAcceptance, false);

  const changed = compareDiagnosticImpact(
    [diagnostic],
    [{ ...diagnostic, message: "Validator prose differs." }],
    ["dep:shop/source/shapes.ttl"],
  );
  assert.deepEqual(changed.introducedErrors, []);
  assert.deepEqual(changed.worsenedErrors, []);
  assert.equal(changed.requiresAcceptance, true);
  assert.equal(changed.unassessableDiagnostics.length, 1);
});
