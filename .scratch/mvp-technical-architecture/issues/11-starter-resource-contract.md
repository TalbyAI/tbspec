# Define metadata and starter resource identities and shapes

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: iskan
Blocked by: 01, 07, 09

## Question

What exact versioned RDF terms and SHACL constraints should the tool's metadata, process extension, and state-machine starter resources publish to implement the already-agreed functional vocabulary? Cover graph self-declarations, model-type and conceptual-schema references, view membership and relationship identity, presentation positions and per-view visual-rule choices, declarative visual rules, process decisions/flows/responsibility, and state transitions. Keep standard OWL/RDFS and P-Plan terms where they fit; make the term and shape identities consistent with the permanent IRI policy, canvas projection contract, and selected SHACL capability. Do not reopen the functional feature set.

## Comments

- The user invoked `auto-grill` instead of answering the first interview round, requesting autonomous discovery followed by one approval gate.
- The user explicitly approved the complete proposed contract with "aprobado." The resolution is recorded below; production implementation and publication remain outside this map.

## Answer

Use the approved starter resource contract below. It specifies the resources to author during implementation; it does not claim that the vocabulary, shapes, or designs have already been published or executed.

#### Evidence and scope

- Preserve [functional spec 0.1](../../mvp/spec.md), the [permanent IRI policy](01-permanent-iri-policy.md), the [projection contract](07-rdf-canvas-projection.md), and the [validation boundary](09-shacl-validation-boundary.md). No existing decision is reopened.
- The canvas proof's `urn:canvas-proof:` properties are temporary. Its subject/predicate/object relationship descriptors and separate per-view positions are evidence for the encoding, not permanent term names.
- Local SHACL sees the resource's own triples and the agreed explicit vocabulary hierarchy. It cannot inspect a source graph, a different view, a configured model type, or a selected design's contents. Checks requiring those resources belong to project diagnostics and never enlarge the SHACL data graph.
- The original P-Plan documentation describes an older release. The author's [P-Plan RDF source](https://raw.githubusercontent.com/dgarijo/Vocabularies/773007a6d7ed2fb0054967008cc128fa5c48ca36/P-PLAN/p-plan.owl) declares version `1.3`, CC BY 4.0, and `p-plan:isPrecededBy`. The linked older documentation declares CC BY-NC-SA and spells the term `isPreceededBy`. Use the pinned newer source, retain attribution and license information, and do not conflate the two term IRIs. This corrects the reference baseline without changing descriptive process behavior.

#### Publication identities and bootstrap

Use these prefixes; namespace spellings, case, and HTTP versus HTTPS are significant:

```turtle
@prefix tbspec: <https://talby.ai/ontology/tbspec#> .
@prefix proc: <https://talby.ai/ontology/process#> .
@prefix sm: <https://talby.ai/ontology/state-machine#> .
@prefix p-plan: <http://purl.org/net/p-plan#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
```

The three ontology roots and their `owl:versionIRI` values remain exactly those approved in the permanent IRI policy. Vocabulary terms use stable `#` IRIs; changing an incompatible meaning requires a new term. Each published class/property has an English `rdfs:label`, an English definition in `rdfs:comment`, and `rdfs:isDefinedBy` pointing to its ontology. Declare classes as `owl:Class`, resource-valued properties as `owl:ObjectProperty`, and literal-valued properties as `owl:DatatypeProperty`. Use hierarchy declarations below, but do not add OWL cardinality, disjointness, inverse, or equivalence axioms for application validation rules. Shared properties need no artificial common domain; several `rdfs:domain` statements would mean intersection, not alternatives.

For a vocabulary root `V` and release `R`, the immutable associated shapes graph IRI is `V/R/shapes`; its named node shapes are `V/R/shapes#<Name>Shape`. Example: `https://talby.ai/ontology/tbspec/0.1.0/shapes#ModelShape`. Do not reuse a shape IRI when its constraints change. Helper node/property shapes may be blank nodes. Declare the shapes graph root as `tbspec:ShapesGraph` so its published identity is also its named-graph IRI. Shapes are support resources, not a fourth ontology. Arbitrary user shapes without a root declaration keep the already-agreed generated project-local graph IRI.

