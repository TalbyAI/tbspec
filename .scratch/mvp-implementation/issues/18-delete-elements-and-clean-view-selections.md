# Delete elements precisely and clean affected views

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 05, 13
User stories covered: 87, 94, 101

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can preview every occurrence of one selected RDF resource in the edited source graph, confirm deletion of that reviewed set, and clean affected view/presentation selections together. Other graph references are disclosed as impact but remain untouched; deletion never cascades into connected resources or creates a session-dependent notion of dangling individual links.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close on reviewed graph-local element deletion and coordinated cleanup of every affected saved view/presentation, with other-graph references disclosed but untouched and safety demonstrated for all coupled files. Managed-root removal belongs to 12; project-wide IRI refactoring/reference repair/GC to 19. Post-deletion validity follows current managed positions and constraints, never a deleted-identity registry.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [x] Keep view-only removal, single statement/association removal, source-element deletion, managed-root lifecycle removal, and IRI refactoring as distinct operations. A cleared field or opened form never implies element deletion.
- [x] Preview all exact source statements containing the chosen resource as subject, predicate, or object, including unknown incident statements. Blank-node deletion binds identity to its parsed source graph/revision and requires explicit confirmation.
- [x] Remove only the reviewed occurrences in that source graph. Do not recursively delete neighbors, Flow/Transition resources, disconnected blank-node structures, or statements in other graphs; managed-root deletion uses lifecycle operations.
- [x] Synchronize all affected saved views/presentations by removing deleted members, exact relationships, node presentation, and corresponding relationship presentation while preserving unrelated membership, coordinates, styles, and other-graph source content.
- [x] Disclose all known references in other sources, configuration, and locked dependencies as impact. Leave them intact and infer no ownership from IRI prefixes or a deleted-identity registry.
- [x] Post-deletion diagnostics follow current explicit associations, available vocabulary, view/presentation invariants, and applicable SHACL constraints. An ordinary individual-valued cross-graph IRI remains permitted without dereferencing even when its previous local definition was deleted.
- [x] Parse and revision-check every graph to be rewritten, including newly discovered affected views/inventory; stale or malformed required files prevent the entire mutation. Normal failure restores bytes; guarded rollback preserves intervening edits/recovery evidence.
- [x] Public-operation/browser checks cover predicate uses, unknown incident statements, blank-node scope, multiple views, locked/other-source impact, confirmed invalidity, stale acceptance, and coupled rollback. After fresh-process restart, ordinary individual values remain permitted while missing vocabulary, broken schema/source associations, stale views, and explicit SHACL failures remain diagnostic.

## Blocked by

- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).
- [13 - Maintain independent views and synchronize their selections](13-maintain-independent-saved-views.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 07](../../mvp-technical-architecture/issues/07-rdf-canvas-projection.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).
- [Architecture decision 16](../../mvp-technical-architecture/issues/16-specialized-form-boundary.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

## Answer

Implemented source-element deletion as a web-only operation at `/editor/delete` and its authenticated project API route; no CLI command was added. The editor previews every exact incident source statement, including unknown predicates, and requires explicit confirmation. Blank-node identity is bound to the selected source graph revision. Deletion removes only the reviewed statements in that graph and synchronizes exact member, relationship, node-presentation, and relationship-presentation occurrences in saved views for that source. Known references in other graphs, configuration, locked dependencies, and unrelated view data are disclosed and left unchanged. Managed-root lifecycle removal and form clearing remain separate operations. Required graph and inventory reads are revision checked, and coupled publication uses transaction rollback.

Public deletion web coverage passed 8/8; deletion rollback, view transaction, saved-view web, and editing web suites passed 1/1, 1/1, 1/1, and 2/2. Root formatting/checks and app typecheck/build passed. A dedicated T3 browser smoke confirmed exact preview, source-scoped deletion, own-source view synchronization, and unchanged other-source graph/view/presentation references.
