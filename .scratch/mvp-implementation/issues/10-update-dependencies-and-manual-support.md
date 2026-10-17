# Update dependencies and manage explicit support

Type: task
Status: ready-for-agent
State: open
Blocked by: 04, 09
User stories covered: 45, 46, 47, 50, 51, 53, 115, 116

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can preview newer dependency content, assess downstream impact, and explicitly adopt exactly what was reviewed. They can attach or clear separately locked shapes/designs when a source exposes no association. Manual support survives main-source updates, and clearing an association retains its files without including inactive support in interpretation.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close on dependency update and explicit support set/clear, semantic diagnostic-multiset impact, separately retained manual attachments, fingerprint-bound CLI reacquisition, exact browser staged bytes, and failure/cancellation preservation. Complete authored-design/presentation behavior belongs to 14; dependency rename/removal to 11. All existing affected validation/query/interpretation behavior must be exercised within this scope.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [x] Implement dependency update and support set/clear in CLI/browser with exact source/file selection, source/interpretation changes, downstream diagnostics, expected revisions, staged content, and the common preview contract.
- [x] Compare complete baseline/proposed diagnostic multisets using normative semantic identities, severity, and multiplicity, not prose, locations, totals, or output order. Resolved errors never offset new conditions; warning-to-error and increased error occurrences are worsened impact.
- [x] Require update accept-impact for introduced/worsened errors or affected required checks that are skipped or otherwise unassessable. Unchanged unrelated baseline failures and warning-only changes do not gate adoption; explicit acceptance never bypasses acquisition/parse/I/O failures.
- [x] Match anonymous shape/path/focus/value identities only in unchanged source graph signatures using normalized source-parser blank-node identities. Changed/untraceable anonymous terms make affected checks unassessable; repeated fingerprints are independent of validator blank labels.
- [x] CLI update/support acquisition requires an accepted fingerprint in addition to existing flags, reacquires once, and rejects changes in bytes/context/support/output lock/impact/inventories/root without writes. Support set gains no unapproved accept-impact flag.
- [x] Browser apply uses the exact session/instance-owned staged bytes without reacquisition, validates expiry/fingerprint/acceptance/revisions, and consumes on success. Detach preserves the preview; cancel/restart/relevant changes invalidate it; uncertain response outcomes require inspection.
- [ ] Manual support set supplies an association absent from the source, retaining separate source, inventory, provenance, and activity; main updates preserve manual attachments while refreshing discoverable support. If the source later supplies the same role, retain both, deduplicate equal shapes/run distinct shapes, and resolve all design candidates without making the manual attachment an implicit winner. Preview the changed active support set and its impact. Clearing deactivates only the requested association and retains bytes/selectors; inactive support is excluded from interpretation and unrelated updates never silently reacquire it.
- [x] Deduplicate equal active shapes, run distinct associated shapes separately with source attribution, and feed designs through normal whole-design resolution rather than field merging. Previously locked content remains available offline.
- [x] Cancellation, unavailable/unparseable sources, stale plans, or publication failures preserve current snapshots/lock bytes and keep controls responsive. Accepted semantic invalidation completes successfully with resulting validity.
- [ ] Public-operation and CLI/browser fixtures cover every normative impact example, anonymous identity stability/unassessability, changed reacquisition, absent flags, root/inventory conflicts, handle ownership/expiry/single consumption, manual support survival/deactivation, independent additions, rollback, and zero browser refetch. Include a standalone dependency with no discoverable source support association, attach shapes/design explicitly, then update a source that introduces the same role and verify retained attachments/deduplication/design precedence and disclosed impact. Dependency checks also inspect manually attached source resources. Clear each attachment while retaining its recorded files and excluding inactive support from interpretation.

## Blocked by

- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).
- [09 - Resolve ontology versions and detect source drift](09-resolve-ontology-versions-and-check-drift.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 09](../../mvp-technical-architecture/issues/09-shacl-validation-boundary.md).
- [Architecture decision 12](../../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

## Answer

Implemented dependency update and explicit SHACL/design support through the public API, CLI, authenticated HTTP routes, and browser. Updates use complete semantic diagnostic multisets and required-check coverage to gate introduced or worsened errors; CLI apply reacquires and compares the accepted fingerprint before writing, while browser apply consumes the exact session-owned staged bytes. Manual support records its source and activity, survives main dependency updates, and clearing an association retains its files while excluding inactive support from interpretation.

Verification passed after syncing the current integration tip: root `npm run format` and `npm run check`, app `npm run typecheck` and `npm run build`; focused CLI tests passed 2/2, the public impact-acceptance API test passed 1/1, the built-asset authenticated HTTP dependency workflow passed 1/1, and diagnostic impact tests passed 5/5, with zero failures or skips. A live T3 browser flow applied an update only after the impact acceptance checkbox was selected, then cleared support and confirmed the retained attachment was inactive and no longer interpreted.

- On 2026-10-17, merge reconciliation retained the implementation answers and verification history from `main`. The ticket is reopened only for expanded semantic-audit criteria whose complete evidence has not been reconciled; unchecked criteria do not establish a production failure or authorize new implementation.