The initial immutable design graph roots are `https://talby.ai/design/data/0.1.0`, `https://talby.ai/design/process/0.1.0`, and `https://talby.ai/design/state-machine/0.1.0`. Rule IRIs are `<design-root>#<Name>`. Later design versions mint new root and rule IRIs, preserving old definitions for locked projects.

`init` locks the metadata ontology and shapes as the tool's common resource contract, independently of model-type replacement. The default `data` ontology association selects the metadata starter, whose available standard vocabulary includes RDF/RDFS/OWL; do not introduce a fourth tool-owned data namespace. Default `process` selects the process extension plus the pinned P-Plan source; default `state-machine` selects the state-machine starter. Bundle the required standard vocabulary definitions locally and record their source signatures. An `owl:imports` reference is resolved through recorded local dependencies, never by validation-time fetching. Exact acquisition, bundle paths, import-format handling, lock entries, and updates remain in the existing dependency and file-schema tickets. Changing a model type does not replace the common metadata contract or silently update locked resources.

#### Metadata declarations and associations

| Class or property | Meaning and required contract |
| --- | --- |
| `tbspec:Model` | Generic domain-model graph kind; supports additional configured types. |
| `tbspec:DataModel` | Subclass of `Model`. |
| `tbspec:ConceptualDataModel`, `tbspec:ConcreteDataModel` | Subclasses of `DataModel`. |
| `tbspec:ProcessModel`, `tbspec:StateMachineModel` | Subclasses of `Model`; neither implies a P-Plan or state-machine class. |
| `tbspec:ViewModel`, `tbspec:PresentationGraph`, `tbspec:VisualDesignModel`, `tbspec:ShapesGraph` | Self-declaration kinds for the corresponding managed RDF graphs; not subclasses of `Model`. |
| `tbspec:modelType` | Configured model-type name as an `xsd:string`, not a path, dependency ID, or ontology IRI. |
| `tbspec:schema` | Zero or more conceptual-schema graph IRIs, only on a concrete model root. |
| `tbspec:sourceGraph` | Exactly one source ontology/model graph IRI on a view root. |
| `tbspec:forView` | Exactly one view graph IRI on a presentation root. |

Managed self-declaration roots must be IRIs. Classification chooses the most specific compatible metadata kind: `Model` plus `ProcessModel` is one kind, while conceptual plus concrete, process plus state-machine, or ontology plus model is an error. Multiple distinct managed roots are ambiguous. Other business `rdf:type` statements and unrecognized declarations do not become additional roots. A source graph has `owl:Ontology` or a model kind, never a view/presentation/design kind. Unclassified RDF stays editable generically.

Every project-owned model root has exactly one nonempty `modelType` string. The built-in names are `data`, `process`, and `state-machine`; custom names resolve through configuration without inventing additional RDF model-kind classes. The application checks existence, classification compatibility, and schema target classification against the registry. Disabled retained types remain valid. Locked models retain their recorded source ontology bindings; do not resolve their type names against the consuming manifest. A locked declared model may lack a type-name statement when its recorded source associations supply the binding. Consequently `ModelShape` imposes only a maximum of one `modelType`, its datatype, and nonempty value; the owned-root requirement is an application diagnostic. `SchemaReferenceShape` targets subjects of `schema`, requires a concrete-model subject, and checks IRI values. A valid concrete model need not reference a conceptual schema.

`OntologyShape` requires IRI identity and permits zero or one IRI `owl:versionIRI`. The tool's own vocabulary publication check requires exactly one approved version IRI; ordinary newly created user ontologies do not need release metadata. `ShapesGraphShape` checks a declared support root's IRI identity; supported SHACL form checks remain the agreed validator preflight.

#### Views and relationship identity

| Property | Value and cardinality |
| --- | --- |
| `tbspec:member` on a view | Zero or more IRI resources projected from its source graph. |
| `tbspec:relationship` on a view | Zero or more local descriptor resources, each an IRI or blank node. |
| `rdf:subject`, `rdf:predicate`, `rdf:object` on each descriptor | Exactly one IRI each. |

The relationship's identity is `(sourceGraph, subject, predicate, object)`, not the descriptor identifier. Duplicate descriptors for the same tuple within one view are an error. Descriptor blank nodes are metadata, not selected source blank nodes. Reification describes a selected triple and does not insert that triple into the view or source. Do not introduce RDF-star or edge identifiers encoded in strings.

