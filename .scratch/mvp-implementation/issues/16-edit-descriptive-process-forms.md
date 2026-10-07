# Edit descriptive processes with specialized forms

Type: AFK
Status: ready-for-agent
Blocked by: 05
User stories covered: 79, 80, 81, 82, 83, 85, 86, 88

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A process author can describe plans, steps, decisions, variables, flows, and responsibility through exact-term forms over the same RDF graph as generic/source editing. Existing forward/inverse P-Plan input/output statements appear as one association with deliberate mutation semantics. Creation preserves descriptive, potentially unfinished structures instead of executing or completing them.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Recognize the settled pinned P-Plan 1.3 and process extension IRIs from valid process graph classification and exact explicit types. Decision exposes its fixed Step fields without writing superclass triples; visual designs, aliases, hierarchy, and older spellings do not select forms.
- [ ] Expose all applicable explicit-type sections and every existing field value without coercion or hidden deletion. Unknown terms/advanced structures remain generically accessible; literal lexical changes retain language/datatype.
- [ ] Bind Plan memberships, Step/Variable associations, responsibility, and Flow plan/endpoints/condition exactly as specified. Missing vocabulary keeps recognized existing values editable with diagnostics but suppresses unavailable creation choices.
- [ ] Present explicit Step-to-Variable and inverse Variable-to-Step input/output statements as one effective association. Additions write only the forward Step-to-Variable statement, including when initiated from a Variable form.
- [ ] Explicit association removal deletes all existing forward/inverse statements expressing that association in the edited graph; changing an association removes the old then adds the chosen new. Generic triple removal still removes only its selected statement; unrelated saves never rewrite inverse data.
- [ ] Step/Variable creation requires explicit Plan selection; Flow creation requires its selected Plan and endpoints. Write only selected exact types, fields, memberships, and endpoints without superclass/inverse/optional materialization or inferred precedence.
- [ ] Keep generic Add triple distinct from Create flow. Flow remains a resource node with exact RDF edges; no collapsed semantic connection or generated isPrecededBy statement is introduced.
- [ ] Preserve empty/shared plans, cycles/self-flows, multiple consumers, unfinished decisions, and optional conditions. Apply only declared producer/shared-plan/cardinality constraints and never execute condition text or invent missing structure.
- [ ] Use existing revision-bound graph operations and validation. When saved views exist, use issue 13 synchronization without implicitly selecting unrelated new members.
- [ ] Browser/public-operation workflows cover forward-only/inverse-only/both-direction associations, exact removals, multi-type Decision, missing terms, invalid/multiple/language/datatype values, unknown preservation, creation without inference, explicit Flow projection, stale forms, read-only snapshots, and parseable-invalid versus malformed data.

## Blocked by

- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 16](../../mvp-technical-architecture/issues/16-specialized-form-boundary.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

