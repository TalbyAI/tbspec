# MVP Functional Specification

Status: Draft; product interview in progress

## Purpose

Define the operations available in the first version of the local ontology and model management tool. This draft starts from [INTENT.md](../../INTENT.md) and the product decisions recorded below. Command names and any behavior marked **Proposed** require confirmation before this becomes the MVP contract.

## Product boundary

- A project is a local directory containing ontologies, domain models, view models, presentation graphs, visual design models, or a combination of them. Git provides version control; the tool does not implement a separate revision history.
- Each project has a configuration based on defaults. The default `data`, `process`, and `state-machine` model types have tool-supplied ontologies and visual design models ready to use. A project can define additional model types or replace a type's ontology with a project-owned ontology or a locked external resource. Changing the ontology disconnects its previous visual design association; the graph remains editable through the generic editor until a design is selected explicitly. Even a local copy of a supplied ontology must explicitly select the original design if it intends to reuse it. Its design can then be extended or modified for changed concepts. The tool does not map replacement terms onto the supplied ontology's terms.
- Ontologies define reusable concepts and relationships. Domain models describe the project's domain using available ontologies.
- Separate presentation graphs describe the visual appearance or placement of concrete ontology or model elements: location, grouping, colors, fonts, and similar information. Each view has its own presentation graph. A visual design model defines reusable presentation rules without describing concrete domain elements.
- A view model explicitly selects elements and relationships from one ontology or domain model. One source graph can have multiple views, potentially using protocols such as C4 or 4+1. Ontologies can define the vocabulary for view protocols; these examples do not imply built-in support for either protocol. Each view has its own presentation graph so the same element can have different positions in different views.
- A project can reuse individual ontologies, domain models, and visual design models selected from local directories, Git repositories, and generic URLs. Added dependencies are stored as fixed local snapshots, like package dependencies. A lockfile records content signatures so changes at the source can be detected as drift. Exact source identity and refresh rules remain undecided.
- Turtle is the MVP authoring format. SHACL is the format for declared constraints. Use an RDF framework with support for standard formats for parsing and serialization, rather than custom parsers or formatters. External dependencies can use other standard RDF formats supported by that framework.
- The CLI and local web interface operate on the same project files. Changes made in either interface are visible in the other.
- Validation covers RDF syntax, use of available vocabulary, and declared constraints.
- Fixed filename suffixes associate supporting graphs with a source graph: `orders.ttl`, `orders.shacl.ttl`, `orders.context.view.ttl`, and `orders.context.presentation.ttl` illustrate the convention. A generic external URL needs an explicit support-graph association when added.
- Specialized editors in the MVP cover core ontology concepts, conceptual data models, descriptive process models, and descriptive state machine models. Additional forms and visual representations can be added after the MVP.

## Proposed CLI command inventory

`tbspec` is a working command name. Agents edit RDF statements directly in files; commands perform lifecycle, association, resolution, and validation operations. All commands are non-interactive, have stable exit codes, and accept `--json` for machine-readable output. Exact arguments remain open.

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
| `tbspec config model-type remove` | Remove a project-defined model type that has no existing models or other references. |
| `tbspec config model-type design set` | Associate a visual design model with a model type's current ontology, including explicit reuse of a supplied design after importing and selecting a local ontology copy. |
| `tbspec config model-type design clear` | Disconnect a model type's visual design while retaining generic graph editing. |
| `tbspec ontology list` | List project-owned ontologies. |
| `tbspec ontology show` | Show an ontology's identity, file, and associated support graphs. |
| `tbspec ontology create` | Create an ontology file. |
| `tbspec ontology import` | Copy an ontology from a local file or external source as a project-owned ontology with a new identity and recorded provenance. |
| `tbspec ontology remove` | Remove an ontology if no remaining resource refers to it. |
| `tbspec model list` | List project-owned domain models and their kinds. |
| `tbspec model show` | Show a domain model's identity, file, kind, and associated support graphs. |
| `tbspec model create` | Create a model of a type enabled in project configuration, using its selected ontology. |
| `tbspec model remove` | Remove a model if no remaining resource refers to it. |
| `tbspec view list` | List views of a source ontology or model. |
| `tbspec view show` | Show a view's source, selected members, and presentation graph. |
| `tbspec view create` | Create and associate a view model and its presentation graph. |
| `tbspec view remove` | Remove a view and its paired presentation graph. |
| `tbspec design list` | List local and available external visual design models. |
| `tbspec design show` | Show a design model and the concept types it covers. |
| `tbspec design create` | Create a reusable visual design model. |
| `tbspec design remove` | Remove a project-owned design if it has no references. |
| `tbspec design select` | Choose one whole visual design for a concept type when definitions conflict. |
| `tbspec design clear` | Remove an explicit design choice for a concept type. |
| `tbspec shapes list` | List SHACL support graphs associated with project resources. |
| `tbspec shapes create` | Create a SHACL graph associated by filename with an ontology or model. |
| `tbspec shapes remove` | Remove a project-owned SHACL support graph. |
| `tbspec dependency list` | List locked external resources and their sources. |
| `tbspec dependency show` | Show one dependency's source, selected resource, snapshot, and signature. |
| `tbspec dependency inspect` | List selectable resources and support graphs when the source exposes a discoverable inventory. |
| `tbspec dependency add` | Snapshot one selected ontology, domain model, or visual design model from a directory, Git repository, or URL. Rules for associated support graphs remain open. |
| `tbspec dependency check` | Detect source drift without changing locked snapshots. |
| `tbspec dependency update` | Refresh a snapshot and its lockfile signature explicitly. |
| `tbspec dependency remove` | Remove a dependency if no remaining resource refers to it. |
| `tbspec validate` | Validate the whole project or a selected resource using locked dependencies. |
| `tbspec web` | Start the local web interface for a project. |
| `tbspec llms [topic ...]` | Print the essential agent prompt or recursively indexed, focused guidance. |

