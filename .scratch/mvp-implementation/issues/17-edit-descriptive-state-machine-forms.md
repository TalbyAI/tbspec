# Edit descriptive state machines

Type: AFK
Status: ready-for-agent
Blocked by: 05
User stories covered: 79, 80, 81, 84, 85, 86, 88

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A state-machine author can describe machines, states, initial/final status, and transitions through exact-term forms over shared RDF operations. Explicit memberships and endpoints remain deliberate, other types/values remain intact, and incomplete or cyclic descriptions stay editable with declared diagnostics rather than runtime semantics.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Recognize only the exact settled state-machine namespace/types in a valid state-machine graph. InitialState/FinalState expose their fixed State fields without inferred superclass persistence; form selection is independent of appearance, aliases, and hierarchy.
- [ ] Expose every applicable type section and value, preserve unknown statements and language/datatype, and route unsupported structures to generic editing. Existing known data remains editable with unavailable-vocabulary diagnostics; offer creation only for available terms.
- [ ] Machine forms show associated local states/transitions via explicit inMachine statements. State/status and Transition machine/source/target/event/condition/action bindings use exact terms and mutate only selected values.
- [ ] Changing initial/final status adds/removes only the selected explicit type statement and preserves other types. A state may be both initial and final; no whole-type-set replacement occurs.
- [ ] State/Transition creation requires an explicit machine selection, and transition creation requires selected endpoints. Write only the selected exact types/values/associations without inferred superclass or optional statements.
- [ ] Keep Add triple separate from Create transition. Transitions remain resource nodes with direct source/target and descriptive RDF edges, rather than canvas-only semantic edges.
- [ ] Allow empty machines, cycles, self-transitions, optional descriptions, and initial-plus-final states. Diagnose wrong-machine endpoints, multiple initial states, and final outgoing transitions without automatic repair, reachability, determinism, hierarchy/parallel regions, or execution requirements.
- [ ] Forms use existing revision-checked mutations, read-only snapshot enforcement, and parseable-invalid/source-repair behavior; synchronize saved views through issue 13 when present.
- [ ] Browser/public-operation workflows verify exact recognition in copied vocabularies without selected designs, multi-type preservation, explicit status changes, no inferred creation, descriptive constraints, Transition projection, unknown/multiple/typed values, stale drafts, and independent source/presentation scope.

## Blocked by

- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 16](../../mvp-technical-architecture/issues/16-specialized-form-boundary.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

