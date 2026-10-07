# Create reusable designs and customize each view

Type: AFK
Status: ready-for-agent
Blocked by: 09, 12, 13
User stories covered: 69, 70, 71, 72

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can create, import, inspect, edit, and remove declarative visual designs, choose a whole winning design for an exact concept, and personalize styles/groups/rule choices in each view's presentation graph. Missing or ambiguous appearance remains generically renderable and does not change domain content or specialized-form recognition.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement design list/show/create/import/remove/select/clear and browser rule editing. New/editable-imported designs receive the specified identities/provenance; import does not silently select a winner. Removal uses reviewed confirmation and retains unresolved references explicitly.
- [ ] Visual rules target exact concept types/properties without subclass inheritance. Resolve whole designs by explicit consuming choice, owned design, effective-ontology-associated design, then nearer inherited designs; never merge competing fields.
- [ ] A persisted per-view chosen rule must belong to the winning design and apply to an explicit type. Multiple exact-type rules require a deliberate applicable choice; a losing design cannot be selected indirectly through presentation.
- [ ] Render absent coverage or unchosen competing rules generically with canvas warnings rather than model invalidity. Diagnose broken persisted rule choices through presentation validation.
- [ ] Support only the settled node/edge fields, enums, finite numeric guards, label-mode inheritance, shapes, colors, and typography through fixed renderer components and typed assignments. Project content cannot provide arbitrary CSS/HTML/scripts/URLs/fonts/components.
- [ ] Persist view-local rule choices, styles, flat grouping, and paired finite absolute coordinates only in presentation data. Preserve negative coordinates and unrelated appearance/positions; no source statements, camera, or layout-option schema are introduced.
- [ ] Extend shared discovery, validation, model-type design association, locked/manual design support resolution, impact/removal, and source move integration for complete design/presentation behavior.
- [ ] Public-operation/browser checks cover imported versus selected designs, precedence/ties/clear, exact-type rather than hierarchy matching, multi-type ambiguity, winning-rule applicability, field/number rejection, safe rendering, two independent appearances, source-byte preservation, and stale coupled writes.

## Blocked by

- [09 - Resolve ontology versions and detect source drift](09-resolve-ontology-versions-and-check-drift.md).
- [12 - Move and remove owned resources with impact review](12-move-and-remove-owned-resources.md).
- [13 - Maintain independent views and synchronize their selections](13-maintain-independent-saved-views.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 12](../../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- [Architecture decision 16](../../mvp-technical-architecture/issues/16-specialized-form-boundary.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