This command list is a proposal for review. There are no CLI commands for Git history or individual RDF statements. Agents edit view membership, visual rules, and other graph details in files, then validate. Whether a separate command is needed to associate support graphs from generic external URLs remains open.

### Agent guidance

`tbspec llms` prints the minimum instructions needed to operate the CLI and an index of next topics. Every index entry names the exact `tbspec llms ...` invocation, when to use it, and what it will explain. A topic may return its own indexed subtopics; a leaf explains the relevant commands, arguments, examples, and errors without dumping unrelated topics. For example, the root can point to `tbspec llms dependencies`, which can point to `tbspec llms dependencies check` and `tbspec llms dependencies update`. This is a hierarchical help system, not a way to retrieve project data; it tells agents which other CLI commands to run to inspect the project.

## Proposed web operations

| Area                 | Available operations                                                                                                                                                                                                                      | Status                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Project              | Open a local project; inspect its contents and validation state; create, enable, disable, reset, or remove model types; change their ontology associations; select or clear their visual designs; preview and confirm the impact of an ontology change. | Required; config details open |
| Ontologies           | List, create, import an editable copy, inspect, edit, and remove project-owned ontologies. Specialized forms cover classes, datatypes, properties, and individuals; advanced OWL constructs remain available in the generic editor.          | Required; exact fields open        |
| Domain models        | List, create, inspect, edit, and remove conceptual data, descriptive process, and descriptive state machine models. Specialized editors are available for supplied vocabularies; the generic graph editor works for every graph. The behavior of specialized forms with replacement vocabularies remains open. | Required; vocabulary details open  |
| View models          | Create, inspect, edit, and remove multiple perspectives on an ontology or domain model by explicitly selecting elements and relationships from one source graph. Creation also creates and associates a presentation graph.                     | Required; selection syntax open    |
| Presentation graphs  | Create, inspect, edit, and remove a separate appearance and placement graph for each view.                                                                                                                                                 | Required; naming details open      |
| Visual design models | Create, inspect, edit, and remove reusable declarative rules for shape, label, color, typography, and relationship style. Choose one complete design per concept type when definitions conflict.                                            | Required; rule details open        |
| Dependencies         | List, add, refresh or change version, and remove selected individual resources from supported sources; inspect recorded signatures and source drift.                                                                                        | Required; details open             |
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
- Removing an ontology, model, dependency, or visual resource must not leave broken references. The exact refusal and repair behavior is undecided.
- Generic web editing can modify any supported RDF graph, regardless of its concept types. Specialized editors must preserve data they do not understand.
- A domain model using a class or property not defined in its available ontologies fails validation. Presentation graphs use their own validation rules.
- A concept with no custom visual definition remains editable through the generic graph editor.
- SHACL constraints supplied with an ontology dependency apply automatically to models using that ontology.
- When designs compete for a concept type, use the project design precedence hierarchy where it yields one winner. If a conflict remains at the same precedence level, report an error. Both the web interface and CLI can record an explicit winner. The hierarchy's exact levels remain open.
- The web source editor can save invalid RDF with visible diagnostics; graph-based editing requires parsable RDF.
- The generic web editor shows the complete graph without requiring a saved view model. Saving a selected subset and its layout creates a view model and presentation graph.
- Source editing reports syntax problems as the user works. Full vocabulary and SHACL validation runs on request from the web interface or CLI.
- `dependency inspect` only enumerates resources when the source exposes a discoverable inventory; a direct resource URL can still be added without an inventory.
- Visual conflict resolution selects one complete design for a concept type, rather than merging individual properties from competing designs.
- A consuming project can use inherited design selections and precedence without configuring every conflict again. An explicit choice in the consuming project takes precedence; exact inheritance rules remain open.
- View protocols can be supplied by project ontologies. C4 and 4+1 are examples only; neither is required as a built-in MVP protocol.
- The initial specialized web editors cover ontologies, data models, process models, and state machine models. Their vocabularies and exact concepts remain open.
- Process editing covers activities, decisions, inputs, outputs, responsible parties, and flows as descriptions; it does not run processes.
- State machine editing covers initial and final states and transitions with events, conditions, and actions, without hierarchical or parallel states or runtime execution.
- Data editing covers conceptual entities, attributes, and relationships, without physical database schema design.