`ViewModelShape` checks the root, one `sourceGraph`, IRI membership, and linked descriptor structure through `RelationshipSelectionShape`. A graph-local SELECT checks that both tuple endpoints are `member` values on the same view and checks tuple uniqueness. Project diagnostics check that the source is available and of the right kind, each member occurs as a projected IRI subject/resource-valued object in that source, and each selected triple actually exists there. A predicate appearing only in predicate position is not a projected node. Preserve the already-agreed automatic endpoint selection, removal, source-edit synchronization, and direct-Turtle broken-reference behavior.

#### Presentation records and appearance selection

| Property | Value and cardinality |
| --- | --- |
| `tbspec:nodePresentation` on a presentation root | Zero or more local IRI/blank-node records. |
| `tbspec:element` on a node record | Exactly one selected source-resource IRI. |
| `tbspec:x`, `tbspec:y` on a node record | Either both absent or exactly one numeric value each. Negative coordinates are valid. |
| `tbspec:chosenRule` on a node record | Zero or one visual-rule IRI for this element in this view. |
| `tbspec:group` on a node record | Zero or one nonempty `xsd:string` grouping name, scoped to this presentation graph. |
| `tbspec:relationshipPresentation` on a presentation root | Zero or more local IRI/blank-node records with the same exact subject/predicate/object tuple encoding as view relationships. |

At most one node record per element and one relationship record per tuple in a presentation graph. Repeating a tuple in presentation avoids references to another file's blank-node labels. Position uses absolute canvas coordinates; grouping is flat visual grouping and creates no source triples or coordinate transformation. A group has no independently managed semantic node. Missing positions are valid and are handled by the later layout decision.

Node records may override the applicable node appearance fields below; relationship records may override edge fields. A saved `chosenRule` must be an available rule from the winning design for one of the element's exact explicit types. It disambiguates different applicable type rules rather than overriding whole-design precedence. Broken or no-longer-applicable saved choices are presentation diagnostics; render generically with a warning. Uncovered concepts and unchosen competing types retain the previously agreed canvas warning without becoming model validation errors. Choices in the complete graph remain temporary until saved.

`PresentationGraphShape`, `NodePresentationShape`, and `RelationshipPresentationShape` check local structure, paired coordinates, duplicate records, and style values. Project diagnostics check the referenced view, selected elements/relationships, and saved rule availability/applicability. Numeric values accept `xsd:integer`, `xsd:decimal`, or `xsd:double`; reject invalid lexical forms and nonfinite or unrepresentable renderer values before using them. The finite renderer conversion is an application guard, not a claim that SHACL datatype constraints detect every runtime limit.

#### Declarative visual rules

`tbspec:VisualRule` is the base class; `tbspec:NodeVisualRule` and `tbspec:EdgeVisualRule` are subclasses. A rule is explicitly exactly one of those two kinds. A design root links zero or more rule IRIs through `tbspec:rule`; each linked rule is defined in that design graph and has exactly one `tbspec:targetConcept` IRI. Node rules target exact class IRIs; edge rules target exact property IRIs. The registry/vocabulary check validates the referenced target kind, without importing ontology definitions into design SHACL data. Each design has at most one rule for a `(rule kind, targetConcept)` pair. A rule IRI with divergent definitions in effective designs is an identity conflict, not a merge.

Every appearance field is optional and single-valued; absent fields use generic renderer defaults. Fields do not merge across competing designs. A winning rule plus a view's explicit local appearance overrides is allowed. Do not apply subclass or subproperty rule inheritance implicitly.

