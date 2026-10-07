# Delete elements precisely and clean affected views

Type: AFK
Status: ready-for-agent
Blocked by: 05, 13
User stories covered: 87, 94, 101

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can preview every occurrence of one selected RDF resource in the edited source graph, confirm deletion of that reviewed set, and clean affected view/presentation selections together. Other graph references are disclosed as impact but remain untouched; deletion never cascades into connected resources or creates a session-dependent notion of dangling individual links.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Keep view-only removal, single statement/association removal, source-element deletion, managed-root lifecycle removal, and IRI refactoring as distinct operations. A cleared field or opened form never implies element deletion.
- [ ] Preview all exact source statements containing the chosen resource as subject, predicate, or object, including unknown incident statements. Blank-node deletion binds identity to its parsed source graph/revision and requires explicit confirmation.
- [ ] Remove only the reviewed occurrences in that source graph. Do not recursively delete neighbors, Flow/Transition resources, disconnected blank-node structures, or statements in other graphs; managed-root deletion uses lifecycle operations.
- [ ] Synchronize all affected saved views/presentations by removing deleted members, exact relationships, node presentation, and corresponding relationship presentation while preserving unrelated membership, coordinates, styles, and other-graph source content.
- [ ] Disclose all known references in other sources, configuration, and locked dependencies as impact. Leave them intact and infer no ownership from IRI prefixes or a deleted-identity registry.
- [ ] Post-deletion diagnostics follow current explicit associations, available vocabulary, view/presentation invariants, and applicable SHACL constraints. An ordinary individual-valued cross-graph IRI remains permitted without dereferencing even when its previous local definition was deleted.
- [ ] Parse and revision-check every graph to be rewritten, including newly discovered affected views/inventory; stale or malformed required files prevent the entire mutation. Normal failure restores bytes; guarded rollback preserves intervening edits/recovery evidence.
- [ ] Public-operation/browser checks cover predicate uses, unknown incident statements, blank-node scope, multiple views, locked/other-source impact, confirmed invalidity, stale acceptance, and coupled rollback. After fresh-process restart, ordinary individual values remain permitted while missing vocabulary, broken schema/source associations, stale views, and explicit SHACL failures remain diagnostic.

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

