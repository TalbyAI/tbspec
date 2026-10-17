# Move and remove owned resources with impact review

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 03, 04, 07
User stories covered: 20, 21, 32, 101, 105

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can inspect removal impact, confirm deletion of an owned ontology, model, shapes graph, or custom model type, and preview/apply movement of an owned graph with its convention-linked support. The workflow keeps filesystem organization separate from semantic identity and permits explicitly accepted structural changes that need later repair.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close on impact and reviewed movement/removal of owned ontology/model/shapes resources and custom model types, including convention-linked support, declared/generated identities, and safe coupled publication. Saved-view/presentation impact and move integration belongs to 13, which now depends on this ticket; full authored-design integration belongs to 14; orphaned-support collection and reference repair to 19. These obligations remain visible until their owners implement and verify them.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [x] Implement impact, ontology/model/shapes remove, custom model-type remove, and resource move with matching browser workflows, exact selectors, explicit apply/confirm flags, and selective CLI guidance.
- [x] Impact is read-only and discloses direct/downstream affected files and all known IRI occurrences, including ordinary individual-valued occurrences and locked references. Do not restrict disclosed impact to persistent validation errors.
- [x] Confirmed resource/type deletion removes only the selected ownership scope. Keep incoming references and unrelated resources intact; built-in model types cannot be removed. Semantic invalidity is reported as the result of a successful deliberate mutation.
- [x] Move previews the source, convention-linked support, and owned recorded path changes, refuses destination/identity collisions, and preserves declared RDF IRIs. Disclose changed generated identities for unrooted selectors.
- [x] Moves and related path-reference updates publish together. Parse every graph being rewritten, bind destination absence and relevant inventories, and reject stale plans or malformed required files without partial changes.
- [x] Retain orphaned owned support after source deletion for the separate GC workflow. Removing a shapes association/resource never silently removes a design, dependency, or another source's support.
- [x] Use the current managed-reference contract for post-removal diagnostics: unavailable vocabulary, explicit associations, and applicable constraints can fail; an ordinary individual IRI does not require a local target merely because its definition was deleted.
- [x] Public-operation and CLI/browser tests cover reviewed/confirmed removal, built-in rejection, intentional invalidity, declared versus generated identity moves, coupled support, occupied/linked destinations, stale plans, external edits during rollback, and retained recovery evidence. Later view/design slices extend impact and move handling for their new resource kinds.

## Blocked by

- [03 - Create and import editable ontologies and domain models](03-create-and-import-owned-resources.md).
- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).
- [07 - Configure model types and accept vocabulary changes](07-configure-model-types-and-vocabulary-changes.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Answer

Delivered read-only impact inspection for exact managed IRI occurrences in owned graphs, locked RDF snapshots, and parsed configuration/lock selectors. Ontology, model, shapes, and custom model-type removals use reviewed plans; deletion preserves incoming triples, unrelated resources, and orphaned owned support. Built-in model types remain protected, and deliberate structural invalidity is returned as a successful mutation result. Moves publish the graph, convention-linked shapes support, and recognized configuration path references together. They preserve declared graph identities, disclose generated identity changes for unrooted selectors, and bind occupancy, inventory, source bytes, and parsed rewrite inputs to the accepted plan.

The CLI exposes impact, removal and move guidance with exact selectors and accepted-preview checks. The authenticated browser offers known-reference review, staged removal confirmation, staged move review, and result/diagnostic details. Browser apply requests send only the public protocol fields, keeping UI route metadata local. Later saved-view and design-kind work can extend the additive lifecycle selectors.

Verification on 2026-10-12:

- Root formatting and quality checks passed (`npm run format`, `npm run check`); application typecheck and production build passed. The build emitted the existing non-failing Rolldown notice about `@xyflow/react`'s `use client` directive.
- `node --test tests/resource-lifecycle.test.ts`: 9/9 passed, including occupied/linked destinations, stale source and new-inventory plans, and coupled source/support rollback with intervening edits and retained recovery evidence.
- `node --test tests/resource-lifecycle-web.test.ts`: 1/1 passed. Authenticated HTTP removal and movement share staged previews, and removal verifies the selected path is absent while incoming data remains unchanged.
- `node --test --test-name-pattern="CLI inventories impact" tests/cli.test.ts`: 1/1 passed, covering impact, confirmed ontology/custom-type removal, built-in rejection, and fingerprint-bound moves.
- An authenticated browser session reviewed one exact reference occurrence, staged and confirmed ontology removal, then showed zero owned graphs with no error. CLI inspection confirmed zero graphs and the selected file absent. The temporary server was stopped after the check.

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
