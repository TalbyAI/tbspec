# MVP Functional Specification

Status: Draft for product decisions (interview rounds 1 and 2 incorporated)

## Purpose

Define the operations available in the first version of the local ontology and model management tool. This draft starts from [INTENT.md](../../INTENT.md) and the product decisions recorded below. Command names and any behavior marked **Proposed** require confirmation before this becomes the MVP contract.

## Product boundary

- A project is a local directory containing ontologies, domain models, view models, presentation graphs, visual design models, or a combination of them. Git provides version control; the tool does not implement a separate revision history.
- Ontologies define reusable concepts and relationships. Domain models describe the project's domain using available ontologies.
- Separate, optional presentation graphs can describe the visual appearance or placement of concrete ontology or model elements: location, grouping, colors, fonts, and similar information. One resource can have multiple presentation graphs; one presentation graph describes one resource. A visual design model defines reusable presentation rules without describing concrete domain elements.
- A view model selects the elements and relationships shown in a perspective on an ontology or domain model. One graph can have multiple views, potentially using protocols such as C4 or 4+1. Ontologies can define the vocabulary for view protocols; these examples do not imply built-in support for either protocol. How a view model relates to a presentation graph remains undecided.
- A project can reuse ontologies, domain models, and visual design models from local directories, Git repositories, and generic URLs. Added dependencies are stored as fixed local snapshots, like package dependencies. A lockfile records content signatures so changes at the source can be detected as drift. Exact source identity and refresh rules remain undecided.
- Turtle is the MVP authoring format. SHACL is the format for declared constraints. Use an RDF framework with support for standard formats for parsing and serialization, rather than custom parsers or formatters. External dependencies can use other standard RDF formats supported by that framework.
- The CLI and local web interface operate on the same project files. Changes made in either interface are visible in the other.
- Validation covers RDF syntax, use of available vocabulary, and declared constraints.

## Proposed CLI command inventory

`tbspec` is a working command name. The command groups below define operations, not final arguments or output format. RDF content is edited as files outside the CLI; the CLI does not need statement-level editing commands.

| Command                    | Operation                                                                                          | Status   |
| -------------------------- | -------------------------------------------------------------------------------------------------- | -------- |
| `tbspec init`              | Create a project in a local directory.                                                             | Proposed |
| `tbspec status`            | Show the current project's ontologies, models, dependencies, and validation summary.               | Proposed |
| `tbspec ontology list`     | List ontologies defined by the project.                                                            | Proposed |
| `tbspec ontology show`     | Display one ontology and its identifying information.                                              | Proposed |
| `tbspec ontology create`   | Create an ontology in the project.                                                                 | Proposed |
| `tbspec ontology remove`   | Remove a project-owned ontology.                                                                   | Proposed |
| `tbspec model list`        | List domain models in the project.                                                                 | Proposed |
| `tbspec model show`        | Display one domain model and its identifying information.                                          | Proposed |
| `tbspec model create`      | Create a domain model in the project.                                                              | Proposed |
| `tbspec model remove`      | Remove a domain model.                                                                             | Proposed |
| `tbspec visual list`       | List view models, presentation graphs, and visual design models.                                   | Proposed |
| `tbspec visual show`       | Display a view model, presentation graph, or visual design model.                                  | Proposed |
| `tbspec visual create`     | Create a view model, presentation graph, or visual design model.                                   | Proposed |
| `tbspec visual remove`     | Remove a view model, presentation graph, or visual design model.                                   | Proposed |
| `tbspec dependency list`   | List external ontologies and models with their sources and selected versions, where available.     | Proposed |
| `tbspec dependency add`    | Make an external ontology, domain model, or visual design model available to this project.         | Proposed |
| `tbspec dependency update` | Refresh the local snapshot or select a different source version and update its lockfile signature. | Proposed |
| `tbspec dependency remove` | Stop making a dependency available.                                                                | Proposed |
| `tbspec validate`          | Check selected project content or the whole project and report diagnostics.                        | Proposed |
| `tbspec web`               | Start the local web interface for a project.                                                       | Proposed |

There are no CLI commands for Git history or for adding, changing, or removing individual RDF statements. Users edit local RDF files with their preferred tools and run `tbspec validate`. The exact CLI command structure for visual resources remains proposed.

## Proposed web operations

