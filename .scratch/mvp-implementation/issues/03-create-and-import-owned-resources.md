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

### Approved scope review (2026-10-11)

The user approved focused model inspection, sequential owned identity checks, selective dependency loading, complete preview cleanup, and measurements before changing the provisional shared preview cap. The approved trade-offs are that isolated CLI model inspection can retain conceptual schema IRIs without resolving owned selectors, and authoring still refuses unknown owned graph identities.

`model show` now uses the selected graph/configuration capture instead of project-wide status. Conceptual schema IRIs, configured support selectors and lock-metadata selectors remain available without reading unrelated graph bytes. Browser schema links use the existing separately refreshed owned inventory; opening a link inspects that target. The inventory and selected graph need not share a revision, and unread dependency integrity is not established.

Authoring captures inventory/file revisions, releases the project lock, and parses owned graphs sequentially while retaining only identity/kind/signature metadata. It loads the selected dependency source, receiving vocabulary closure, common contract and relevant schemas on demand with integrity and revision checks. Imports inspect owned declarations sequentially for term collisions. Publication preserves exact preview bytes, destination absence, inventory and file rechecks, and concurrent identity protection. Unused dependency corruption no longer blocks authoring; malformed/unreadable/ambiguous owned identity evidence still does. Required configuration schemas are checked before parsing owned identities.

Expiry cleanup joins the worker's operation sequence, runs without another preview request, and cannot remove bytes during publication. Failed staging, cancellation, success and detected stale revisions discard the relevant preview. Shutdown and worker replacement remove recognized obsolete artifacts after active work finishes; exclusive startup removes recognized prior-instance leftovers. Confined paths, canonical instance/handle tokens, recognized artifact names and link checks guard deletion. Unknown files and transaction originals remain intact, with `CLEANUP_RETAINED` warnings in authenticated responses or lifecycle logs. Restart never restores handles, and failed or uncertain writes are not replayed.

Windows verification passed root installation/format/check, application typecheck/build, and 77 applicable tests out of 79 with no failures; two native macOS tests were skipped. Added regressions reproduced unrelated reads, idle staging retention, lock-held parsing and occupied-destination error classification before the fixes. A destination occupied during capture returns a conflict without parsing or replacing that file. Fault checks cover partial staging and retained cleanup failures. The collaborative browser opened a concrete model, displayed its conceptual schema association, followed that link to the conceptual model, and verified removal of the bootstrap fragment. No mobile or new native Linux/macOS run is claimed.

The [capacity report](../measurements/03-owned-resources/README.md) records synthetic preparation and preview-storage executions. With a 512 MiB heap limit, the baseline exhausted its heap at 500,020 triples across ten files; revised creation/import succeeded there, and revised creation succeeded across twenty files containing 1,000,040 triples. One hundred smaller previews used 33,992,940 staging bytes; ten larger previews peaked at approximately 762 MiB resident memory for the server and measurement controller together. Both preview runs left zero staged bytes after graceful stop. These are fixture observations, not support guarantees: per-file parsing, receiving closure size and import size still matter. The shared 100-preview cap and worker heap setting remain provisional. Persistent indexes, new quota configuration, full validation and broader worker architecture remain outside this review.

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
- On 2026-10-10, implementation and Windows verification completed on `feat/03-owned-resources`; see Answer for behavior, review corrections and execution limits.
- On 2026-10-11, the user approved the clarified autonomous scope review. The approved review above records implementation, verification, capacity evidence and retained limitations.
