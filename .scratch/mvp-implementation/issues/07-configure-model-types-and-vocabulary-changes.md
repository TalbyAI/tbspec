# Configure model types and accept vocabulary changes

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 04, 05
User stories covered: 6, 13, 14, 15, 16, 17, 18, 19, 115

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can create additional model types, change ontology/design associations, disable or enable creation, and restore a built-in type's project-locked defaults through either interface. Replacing a used vocabulary is a reviewed configuration change that leaves model statements intact and explicitly disconnects the old design; generic editing remains available when specialized vocabulary is absent.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Implement model-type set/list/show through effective configuration, enable/disable/reset, and design set/clear with matching browser actions and exact local/locked selectors. Custom type removal is delivered by issue 12.
- [x] Disabling prevents new model creation without changing existing bindings, contents, or validity; enabling restores creation. Built-in types are disabled rather than removable.
- [x] Adding/replacing configuration preserves unrelated TOML keys, comments, and line endings. A replacement row does not inherit the old design field, and model graph bytes/statements remain unchanged.
- [x] Replacing a used ontology previews affected associations and validity and requires the specified impact acceptance. No automatic term mapping, ontology migration, superclass inference, or repair is performed.
- [x] Reset restores the project's recorded locked default row and resources, not the application package's latest resources. Explicit design selection/clearing remains independent of ontology and specialized-form recognition.
- [x] Demonstrate unchanged known terms in a local ontology copy, an arbitrary incompatible replacement, disconnected appearance, and retained generic/source editing with unavailable vocabulary diagnostics.
- [x] Local plans bind root, exact revisions, relevant inventory, proposed bytes, and disclosed impact. Browser previews stage server-held bytes, disclose the 15-minute expiry, enforce tab/instance/fingerprint/flags/revision ownership, and consume only on successful publication.
- [x] Cancel/restart/relevant changes invalidate browser handles; detach preserves unexpired previews. Apply requests cannot supply replacement bytes/plans, and uncertain transport outcomes require inspection rather than automatic write retries.
- [x] Shared-operation and CLI/browser workflows verify compatible/incompatible replacement, explicit acceptance, no model mutation, design disconnection/reselection, locked reset after a simulated package upgrade, stale previews, expiry, cancellation, and successful intentional invalidity.

## Blocked by

- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).
- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).
- [Architecture decision 16](../../mvp-technical-architecture/issues/16-specialized-form-boundary.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

## Answer

Implemented project-scoped model-type configuration through the shared operation, CLI, and browser configuration flow. Set/list/show, enable/disable, locked-default reset, and independent design set/clear use exact owned or locked graph selectors. Surgical TOML edits retain unrelated values, comments, and line endings; setting a semantically identical locked selector is a no-op that preserves the existing row and design.

Replacing a used ontology stages a revision-bound preview with affected models, before/after validity, and required `accept-impact`. Applying changes only configuration, disconnects the prior design, and reports resulting validity; existing RDF remains byte-identical and generic/source editing remains available with vocabulary diagnostics. Browser application uses staged server bytes and shared owner, instance, expiry, fingerprint, and revision checks. Reset reads the project's locked defaults.

Evidence includes 72 passing focused configuration, diagnostic-impact, authenticated HTTP preview/apply/cancel/stale/reset, schema-impact, authoring, validation, retention, and RDF/process-editor tests, plus passing CLI query and model-type workflows. The browser configuration was exercised against a live preview instance. After merging integration commit `02faa26`, root `npm run format`/`npm run check`, app typecheck, and app build passed; the build reported the existing `@xyflow/react` `use client` bundler warning. No full `npm test` or cross-platform CI run was performed for this ticket.
