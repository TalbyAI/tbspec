# MVP Functional Specification

Status: Draft; product interview in progress

## Purpose

Define the operations available in the first version of the local ontology and model management tool. This draft starts from [INTENT.md](../../INTENT.md) and the product decisions recorded below. Command names and any behavior marked **Proposed** require confirmation before this becomes the MVP contract.

## Product boundary

- A project is a local directory containing ontologies, domain models, view models, presentation graphs, visual design models, or a combination of them. Git provides version control; the tool does not implement a separate revision history.
- Each project has a configuration based on defaults. The default `data`, `process`, and `state-machine` model types have tool-supplied, versioned RDF ontologies and visual design models with stable identities; projects can reference or copy them. A project can define additional model types or replace a type's ontology with a project-owned ontology or a locked external resource. Changing the ontology disconnects its previous visual design association; the graph remains editable through the generic editor until a design is selected explicitly. Even a local copy of a supplied ontology must explicitly select the original design if it intends to reuse it. Its design can then be extended or modified for changed concepts. The tool does not map replacement terms onto the supplied ontology's terms.
- Ontologies define reusable concepts and relationships. Domain models describe the project's domain using available ontologies.
- Separate presentation graphs describe the visual appearance or placement of concrete ontology or model elements: location, grouping, colors, fonts, and similar information. Each view has its own presentation graph. A visual design model defines reusable presentation rules without describing concrete domain elements.
- A view model explicitly selects elements and relationships from one ontology or domain model. A selected relationship requires both endpoints in the view. One source graph can have multiple views, potentially using protocols such as C4 or 4+1. Ontologies can define the vocabulary for view protocols; these examples do not imply built-in support for either protocol. Each view has its own presentation graph so the same element can have different positions in different views.
- A project can reuse individual ontologies, domain models, and visual design models selected from local directories, Git repositories, and generic URLs. Adding an ontology also includes its discoverable, directly associated SHACL, visual design, and design selection metadata, but not unrelated models from the source project. Added dependencies are stored as fixed local snapshots, like package dependencies. A lockfile records content signatures so changes at the source can be detected as drift. Exact source identity and refresh rules remain undecided.
- Turtle is the MVP authoring format for ontologies, domain models, view models, presentation graphs, visual design models, and SHACL constraint graphs. Use an RDF framework with support for standard formats for parsing and serialization, rather than custom parsers or formatters. External dependencies can use other standard RDF formats supported by that framework. Saved read-only SPARQL queries are versioned project files.
- The CLI and local web interface operate on the same project files. Changes made in either interface are visible in the other.
- Validation covers RDF syntax, use of available vocabulary, and declared constraints.
- Fixed filename suffixes associate supporting graphs with a source graph: `orders.ttl`, `orders.shacl.ttl`, `orders.context.view.ttl`, and `orders.context.presentation.ttl` illustrate the convention. A generic external URL needs an explicit support-graph association when added.
- Specialized editors in the MVP cover core ontology concepts, conceptual data models, descriptive process models, and descriptive state machine models. Additional forms and visual representations can be added after the MVP.

## Proposed CLI command inventory

`tbspec` is the confirmed executable name. Agents edit RDF statements directly in files; commands perform lifecycle, association, resolution, and validation operations. All commands are non-interactive, have stable exit codes, and accept `--json` for machine-readable output. Exact arguments remain open.