| Field | Values | Applies to |
| --- | --- | --- |
| `tbspec:nodeShape` | `"rectangle"`, `"rounded-rectangle"`, `"ellipse"`, `"diamond"` | Nodes |
| `tbspec:fillColor` | `#RRGGBB` or `#RRGGBBAA` string, case insensitive | Nodes |
| `tbspec:strokeColor`, `tbspec:textColor` | Same hexadecimal color syntax | Both |
| `tbspec:strokeWidth` | Nonnegative finite numeric value, canvas pixels | Both |
| `tbspec:fontFamily` | `"system-ui"`, `"sans-serif"`, `"serif"`, `"monospace"` | Both |
| `tbspec:fontSize` | Positive finite numeric value, canvas pixels | Both |
| `tbspec:fontWeight` | Integer: 100, 200, 300, 400, 500, 600, 700, 800, 900 | Both |
| `tbspec:fontStyle` | `"normal"`, `"italic"` | Both |
| `tbspec:lineStyle` | `"solid"`, `"dashed"`, `"dotted"` | Both |
| `tbspec:edgeRouting` | `"straight"`, `"bezier"`, `"step"` | Edges |
| `tbspec:arrowHead` | `"none"`, `"arrow"` | Edges |
| `tbspec:labelMode` | `"property"`, `"local-name"`, `"iri"`, `"text"`, `"none"` | Both |
| `tbspec:labelProperty` | Property IRI, only with `labelMode "property"` | Both |
| `tbspec:labelText` | `xsd:string` or `rdf:langString`, only with `labelMode "text"` | Both |

An absent `labelMode` defaults to `"property"` and an absent `labelProperty` defaults to `rdfs:label`. `"text"` requires one `labelText`; `labelText` with another effective mode is an error. A node label reads literal values on the source element; an edge label reads literal values on its predicate from locally available vocabulary. Choose a language matching the UI preference, then an untagged string, then the first literal under a deterministic RDF-term sort. If the chosen property has no literal value, fall back to the IRI's fragment or last nonempty path segment and then its full IRI. Do not interpret literal markup. A local label-mode override replaces the inherited label-choice configuration: when it changes mode, ignore inherited `labelProperty`/`labelText` that do not belong to that mode, then apply the locally supplied fields. Supplied incompatible local fields still produce an error. An override supplying only `labelProperty` or `labelText` inherits the rule's mode.

Use string enum values and SHACL `sh:in`, hexadecimal pattern `^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$`, numeric datatypes/ranges, and the existing safe SELECT profile where a local combination needs it. Node-only fields on an edge rule/record and edge-only fields on a node rule/record are errors. No positions, concrete `element` references, `chosenRule`, or `group` values belong on reusable rules. Unknown RDF is retained and remains subject to the established available-vocabulary check; these are open shapes, not a rejection of all extra properties. Render only the supported fields through fixed components and typed style assignments: no arbitrary CSS, URLs, HTML, scripts, or loaded fonts/components.

`VisualDesignModelShape`, `VisualRuleShape`, `NodeVisualRuleShape`, `EdgeVisualRuleShape`, and reusable `AppearanceShape` carry the local design constraints. For presentation overrides, validate supplied field types locally and validate the resulting effective label combination with the resolved rule at the application boundary; do not demand a local `labelMode` when an override legitimately inherits it.

Renderer defaults are: node shape `"rounded-rectangle"`, fill `"#FFFFFF"`, stroke `"#334155"`, text `"#172536"`, stroke width `1`, font family `"system-ui"`, font size `14`, font weight `400`, font style `"normal"`, line style `"solid"`, edge routing `"bezier"`, arrow head `"arrow"`, and the label defaults above. These values configure supported fields, not source content.

| Initial design | Exact node rule targets | Exact edge rule targets |
| --- | --- | --- |
| `data` | `owl:Class`, `rdfs:Class`, `rdfs:Datatype`, `owl:NamedIndividual`, `owl:ObjectProperty`, `owl:DatatypeProperty`, `rdf:Property` | `rdf:type`, `rdfs:subClassOf`, `rdfs:subPropertyOf`, `rdfs:domain`, `rdfs:range` |
| `process` | `p-plan:Plan`, `p-plan:Step`, `p-plan:Variable`, `proc:Decision`, `proc:Flow` | `p-plan:isStepOfPlan`, `p-plan:isVariableOfPlan`, `p-plan:hasInputVar`, `p-plan:hasOutputVar`, `p-plan:isInputVarOf`, `p-plan:isOutputVarOf`, `p-plan:isPrecededBy`, `proc:source`, `proc:target`, `proc:inPlan`, `proc:responsibleParty` |
| `state-machine` | `sm:StateMachine`, `sm:State`, `sm:InitialState`, `sm:FinalState`, `sm:Transition` | `sm:inMachine`, `sm:source`, `sm:target` |

