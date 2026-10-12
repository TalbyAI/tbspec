# Edit descriptive state machines

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 05
User stories covered: 79, 80, 81, 84, 85, 86, 88

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A state-machine author can describe machines, states, initial/final status, and transitions through exact-term forms over shared RDF operations. Explicit memberships and endpoints remain deliberate, other types/values remain intact, and incomplete or cyclic descriptions stay editable with declared diagnostics rather than runtime semantics.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Recognize only the exact settled state-machine namespace/types in a valid state-machine graph. InitialState/FinalState expose their fixed State fields without inferred superclass persistence; form selection is independent of appearance, aliases, and hierarchy.
- [x] Expose every applicable type section and value, preserve unknown statements and language/datatype, and route unsupported structures to generic editing. Existing known data remains editable with unavailable-vocabulary diagnostics; offer creation only for available terms.
- [x] Machine forms show associated local states/transitions via explicit inMachine statements. State/status and Transition machine/source/target/event/condition/action bindings use exact terms and mutate only selected values.
- [x] Changing initial/final status adds/removes only the selected explicit type statement and preserves other types. A state may be both initial and final; no whole-type-set replacement occurs.
- [x] State/Transition creation requires an explicit machine selection, and transition creation requires selected endpoints. Write only the selected exact types/values/associations without inferred superclass or optional statements.
- [x] Keep Add triple separate from Create transition. Transitions remain resource nodes with direct source/target and descriptive RDF edges, rather than canvas-only semantic edges.
- [x] Allow empty machines, cycles, self-transitions, optional descriptions, and initial-plus-final states. Diagnose wrong-machine endpoints, multiple initial states, and final outgoing transitions without automatic repair, reachability, determinism, hierarchy/parallel regions, or execution requirements.
- [x] Forms use existing revision-checked mutations, read-only snapshot enforcement, and parseable-invalid/source-repair behavior; synchronize saved views through issue 13 when present.
- [x] Browser/public-operation workflows verify exact recognition in copied vocabularies without selected designs, multi-type preservation, explicit status changes, no inferred creation, descriptive constraints, Transition projection, unknown/multiple/typed values, stale drafts, and independent source/presentation scope.

## Blocked by

- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 16](../../mvp-technical-architecture/issues/16-specialized-form-boundary.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

## Answer

Implemented exact state-machine bindings for the settled namespace in the shared editor, including fixed State fields for InitialState and FinalState, additive explicit status controls, and machine membership lists based only on `sm:inMachine`. New state-machine resources use the shared revision-checked mutation path; state and transition creation require an explicit local machine, and transitions require exact local endpoints explicitly associated with that machine. The browser form offers only supported vocabulary terms and available fields, retains creation drafts across revision conflicts, and keeps transition creation separate from Add triple. Generic RDF controls retain unsupported statements and values, and the existing canvas continues to project Transition resources and their direct RDF statements.

Added public-operation and authenticated HTTP coverage for exact recognition without a selected design, replacement vocabulary diagnostics, multi-type and language/datatype preservation, exact status edits, missing or wrong-machine creation bindings, and no inferred types or optional statements. The focused editing, draft, HTTP, and validation suite passed 32 tests. `npm run typecheck`, `npm run build`, root `npm run format`, and root `npm run check` passed. A dedicated local browser preview verified state status controls, explicit machine membership, descriptive self-transition creation and direct RDF edges, and stale draft reconciliation.