| Command | Operation |
| --- | --- |
| `tbspec init` | Create a project and its configuration in a local directory. |
| `tbspec status` | Summarize the current project's resources and locked dependencies. |
| `tbspec config show` | Show the effective project configuration and which values come from defaults. |
| `tbspec config model-type list` | List available model types and their selected ontologies. |
| `tbspec config model-type set` | Create a model type or change its local or locked external ontology association; disconnect the previous design association on ontology change. Show impact before changing a type already used by models and require explicit `--accept-impact` to proceed. |
| `tbspec config model-type disable` | Stop creation of new models of this type while preserving existing models, their ontology binding, and their validity. |
| `tbspec config model-type enable` | Allow new models of a previously disabled type to be created again. |
| `tbspec config model-type reset` | Restore a model type's default association. |
| `tbspec config model-type remove` | Remove a project-defined model type after impact inspection and explicit confirmation; existing models may then need repair. |
| `tbspec config model-type design set` | Associate a visual design model with a model type's current ontology, including explicit reuse of a supplied design after importing and selecting a local ontology copy. |
| `tbspec config model-type design clear` | Disconnect a model type's visual design while retaining generic graph editing. |
| `tbspec ontology list` | List project-owned ontologies. |
| `tbspec ontology show` | Show an ontology's identity, file, and associated support graphs. |
| `tbspec ontology create` | Create an ontology file. |
| `tbspec ontology import` | Copy an ontology from a local file or external source as a project-owned ontology with a new identity and recorded provenance. |
| `tbspec ontology remove` | Remove a project-owned ontology after explicit confirmation, even if this leaves unresolved references. |
| `tbspec model list` | List project-owned domain models and their kinds. |
| `tbspec model show` | Show a domain model's identity, file, kind, and associated support graphs. |
| `tbspec model create` | Create a model of a type enabled in project configuration, using its selected ontology. |
| `tbspec model remove` | Remove a project-owned model after explicit confirmation, even if this leaves unresolved references. |
| `tbspec view list` | List views of a source ontology or model. |
| `tbspec view show` | Show a view's source, selected members, and presentation graph. |
| `tbspec view create` | Create and associate a view model and its presentation graph. |
| `tbspec view remove` | Remove a view and its paired presentation graph after explicit confirmation. |
| `tbspec design list` | List local and available external visual design models. |
| `tbspec design show` | Show a design model and the concept types it covers. |
| `tbspec design create` | Create a reusable visual design model. |
| `tbspec design remove` | Remove a project-owned design after explicit confirmation, even if this leaves unresolved references. |
| `tbspec design select` | Choose one whole visual design for a concept type when definitions conflict. |
| `tbspec design clear` | Remove an explicit design choice for a concept type. |
| `tbspec shapes list` | List SHACL support graphs associated with project resources. |
| `tbspec shapes create` | Create a SHACL graph associated by filename with an ontology or model. |
| `tbspec shapes remove` | Remove a project-owned SHACL support graph after explicit confirmation. |
| `tbspec dependency list` | List locked external resources and their sources. |
| `tbspec dependency show` | Show one dependency's source, selected resource, snapshot, and signature. |
| `tbspec dependency inspect` | List selectable resources and support graphs when the source exposes a discoverable inventory. |
| `tbspec dependency add` | Snapshot one selected ontology, domain model, or visual design model from a directory, Git repository, or URL, including its discoverable directly associated support graphs and design choices. |
| `tbspec dependency check` | Detect source drift without changing locked snapshots. |
| `tbspec dependency update` | Refresh a snapshot and its lockfile signature explicitly. |
| `tbspec dependency support set` | Associate a SHACL or visual design resource with a dependency whose source does not expose that association; snapshot and lock the support resource. |
| `tbspec dependency support clear` | Remove an explicit support-graph association without silently deleting other resources. |
| `tbspec dependency remove` | Remove a locked dependency after explicit confirmation, even if this leaves unresolved references. |
| `tbspec impact <kind> <id>` | Preview direct and downstream references and affected files before removing a resource, with no changes. |
| `tbspec refactor iri <old> <new> [--apply]` | Preview an IRI rename by default; with `--apply`, update project-owned RDF graphs and project configuration. Report references in locked dependencies without modifying them. |
| `tbspec references list` | Show references to a selected IRI or resource, including dangling references. |
| `tbspec references redirect <old> <new> [--apply]` | Preview or apply redirection of selected occurrences of a dangling IRI in project-owned graphs and configuration. |
| `tbspec references remove <target> [--apply]` | Preview or apply deletion of selected statements and associations containing a dangling IRI. |
| `tbspec gc [--apply --confirm]` | Preview orphaned project-owned support resources associated with deleted models; remove selected candidates only with explicit application and confirmation. |
| `tbspec query list` | List saved project SPARQL queries. |
| `tbspec query show` | Show a saved query and its declared parameters. |
| `tbspec query save` | Save a named query and its parameter declarations as versioned project files. |
| `tbspec query run` | Run an ad hoc or saved read-only SPARQL query against a selected graph or the resolved project dataset, with optional typed parameter bindings. |
| `tbspec query remove` | Remove a saved project query after explicit confirmation. |
| `tbspec validate` | Validate the whole project or a selected resource using locked dependencies. |
| `tbspec web` | Start the local web interface for a project. |
| `tbspec llms [topic ...]` | Print the essential agent prompt or recursively indexed, focused guidance. |

