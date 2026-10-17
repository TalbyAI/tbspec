# Refactor identities, repair references, and collect orphaned support

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 11, 12, 14, 18
Assigned to: Codex
User stories covered: 94, 101, 102, 103, 104

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can inspect exact IRI occurrences, preview project-wide owned-IRI refactoring, repair demonstrably dangling references within an explicit scope, and separately collect selected orphaned support. These workflows make deliberate breaking changes repairable without rewriting locked content, guessing ownership of external individuals, or silently deleting independent resources.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close on complete exact/dangling reference inspection, scoped owned IRI refactoring/repair, explicit orphaned-support GC, and the combined removal/repair scenario over all resource kinds available through its blockers. Locked bytes remain untouched and normal/rollback/interruption failures preserve the specified evidence. Installed-artifact and cross-platform verification belongs to 20.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [x] Implement references list --target/--dangling, refactor iri, references redirect/remove, and gc with matching browser workflows, exact target/scope records, and recursive guidance for live inspection.
- [x] Exact-target inspection includes all known subject/predicate/object/configuration occurrences and locked references. Dangling listing includes only targets demonstrated missing by current managed positions; it excludes ordinary external individual values and uses no prefix ownership or deletion history.
- [x] IRI refactoring previews by default and requires apply, updates owned RDF/configuration coherently, refuses a new IRI declared by another owned resource, and reports locked occurrences without editing their bytes.
- [x] Dangling redirection/removal requires explicitly selected files or all occurrences and apply. Rewrite only reviewed eligible owned statements/associations, preserve unrelated data, and expose resulting diagnostics; do not silently broaden scope.
- [x] Malformed required rewritten graphs must first be repaired in source. Refactoring and repair bind exact revisions, absences, and inventories; newly added references or changed accepted bytes cause conflict rather than silent replanning.
- [x] GC previews only orphaned owned support belonging to removed sources and requires named candidates or all plus apply and confirm. Independent designs and locked dependencies require their own removals; merely clearing a manual support association does not silently delete its retained files.
- [x] Each mutation uses shared browser/local preview, confinement, publication, guarded rollback, and deliberate-invalidity contracts. Other resources and locked bytes remain unchanged.
- [x] Public-operation and CLI/browser workflows cover every occurrence position, exact versus dangling distinction after restart, collision refusal, selected/all scope, locked-reference reporting, malformed source, stale/new-reference conflicts, no dereferencing, candidate eligibility, explicit GC flags, and recovery-preserving failure.
- [x] Demonstrate the original breaking-removal/repair/GC acceptance scenario end to end, including an ordinary individual-valued link disclosed in impact but absent from dangling results and separately diagnosed managed-reference failures.

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

## Answer

Implemented a shared reference inventory and repair/collection workflow across public operations, CLI, authenticated HTTP, and the browser. Bare `references list` reports every known exact occurrence; target and dangling modes distinguish literal datatype IRIs, ordinary data, managed missing positions, configuration, and locked references. Refactoring and selected/all redirect or removal plans capture exact files, occurrences, project revisions, absences, and inventory before guarded publication. Malformed required RDF, changed inventories, declaration collisions anywhere in another owned resource, or unrepresentable RDF/XML edits refuse before writing. RDF/XML candidates are reparsed and checked for term preservation. TOML edits preserve unrelated tokens, comments, line endings, and valid unknown scalars.

Garbage collection is a separate preview. It selects named candidates or all candidates and requires both apply and confirmation. It collects only demonstrably orphaned owned SHACL support and saved-view/presentation pairs; independent designs, live shared support, locked dependencies, and cleared manual support remain. The authenticated workflow uses the bounded project worker for enumeration and planning. Recursive CLI guidance and [the application README](../../../app/README.md#exact-iri-repair-and-support-collection) describe the exact commands and boundaries.

Verification on the final implementation revision:

- `node --test --test-concurrency=1 tests/repair.test.ts tests/repair-web.test.ts`: 15/15 pass (14 public-operation tests and one authenticated HTTP workflow).
- `node --test --test-concurrency=1 --test-name-pattern="repair CLI supports bare reference listing" tests/cli.test.ts`: 1/1 pass.
- Root `npm run format` then `npm run check`, plus application `npm run typecheck` and `npm run build`, pass after the Answer and README update.
- Native T3 verified staged/cancelled/applied IRI refactoring on the first live instance; a new live instance on port 51823 then staged/applied selected removal and selected garbage collection. The removal deleted only the missing `rdf:type` statement while preserving an ordinary `rdfs:seeAlso` link to the same IRI. GC preview/cancel left `orphan.shacl.ttl` byte-identical, then a fresh preview/confirm removed only that path. The manifest, lock, and all 25 locked dependency files retained their hashes (27 files total); served `index-PHk-tJv8.js` matched the final dist hash. The first browser process had ended before the second workflow; no fallback automation was used. The project server was stopped normally and its port is unbound.
- Captured pre-fix red observations included a missed term-declaration collision, a false `RESOURCE_MISSING` during selected GC, a shared SHACL file incorrectly proposed for collection, and an `IO_FAILURE` while preserving valid TOML datetime values. The public regressions now pass. No pre-fix red was captured for the nested/bare dependency-selector regression.

Ticket 20 still owns installed-artifact and complete supported-platform acceptance; this ticket does not claim those checks.
