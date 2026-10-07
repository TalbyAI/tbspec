# Refactor identities, repair references, and collect orphaned support

Type: AFK
Status: ready-for-agent
Blocked by: 11, 12, 14, 18
User stories covered: 94, 101, 102, 103, 104

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can inspect exact IRI occurrences, preview project-wide owned-IRI refactoring, repair demonstrably dangling references within an explicit scope, and separately collect selected orphaned support. These workflows make deliberate breaking changes repairable without rewriting locked content, guessing ownership of external individuals, or silently deleting independent resources.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement references list --target/--dangling, refactor iri, references redirect/remove, and gc with matching browser workflows, exact target/scope records, and recursive guidance for live inspection.
- [ ] Exact-target inspection includes all known subject/predicate/object/configuration occurrences and locked references. Dangling listing includes only targets demonstrated missing by current managed positions; it excludes ordinary external individual values and uses no prefix ownership or deletion history.
- [ ] IRI refactoring previews by default and requires apply, updates owned RDF/configuration coherently, refuses a new IRI declared by another owned resource, and reports locked occurrences without editing their bytes.
- [ ] Dangling redirection/removal requires explicitly selected files or all occurrences and apply. Rewrite only reviewed eligible owned statements/associations, preserve unrelated data, and expose resulting diagnostics; do not silently broaden scope.
- [ ] Malformed required rewritten graphs must first be repaired in source. Refactoring and repair bind exact revisions, absences, and inventories; newly added references or changed accepted bytes cause conflict rather than silent replanning.
- [ ] GC previews only orphaned owned support belonging to removed sources and requires named candidates or all plus apply and confirm. Independent designs and locked dependencies require their own removals; merely clearing a manual support association does not silently delete its retained files.
- [ ] Each mutation uses shared browser/local preview, confinement, publication, guarded rollback, and deliberate-invalidity contracts. Other resources and locked bytes remain unchanged.
- [ ] Public-operation and CLI/browser workflows cover every occurrence position, exact versus dangling distinction after restart, collision refusal, selected/all scope, locked-reference reporting, malformed source, stale/new-reference conflicts, no dereferencing, candidate eligibility, explicit GC flags, and recovery-preserving failure.
- [ ] Demonstrate the original breaking-removal/repair/GC acceptance scenario end to end, including an ordinary individual-valued link disclosed in impact but absent from dangling results and separately diagnosed managed-reference failures.

## Blocked by

- [11 - Rename and deliberately remove dependencies](11-rename-and-remove-dependencies.md).
- [12 - Move and remove owned resources with impact review](12-move-and-remove-owned-resources.md).
- [14 - Create reusable designs and customize each view](14-author-designs-and-view-appearance.md).
- [18 - Delete elements precisely and clean affected views](18-delete-elements-and-clean-view-selections.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