This command list is a proposal for review. There are no CLI commands for Git history or individual RDF statements. Agents edit view membership, visual rules, saved query files, and other graph details in files, then validate. The naming and argument syntax of new query, reference repair, and garbage collection commands remain provisional.

### Agent guidance

`tbspec llms` prints the minimum instructions needed to operate the CLI and an index of next topics. Every index entry names the exact `tbspec llms ...` invocation, when to use it, and what it will explain. A topic may return its own indexed subtopics; a leaf explains the relevant commands, arguments, examples, and errors without dumping unrelated topics. For example, the root can point to `tbspec llms dependencies`, which can point to `tbspec llms dependencies check` and `tbspec llms dependencies update`. This is a hierarchical help system, not a way to retrieve project data; it tells agents which other CLI commands to run to inspect the project.

## Proposed web operations

| Area                 | Available operations                                                                                                                                                                                                                      | Status                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Project              | Open a local project; inspect its contents and validation state; create, enable, disable, reset, or remove model types; change their ontology associations; select or clear their visual designs; preview and confirm the impact of an ontology change. | Required; config details open |
| Ontologies           | List, create, import an editable copy, inspect, edit, and remove project-owned ontologies. Preview removal impact and confirm removal, including when references will break. Specialized forms cover classes, datatypes, properties, and individuals; advanced OWL constructs remain available in the generic editor. | Required; exact fields open |
| Domain models        | List, create, inspect, edit, and remove conceptual data, descriptive process, and descriptive state machine models. Specialized forms work for the terms they recognize, including unchanged terms in a local ontology copy. New or unfamiliar terms use the generic editor. Canvas visual rules and specialized forms are configured separately. | Required; vocabulary details open |
| View models          | Create, inspect, edit, and remove multiple perspectives on an ontology or domain model by explicitly selecting elements and relationships from one source graph. Selecting a relationship in the web interface also selects its endpoints. Creation also creates and associates a presentation graph. | Required; selection syntax open |
| Presentation graphs  | Create, inspect, edit, and remove a separate appearance and placement graph for each view.                                                                                                                                                 | Required; naming details open      |
| Visual design models | Create, inspect, edit, and remove reusable declarative rules for shape, label, color, typography, and relationship style. Choose one complete design per concept type when definitions conflict.                                            | Required; rule details open        |
| Dependencies         | List, add, refresh or change version, and remove selected individual resources from supported sources; inspect recorded signatures and source drift. Preview removal impact and confirm removal. | Required; details open |
| Refactoring          | Preview and apply an IRI rename across project-owned graphs and configuration, including ontology references, models, views, SHACL, and visual designs. Show references in locked dependencies without changing their snapshots. | Required; collision rules open |
| Reference repair     | Inspect dangling references, preview removal or redirection of incoming references, and apply a chosen repair to project-owned graphs and configuration. RDF syntax errors still require source correction. | Required; exact scope open |
| Saved queries        | List, inspect, save, run, and remove reusable read-only SPARQL queries with named typed parameters. Run ad hoc queries against one graph or the resolved project dataset. | Required; storage details open |
| Garbage collection  | Preview orphaned project-owned views and other support resources associated with deleted models; remove selected candidates only after explicit confirmation. | Required; selection details open |
| Validation           | Run validation and navigate from diagnostics to affected content.                                                                                                                                                                         | Proposed                           |
| Visual exploration   | View relationship graphs, concept hierarchies, and multiple view models of the same ontology or domain model. The generic graph editor is a node-and-relationship canvas with a properties panel and direct RDF source access.            | Required; scope open               |

