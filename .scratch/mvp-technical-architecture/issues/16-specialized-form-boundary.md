# Choose specialized form bindings and generic fallback

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: iskan
Blocked by: 07, 11

## Question

How should ontology, conceptual data, process, and state-machine forms bind to the exact recognized RDF terms while preserving unknown statements and leaving arbitrary replacement vocabularies in the generic editor? Decide the boundary between specialized form mutations, canvas edits, and source editing using the chosen projection and starter resource contract. Keep visual design selection separate from term recognition.

## Comments

- The user approved the first interview round with "de acuerdo": ontology and conceptual-data forms share the proposed class/datatype/property bindings; ontology individual forms recognize `owl:NamedIndividual`, while concrete models retain generic editing. Classes recognize `owl:Class` and `rdfs:Class` and expose labels, comments, and `rdfs:subClassOf`; datatypes recognize `rdfs:Datatype` and expose labels and comments; properties recognize `rdf:Property`, `owl:ObjectProperty`, and `owl:DatatypeProperty` and expose labels, comments, `rdfs:subPropertyOf`, domains, and ranges. Advanced OWL constructs remain generic.
- The same approval covers selectable sections for multiple recognized types, combining compatible specializations without changing any type; term-level editing that exposes every existing value and its diagnostics without coercion or loss, preserves literal language/datatype when only text changes, and routes unsupported structures to generic editing while retaining other editable fields; and P-Plan input/output bindings that read explicit forward and inverse statements together, write new associations in the Step-to-Variable direction, and remove all explicit statements expressing an association only when that association is explicitly removed.
- The user approved the second interview round with "de acuerdo": creation writes the exact selected type and explicitly supplied memberships/endpoints without superclass, inverse, or optional-value materialization; absent vocabulary terms are not offered for creation, while existing recognized statements remain editable with diagnostics. Generic canvas connection adds a triple; explicit Flow/Transition creation adds a resource and its exact triples without collapsing the RDF projection. Element deletion previews and confirms removal of all occurrences in the edited source graph, synchronizes affected views/presentation, preserves other-graph references with diagnostics, and never recursively deletes related resources. Graph-root deletion belongs to resource lifecycle operations.
- Both rounds' recommendations were approved. No further decision remains for this ticket; the resolution below records the shared understanding. Production implementation remains outside this map.

- On 2026-10-04, the user authorized closing the MVP deletion-reference review gap. The historical approval of other-graph diagnostics is clarified below: all known occurrences are disclosed as impact, while persistent errors require evidence in current associations, vocabulary, view/presentation invariants, or explicit constraints. Ordinary individual-valued links remain permitted without a deleted-identity registry.

## Answer

Use the approved binding and mutation contract below. Specialized forms are views over the same parsed RDF graph and shared RDF-term operations as the generic editor; they do not own a reconstructed subset of the graph.

### Recognition and applicability

- Use the exact namespaces and stable term IRIs in [Define metadata and starter resource identities and shapes](11-starter-resource-contract.md). Prefix aliases, labels, file names, model-type names, visual designs, and similar-looking IRIs are not semantic bindings. Unchanged terms in a local ontology copy retain their forms. Do not map arbitrary replacement classes/properties, subclasses, equivalent classes, or older P-Plan spellings into the recognized terms.
- Choose the editor family from the graph's managed classification, following that contract: ontology, conceptual data, process, or state-machine. Concrete data models, additional model types, and unclassified graphs retain generic editing. An ambiguous or incompatible graph-root classification receives diagnostics and generic/source editing rather than an invented specialized classification.
- Within an applicable family, a resource's explicit recognized `rdf:type` statements select its form sections. Fixed recognized specializations share their base fields: `proc:Decision` has Step fields; `sm:InitialState` and `sm:FinalState` have State fields. This is a built-in field binding, not general hierarchy inference and not permission to write superclass triples.
- Expose all applicable sections for multiple recognized types instead of choosing a single type or changing the graph on opening a form. Compatible sections share fields without duplicating the same RDF statement. Incompatible combinations remain visible with diagnostics; do not silently normalize them. Unknown types and properties remain accessible through generic editing.
- Form recognition is independent of visual-rule availability, precedence, and a per-view chosen rule. Missing vocabulary support does not erase recognized existing data: keep it editable and report the established vocabulary/support diagnostics. Offer creation only for exact terms available through that graph's settled vocabulary-resolution contract; never silently restore a replaced ontology.
- Graph-based forms require parseable RDF. Parseable but semantically invalid data remains editable/saveable with diagnostics under the existing validation contract. Malformed Turtle uses source editing until repaired. Locked dependency snapshots remain read-only.

### Ontology and conceptual-data bindings

`labels` and `comments` below mean individual literal statements using `rdfs:label` and `rdfs:comment`. Identify every field value by its RDF terms, not its displayed text.