| Area                 | Available operations                                                                                                                                                                                                                      | Status                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Project              | Open a local project; inspect its contents and validation state.                                                                                                                                                                          | Proposed                           |
| Ontologies           | List, create, inspect, edit, and remove project-owned ontologies. Include generic graph editing and concept-specific editing. A project can define how a new concept appears on the canvas; dependent projects can reuse that definition. | Required; extension mechanism open |
| Domain models        | List, create, inspect, edit, and remove models. Open any graph in the generic editor and apply available custom representations for its concepts.                                                                                         | Required; specialized scope open   |
| View models          | Create, inspect, edit, and remove multiple perspectives on an ontology or domain model by selecting the elements and relationships each one includes.                                                                                     | Required; selection rules open     |
| Presentation graphs  | Create, inspect, edit, and remove separate graphs describing appearance and placement. A resource may have multiple presentation graphs.                                                                                                  | Required; association details open |
| Visual design models | Create, inspect, edit, and remove reusable visual rules; apply or reference local and external design models from presentation graphs.                                                                                                    | Required; reuse details open       |
| Dependencies         | List, add, refresh or change version, and remove local snapshots of ontologies, domain models, and visual design models from supported sources; inspect recorded signatures and source drift.                                             | Required; details open             |
| Validation           | Run validation and navigate from diagnostics to affected content.                                                                                                                                                                         | Proposed                           |
| Visual exploration   | View relationship graphs, concept hierarchies, and multiple view models of the same ontology or domain model. The generic graph editor is a node-and-relationship canvas with a properties panel and direct RDF source access.            | Required; scope open               |

## Proposed shared behavior

- Operations that change project content persist to local files and can be versioned with the project.
- A domain model can use vocabulary from project-owned and external ontologies.
- Validation identifies the affected file and the reason for each problem. Location and machine-readable output are undecided.
- Removing an ontology, model, dependency, or visual resource must not leave broken references. The exact refusal and repair behavior is undecided.
- Generic web editing can modify any supported RDF graph, regardless of its concept types. Specialized editors must preserve data they do not understand.
- A domain model using a class or property not defined in its available ontologies fails validation. Presentation graphs use their own validation rules.
- A concept with no custom visual definition remains editable through the generic graph editor.

## Visual extensibility proposal

The MVP needs a fallback representation for any RDF graph and a way to reuse visual definitions supplied by a dependency. A small declarative mapping from concept type to built-in node or edge appearance would meet that need while leaving specialized editors to be added over time. The alternative is to require executable plugins for new concepts in the first release; the product decision is still open. React Flow supports custom nodes and edges through registered React components; the proposed mapping to configurable built-in renderers is an inference about how it could be used, not a choice of UI framework. See its [custom node](https://reactflow.dev/learn/customization/custom-nodes) and [custom edge](https://reactflow.dev/learn/customization/custom-edges) documentation.

## Decisions recorded

- Use Git directly for version control; no separate version history in the tool.
- Edit RDF files directly for CLI workflows; no statement-level CLI editor is required.
- The web interface must support both generic graph editing and specialized editors chosen by graph and concept type.
- Turtle is the MVP authoring format, SHACL declares constraints, and standard format handling belongs to an RDF framework.
- Support local directory, Git repository, and generic URL sources for external ontologies and models.
- Include relationship graph and concept hierarchy views.
- Include removal operations with protection against broken references.
- The generic web editor uses a node-and-relationship canvas, properties panel, and RDF source editor.
- One resource can have multiple presentation graphs, with each presentation graph describing only one resource.
- An ontology or domain model can have multiple view models; ontologies can define view protocols. C4 and 4+1 are examples rather than promised built-in protocols.
- Store dependency snapshots locally and record their content signatures in a lockfile for drift detection.
- Accept standard RDF formats supported by the selected framework as external dependency inputs.
- Treat unknown classes or properties in domain models as validation errors.

## Decisions needed to finish the contract

1. Visual extensibility: whether the MVP includes declarative reusable concept appearances, executable visual plugins, or only a fixed built-in set; and which concept-specific editors are first.
2. Views: how view models select elements, how view protocols are described, and whether presentation graphs attach to an original model or to each view model.
3. Visual design reuse: how styles from local and dependent design models are associated, combined, and overridden.
4. Dependency behavior: source and snapshot identity, lockfile contents, drift detection and refresh, and handling incompatible or unavailable sources.
5. Validation: SHACL scope and results across dependencies, view models, and multiple graphs.
6. Command details: identifiers, file layout, arguments, output, failure behavior, and removal rules after the earlier decisions are settled.
