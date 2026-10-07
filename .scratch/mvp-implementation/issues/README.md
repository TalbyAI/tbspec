# MVP implementation issues

The user approved this grouped breakdown of 20 AFK vertical slices on 2026-10-04. The [parent specification](../spec.md) remains unchanged. All tickets are `ready-for-agent`; that status indicates specification readiness, not completed blockers or authorization to implement.

## Execution authorization

Approval to write or review this breakdown authorizes that documentary work only. Production implementation requires an explicit user instruction identifying one ticket, a set of tickets, or the whole plan. That instruction remains effective for the authorized work, including necessary implementation, checks, and fixes; routine steps do not require repeated approval. Finishing an authorized ticket does not authorize the next ticket.

Specification readiness, dependency readiness, and execution authorization are separate conditions. A ticket can start only when its listed blockers are implemented and verified and its implementation is authorized. For example, "implement issue 01" authorizes issue 01, while "implement issues 01-04" authorizes that set in dependency order. Neither `ready-for-agent` nor an empty blocker list grants execution permission. External npm publication, application deployment, and public vocabulary hosting require separate release authorization.

## Issue index

| Issue | Blocked by | User stories covered |
| --- | --- | --- |
| [01 - Initialize an offline project with bundled resources and safe publication](01-initialize-offline-project.md) | None | 1, 2, 3, 4, 7, 9, 10, 11, 12, 105, 106, 107, 108, 109 |
| [02 - Inspect the project from CLI and an authenticated browser](02-inspect-project-and-authenticated-web.md) | 01 | 5, 6, 8, 24, 25, 26, 110, 111, 112, 113, 114 |
| [03 - Create and import editable ontologies and domain models](03-create-and-import-owned-resources.md) | 02 | 7, 21, 22, 23, 24, 27, 28, 31, 62 |
| [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md) | 03 | 2, 5, 25, 26, 29, 30, 89, 90, 91, 92, 93, 94, 101 |
| [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md) | 04 | 56, 57, 58, 59, 60, 61, 62, 78, 79, 80, 81, 85 |
| [06 - Run and manage reproducible SPARQL queries](06-run-and-manage-sparql-queries.md) | 04 | 11, 95, 96, 97, 98, 99, 100 |
| [07 - Configure model types and accept vocabulary changes](07-configure-model-types-and-vocabulary-changes.md) | 04, 05 | 6, 13, 14, 15, 16, 17, 18, 19, 115 |
| [08 - Acquire dependencies from directories, HTTP, and Git](08-acquire-directory-http-and-git-dependencies.md) | 07 | 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 53, 54, 55, 115, 116 |
| [09 - Resolve ontology versions and detect source drift](09-resolve-ontology-versions-and-check-drift.md) | 06, 08 | 43, 44, 48, 49, 97, 98 |
| [10 - Update dependencies and manage explicit support](10-update-dependencies-and-manual-support.md) | 04, 09 | 45, 46, 47, 50, 51, 53, 115, 116 |
| [11 - Rename and deliberately remove dependencies](11-rename-and-remove-dependencies.md) | 10 | 52, 101 |
| [12 - Move and remove owned resources with impact review](12-move-and-remove-owned-resources.md) | 03, 04, 07 | 20, 21, 32, 101, 105 |
| [13 - Maintain independent views and synchronize their selections](13-maintain-independent-saved-views.md) | 05, 08, 11, 12 | 24, 25, 32, 52, 63, 64, 65, 66, 67, 68, 89, 90, 97, 98 |
| [14 - Create reusable designs and customize each view](14-author-designs-and-view-appearance.md) | 09, 12, 13 | 24, 25, 69, 70, 71, 72, 89, 90, 97, 98 |
| [15 - Organize and explore the canvas without losing positions](15-organize-and-explore-canvas.md) | 14 | 73, 74, 75, 76, 77, 115, 116 |
| [16 - Edit descriptive processes with specialized forms](16-edit-descriptive-process-forms.md) | 05 | 79, 80, 81, 82, 83, 85, 86, 88 |
| [17 - Edit descriptive state machines](17-edit-descriptive-state-machine-forms.md) | 05 | 79, 80, 81, 84, 85, 86, 88 |
| [18 - Delete elements precisely and clean affected views](18-delete-elements-and-clean-view-selections.md) | 05, 13 | 87, 94, 101 |
| [19 - Refactor identities, repair references, and collect orphaned support](19-refactor-repair-and-collect-orphaned-support.md) | 11, 12, 14, 18 | 94, 101, 102, 103, 104 |
| [20 - Install and verify the complete application on supported platforms](20-install-and-verify-packed-application.md) | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19 | 9, 54, 117 |

