# Validate models, schema associations, and constraints offline

Type: AFK
Status: ready-for-agent
Blocked by: 03
User stories covered: 2, 5, 25, 26, 29, 30, 89, 90, 91, 92, 93, 94, 101

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can associate a concrete model with zero or more conceptual schemas, author associated shapes, and validate selected resources or the whole project offline. Both interfaces report syntax, classification, vocabulary, association, and SHACL diagnostics separately, including what could not be checked. View/presentation invariants are delivered by 13 and completed for authored design/style/rule choices by 14; those categories are not claimed as checked before their scope is delivered. The validation workflow uses only declared local or locked interpretation context and never treats arbitrary individual-valued IRIs as fetch instructions.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close on schema/shapes management and offline validation of owned ontologies/models, bundled resources/design fixtures, and their available declared interpretation context. Syntax, classification, vocabulary, association, and applicable SHACL coverage must be verified now. Acquired/source-bound contexts are extended by 08-10; saved-view and paired-presentation invariants by 13; authored-design and rule/style invariants by 14. These later checks are assigned obligations, not passed criteria or complete shared stories at this milestone. Missing prerequisites and unchecked coverage cannot be reported clean.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [ ] Implement model schema list/add/remove, shapes list/create, and selected/whole-project validate with matching browser operations. Schema removal previews the vocabulary and affected references it removes and requires confirmation; shapes deletion is delivered in issue 12.
- [ ] Concrete models need not have a schema. Selected conceptual schemas add available declarations without replacing the model's own ontology; missing, nonconceptual, or wrongly classified declared references receive association diagnostics. In acceptance scenario 1, demonstrate both a concrete model with no schema association (not invalid for that absence) and one with an explicit reference to a missing/wrong-kind schema (diagnosed); do not turn the scenario's shorthand into a mandatory-schema rule.
- [ ] Each SHACL run contains only target triples plus the explicit effective vocabulary/schema subclass/subproperty hierarchy in the agreed validator context. Never add unrelated model data, inferred persisted statements, or a consumer manifest rebinding for locked models.
- [ ] Apply target-owned, effective ontology-associated, and conceptual-schema-associated shapes separately, deduplicate equal shapes, and attribute every result to its target and source shapes graph. Dependency contexts extend this workflow in issues 08-10.
- [ ] Support the settled Core and sh:sparql SELECT profile with validated prefix/PATH expansion, this projection, and pre-binding restrictions. Gate expanded queries before execution; skip unsupported/unsafe shapes as whole shapes with actionable coverage records. Negative fixtures reject PATH outside triple-predicate position, missing outer this projection, Update/nested SERVICE/FROM/FROM NAMED, MINUS/VALUES, AS rebinding of potentially prebound this/shapesGraph/currentShape, subqueries omitting this, and references to unbound shapesGraph/currentShape. Reject unsupported SPARQL targets/custom components explicitly and let independent valid shapes continue.
- [ ] Malformed RDF/shapes or missing required prerequisites block only dependent checks. Independent resources and valid shapes continue; skipped checks and blockers are explicit, no source locations are invented, and warnings/info alone remain successful.
- [ ] Use the exact managed-reference positions to distinguish unavailable vocabulary/associations from ordinary external individual values. Validation, status, and rendering make no network or implicit acquisition requests.
- [ ] Exercise every bundled valid/invalid vocabulary, shapes, and design fixture, including empty starters, compatible versus ambiguous roots, process inverse inputs/outputs/shared-plan/distinct-producer constraints, and state ownership/endpoints/initial/final/cycle constraints.
- [ ] Allowed confirmed schema removal may leave semantic errors: the completed mutation succeeds with resulting validity, while later validation/status reports them. Revision conflicts and malformed required rewritten graphs still prevent publication.
- [ ] Public-operation tests assert returned diagnostic identities, severity, target/source attribution, check.kind, completed/skipped coverage with blockers, and RDF/file outcomes separately for syntax, classification, vocabulary, association, and SHACL checks. Focused CLI/browser checks verify command routing, selected prerequisite scope, schema confirmation, offline behavior, and partial validation. Issues 13/14 own equivalent category-specific evidence for later view/presentation and design invariants.
- [ ] Shapes self-declarations and classification follow the settled managed-root/support-kind contract; compatible kinds, conflicting kinds, multiple roots, and parseable unclassified support receive the specified classification/coverage without guessed roots. Later support-kind owners 13/14 must extend these same checks for views, presentations, and designs.

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
