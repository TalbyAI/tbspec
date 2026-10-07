# Install and verify the complete application on supported platforms

Type: AFK
Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19
User stories covered: 9, 54, 117

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can install one actual npm artifact and use the complete CLI and local browser offline on Windows, macOS, and Linux with Node as the only mandatory installed runtime. Verify packaging, immutable starter inventory, upgrade compatibility, and the fully assembled user workflows against the installed artifact rather than a development checkout. External npm publication, hosting, and deployment remain separate release actions.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Produce one packed artifact containing compiled TypeScript CLI/server entry points, matching prebuilt local React/Vite/React Flow assets and ELK worker, pinned production dependencies, immutable starter releases/digests/parser contexts, and complete license/source inventory.
- [ ] Install and run the actual packed artifact in clean environments with Node 24 and without build tools, repository files, or prototype dependencies. Git is optional and required only for explicit Git acquisition; unsupported requested resource releases fail rather than substituting.
- [ ] Initialization, ordinary status/configuration/lifecycle operations, validation, queries, and browser graph/form/view/layout use work without network access. Rendering/query/validation never initiate hidden acquisition requests.
- [ ] Package upgrades leave canonical project schema versions, locked resources, snapshots, and descriptions unchanged. Reset restores the project's locked defaults; no automatic migration/update/restart occurs.
- [ ] Document stop-before-replacement guidance and verify compatible reconnection versus incompatible protocol refusal. Browser assets/API remain tied to the launched server release, and status reports that actual version.
- [ ] Run platform-sensitive ownership/protected records, process identity/lifecycle, path/link/alias confinement, staged publication/rollback, acquisition, and package checks on Windows, macOS, and Linux with real processes/filesystem boundaries before claiming support for all three.
- [ ] Execute all seven original functional acceptance scenarios against the assembled application: project/conceptual/concrete/schema creation; acquisition/check/update; accepted vocabulary replacement; independent views/design ties; retained ontology conflicts; breaking removal/repair/GC; and malformed RDF with isolated querying/partial diagnostics.
- [ ] Check every public command family has exact routing/help/guidance and one-envelope JSON/error/exit behavior. Use focused real browser/HTTP checks for bootstrap, drafts, forms, canvas/views/layout, staged previews, and lifecycle rather than duplicating all core permutations.
- [ ] Record artifact identity, Node/OS versions, exact install/run/check commands, measured outcomes, and material limitations. Missing platform execution is explicit incomplete evidence, not a passed mock or an assumption from prototype verdicts.
- [ ] Tests introduced by earlier tickets remain the primary public-operation seam; broaden integration only to installed-artifact, cross-platform, and cross-feature risks that those checks cannot establish. Do not claim multi-file crash atomicity, network-share guarantees, public publication, or vocabulary hosting.

## Blocked by

- [01 - Initialize and discover an offline project](01-initialize-offline-project.md).
- [02 - Inspect the project from CLI and an authenticated browser](02-inspect-project-and-authenticated-web.md).
- [03 - Create and import editable ontologies and domain models](03-create-and-import-owned-resources.md).
- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).
- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).
- [06 - Run and manage reproducible SPARQL queries](06-run-and-manage-sparql-queries.md).
- [07 - Configure model types and accept vocabulary changes](07-configure-model-types-and-vocabulary-changes.md).
- [08 - Acquire dependencies from directories, HTTP, and Git](08-acquire-directory-http-and-git-dependencies.md).
- [09 - Resolve ontology versions and detect source drift](09-resolve-ontology-versions-and-check-drift.md).
- [10 - Update dependencies and manage explicit support](10-update-dependencies-and-manual-support.md).
- [11 - Rename and deliberately remove dependencies](11-rename-and-remove-dependencies.md).
- [12 - Move and remove owned resources with impact review](12-move-and-remove-owned-resources.md).
- [13 - Maintain independent views and synchronize their selections](13-maintain-independent-saved-views.md).
- [14 - Create reusable designs and customize each view](14-author-designs-and-view-appearance.md).
- [15 - Organize and explore the canvas without losing positions](15-organize-and-explore-canvas.md).
- [16 - Edit descriptive processes with specialized forms](16-edit-descriptive-process-forms.md).
- [17 - Edit descriptive state machines](17-edit-descriptive-state-machine-forms.md).
- [18 - Delete elements precisely and clean affected views](18-delete-elements-and-clean-view-selections.md).
- [19 - Refactor identities, repair references, and collect orphaned support](19-refactor-repair-and-collect-orphaned-support.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 05](../../mvp-technical-architecture/issues/05-select-rdf-stack.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 15](../../mvp-technical-architecture/issues/15-layout-and-exploration-policy.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

