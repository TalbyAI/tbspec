# Create and import editable ontologies and domain models

Type: task
Status: ready-for-agent
State: resolved
Assigned to: Codex
Blocked by: 02
User stories covered: 7, 21, 22, 23, 24, 27, 28, 31, 62

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can create, list, and inspect project-owned ontologies and conceptual, concrete, process, or state-machine models from both interfaces. They can also adopt an external local resource or available locked snapshot as an editable copy with a new graph identity and recorded provenance while keeping vocabulary term identities intact. The workflow records deliberate model-type associations and exposes missing vocabulary rather than inventing rebinding.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Ontology and model list/show/create/import commands and matching browser actions expose identity, selector, kind, configured association, support, and provenance through shared operations.
- [x] Creation uses the explicitly supplied graph IRI or the configured base-IRI rule, refuses occupied destinations and identity collisions, and writes the exact self-declaration and enabled model-type association required by the contract.
- [x] Create conceptual and concrete data models distinctly, as well as empty descriptive process/state-machine models. Conceptual resources describe classes/properties; concrete resources remain available for generic individual/value editing.
- [x] Creation rejects disabled, missing, or unusable types with diagnostics. Imports use the explicitly selected receiving type and report absent vocabulary without silently copying, renaming, or remapping term IRIs.
- [x] Editable import assigns a new managed root identity and provenance while preserving original class/property/individual terms and unknown statements. Merely opening a locked resource remains read-only; bundled snapshots provide an initial executable import example and acquired snapshots extend it in issue 08.
- [x] Classification relies on graph-root declarations rather than filenames or business types. Conflicting kinds/multiple roots are diagnosed, and parseable unclassified resources remain available for inspection.
- [x] CLI and browser creation/import use confined paths, revision checks, staged publication, and the common machine/diagnostic contract. Failed import, parse, identity, destination, or publication checks leave existing files untouched.
- [x] Public-operation and focused CLI/browser workflows demonstrate explicit and derived identity creation, each built-in model family, independent term preservation on editable import, missing vocabulary diagnostics, read-only originals, and occupied/invalid destinations. Full constraint validation is extended by issue 04.

## Blocked by

- [02 - Inspect the project from CLI and an authenticated browser](02-inspect-project-and-authenticated-web.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 01](../../mvp-technical-architecture/issues/01-permanent-iri-policy.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Answer

Delivered owned ontology/model list, show, create and editable import through shared project operations, exact CLI signatures and the authenticated local workspace. Explicit and base-derived identities, conceptual/concrete data profiles, descriptive process/state-machine roots, enabled receiving types, reusable schema selectors, support associations and import provenance are exposed consistently. Root declarations determine classification; custom model types use the generic root. Business starter declarations are added only when the selected vocabulary supplies the exact class.

Editable import accepts local Turtle, N-Triples and strict RDF/XML or an available locked selector. Only managed root metadata moves to the new identity. Original classes, properties, individuals and unknown statements retain their terms, and the source remains unchanged. Missing vocabulary and schema targets are diagnosed; successful publication reports `applied: true` and resulting `projectValidity`, with full constraint validation explicitly incomplete. Source-bound locked edges remain in their recorded context. Local ontology imports respect configured winners, owned/direct/nearest precedence and byte/parser graph signatures rather than semantic triple equality.

Publication reuses captured reads, absence/inventory revisions, confined paths, full-identity locking and staged transactions. CLI local operations apply directly, with optional accepted-preview fingerprint verification. Browser creation and import both return reviewed plans with random session/instance-owned handles and fifteen-minute expiry. Exact proposed bytes live in protected `.tbspec/previews/<instance-id>/<handle>/` directories; application verifies fingerprints, accepted flags, staged bytes and project revisions. Successful application consumes the handle; cancellation invalidates it. Restart never restores handles, and uncertain writes are never automatically retried.

Verification on 2026-10-10 used Windows, Node 24.14.1 and npm 11.17.0:

- Root `npm ci`, formatting and read-only quality checks passed; application typecheck and production build passed. The full suite passed 68 of 70 tests with no failures; two native macOS tests were skipped on Windows.
- Public-operation tests cover explicit/derived identities, all four built-in model families, replacement/custom/disabled/missing types, schema selectors, preserved import terms and originals, vocabulary diagnostics, source contexts, configured winners and ontology precedence. Malformed/conflicting roots, identity collisions, stale reads, occupied/unsafe destinations and a native publication fault preserve existing files. Concurrent identity claims publish exactly once.
- Offline CLI child processes exercise every command family with networking blocked and Git absent from PATH, repeated schema flags, receiving types, help/recursive guidance and accepted fingerprints. Real authenticated HTTP tests cover origin/schema/body rejection, previews for creation and import, owner/fingerprint checks, staged-byte tampering, exact schema links, cancellation, replay, stale revisions and external source changes after staging.
- The collaborative browser exercised explicit/derived creation, every built-in model family, schema associations, locked and external editable imports, missing-vocabulary diagnostics and occupied destinations. The rebuilt interface verified creation preview leaves its destination absent, reviewed application publishes it, and schema links open the conceptual model. Preview-host snapshot/evaluation timeouts prevented a final cancellation UI check; cancellation is verified through HTTP. No screenshot or mobile check is claimed.
- Parallel standards and specification reviews identified result-field, schema-selector, source-resolution and preview-protocol gaps; these were corrected with focused regressions. Shared format/type descriptors remove repeated mappings where the operations have the same responsibility.

Full vocabulary/association/SHACL validation and RDF statement editors remain in tickets 04/05. Native Linux/macOS execution, representative resource-capacity calibration and complete installed-artifact acceptance remain in ticket 20. No dependency acquisition, package publication or hosted CI execution is claimed.

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
- On 2026-10-10, implementation and Windows verification completed on `feat/03-owned-resources`; see Answer for behavior, review corrections and execution limits.
