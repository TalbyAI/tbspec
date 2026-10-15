# Create reusable designs and customize each view

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 09, 12, 13
User stories covered: 69, 70, 71, 72

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can create, import, inspect, edit, and remove declarative visual designs, choose a whole winning design for an exact concept, and personalize styles/groups/rule choices in each view's presentation graph. Missing or ambiguous appearance remains generically renderable and does not change domain content or specialized-form recognition.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Implement design list/show/create/import/remove/select/clear and browser rule editing. New/editable-imported designs receive the specified identities/provenance; import does not silently select a winner. Removal uses reviewed confirmation and retains unresolved references explicitly.
- [x] Visual rules target exact concept types/properties without subclass inheritance. Resolve whole designs by explicit consuming choice, owned design, effective-ontology-associated design, then nearer inherited designs; never merge competing fields.
- [x] A persisted per-view chosen rule must belong to the winning design and apply to an explicit type. Multiple exact-type rules require a deliberate applicable choice; a losing design cannot be selected indirectly through presentation.
- [x] Render absent coverage or unchosen competing rules generically with canvas warnings rather than model invalidity. Diagnose broken persisted rule choices through presentation validation.
- [x] Support only the settled node/edge fields, enums, finite numeric guards, label-mode inheritance, shapes, colors, and typography through fixed renderer components and typed assignments. Project content cannot provide arbitrary CSS/HTML/scripts/URLs/fonts/components.
- [x] Persist view-local rule choices, styles, flat grouping, and paired finite absolute coordinates only in presentation data. Preserve negative coordinates and unrelated appearance/positions; no source statements, camera, or layout-option schema are introduced.
- [x] Extend shared discovery, validation, model-type design association, locked/manual design support resolution, impact/removal, and source move integration for complete design/presentation behavior.
- [x] Public-operation/browser checks cover imported versus selected designs, precedence/ties/clear, exact-type rather than hierarchy matching, multi-type ambiguity, winning-rule applicability, field/number rejection, safe rendering, two independent appearances, source-byte preservation, and stale coupled writes.

## Answer

Implemented reusable design lifecycle and per-view appearance through shared project operations, CLI commands, and authenticated browser workflows. Designs can be listed, inspected, created, imported, removed with reviewed confirmation, selected, and cleared. Imports receive the requested graph/rule identities and provenance without selecting a winner; removal reports and retains unresolved references. Browser views support design rule editing and presentation-local appearance changes.

Designs resolve whole, per exact target, in the normative order: consuming-project choice, owned design, design associated with the effective ontology, then the nearest inherited design. Competing fields are never merged. Node rules match exact explicit class types and edge rules exact predicate types, with no hierarchy inheritance. A saved `chosenRule` must come from the winning design and apply to an explicit type. Missing coverage and unchosen competing rules remain generically renderable with canvas warnings; broken persisted choices are reported as presentation diagnostics. No foreign-vocabulary rejection or implicit mapping gate was added, consistent with ticket 07.

Only the allowlisted node/edge appearance fields, enums, label rules, and finite renderer values reach fixed components through typed assignments. View-local style overrides, flat groups, applicable rule choices, and paired finite absolute coordinates are stored in each view's presentation graph. Negative and fractional coordinates are retained. Complete-graph choices remain temporary until saved to a view, and appearance edits leave source RDF bytes unchanged.

Design resolution for owned and locked sources is returned from the same captured, validated snapshot used by editor inspection. Editing an element's `rdf:type` refreshes the effective rules; locked models can use manually attached design support while remaining read-only. Views and design inventories are read sequentially to avoid `PROJECT_BUSY`. During graph-based source edits, only the `DESIGN_CONFLICT` identity for a winning-design collision is excluded from structural synchronization blockers; the diagnostic remains visible, and malformed or stale required views/presentations still refuse coupled writes.

## Validation

On `feat/mvp-ticket-14`, based on integration `5cfd7651` at commit `79046a5` plus the preserved authored working-tree changes, the latest focused serial runs passed: `editing.test.ts` 13/13 in 108.9 seconds, `views-workspace.test.ts` 1/1 in 122 ms, and `editor-design-web.test.ts` 2/2 in 52.1 seconds, with zero failures, cancellations, or skips. These runs covered preserving structurally valid views through an unrelated source edit under a design tie, sequential inventory reads, same-snapshot style refresh after type edits, and locked-source manual design rendering with writes refused and source bytes unchanged. Only this issue's Answer/State documentation changed after those runs.

Native T3 renderer checks exercised the complete graph and saved views. The selected exact Child rule rendered its node green (`rgb(17, 170, 34)`) and the edge rule rendered a dashed edge (`rgb(204, 68, 34)`); a tied node stayed generic white with conflict and ambiguity warnings. Two saved views retained distinct fills (`#aa2233` and `#2255aa`) through normal navigation and remount, with matching DOM colors and unchanged source SHA-256 `bc2e2ca65f1c2740bd7426bb8957f0663809393de674977d6f7ad67fcf6c84f6`. A source type edit refreshed rule candidates and appearance; a multi-type ambiguity returned the node to generic white until the user explicitly chose a rule. A locked manually supported source rendered `#224466`, displayed its exact selector and read-only guidance, disabled source-edit controls, and remained byte-identical to the acquired snapshot. The locked fixture retained its `VOCABULARY_UNKNOWN` diagnostic; inspection and styling still worked.

After the implementation and this ticket Answer were written, root `npm run format` and `npm run check` passed (Biome: 121 files; Markdown: 67 files, zero issues), and app `npm run typecheck` passed. App `npm run build` passed with 178 modules; only the existing `@xyflow/react` module-directive and large-chunk notices were emitted. The later edits to this validation paragraph are documentation-only.

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
