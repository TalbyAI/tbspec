# Rename and deliberately remove dependencies

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 10
User stories covered: 52, 101

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can preview and apply an administrative dependency-ID rename or confirm removal of one selected addition. Renaming updates owned selectors and inventory locations without changing semantic identities; removal discloses all known impact and affects only that addition. Other additions, retained owned references, and deliberate semantic invalidity remain explicit.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close on administrative dependency rename/removal for the available inventories and owned reference kinds, preserving locked bytes/IRIs/signatures and reporting deliberate invalidity. Owned saved-view/presentation handling is assigned to 13, which now depends on this ticket; complete authored-design integration belongs to 14. Those resource-owning tickets must demonstrate the extensions before closing, not merely cite the earlier workflow.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [x] Implement dependency rename/remove and matching browser actions through shared operations with bare administration IDs and exact retained graph selectors in output.
- [x] Rename previews every owned selector/path/choice/configuration change and requires apply. Change the lock inventory location and owned references together, preserving original snapshot bytes, declared graph IRIs, parser contexts, and interpretation signatures.
- [x] Reject invalid/colliding IDs, occupied destinations, stale revisions, and malformed required rewritten files without partial mutation. Disclose any selector-derived unrooted graph identity change instead of silently treating it as a declared IRI rename.
- [x] Removal without confirm returns the direct/downstream impact, including owned and locked known references. Confirmation removes only the chosen addition's managed inventory/record and associated choices as specified; independently acquired snapshots and owned source references remain intact.
- [x] Do not cascade-delete owned views, models, independent designs, or other additions to fix invalidity. Where retained associations/invariants become invalid, return resulting validity with successful mutation status and let later status/validation diagnose them.
- [x] Local apply rechecks accepted fingerprints when supplied, revisions, and inventories. Browser apply uses reviewed server-held plans; normal failures preserve bytes/records and interruption retains recovery evidence.
- [x] Public-operation and CLI/browser checks demonstrate no RDF/content/signature changes after ID rename, collision refusal, separate repeated acquisitions, exact removal scope, breaking-removal diagnostics, changed-preview rejection, and multi-file rollback. Issue 13 extends owned-view selector handling when that resource kind is introduced.

## Answer

Implemented dependency-ID rename and deliberate removal through shared project operations, the CLI, and authenticated browser actions. Rename previews exact selectors, owned paths and choices, then moves the locked inventory and updates owned references in one accepted operation. It preserves snapshot RDF bytes, declared graph IRIs, parser contexts, and interpretation signatures; selector-derived generated graph identity changes are listed explicitly. Removal previews known owned and locked references, affected files, and resulting validity. Confirmation removes only the selected dependency record, snapshot, and linked choices, while preserving independent acquisitions and owned source references such as views.

Local apply rechecks an accepted fingerprint when supplied, captured revisions, and dependency inventories before publication. Browser apply consumes only the reviewed server-held plan. Transaction recovery preserves the prior lock and snapshot files when a later move fails. Unknown RDF statements are not rewritten as if they were dependency selectors.

Focused evidence passed 4 tests with 0 failures or skips (227.817 seconds): CLI rename/removal and collision, occupied-destination, invalid-ID, stale-preview, and repeated-acquisition cases; multi-file rename rollback; locked-source view rename/removal; and authenticated HTTP rename/removal. The locked-view case preserves source, view, and presentation bytes, updates the exact selector, resolves it through showView, and after confirmed removal reports ASSOCIATION_BROKEN at views/locked.ttl for the retained source graph IRI; showView then returns RESOURCE_MISSING with "Dependency selector is unavailable."

Native T3 smoke used a dedicated browser tab and server on port 61850. The Dependencies page showed legacy and repeated as separate additions. A rename preview to renamed-legacy reported the selector, lock-path, and ontology-choice changes with applied=false; before apply, the inventory still showed legacy and the destination was absent. Applying the reviewed plan changed the card and exact selector to renamed-legacy. The moved snapshot SHA-256 remained 09EB16079202EE757B27B476ACB0DDEAEAD058A8CAE9BA0B347E6B6001FB0CC2, matching the original and repeated snapshot bytes. The removal preview required confirm and disclosed the locked repeated reference and owned choice; its no-write state retained both additions and the pre-preview lock/configuration and snapshot hashes. Confirming removed only renamed-legacy: the page reported 7 locked dependencies and valid project status, while repeated and its snapshot hash remained intact. The owned server was stopped and port 61850 was unbound afterward.

On 2026-10-13, root npm run format and npm run check passed (117 code files, 67 Markdown files, zero issues); app npm run typecheck passed, and npm run build succeeded with 177 modules transformed. The build emitted only the existing non-failing @xyflow/react "use client" directive notice.

## Blocked by

- [10 - Update dependencies and manage explicit support](10-update-dependencies-and-manual-support.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 12](../../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