| Resource section | Exact recognized explicit types | Editable bindings |
| --- | --- | --- |
| Class / conceptual entity | `owl:Class`, `rdfs:Class` | Labels, comments, `rdfs:subClassOf`. |
| Datatype | `rdfs:Datatype` | Labels and comments. |
| Property | `rdf:Property`, `owl:ObjectProperty`, `owl:DatatypeProperty` | Labels, comments, `rdfs:subPropertyOf`, `rdfs:domain`, `rdfs:range`. |
| Ontology individual | `owl:NamedIndividual` | Labels, comments, exact explicit `rdf:type` values, and individual property values using the shared generic RDF-term controls. |

Ontology and conceptual-data forms share the class/datatype/property bindings. Conceptual entities are class declarations; attributes are datatype-property declarations; relationships are object-property declarations. Do not generate property domain/range statements merely because a property is displayed beside an entity. The user explicitly supplies those associations. Ontology individual forms do not introduce a specialized concrete-data-model editor; resources outside the recognized sections remain generically editable.

Ontology-root declarations and metadata retain the starter and lifecycle contracts. Advanced OWL constructs, including restrictions, unions, intersections, and RDF lists, remain generic. A blank-node expression used as a recognized field value remains visible as that exact value with access to the generic editor; the simple form does not flatten, interpret, or replace its structure. Do not derive the form's field coverage from the starter design's visual-rule target list.

### Process bindings

Use pinned P-Plan 1.3 terms under `http://purl.org/net/p-plan#` and the exact process extension namespace `https://talby.ai/ontology/process#`.

| Resource section | Exact recognized explicit types | Editable bindings beyond labels/comments |
| --- | --- | --- |
| Plan | `p-plan:Plan` | Its associated local steps and variables through the exact memberships below; no invented containment property. |
| Step / Decision | `p-plan:Step`, `proc:Decision` | `p-plan:isStepOfPlan`, effective inputs/outputs, `proc:responsibleParty`. |
| Variable | `p-plan:Variable` | `p-plan:isVariableOfPlan`, effective producer/consumer associations. |
| Flow | `proc:Flow` | `proc:source`, `proc:target`, `proc:inPlan`, `proc:condition`. |

Read effective inputs from both `Step p-plan:hasInputVar Variable` and `Variable p-plan:isInputVarOf Step`; read outputs from both `Step p-plan:hasOutputVar Variable` and `Variable p-plan:isOutputVarOf Step`. Present each Step/Variable association once while retaining access to the explicit statements that support it. Adding a new input/output association, including from a Variable section, writes the forward Step-to-Variable statement only. Opening or saving unrelated fields never rewrites inverse statements.

Explicitly removing an association removes all existing forward and inverse statements expressing that association in the edited source graph. Changing it is an explicit removal of the old association followed by addition of the selected new one. Generic triple removal still removes only its selected triple. Never use a query result or inferred relationship as a statement to persist, and never synthesize `p-plan:isPrecededBy` from a Flow. That property and the older misspelled precedence IRI remain ordinary generic RDF.

Preserve the starter's descriptive semantics: shared Plan memberships, multiple consumers, empty plans, cycles, self-flows, parallel Flow resources, optional conditions, and unfinished decisions. Producer/cardinality and shared-plan constraints produce the already-agreed diagnostics; the form does not execute conditions or invent missing process structure.

### State-machine bindings

Use the exact namespace `https://talby.ai/ontology/state-machine#`.

| Resource section | Exact recognized explicit types | Editable bindings beyond labels/comments |
| --- | --- | --- |
| State machine | `sm:StateMachine` | Associated states and transitions through their `sm:inMachine` statements. |
| State / initial / final | `sm:State`, `sm:InitialState`, `sm:FinalState` | `sm:inMachine`; initial/final status is represented by the corresponding explicit `rdf:type` statement. |
| Transition | `sm:Transition` | `sm:inMachine`, `sm:source`, `sm:target`, `sm:event`, `sm:condition`, `sm:action`. |

Changing a recognized status adds/removes only the explicitly selected type statement; it does not replace all `rdf:type` values. A state may be both initial and final. Preserve the starter's empty-machine, optional descriptive-field, cycle, and self-transition behavior. Multiple initial states, wrong-machine endpoints, or outgoing transitions from a final state receive diagnostics without automatic repairs. No hierarchy, parallel regions, reachability requirement, determinism, or execution semantics are introduced.

### Value preservation and mutation scope

- Forms apply explicit add/remove/replace operations to exact statements in the edited graph. An unchanged field produces no semantic mutation. Never regenerate a resource's statements from the visible fields or treat a hidden/unsupported value as absent.
- Show every existing value, including repeated recognized fields beyond a SHACL cardinality, unexpected RDF term kinds, unrecognized types, and literals with distinct language/datatype. Report diagnostics without picking a value, coercing it, or discarding the others. Supported values remain individually editable; unsupported structures route to generic editing while other fields remain available.
- Changing only literal lexical text preserves its datatype or language. Changing a resource-valued field replaces only the selected term, not every value of that predicate. Switching a form section never changes types or source data.
- All writes use the shared revision, project-lock, staging, and coupled-file transaction contracts. An outdated form save retains the draft and requires reconciliation with the current revision; explicit replacement cannot bypass conflict checks. See [Choose safe project file mutations and edit conflicts](10-file-transaction-boundary.md) and [Choose the shared CLI and loopback web architecture](13-cli-web-runtime-boundary.md).
- Preserve unknown statements and semantic RDF terms through serialization. Turtle formatting/comments need not survive graph-based edits. Raw source saves retain the submitted source text and the existing stale-draft confirmation rule.