## Proposed shared behavior

- Operations that change project content persist to local files and can be versioned with the project.
- A domain model can use vocabulary from project-owned and external ontologies.
- `model create` resolves the selected model type through effective project configuration. The configured ontology may be local or a locked external resource.
- New model types can be configured with their own ontologies. Disabling a model type prevents new models of that type but leaves existing models valid and editable against the retained ontology association.
- Replacing a model type's ontology when models of that type exist requires an advance warning. In the non-interactive CLI, the first attempt reports impact and makes no change; `--accept-impact` commits the change. The web interface asks for confirmation. The tool leaves model files unchanged and does not migrate their terms; validation reports any resulting incompatibilities.
- Replacing an ontology disconnects its old visual design association. Until a design is explicitly selected, the generic graph editor and generic fallback rendering remain available. The new design uses the replacement ontology's own concepts. A local copy can explicitly reuse the original design, extending it where needed. No semantic mapping to the tool-supplied ontology is required or implied.
- Importing an ontology as a project-owned copy makes it editable. Adding it as a dependency keeps it as a locked external snapshot; these are separate operations.
- An imported editable copy receives its own ontology identity and records the source it was derived from.
- Validation identifies the affected file and the reason for each problem. Location and machine-readable output are undecided.
- Before removing a model type, ontology, model, dependency, or visual resource, the CLI and web interface show its direct and downstream references and affected files within the known project. Removal requires explicit confirmation and may leave broken references. The project then remains invalid until those references are resolved; `status` and `validate` expose them. Removal does not silently rewrite referring graphs.
- `tbspec impact <kind> <id>` is read-only and can be used before deciding whether to remove a resource. Every CLI removal requires `--confirm`; the web interface presents the same impact before its confirmation action.
- `tbspec refactor iri` previews changes by default and applies them only with `--apply`. It updates references in project-owned RDF graphs and configuration as one operation; it reports references in locked dependencies but does not change their snapshots.
- A broken managed reference points to a registered project resource that is no longer available, or uses a class or property absent from the available ontologies. Arbitrary external IRIs used as data values do not require local targets. Validation does not dereference arbitrary IRIs over the network.
- The CLI can inspect dangling references and preview either redirection to an available resource or deletion of selected references. It lists each occurrence before changing it, including subject, predicate, and object positions and project configuration associations. Repair operations change only project-owned parseable graphs and project configuration. A syntactically invalid RDF file must be corrected in source before a graph operation can safely edit it.
- A confirmed garbage collection operation removes only orphaned project-owned support resources associated with deleted models, such as views, presentation graphs, and SHACL graphs. It does not collect independent designs or locked dependencies. Its default invocation previews candidates and affected files; the user selects candidates before applying. Projects that track these files in Git can restore tracked deletions through Git; the tool does not implement its own revision history.
- Generic web editing can modify any supported RDF graph, regardless of its concept types. Specialized editors must preserve data they do not understand.
- A domain model using a class or property not defined in its available ontologies fails validation. Presentation graphs use their own validation rules.
- A concept with no custom visual definition remains editable through the generic graph editor.
- If a selected design does not cover a concept, render it generically and show a visual-editor warning. Missing appearance rules do not invalidate RDF or the model.
- SHACL constraints supplied with an ontology dependency apply automatically to models using that ontology.
- When adding an ontology dependency, include only its discoverable directly associated SHACL graph, visual design model, and design choices. Support graphs of a standalone resource URL can be associated explicitly when the source provides no discoverable inventory.
- A support graph manually associated with a standalone dependency is snapshotted and recorded in the lockfile. Clearing its association does not silently remove the underlying resource.
- SPARQL `SELECT`, `ASK`, `CONSTRUCT`, and `DESCRIBE` queries are read-only; SPARQL Update and remote `SERVICE` are not accepted by `query run`. Saved queries are versioned project files with declared named RDF-term parameters such as IRIs and literals. Bindings are passed by name to SPARQL variables, rather than interpolating raw strings into query text.
- Every project RDF resource is exposed to SPARQL as a named graph. The default project dataset is the union of the project's ontologies and domain models, including their locked ontology/model dependencies. SHACL, view, presentation, and visual design graphs remain available by graph name; a query can also target one selected graph. Query execution uses local project files and locked snapshots without fetching remote data.
- When designs compete for a concept type, use this precedence: (1) an explicit choice in the consuming project, (2) a project-owned design, (3) a design associated with the selected ontology, including an inherited source choice, and (4) other inherited designs, with nearer dependencies ahead of more distant ones. If multiple candidates remain at the same level and distance, report an error. Both the web interface and CLI can record an explicit winner.
- The web source editor can save invalid RDF with visible diagnostics; graph-based editing requires parsable RDF.
- The generic web editor shows the complete graph without requiring a saved view model. Saving a selected subset and its layout creates a view model and presentation graph.
- In a web view editor, selecting a relationship automatically selects both endpoints and makes that addition visible. `validate` reports a view whose file lists a relationship without both endpoints; it does not silently modify the file.
- Source editing reports syntax problems as the user works. Full vocabulary and SHACL validation runs on request from the web interface or CLI.
- `dependency inspect` only enumerates resources when the source exposes a discoverable inventory; a direct resource URL can still be added without an inventory.
- Visual conflict resolution selects one complete design for a concept type, rather than merging individual properties from competing designs.
- A consuming project can use inherited design selections and precedence without configuring every conflict again. An explicit local choice takes precedence over all inherited choices.
- View protocols can be supplied by project ontologies. C4 and 4+1 are examples only; neither is required as a built-in MVP protocol.
- The initial specialized web editors cover ontologies, data models, process models, and state machine models. Their vocabularies and exact concepts remain open.
- Specialized forms recognize known RDF terms rather than following the selected visual design. They remain usable for unchanged terms in a local ontology copy; unfamiliar terms use generic editing.
- Process editing covers activities, decisions, inputs, outputs, responsible parties, and flows as descriptions; it does not run processes.
- State machine editing covers initial and final states and transitions with events, conditions, and actions, without hierarchical or parallel states or runtime execution.
- Data editing covers conceptual entities, attributes, and relationships, without physical database schema design.