## Iteration and completion

- Once execution is authorized, start with issue 01. A later authorized ticket can start when all its listed blockers are implemented and verified; numeric order is a valid dependency order, but independent unblocked tickets need not wait for unrelated lower numbers.
- Each ticket is a complete demoable workflow through shared operations and its applicable interfaces. Individual RDF statement editing belongs to the web editors; do not invent statement-edit CLI commands.
- Story references can span tickets: early workflows cover the resource kinds available at that point, and later slices extend discovery, validation, query assembly, guidance, impact, moves, and editing for newly introduced kinds. A story is fully delivered only when all its mapped scope is complete. Do not report absent checks as complete clean validation.
- The 20-ticket breakdown is preserved. On 2026-10-07, the user approved adding 11 and 12 to issue 13's blockers so its query/rename/move integrations are executable at closure. These edges also establish 06/09/10 transitively and make issue 14's existing dependency on 13 sufficient for manual-support integration. Ticket 20 depends on all preceding tickets because installed-artifact, cross-platform, and assembled acceptance checks require the complete application.
- Append implementation discussion under the ticket's Comments section. Do not close or modify the parent specification as part of these issues.

### Ticket closure and later extensions

Each ticket's completion boundary identifies its resource scope and the tickets responsible for later extensions. Closing a ticket requires every acceptance criterion within that boundary, the applicable shared contracts, and evidence for its public operations and interfaces. An acceptance criterion cannot be marked complete by silently excluding a resource kind that its wording still promises.

Later resource tickets must extend the existing inspection, validation, query, impact, move, and editing operations where applicable, with integration evidence, before they close. They extend the application delivered by earlier tickets; they do not retroactively claim that the earlier milestone delivered the whole story. A shared story remains incomplete until every mapped obligation is delivered and verified. Ticket 20 verifies assembled behavior rather than absorbing missing feature implementation.

Unavailable checks must remain visible in coverage and diagnostics. A project containing unchecked resource kinds must not receive a complete clean-validation claim. Safety and integrity guarantees for every enabled operation apply immediately, including operations on newly introduced resources; they cannot be postponed to a later slice.

### Foundation and feature safety evidence

Issue 01 is a substantial foundational workflow: offline initialization, immutable starter authoring/bundling, and the shared safe-publication mechanism. Its title and completion boundary disclose those responsibilities. Its closure must demonstrate all locking, revision, transaction, recovery, and confinement guarantees applicable to initialization; it is not a scaffolding-only milestone.

Every later ticket owns the application and evidence of those same guarantees for the operations it introduces. For example, issue 13 must verify source/view/presentation coordination and revision-bound multi-file rollback. Passing issue 01 does not prove that a later operation captures all its prerequisites, guards all destinations, or rolls back all its affected files. Cross-platform verification remains assigned to issue 20 and must not be claimed early without actual platform evidence.

## Shared delivery requirements

These requirements apply to every relevant acceptance criterion without becoming separate horizontal implementation tickets.