### Creation and canvas actions

- New form-created resources use IRIs and the exact selected type. Use `owl:Class` by default for conceptual entities, `owl:DatatypeProperty` for attributes, and `owl:ObjectProperty` for relationships. Other supported types are explicit selections. Create Decision, InitialState, and FinalState using their selected types without automatically adding superclass types. Only explicitly requested types, field values, and required selected associations are written.
- Step and Variable creation requires an explicit Plan selection; further memberships remain explicit. State and Transition creation requires an explicit StateMachine selection. Flow creation requires its Plan and endpoints; Transition creation requires its machine and endpoints. Do not infer those selections from layout, proximity, view membership, or another resource's appearance. Preserve the starter's cardinalities and diagnostics; creation does not silently repair existing invalid data.
- Keep generic "Add triple" separate from explicit "Create flow" and "Create transition" actions. The latter use the same resource/field bindings and mutation operation as their forms. Create the resource and its requested triples together through the shared operation boundary, without inferred inverse statements or optional defaults.
- Keep the direct RDF projection from [Choose the RDF-to-canvas projection and editing boundary](07-rdf-canvas-projection.md): Flow and Transition resources are nodes with their exact resource-valued statements as edges. Do not collapse them into semantic edges or translate a generic connection into a process/state relationship.
- Form source changes synchronize affected saved-view relationship membership and presentation references through the same graph-edit boundary as canvas source changes. Source changes do not themselves select new elements into unrelated views; explicit edits within a saved view retain the settled membership/endpoint-selection rules. Direct Turtle changes leave view files unchanged and diagnose broken references. Appearance and position writes remain in presentation graphs, never source content.

### Deletion and reference repair

- Distinguish removing an element/relationship from a view, removing a selected source statement or P-Plan association, and deleting a source element. Opening a form or clearing one value never implies element deletion.
- Element deletion previews every source statement where the selected RDF resource occurs as subject, predicate, or object in the edited source graph, including unknown statements. Require explicit confirmation before removing that reviewed set. Scope blank-node identity to its parsed source graph/revision.
- Synchronize affected saved views and presentation records: remove deleted source relationships, membership of the deleted element, its node presentation, and corresponding relationship presentation. Preserve unrelated view members, statements, positions, and appearance. Parse and revision-check every graph that the operation will rewrite; normal failure publishes no partial deletion under the existing transaction contract.
- References in other source graphs, configuration, or locked dependencies remain intact and are disclosed as impact. Subsequent diagnostics follow the [managed-reference scope contract](../contracts/file-and-output-schemas.md#managed-reference-scope): a retained managed association, unavailable class/property, invalid view/presentation reference, or applicable SHACL constraint can produce an error. An ordinary link to an individual IRI does not become broken solely because its local definition was deleted. Preserve no deleted-identity registry and infer no ownership from an IRI prefix. Exact-target inspection lists all known occurrences; dangling inspection lists only demonstrably broken managed references. Repair references only through explicitly scoped refactoring/reference operations. Do not recursively delete connected resources or blank-node structures that no longer have an incoming link; remaining invalid or orphaned data stays inspectable.
- Deleting a managed graph root uses its ontology/model lifecycle operation rather than this element action. An identity change uses the existing previewed IRI refactoring operation rather than an ordinary field update. Preserve confirmed-breaking-removal behavior in [ADR 0003](../../../docs/adr/0003-allow-confirmed-breaking-removal.md).

### Implementation acceptance and scope

Production checks must cover shared ontology/conceptual bindings; exact terms in a local copy without a selected design; an arbitrary replacement vocabulary and absent creation terms; multi-type selectable sections, including Decision and initial-plus-final State; generic access to a blank-node restriction; preservation of unknown statements and multiple/language-tagged/typed values during unrelated edits; forward-only, inverse-only, and duplicate-direction P-Plan associations with explicit removal; default creation without superclass/inverse materialization; Flow/Transition actions retaining the direct RDF projection; deletion involving unknown incident statements and predicate uses, other-graph references, and view/presentation cleanup; read-only snapshots; stale form saves; and invalid Turtle versus parseable SHACL-invalid data.

This decision introduces no executable form-definition framework, vocabulary mapping, OWL expansion, or production editor code. It uses the existing domain glossary and contradicts no current ADR; no new domain term or ADR is needed. No additional in-scope fog or decision ticket was surfaced. The remaining work is implementation planning and production execution after this map.
