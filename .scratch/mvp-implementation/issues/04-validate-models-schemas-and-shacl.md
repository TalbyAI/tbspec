# Validate models, schema associations, and constraints offline

Type: task
Status: ready-for-agent
State: open
Blocked by: 03
User stories covered: 2, 5, 25, 26, 29, 30, 89, 90, 91, 92, 93, 94, 101

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can associate a concrete model with zero or more conceptual schemas, author associated shapes, and validate selected resources or the whole project offline. Both interfaces report syntax, classification, vocabulary, association, view, presentation, and SHACL diagnostics separately, including what could not be checked. The validation workflow uses only declared local or locked interpretation context and never treats arbitrary individual-valued IRIs as fetch instructions.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement model schema list/add/remove, shapes list/create, and selected/whole-project validate with matching browser operations. Schema removal previews the vocabulary and affected references it removes and requires confirmation; shapes deletion is delivered in issue 12.
- [ ] Concrete models need not have a schema. Selected conceptual schemas add available declarations without replacing the model's own ontology; missing, nonconceptual, or wrongly classified references receive association diagnostics.
- [ ] Each SHACL run contains only target triples plus the explicit effective vocabulary/schema subclass/subproperty hierarchy in the agreed validator context. Never add unrelated model data, inferred persisted statements, or a consumer manifest rebinding for locked models.
- [ ] Apply target-owned, effective ontology-associated, and conceptual-schema-associated shapes separately, deduplicate equal shapes, and attribute every result to its target and source shapes graph. Dependency contexts extend this workflow in issues 08-10.
- [ ] Support the settled Core and sh:sparql SELECT profile with validated prefix/PATH expansion, this projection, and pre-binding restrictions. Gate expanded queries before execution; skip unsupported/unsafe shapes as whole shapes with actionable coverage records.
- [ ] Malformed RDF/shapes or missing required prerequisites block only dependent checks. Independent resources and valid shapes continue; skipped checks and blockers are explicit, no source locations are invented, and warnings/info alone remain successful.
- [ ] Use the exact managed-reference positions to distinguish unavailable vocabulary/associations from ordinary external individual values. Validation, status, and rendering make no network or implicit acquisition requests.
- [ ] Exercise every bundled valid/invalid vocabulary, shapes, and design fixture, including empty starters, compatible versus ambiguous roots, process inverse inputs/outputs/shared-plan/distinct-producer constraints, and state ownership/endpoints/initial/final/cycle constraints.
- [ ] Allowed confirmed schema removal may leave semantic errors: the completed mutation succeeds with resulting validity, while later validation/status reports them. Revision conflicts and malformed required rewritten graphs still prevent publication.
- [ ] Public-operation tests assert returned diagnostic identities, severity, target/source attribution, coverage, and RDF/file outcomes; focused CLI/browser checks verify command routing, selected prerequisite scope, schema confirmation, offline behavior, and partial validation. Later view/presentation slices extend their invariant checks here.

## Blocked by

- [03 - Create and import editable ontologies and domain models](03-create-and-import-owned-resources.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 09](../../mvp-technical-architecture/issues/09-shacl-validation-boundary.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