The rule name is `<Prefix><CapitalizedTerm>NodeRule` or `EdgeRule` (`OwlClassNodeRule`, `RdfsSubClassOfEdgeRule`, `PPlanStepNodeRule`, `ProcDecisionNodeRule`, `SmInitialStateNodeRule`). Prefix tokens are `Rdf`, `Rdfs`, `Owl`, `PPlan`, `Proc`, and `Sm`; capitalize only the term's first character, retaining its remaining case. Each rule uses renderer defaults except `ProcDecisionNodeRule` (diamond), `PPlanVariableNodeRule` (ellipse), `SmInitialStateNodeRule` (ellipse), and `SmFinalStateNodeRule` (ellipse, stroke width `3`). Palette choices carry no domain semantics. Generic RDF individuals with arbitrary domain types are not promised a rule; the fallback is intentional. Multiple distinct exact-type rules still require the already-agreed per-view choice.

#### Process starter

Default process creation writes the graph root as both `tbspec:ProcessModel` and `p-plan:Plan`, with `modelType "process"`. This dual declaration applies when the selected ontology supplies the recognized starter terms, including an unchanged local copy; an arbitrary replacement gets the metadata declaration without automatic semantic mapping. It is a starter convention, not a superclass relationship that forces P-Plan onto replacement ontologies. Additional local Plan individuals may exist without becoming graph roots.

Reuse `p-plan:Plan`, `p-plan:Step`, `p-plan:Variable`, `p-plan:isStepOfPlan`, `p-plan:isVariableOfPlan`, `p-plan:hasInputVar`, `p-plan:hasOutputVar`, `p-plan:isInputVarOf`, and `p-plan:isOutputVarOf`. The supplied extension adds only:

| Term | Contract |
| --- | --- |
| `proc:Decision` | Subclass of `p-plan:Step`; uses ordinary labels, inputs, outputs, membership, and responsibility. |
| `proc:Flow` | Immediate descriptive connection; a resource, not an inferred transitive precedence relation. |
| `proc:source`, `proc:target` | Exactly one Step resource each on a Flow. |
| `proc:inPlan` | Exactly one local Plan resource on a Flow. |
| `proc:condition` | Zero or one `xsd:string`/`rdf:langString` description on a Flow. |
| `proc:responsibleParty` | Zero or more IRI references on a Step, including a Decision; no execution association or required local party declaration. |

Plans, steps, variables, decisions, and flows may be IRIs or blank nodes; creation uses IRIs so starter elements can participate in saved views. Every Step and Variable has one or more locally typed Plan memberships through the existing P-Plan property. Shared steps/variables are permitted. A Flow's endpoints must both be members of its declared Plan. Every effective input/output variable must share a Plan membership with its Step. Evaluate explicit forward and inverse input/output statements together using SHACL alternative/inverse paths, without persisting inferred triples. A Variable has zero or one distinct producer across `isOutputVarOf` and inverse `hasOutputVar`, matching the pinned P-Plan property's functional intent; multiple consumers are valid.

`PlanShape`, `StepShape`, `VariableShape`, `DecisionShape`, and `FlowShape` use Core for kinds, memberships, type checks, and cardinalities; graph-local SELECT constraints check shared Plan membership. Labels are optional and multilingual; conditions are optional single descriptive literals. Empty Plans are valid. Cycles, self-flows, parallel flows with distinct resource identities, unconditioned branches, and unfinished decisions are valid descriptions. Do not generate `isPrecededBy` from Flow, execute conditions, require complete branch coverage, or translate an older precedence IRI automatically. Transitive precedence remains ordinary generic RDF.

#### State-machine starter

Default creation writes the graph root as both `tbspec:StateMachineModel` and `sm:StateMachine`, with `modelType "state-machine"`, under the same recognized-starter-term condition as process creation. Additional local machines do not become graph roots unless explicitly given a metadata model declaration.

| Term | Contract |
| --- | --- |
| `sm:StateMachine`, `sm:State`, `sm:Transition` | Independent classes. |
| `sm:InitialState`, `sm:FinalState` | Subclasses of `sm:State`. |
| `sm:inMachine` | Exactly one locally typed StateMachine resource on each State and Transition. |
| `sm:source`, `sm:target` | Exactly one locally typed State resource each on a Transition; both belong to its machine. |
| `sm:event`, `sm:condition`, `sm:action` | Each zero or one `xsd:string`/`rdf:langString` descriptive literal on a Transition. |