## Visual extensibility proposal

The MVP includes a fallback representation for any RDF graph and declarative appearance rules keyed by the concepts of the ontology actually selected by the project. These rules configure generic node and edge renderers and can be reused through dependencies. A replacement ontology does not need to resemble the tool-supplied ontology. Executable visual plugins are outside the MVP. React Flow supports custom nodes and edges through registered React components; using configurable generic components for these rules is an inference about how it could be used, not a choice of UI framework. See its [custom node](https://reactflow.dev/learn/customization/custom-nodes) and [custom edge](https://reactflow.dev/learn/customization/custom-edges) documentation.

## Vocabulary assessment for specialized editors

- [OWL 2](https://www.w3.org/TR/owl2-syntax/) and [RDF Schema](https://www.w3.org/TR/rdf-schema/) cover classes, datatype properties, and object properties. Using them for conceptual entities, attributes, and relationships is a plausible fit, but the exact editor terms remain open.
- [BPMN](https://www.omg.org/spec/BPMN/machine-readable) provides process modeling concepts, but OMG's machine-readable artifacts are XML Schema and CMOF. Using its concepts in this RDF-native project would therefore need a mapping or separate RDF vocabulary; this is an inference from the published formats.
- [P-Plan](https://www.opmw.org/model/p-plan/) supplies planned steps, input/output variables, and precedence. [PROV-O](https://www.w3.org/TR/prov-o/) supplies agents and activity associations, but neither alone covers every agreed descriptive-process concept. [OWL-S](https://www.w3.org/submissions/OWL-S/) has control constructs but targets web services; its fit needs assessment.
- [SCXML](https://www.w3.org/TR/scxml/) covers state-machine concepts in XML, including runtime behavior outside this MVP. [UML](https://www.omg.org/spec/UML/2.5.1) has state machines and [MOF2RDF](https://www.omg.org/spec/MOF2RDF/) provides an RDF mapping route. A small directly usable RDF vocabulary has not yet been selected. See the [per-type assessment](vocabulary-options.md#assessment-by-default-model-type).

## Decisions recorded

- Use Git directly for version control; no separate version history in the tool.
- Agents edit individual RDF statements in files. CLI commands cover all complex project operations, with no per-statement commands.
- The web interface must support both generic graph editing and specialized editors chosen by graph and concept type.
- Turtle is the MVP authoring format, SHACL declares constraints, and standard format handling belongs to an RDF framework.
- Support local directory, Git repository, and generic URL sources for external ontologies and models.
- Include relationship graph and concept hierarchy views.
- Include read-only impact inspection and confirmed removal, including removal that leaves dangling references and an invalid project until repaired ([ADR 0003](../../docs/adr/0003-allow-confirmed-breaking-removal.md)).
- The generic web editor uses a node-and-relationship canvas, properties panel, and RDF source editor.
- One source graph can have multiple views, each with its own presentation graph.
- An ontology or domain model can have multiple view models; ontologies can define view protocols. C4 and 4+1 are examples rather than promised built-in protocols.
- Store dependency snapshots locally and record their content signatures in a lockfile for drift detection ([ADR 0001](../../docs/adr/0001-lock-external-resources.md)).
- Accept standard RDF formats supported by the selected framework as external dependency inputs.
- Treat unknown classes or properties in domain models as validation errors.
- Provide reusable declarative concept appearance definitions in the MVP; defer executable visual plugins.
- View models explicitly select elements and relationships from one source graph, with a separate presentation graph per view.
- Resolve visual designs by a defined precedence hierarchy, allowing inherited choices to work without repeated configuration; surface remaining ties as errors and allow explicit resolution in the web interface and CLI.
- Prefer standard vocabularies for the default model types where they cover the agreed concepts; assess data, process, and state-machine ontologies separately before choosing exact terms.
- Provide `dependency check` to detect source drift; `validate` uses locked snapshots without network access.
- Apply SHACL constraints from ontology dependencies automatically.
- Allow saving invalid RDF source with diagnostics; graph-based editing needs parsable RDF.
- Associate support graphs with original graphs through file naming conventions.
- Include specialized web editors for ontologies, data models, process models, and state machine models, with their vocabularies still to be selected.
- Define visual shape, label, color, typography, and relationship style per concept type; position remains view-specific presentation data.
- Resolve visual conflicts by choosing one complete design per concept type.
- Let projects supply view protocols through ontologies; do not require C4 or 4+1 as built-in MVP protocols.
- Add individual external resources, even when a source directory or repository contains several.
- Make CLI commands non-interactive with stable exit codes and optional JSON output; add `tbspec llms` with selective agent guidance.
- Provide specialized ontology forms for classes, datatypes, properties, and individuals; use the generic editor for advanced OWL constructs.
- Keep data models conceptual, process models descriptive, and state machine models non-executable and non-hierarchical in the MVP.
- Make `tbspec llms` a recursive disclosure tree: the root gives essential guidance and an index; deeper topics provide progressively detailed prompts and further indexes.
- Associate local support graphs through fixed suffixes and create each view model with its own linked presentation graph.
- Show the full graph in the generic editor without requiring a saved view; run full validation on request.
- Inspect dependency sources only when they expose a resource inventory.
- Include discoverable directly associated SHACL, visual designs, and design choices when adding an individual ontology dependency; allow explicit association for standalone resource URLs.
- Start every project with ready-to-use `data`, `process`, and `state-machine` ontology and visualization defaults; allow additional types and replacement ontologies ([ADR 0002](../../docs/adr/0002-configure-model-types-per-project.md)).
- Give tool-supplied ontologies stable RDF identities and versions so projects can reference or fork them.
- Do not map a replacement ontology's concepts to those of the default ontology.
- Keep specialized forms tied to recognized terms, independently of canvas visual rules; a local ontology copy can retain forms for unchanged terms.
- Render concepts without a matching visual rule generically and warn in the visual editor without treating this as a model validation failure.
- Automatically select relationship endpoints in the web view editor and validate the same invariant in view files.
- Let agents preview and apply a project-wide IRI rename across owned graphs and configuration; leave locked dependency snapshots unchanged.
- Store visual designs, views, and presentation graphs as RDF/Turtle; support ad hoc and saved parameterized read-only SPARQL queries for project exploration.
- Expose resources as named SPARQL graphs and use a local union of ontology and domain-model graphs as the default dataset; exclude remote `SERVICE` in the MVP.
- Treat only missing managed resources and unavailable vocabulary terms as broken references, while allowing external individual IRIs as data values.
- Allow read-only inspection and repair operations while the project has broken references. Surface RDF parse errors and require source correction before graph operations that would edit an unparseable file.
- Allow explicit association of SHACL and visual design resources with dependencies lacking a discoverable inventory; snapshot and lock the associated resources.
- Provide confirmed garbage collection for orphaned project-owned support resources associated with deleted models, with preview as the default action; leave independent designs and locked dependencies to explicit removal commands.
- Preview each selected occurrence of a dangling IRI across subject, predicate, and object positions before bulk redirection or removal.
- Disconnect the old visual design when a model type's ontology changes; allow generic graph editing until a new design is explicitly selected, including when reusing a supplied design for a local ontology copy.
- Give imported editable ontologies new identities and record provenance.
- Warn before changing a model type used by existing models; require `--accept-impact` in the CLI and confirmation in the web interface; do not migrate their files.
- Allow projects to create model types and override, disable, and reset default types. Disabling prevents new model creation while retaining existing models as valid and editable.
- Include basic relation inference in the MVP only if the selected RDF framework exposes it as a straightforward, reliable capability; do not imply full OWL reasoning.
- Keep `llms` documentation-only and direct agents to `status`, `list`, `show`, and other commands for live project context.

## Decisions needed to finish the contract

1. Starter vocabularies: evaluate standard RDF vocabularies separately for data, process, and state-machine models, then define exact terms and specialized forms. See the [option analysis](vocabulary-options.md).
2. Inference: evaluate the selected RDF framework, define the exact basic entailments if included, and keep full OWL reasoning out of this implicit promise.
3. `llms` guidance: topic names, leaf contents, and how the index points to project-inspection and query commands.
4. Visual design reuse: define how precedence and upstream selections are serialized so dependency snapshots preserve the chosen behavior.
5. Dependency behavior: source and snapshot identity, lockfile contents, drift detection and refresh, and handling incompatible or unavailable sources.
6. Validation and file layout: SHACL scope across graphs, support graph naming conventions, and failure behavior.
7. Command details: project discovery, identifiers, arguments, output schemas, exit codes, saved-query parameter declaration syntax, reference occurrence selection, garbage collection candidate selection, explicit removal confirmation, and IRI rename collision handling.
