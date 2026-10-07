# Update dependencies and manage explicit support

Type: AFK
Status: ready-for-agent
Blocked by: 04, 09
User stories covered: 45, 46, 47, 50, 51, 53, 115, 116

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can preview newer dependency content, assess downstream impact, and explicitly adopt exactly what was reviewed. They can attach or clear separately locked shapes/designs when a source exposes no association. Manual support survives main-source updates, and clearing an association retains its files without including inactive support in interpretation.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement dependency update and support set/clear in CLI/browser with exact source/file selection, source/interpretation changes, downstream diagnostics, expected revisions, staged content, and the common preview contract.
- [ ] Compare complete baseline/proposed diagnostic multisets using normative semantic identities, severity, and multiplicity, not prose, locations, totals, or output order. Resolved errors never offset new conditions; warning-to-error and increased error occurrences are worsened impact.
- [ ] Require update accept-impact for introduced/worsened errors or affected required blocked/unassessable coverage. Unchanged unrelated baseline failures and warning-only changes do not gate adoption; explicit acceptance never bypasses acquisition/parse/I/O failures.
- [ ] Match anonymous shape/path/focus/value identities only in unchanged source graph signatures using normalized source-parser blank-node identities. Changed/untraceable anonymous terms make affected checks unassessable; repeated fingerprints are independent of validator blank labels.
- [ ] CLI update/support acquisition requires an accepted fingerprint in addition to existing flags, reacquires once, and rejects changes in bytes/context/support/output lock/impact/inventories/root without writes. Support set gains no unapproved accept-impact flag.
- [ ] Browser apply uses the exact session/instance-owned staged bytes without reacquisition, validates expiry/fingerprint/acceptance/revisions, and consumes on success. Detach preserves the preview; cancel/restart/relevant changes invalidate it; uncertain response outcomes require inspection.
- [ ] Manual shapes/design attachments have separately recorded source, inventory, and activity; main updates preserve them. Clearing deactivates only the requested association and retains bytes/selectors; inactive support is excluded from interpretation.
- [ ] Deduplicate equal active shapes, run distinct associated shapes separately with source attribution, and feed designs through normal whole-design resolution rather than field merging. Previously locked content remains available offline.
- [ ] Cancellation, unavailable/unparseable sources, stale plans, or publication failures preserve current snapshots/lock bytes and keep controls responsive. Accepted semantic invalidation completes successfully with resulting validity.
- [ ] Public-operation and CLI/browser fixtures cover every normative impact example, anonymous identity stability/unassessability, changed reacquisition, absent flags, root/inventory conflicts, handle ownership/expiry/single consumption, manual support survival/deactivation, independent additions, rollback, and zero browser refetch.

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

