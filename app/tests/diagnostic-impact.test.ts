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