Machine/state/transition resources may be IRIs or blank nodes; creation uses IRIs. Empty machines are valid. A machine has zero or one InitialState and any number of FinalStates. A state may be both initial and final, permitting a terminal one-state description. A FinalState has no outgoing transition. Other self-transitions and cycles, including transitions back to the initial state, are allowed. Do not impose reachability, a required initial/final state, deterministic event handling, condition execution, hierarchy, parallel regions, or executable action semantics.

`StateMachineShape`, `StateShape`, `InitialStateShape`, `FinalStateShape`, and `TransitionShape` use Core for resource kinds, ownership, endpoints, and descriptive values. Local SELECT constraints check equal machine ownership, at most one initial state per machine, and no outgoing final-state transition. Subclass checks use only the explicit hierarchy already approved for the validator; no superclass statements are written to model files.

#### Validation, rollout, and acceptance boundary

- All named shapes are immutable release-scoped node shapes; helper node/property shapes may be anonymous. Shapes remain open (`sh:closed` absent/false), with explicit exclusions only for contradictory recognized fields. Labels are not mandatory. All structural violations are `sh:Violation`; missing visual coverage remains a canvas warning outside these shapes. Use `sh:targetClass` plus subjects/objects-of targets where necessary to catch untyped uses of a recognized property. Require the corresponding declared class rather than relying on unprovided domain/range entailment; shared properties such as `sm:inMachine` use an anonymous guard allowing State or Transition, not a domain intersection.
- Intrinsic metadata checks cover declared managed resource structures, including views, presentation, and designs, one file at a time. Ontology/model-associated user shapes still run separately under the settled validation contract. Arbitrary support/unclassified graphs do not gain invented classifications or model constraints. Cross-file checks keep their existing classification/association/view/presentation diagnostic categories; never claim a cross-file lookup was a SHACL result.
- A malformed graph or unavailable required support produces the already-agreed partial/skipped diagnostics. Do not reinterpret missing support as an empty valid graph. Invalid source remains saveable; graph editing needs parseable RDF. Unknown statements are preserved rather than reconstructed from recognized forms.
- Validation, style resolution, and rendering use local files and locked snapshots only. Published vocabulary/design IRIs identify resources; they are not permission to dereference them. The existing transaction and content-revision contract applies to coupled view/presentation writes.
- `0.1.0` is the first public starter release. Existing proof fixtures need no migration. Application upgrades do not update a project's locked vocabulary, shapes, or design; explicit dependency updates show impact. Incompatible future terms need new identities; this contract is cheap to revise before publication but published identities are a lasting commitment.
- The later production resource checks must cover: empty valid starters; every declared hierarchy and shape IRI; root ambiguity/type mismatch; wrong/missing schema references; exact tuple membership and duplicate descriptors; a source triple deleted through Turtle; blank metadata descriptors with IRI endpoints; per-view positions/rules; duplicate presentation records; invalid and nonfinite style numbers; label-mode inheritance; unavailable rules; preservation of extra known-vocabulary triples; P-Plan inverse input/output cases and multiple producers; shared-plan flow checks; a valid state cycle; wrong-machine endpoints; multiple initial states; a final state's outgoing transition; and offline execution of every bundled Core/SELECT constraint. No new starter RDF/SHACL package has been authored or executed in this discovery turn.

#### Trade-offs and scope

These choices avoid a separate primary plan/machine wrapper, a custom statement-ID scheme, an expression language, arbitrary CSS, and workflow execution checks. The cost is a deliberately small appearance vocabulary, one descriptive value per transition field, and a public RDF contract that must be versioned carefully after publication. The agreed process/state terms are recorded in [the domain glossary](../../../CONTEXT.md). No current ADR is contradicted. A new ADR is unnecessary because the decision belongs in this ticket and the permanent identity policy already records the lasting trade-off.

The dependency, concrete TOML/JSON schema, layout, and specialized-form tickets retain their existing scope. This resolution does not select their implementations or close them. No new in-scope fog needs a ticket after this discovery pass.

Production ontology/shape authoring, external publication, CLI/web code, and resolution of other tickets remain outside this session.
