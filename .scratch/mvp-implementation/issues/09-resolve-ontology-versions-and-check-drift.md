# Resolve ontology versions and detect source drift

Type: task
Status: resolved
State: resolved
Blocked by: 06, 08
User stories covered: 43, 44, 48, 49, 97, 98

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can select or clear an ontology version winner, inspect every retained alternative, and check whether recorded sources have changed without adopting those changes. Project queries and validation use one effective interpretation, while exact retained files remain independently queryable under their original identities. Drift measures the selected resource's interpretation rather than unrelated upstream activity.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Implement dependency select/clear and check for one/all additions in CLI and browser. Listings disclose the chosen/effective candidate, relevant provenance/support, retained selectors, and changed/unchanged/unavailable outcomes.
- [x] Resolve ontology candidates by IRI/signature using explicit consuming choice, owned ontology, direct dependency, then nearest transitive dependency. Equal content is one effective candidate with retained contexts; different-content winning ties and broken choices are explicit errors.
- [x] Register only effective winners/support for consumer queries and validation; never merge losing ontology triples. Preserve locked models' recorded source resolution context even when the consumer chooses a different ontology version.
- [x] Exact retained closure/support/losing selectors load only that file as both default and sole named graph under its recorded identity. Consumer resolution conflicts or unrelated malformed files do not block isolated queries.
- [x] Diagnose genuine loaded graph collisions and divergent non-ontology identities rather than assigning arbitrary winners. Retain all losing bytes and original associations for inspection.
- [x] Read-only drift checks compare included original bytes, parser context, support, closure/bindings, and relevant choices. Included formatting changes count; unrelated commits/settings and consumer dependency-ID relocation alone do not.
- [x] Distinguish comparison changes/partial availability from unavailable sources using the specified records and exit categories. Checking, clearing a choice, and inspection never silently update snapshots or refetch during subsequent local operations.
- [x] Verify canonical signature golden vectors, Unicode/null/set ordering, cycle closure, signature stability under ID renames, source-bound validation, retained losing graph queries, explicit winner/clear behavior, and irrelevant-versus-interpretation drift through public operations and focused CLI/browser checks.

## Blocked by

- [06 - Run and manage reproducible SPARQL queries](06-run-and-manage-sparql-queries.md).
- [08 - Acquire dependencies from directories, HTTP, and Git](08-acquire-directory-http-and-git-dependencies.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 08](../../mvp-technical-architecture/issues/08-query-dataset-boundary.md).
- [Architecture decision 09](../../mvp-technical-architecture/issues/09-shacl-validation-boundary.md).
- [Architecture decision 12](../../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

## Answer

Implemented shared ontology ranking and explicit winner/clear operations across queries, validation, dependency inspection, CLI, authenticated HTTP, and the browser. Effective candidates follow owned/direct/nearest precedence and compare canonical interpretation signatures; only the active closure contributes winners, while exact retained selectors preserve losing bytes and graph identities. Locked model bindings remain source-bound. Read-only drift checks compare the captured closure, byte/parser signatures, support, bindings, and relevant choices without refetching or replacing snapshots.

Focused evidence: `schemas.test.ts` verifies UTF-8/Unicode, null, set ordering, canonical digests, and ID-independent signatures; `dependencies.test.ts` verifies precedence, explicit selection/clear and ambiguity, exact losing queries, inactive-choice isolation, and cyclic closure; `validation.test.ts` verifies independently source-bound models. `dependency-sources.test.ts` proves unrelated Git commits/settings and dependency-ID relocation stay unchanged, byte-only formatting changes are changed, and unavailable source trees report unavailable. The authenticated API test covers changed/partial checks; `queries.test.ts` covers malformed unrelated files and graph collisions; `cli.test.ts` exercises select/clear/check. A live T3 browser flow selected a winner, checked one and all dependencies, cleared the choice, and verified the tie returned.

Final focused tests passed 15/15 with zero failures or skips. Root formatting/checks and app typecheck/build passed.