## Visual extensibility proposal

The MVP includes a fallback representation for any RDF graph and declarative appearance rules keyed by the concepts of the ontology actually selected by the project. These rules configure generic node and edge renderers and can be reused through dependencies. A replacement ontology does not need to resemble the tool-supplied ontology. Executable visual plugins are outside the MVP. React Flow supports custom nodes and edges through registered React components; using configurable generic components for these rules is an inference about how it could be used, not a choice of UI framework. See its [custom node](https://reactflow.dev/learn/customization/custom-nodes) and [custom edge](https://reactflow.dev/learn/customization/custom-edges) documentation.

## Vocabulary assessment for specialized editors

- [OWL 2](https://www.w3.org/TR/owl2-syntax/) defines classes, datatypes, properties, and individuals and is an established basis for ontology editing. The subset exposed by specialized editors is still open.
- [BPMN](https://www.omg.org/spec/BPMN/machine-readable) provides process modeling concepts, but OMG's machine-readable artifacts are XML Schema and CMOF. Using its concepts in this RDF-native project would therefore need a mapping or separate RDF vocabulary; this is an inference from the published formats.
- [P-Plan](https://www.opmw.org/model/p-plan/) is an RDF vocabulary for plans, steps, and input/output variables. [PROV-O](https://www.w3.org/TR/prov-o/) describes activities, entities, and agents. Their fit depends on whether the process editor describes planned workflows or execution history.
- [SCXML](https://www.w3.org/TR/scxml/) specifies event-based state machines in XML. An RDF-native state machine editor would need an RDF vocabulary, whether reused or authored for this project. The required semantics are still open.

## Decisions recorded

- Use Git directly for version control; no separate version history in the tool.
- Agents edit individual RDF statements in files. CLI commands cover all complex project operations, with no per-statement commands.
- The web interface must support both generic graph editing and specialized editors chosen by graph and concept type.
- Turtle is the MVP authoring format, SHACL declares constraints, and standard format handling belongs to an RDF framework.
- Support local directory, Git repository, and generic URL sources for external ontologies and models.
- Include relationship graph and concept hierarchy views.
- Include removal operations with protection against broken references.
- The generic web editor uses a node-and-relationship canvas, properties panel, and RDF source editor.
- One source graph can have multiple views, each with its own presentation graph.
- An ontology or domain model can have multiple view models; ontologies can define view protocols. C4 and 4+1 are examples rather than promised built-in protocols.
- Store dependency snapshots locally and record their content signatures in a lockfile for drift detection ([ADR 0001](../../docs/adr/0001-lock-external-resources.md)).
- Accept standard RDF formats supported by the selected framework as external dependency inputs.
- Treat unknown classes or properties in domain models as validation errors.
- Provide reusable declarative concept appearance definitions in the MVP; defer executable visual plugins.
- View models explicitly select elements and relationships from one source graph, with a separate presentation graph per view.
- Resolve visual designs by a defined precedence hierarchy, allowing inherited choices to work without repeated configuration; surface remaining ties as errors and allow explicit resolution in the web interface and CLI.
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
- Start every project with ready-to-use `data`, `process`, and `state-machine` ontology and visualization defaults; allow additional types and replacement ontologies ([ADR 0002](../../docs/adr/0002-configure-model-types-per-project.md)).
- Do not map a replacement ontology's concepts to those of the default ontology.
- Disconnect the old visual design when a model type's ontology changes; allow generic graph editing until a new design is explicitly selected, including when reusing a supplied design for a local ontology copy.
- Give imported editable ontologies new identities and record provenance.
- Warn before changing a model type used by existing models; require `--accept-impact` in the CLI and confirmation in the web interface; do not migrate their files.
- Allow projects to create model types and override, disable, and reset default types. Disabling prevents new model creation while retaining existing models as valid and editable.
- Include basic relation inference in the MVP only if the selected RDF framework exposes it as a straightforward, reliable capability; do not imply full OWL reasoning.
- Keep `llms` documentation-only and direct agents to `status`, `list`, `show`, and other commands for live project context.

## Decisions needed to finish the contract

1. Specialized editors: determine whether their forms work with replacement ontologies once visual definitions are selected. See the [option analysis](vocabulary-options.md).
2. Inference: evaluate the selected RDF framework, define the exact basic entailments if included, and keep full OWL reasoning out of this implicit promise.
3. `llms` guidance: topic names, leaf contents, and how the index points to project-inspection commands.
4. Visual design reuse: define the precedence hierarchy and how an upstream selection is inherited when a consuming project adds competing designs.
5. Dependency behavior: source and snapshot identity, lockfile contents, drift detection and refresh, and handling incompatible or unavailable sources.
6. Validation and file layout: SHACL scope across graphs, support graph naming conventions, and failure behavior.
7. Command details: project discovery, identifiers, arguments, output schemas, exit codes, and removal rules.