- **Normative sources:** Follow the [functional command signatures and acceptance scenarios](../../mvp/spec.md), [implementation/testing decisions](../spec.md#implementation-decisions), [resolved architecture map](../../mvp-technical-architecture/map.md), [version-1 schemas and machine contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md), [domain glossary](../../../CONTEXT.md), and [ADRs](../../../docs/adr/). Exact terms, fields, flags, lifetimes, and policies come from those sources; reversible library/module choices do not reopen product decisions.
- **Shared behavior:** Use transport-independent project operations, called directly by ordinary CLI commands and by authenticated HTTP adapters. Preserve exact RDF terms, declared identities, source-bound locked contexts, and owned/read-only boundaries. Serve local assets; acquire external content only through explicit dependency actions. Keep authentication, status, cancellation, and navigation responsive during acquisition, CPU-heavy RDF work, and layout, using bounded Node/browser worker boundaries where required; each enabled long-operation workflow needs observed control-responsiveness evidence rather than an inference from asynchronous APIs. Implement applicable CLI and browser workflows within the feature ticket, not as a later adapter sweep.
- **CLI contracts:** Update exact command routing/help and recursive focused llms guidance as commands are added. Every JSON invocation emits one version-1 envelope, including errors/help/version, with no progress stdout; human diagnostics go to stderr. Preserve exits 0 success/preview, 1 invalidity/drift, 2 invalid arguments/policy, 3 conflict/acceptance/recovery, and 4 unavailability/I/O with normative precedence. Completed deliberate semantic invalidation is success with resulting validity.
- **Safe publication:** Use coherent captured reads, full-identity short-lived project locking, SHA-256 file/absence/inventory revisions, same-filesystem staging/before-images, confined owned writes, commit-time rechecks, and guarded rollback. Preserve unrelated human TOML keys/comments/line endings and unknown RDF statements. Busy/unknown ownership, pending recovery, stale inputs, and malformed required rewritten graphs never authorize a partial mutation or automatic clearing/replanning.
- **Accepted previews:** Existing apply/confirm/accept-impact flags remain required independently of a fingerprint. CLI external-content application reacquires once and compares the accepted fingerprint; browser application uses only session/instance-owned staged bytes with expiry, revision checks, and single successful consumption. Uncertain transport outcomes require inspection, not automatic write retries.
- **Focused evidence:** Test public shared operations with temporary real projects and assert records, diagnostics, coverage, resulting bytes/RDF, and failure preservation. Assert each delivered command/HTTP record against the exact version-1 field, nullability, status/exit-precedence, RDF-term, and coverage contract, including errors/partial results; a generic success assertion or schema link is insufficient. Add focused CLI process and real HTTP/browser checks for contracts the core alone cannot establish. Use actual process/filesystem fault and concurrency boundaries for OS-sensitive behavior; prototypes supply evidence, not production imports or proof of unimplemented behavior.
- **Distribution and scope:** Keep production dependencies pinned and prototypes isolated. Ordinary installed use requires Node 24, with Git optional for Git acquisition. Cross-platform support needs actual Windows/macOS/Linux evidence in ticket 20. The planned implementation scope includes production code and offline resource authoring/bundling. This scope description does not authorize execution; use the explicit authorization rule above.

## Story coverage

The ticket references include every numbered user story from 1 through 117. This is an inventory check, not proof that every normative obligation has sufficient acceptance criteria or that any implementation has passed. Semantic coverage requires tracing story obligations and the normative functional/architecture contracts to responsible tickets, acceptance criteria, and required evidence, with ambiguities and gaps recorded explicitly.

Shared safety, machine-output, and responsiveness stories apply across the feature workflows even where their foundational ownership is initialization, server lifecycle, acquisition, or packaging. The seven original acceptance scenarios must become executable workflows in their feature tickets and be assembled again in ticket 20. No production execution result is claimed by this breakdown or its documentary audit.

The [2026-10-07 semantic audit](../audit/README.md) records story/contract traces, applied documentary clarifications, and the user's resolved ownership/ordering decision for later-resource query and cross-feature integrations. Issues 13/14 now own explicit query evidence and issue 13 depends on 11/12. Documentary coverage describes specified obligations; implementation and runtime verification remain future work requiring explicit execution authorization.
