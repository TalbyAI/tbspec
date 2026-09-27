# Starter Vocabulary Options for the MVP

Status: Decision aid; project configuration direction selected

## Direction from the interview

Every project has a configuration based on defaults. It chooses which model types are available and which ontology supplies each type's vocabulary. For example, `process` may use a locked ontology fetched from a public URL, or a project-owned copy that the team edits. A model type is not permanently tied to one ontology chosen by the application.

An external ontology can enter a project in two ways: as a locked dependency that stays unchanged until explicitly updated, or as an imported project-owned copy that the team edits and versions with Git. The same model-type setting can point to either.

The default configuration supplies ready-to-use ontologies and visualizations for `data`, `process`, and `state-machine`. A project can replace a default ontology, including with one whose concepts are incompatible with the supplied ontology. Doing so disconnects the previous visual design association. The graph remains editable generically until the project explicitly selects a design for the replacement ontology's own concepts. Even a local copy of a supplied ontology must explicitly select the supplied design to reuse it. The tool does not map replacement concepts onto supplied concepts.

For example, an external process ontology might name its activity class `wf:Activity` and its flow property `wf:next`. Its visual definition can render those concepts directly. The generic RDF editor can open the graph regardless. Whether the built-in process forms can edit an arbitrary replacement ontology remains an open question.

## Concrete scenario

A team creates a descriptive approval process with `Submit`, `Review`, and `Approve` steps, and a state machine with `Draft`, `Submitted`, and `Approved` states. Another project reuses the process ontology and its canvas appearance rules, then adds a `RiskReview` concept. The generic editor must still edit `RiskReview` even if no specialized form exists for it.

## Options

| Option | How `model create --kind process` works | Advantages | Costs |
| --- | --- | --- | --- |
| A. Fixed built-in vocabularies | The application embeds its own data, process, and state-machine terms and specialized editors know those terms directly. | Works immediately; few setup steps; simplest first implementation. | Every semantic change requires a tool release; reuse by another project depends on tool-specific IRIs and versions; custom concepts fall back to generic editing. |
| B. Versioned starter resources | The tool supplies ordinary ontology resources, SHACL graphs, and visual definitions. `model create` selects and locks the relevant starter resource just like any other dependency. Specialized editors recognize its published terms; projects can extend them. | Works immediately while using the same dependency mechanism as user content; definitions and visual rules can be inherited; semantic updates can be versioned separately from the application. | Requires a stable starter-resource identity, versioning, and migration policy; the initial bootstrap and specialized form bindings need specification. |
| C. Bring your own ontology | A project selects a project-owned or external ontology, uses generic graph editing immediately, and associates a visual design explicitly. | Maximum control over domain vocabulary and its appearance. | Project-specific visual rules require authoring or explicit reuse; specialized forms designed for the default ontology may not apply. |

For the same `RiskReview` example:

- Under A, the application recognizes its built-in `Step` type. `RiskReview` can be shown in the generic editor, but adding a specialized form for it requires an application update.
- Under B, the project locks a process starter ontology, extends its `Step` type with `RiskReview`, and supplies a declarative visual rule. A dependent project receives both definitions through the normal dependency mechanism; a specialized `RiskReview` form would still require a later application update.
- Under C, the team chooses or authors an ontology and defines how its concepts appear on the canvas. Generic graph editing works immediately; specialized form support for arbitrary terms is still undecided.

The selected direction combines ready-to-use defaults with project-controlled replacements. The packaging and versioning of the supplied default resources remain technical design choices. The editor has a generic fallback for every concept. Replacing a model type's ontology warns in advance when existing models use that type; it does not rewrite those models.

## Candidate standards to reuse

| Area | Primary source | Fit and limit |
| --- | --- | --- |
| Ontology terms | [OWL 2](https://www.w3.org/TR/owl2-syntax/) | Defines classes, datatypes, properties, and individuals; specialized forms can cover a small subset. |
| Validation | [SHACL](https://www.w3.org/TR/shacl/) | A shapes graph validates an RDF data graph; starter resources can supply shapes alongside their ontologies. |
| Planned process steps | [P-Plan](https://www.opmw.org/model/p-plan/) | Defines plans, steps, input/output variables, and step precedence. Its stated focus is planned scientific workflows; decision and responsibility concepts for the proposed editor would need additional terms or another vocabulary. |
| Executed activity and provenance | [PROV-O](https://www.w3.org/TR/prov-o/) | Defines activities, entities, agents, and provenance relationships. It is useful when modeling what happened, which is outside the agreed descriptive-process MVP scope. |
| Business process notation | [BPMN machine-readable files](https://www.omg.org/spec/BPMN/machine-readable) | OMG publishes XML Schema and CMOF artifacts. Direct use as this tool's RDF authoring vocabulary would require an RDF mapping; this is an inference from the published formats. |
| State machine notation | [SCXML](https://www.w3.org/TR/scxml/) | Defines event-based state-machine concepts in XML. An RDF-native starter can reuse the concepts, but it would not automatically be an SCXML document or executable machine. |

The remaining functional choices are the exact default ontologies and which specialized forms, if any, can edit arbitrary replacement ontologies. Exact vocabulary terms and standards mappings follow from those choices.

## Separate question: inference

Inference has several scopes, so the spec should not promise generic "OWL reasoning" before the RDF framework is chosen. [Apache Jena](https://jena.apache.org/documentation/inference/) exposes RDFS inference directly and documents its bundled OWL reasoners as incomplete. [RDF4J](https://rdf4j.org/javadoc/latest/org/eclipse/rdf4j/sail/inferencer/fc/package-summary.html) provides an RDFS inferencer for its stores. [RDFLib's owlrl companion](https://owl-rl.readthedocs.io/en/latest/owlrl.html) adds RDFS and OWL 2 RL rule closure. [OWL 2 RL](https://www.w3.org/TR/owl2-profiles/) is a specific rule-oriented profile, not all OWL 2 semantics.

The agreed rule is conditional: include basic relation inference in the MVP if the selected framework makes it straightforward and reliable; otherwise postpone it. Its exact entailment scope must be declared after choosing the framework. Full OWL reasoning is not implied by this rule.
