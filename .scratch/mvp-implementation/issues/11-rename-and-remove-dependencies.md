# Rename and deliberately remove dependencies

Type: task
Status: ready-for-agent
State: open
Blocked by: 10
User stories covered: 52, 101

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can preview and apply an administrative dependency-ID rename or confirm removal of one selected addition. Renaming updates owned selectors and inventory locations without changing semantic identities; removal discloses all known impact and affects only that addition. Other additions, retained owned references, and deliberate semantic invalidity remain explicit.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement dependency rename/remove and matching browser actions through shared operations with bare administration IDs and exact retained graph selectors in output.
- [ ] Rename previews every owned selector/path/choice/configuration change and requires apply. Change the lock inventory location and owned references together, preserving original snapshot bytes, declared graph IRIs, parser contexts, and interpretation signatures.
- [ ] Reject invalid/colliding IDs, occupied destinations, stale revisions, and malformed required rewritten files without partial mutation. Disclose any selector-derived unrooted graph identity change instead of silently treating it as a declared IRI rename.
- [ ] Removal without confirm returns the direct/downstream impact, including owned and locked known references. Confirmation removes only the chosen addition's managed inventory/record and associated choices as specified; independently acquired snapshots and owned source references remain intact.
- [ ] Do not cascade-delete owned views, models, independent designs, or other additions to fix invalidity. Where retained associations/invariants become invalid, return resulting validity with successful mutation status and let later status/validation diagnose them.
- [ ] Local apply rechecks accepted fingerprints when supplied, revisions, and inventories. Browser apply uses reviewed server-held plans; normal failures preserve bytes/records and interruption retains recovery evidence.
- [ ] Public-operation and CLI/browser checks demonstrate no RDF/content/signature changes after ID rename, collision refusal, separate repeated acquisitions, exact removal scope, breaking-removal diagnostics, changed-preview rejection, and multi-file rollback. Issue 13 extends owned-view selector handling when that resource kind is introduced.

## Blocked by

- [10 - Update dependencies and manage explicit support](10-update-dependencies-and-manual-support.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 12](../../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
