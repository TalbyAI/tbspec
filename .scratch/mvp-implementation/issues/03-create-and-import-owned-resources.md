# Create and import editable ontologies and domain models

Type: AFK
Status: ready-for-agent
Blocked by: 02
User stories covered: 7, 21, 22, 23, 24, 27, 28, 31, 62

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can create, list, and inspect project-owned ontologies and conceptual, concrete, process, or state-machine models from both interfaces. They can also adopt an external local resource or available locked snapshot as an editable copy with a new graph identity and recorded provenance while keeping vocabulary term identities intact. The workflow records deliberate model-type associations and exposes missing vocabulary rather than inventing rebinding.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Ontology and model list/show/create/import commands and matching browser actions expose identity, selector, kind, configured association, support, and provenance through shared operations.
- [ ] Creation uses the explicitly supplied graph IRI or the configured base-IRI rule, refuses occupied destinations and identity collisions, and writes the exact self-declaration and enabled model-type association required by the contract.
- [ ] Create conceptual and concrete data models distinctly, as well as empty descriptive process/state-machine models. Conceptual resources describe classes/properties; concrete resources remain available for generic individual/value editing.
- [ ] Creation rejects disabled, missing, or unusable types with diagnostics. Imports use the explicitly selected receiving type and report absent vocabulary without silently copying, renaming, or remapping term IRIs.
- [ ] Editable import assigns a new managed root identity and provenance while preserving original class/property/individual terms and unknown statements. Merely opening a locked resource remains read-only; bundled snapshots provide an initial executable import example and acquired snapshots extend it in issue 08.
- [ ] Classification relies on graph-root declarations rather than filenames or business types. Conflicting kinds/multiple roots are diagnosed, and parseable unclassified resources remain available for inspection.
- [ ] CLI and browser creation/import use confined paths, revision checks, staged publication, and the common machine/diagnostic contract. Failed import, parse, identity, destination, or publication checks leave existing files untouched.
- [ ] Public-operation and focused CLI/browser workflows demonstrate explicit and derived identity creation, each built-in model family, independent term preservation on editable import, missing vocabulary diagnostics, read-only originals, and occupied/invalid destinations. Full constraint validation is extended by issue 04.

## Blocked by

- [02 - Inspect the project from CLI and an authenticated browser](02-inspect-project-and-authenticated-web.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 01](../../mvp-technical-architecture/issues/01-permanent-iri-policy.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

