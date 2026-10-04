# MVP Functional Specification

Version: 0.1
Status: Closed functional specification; technical design pending

## Purpose

Define the operations available in the first version of the local ontology and model management tool. This specification develops [INTENT.md](../../INTENT.md) and the decisions agreed during the product interview.

## Product boundary

- A project is a local directory containing ontologies, domain models, view models, presentation graphs, visual design models, or a combination of them. `tbspec.toml` marks the project root. Commands search upward from the current directory for that root or use an explicit `--project` path. A Git repository is not required, although Git provides version control when used; the tool does not implement a separate revision history.
- Each project has a configuration based on defaults. The default `data`, `process`, and `state-machine` model types have tool-supplied, versioned RDF ontologies and visual design models with stable identities; projects can reference or copy them. A project can define additional model types or replace a type's ontology with a project-owned ontology or a locked external resource. Changing the ontology disconnects its previous visual design association; the graph remains editable through the generic editor until a design is selected explicitly. Even a local copy of a supplied ontology must explicitly select the original design if it intends to reuse it. Its design can then be extended or modified for changed concepts. The tool does not map replacement terms onto the supplied ontology's terms.
- Ontologies define reusable concepts and relationships. Domain models describe the project's domain using available ontologies.
- Separate presentation graphs describe the visual appearance or placement of concrete ontology or model elements: location, grouping, colors, fonts, and similar information. Each view has its own presentation graph. A visual design model defines reusable presentation rules without describing concrete domain elements.
- A view model explicitly selects elements and relationships from one ontology or domain model. A selected relationship requires both endpoints in the view. One source graph can have multiple views, potentially using protocols such as C4 or 4+1. Ontologies can define the vocabulary for view protocols; these examples do not imply built-in support for either protocol. Each view has its own presentation graph so the same element can have different positions in different views.
- A project can reuse individual ontologies, domain models, and visual design models selected from local directories, Git repositories, and generic URLs. Adding a selected resource also includes its discoverable dependency closure and directly associated SHACL, visual design, and design selection metadata, but not unrelated models from the source project. Added dependencies are stored as fixed local snapshots, like package dependencies. A lockfile records content signatures so changes at the source can be detected as drift.
- Turtle is the MVP authoring format for ontologies, domain models, view models, presentation graphs, visual design models, and SHACL constraint graphs. Use an RDF framework with support for standard formats for parsing and serialization, rather than custom parsers or formatters. External dependencies can use other standard RDF formats supported by that framework. Saved read-only SPARQL queries are versioned project files.
- The CLI and local web interface operate on the same project files. Changes made in either interface are visible in the other.
- Validation covers RDF syntax, use of available vocabulary, and declared constraints.
- Fixed filename suffixes associate supporting graphs with a source graph: `orders.ttl`, `orders.shacl.ttl`, `orders.context.view.ttl`, and `orders.context.presentation.ttl` illustrate the convention. A generic external URL needs an explicit support-graph association when added.
- Specialized editors in the MVP cover core ontology concepts, conceptual data models, descriptive process models, and descriptive state machine models. Additional forms and visual representations can be added after the MVP.

## Graph identity and classification

Each project-owned RDF file represents one graph. Managed ontologies and models declare a stable resource IRI inside that graph; SPARQL exposes the file under that IRI as a named graph. A graph is an ontology when its own IRI is declared `rdf:type owl:Ontology`, following the [OWL 2 RDF form](https://www.w3.org/TR/owl-syntax/#Ontology_IRI_and_Version_IRI). An ontology can contain classes and properties, but a data model does not become an ontology merely by declaring them. A support or unclassified graph without its own declaration still receives a project-local named-graph IRI for querying.

The tool supplies a small RDF metadata vocabulary with `tbspec:Model` and subclasses for data, process, and state-machine models. Within data, `tbspec:ConceptualDataModel` identifies a graph of classes and properties; `tbspec:ConcreteDataModel` identifies a graph of individuals and values. Both are data models. The graph's self-declaration determines its kind for project-owned resources; `tbspec.toml` selects the ontology and design associated with its configured model type. A graph declared both as `owl:Ontology` and a model kind produces a classification error. A parseable graph without a recognized declaration remains openable and editable in the generic editor and visible through `graph list`.

A managed ontology or model graph has one root IRI that carries its classification; multiple distinct candidate roots in one file are reported as ambiguous. A concrete data model may contain many individuals, but only its graph root carries the model declaration. Ordinary `rdf:type` statements on those individuals do not change the graph's classification.

A project-owned model root also records its configured model-type name through the tool metadata vocabulary. `model create --type <name>` writes this association. Validation resolves that name through `tbspec.toml` and reports an unknown type or a classification mismatch; a disabled but retained type remains valid. Locked external models keep the ontology associations recorded from their source and are not silently rebound to a same-named type in the consuming project.

A concrete data model may explicitly reference one or more conceptual data models as schema sources. Their declared classes and properties then join its available vocabulary. These references are stored as RDF metadata in the concrete model, survive dependency snapshots, and appear in `model show`. The concrete model's own selected ontology remains available as well.

For example, the roots of three separate Turtle files may declare `<https://example.org/orders/vocabulary> a owl:Ontology`, `<https://example.org/orders/schema> a tbspec:ConceptualDataModel`, and `<https://example.org/orders/sample> a tbspec:ConcreteDataModel`. The `tbspec:` prefix here names the tool's versioned metadata vocabulary; its final namespace IRI is an implementation prerequisite.

External RDF resources may lack a self-declaration. `dependency add --kind` records an explicit kind for such read-only resources without rewriting their snapshots; `dependency show` identifies that classification as an override. An explicit kind that contradicts a declaration already present in a dependency is an error. Creating a project-owned ontology or model writes the appropriate declaration into its RDF graph.

## Project configuration format

The root `tbspec.toml` holds model-type enablement, selected ontology and visual design associations, and explicit visual conflict choices. It is distinct from the locked dependency snapshots and from RDF domain content. Use [TOML](https://toml.io/en/v1.0.0) for this human-edited project configuration. Its comments and simple scalar types suit these settings; RDF content stays in RDF files.

CLI and web configuration edits must preserve unrelated keys and user comments. Formatting may be normalized only for the setting being changed.

## Resource selectors

CLI commands identify project-owned RDF resources by paths relative to the project root, such as `models/orders.ttl` in `tbspec model show models/orders.ttl`. Locked external resources use project-unique dependency IDs, such as `p-plan` in `tbspec dependency show p-plan`. File paths identify files for CLI operations; RDF IRIs remain the semantic identities of ontology and model concepts. Moving a file changes its CLI path without implicitly renaming its RDF IRIs. Resource listings and JSON output expose the relevant path or dependency ID so agents can pass it to subsequent commands.

`dependency add` requires an explicit `--id`, unique within the project and safe as a single path segment. `tbspec init` may set a `base_iri` in `tbspec.toml`. Creation of a new ontology or domain model uses an explicit `--iri` or derives one from `base_iri` and the chosen resource name. Without either, creation fails with an actionable message. Imported editable ontologies always receive a new ontology IRI; existing term IRIs remain unchanged until explicitly edited or refactored.

## CLI command inventory

`tbspec` is the executable name. Agents edit RDF statements directly in files; commands perform lifecycle, association, resolution, and validation operations. All commands are non-interactive except for the attached foreground `web` console, which supports lifecycle controls such as detaching. All commands have stable exit codes and accept `--json` for machine-readable output. `tbspec --help`, `tbspec --version`, and `--help` on every command expose usage and examples. Shared arguments and output rules appear below.

| Command | Operation |
| --- | --- |
| `tbspec init` | Create a project and its root `tbspec.toml` in a local directory; initializing Git is separate. |
| `tbspec status` | Summarize the current project's resources and locked dependencies. |
| `tbspec graph list` | List every project-owned RDF graph, including graphs without a recognized kind, with path, graph IRI, and classification. |
| `tbspec graph show` | Inspect any project-owned RDF graph's identity, kind, terms, and associated files. |
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
| `tbspec ontology create` | Create an ontology file whose graph IRI is declared `owl:Ontology`. |
| `tbspec ontology import` | Copy an ontology from a local file or external source as a project-owned ontology with a new identity and recorded provenance. |
| `tbspec ontology remove` | Remove a project-owned ontology after explicit confirmation, even if this leaves unresolved references. |
| `tbspec model list` | List project-owned domain models and their kinds. |
| `tbspec model show` | Show a domain model's identity, file, kind, and associated support graphs. |
| `tbspec model create` | Create a self-declared model of a type enabled in project configuration, using its selected ontology. |
| `tbspec model import` | Copy an external model to a project-owned path with new model identity and provenance; report missing vocabulary dependencies. |
| `tbspec model schema list` | List the conceptual data models whose declarations a concrete data model uses. |
| `tbspec model schema add` | Associate one project-owned or locked conceptual data model with a concrete data model. |
| `tbspec model schema remove` | Remove one such association after reporting classes and properties it provided. |
| `tbspec model remove` | Remove a project-owned model after explicit confirmation, even if this leaves unresolved references. |
| `tbspec view list` | List views of a project-owned or locked source ontology or model. |
| `tbspec view show` | Show a view's source, selected members, and presentation graph. |
| `tbspec view create` | Create and associate a view model and its presentation graph. |
| `tbspec view remove` | Remove a view and its paired presentation graph after explicit confirmation. |
| `tbspec design list` | List local and available external visual design models. |
| `tbspec design show` | Show a design model and the concept types it covers. |
| `tbspec design create` | Create a reusable visual design model. |
| `tbspec design import` | Copy an external visual design to a project-owned path with provenance, without silently selecting it as the winner. |
| `tbspec design remove` | Remove a project-owned design after explicit confirmation, even if this leaves unresolved references. |
| `tbspec design select` | Choose one whole visual design for a concept type when definitions conflict. |
| `tbspec design clear` | Remove an explicit design choice for a concept type. |
| `tbspec shapes list` | List SHACL support graphs associated with project resources. |
| `tbspec shapes create` | Create a SHACL graph associated by filename with an ontology or model. |
| `tbspec shapes remove` | Remove a project-owned SHACL support graph after explicit confirmation. |
| `tbspec dependency list` | List locked external resources and their sources. |
| `tbspec dependency show` | Show one dependency's source, selected resource, snapshot, and signature. |
| `tbspec dependency inspect` | List selectable resources and support graphs when the source exposes a discoverable inventory. |
| `tbspec dependency add` | Snapshot one selected ontology, domain model, or visual design model from a directory, Git repository, or URL, including discoverable dependency closure, directly associated support graphs, and design choices. |
| `tbspec dependency check` | Detect source drift without changing locked snapshots. |
| `tbspec dependency update` | Preview a newer source snapshot and its validation impact by default; apply an explicit update atomically, accepting any reported project impact explicitly. |
| `tbspec dependency rename` | Preview or apply a dependency ID change in the lockfile and project-owned references without changing snapshot content. |
| `tbspec dependency select` | Resolve competing versions of the same ontology IRI by explicitly choosing one locked dependency. |
| `tbspec dependency clear` | Remove an explicit ontology-version choice and return to precedence-based resolution. |
| `tbspec dependency support set` | Associate a SHACL or visual design resource with a dependency whose source does not expose that association; snapshot and lock the support resource. |
| `tbspec dependency support clear` | Remove an explicit support-graph association without silently deleting other resources. |
| `tbspec dependency remove` | Remove a locked dependency after explicit confirmation, even if this leaves unresolved references. |
| `tbspec impact <kind> <id>` | Preview direct and downstream references and affected files before removing a resource, with no changes. |
| `tbspec resource move <from> <to> [--apply]` | Preview or move a project-owned graph, its convention-linked support graphs, and recorded paths; preserve RDF IRIs and refuse destination collisions. |
| `tbspec refactor iri <old> <new> [--apply]` | Preview an IRI rename by default; with `--apply`, update project-owned RDF graphs and project configuration. Report references in locked dependencies without modifying them. |
| `tbspec references list` | Show references to a selected IRI or resource, including dangling references. |
| `tbspec references redirect <old> <new> [--file <path> ... / --all] [--apply]` | Preview or apply redirection in selected files or all occurrences of a dangling IRI in project-owned graphs and configuration. |
| `tbspec references remove <target> [--file <path> ... / --all] [--apply]` | Preview or apply deletion of statements and associations containing a dangling IRI in selected files or all occurrences. |
| `tbspec gc [--resource <path> ... / --all] [--apply --confirm]` | Preview orphaned project-owned support resources of deleted ontologies, models, or locked sources; remove explicitly selected candidates or all only with application and confirmation. |
| `tbspec query list` | List saved project SPARQL queries. |
| `tbspec query show` | Show a saved query and its declared parameters. |
| `tbspec query save` | Save a named query and its parameter declarations as versioned project files. |
| `tbspec query run` | Run an ad hoc or saved read-only SPARQL query against a selected graph or the resolved project dataset, with optional typed parameter bindings. |
| `tbspec query remove` | Remove a saved project query after explicit confirmation. |
| `tbspec validate` | Validate the whole project or a selected resource using locked dependencies. |
| `tbspec web` | Start or reconnect to the project's local web server; attach a foreground control/log console by default or return with `--background`. |
| `tbspec web status` | Report the web server's state and URL without starting it or attaching a console. |
| `tbspec web stop` | Request graceful shutdown of the project's web server without attaching a console. |
| `tbspec llms [topic ...]` | Print the essential agent prompt or recursively indexed, focused guidance. |

There are no CLI commands for Git history or individual RDF statements. Agents edit view membership, visual rules, saved query files, and other graph details in files, then validate.

### CLI conventions

- `--project <dir>` selects a project instead of upward discovery. Project-owned target paths and file selectors are relative to that project's root; dependency source locators may point outside it. A graph selector is a project-relative path, `dep:<id>` for a dependency's primary graph, or `dep:<id>/<file-key>` for a retained closure/support graph, with the exact file key reported by `dependency show`. Dependency administration commands take the bare ID. Project writes cannot escape the root through `..` or symlinks. See the [version-1 file and output contract](../mvp-technical-architecture/contracts/file-and-output-schemas.md) for selector grammar and compatibility.
- `--json` emits one JSON object with `schemaVersion`, `status`, `data`, and `diagnostics`. Diagnostics have stable `code`, `severity`, `message`, `file`, and, where known, line/column and source SHACL graph. Human-readable diagnostics go to stderr. Exit codes: `0` successful operation, clean validation, or preview; `1` validation violations, invalid project status, or detected dependency drift; `2` invalid arguments; `3` conflict or explicit acceptance required; `4` unavailable source or I/O failure. Warnings alone do not set exit code `1`. JSON is still emitted for nonzero exits.
- Creation commands receive a project-relative destination path and, for a new ontology or model, an explicit `--iri` unless `base_iri` is configured. They fail on an existing destination. `init` accepts an optional directory and `--base-iri`. List output provides the exact selectors accepted by subsequent commands.
- `dependency add <source> --id <id> --kind ontology|model|design` accepts an HTTP(S) resource URL directly. A directory or Git source containing multiple resources also needs `--resource <source-relative-path>`; Git accepts `--ref <revision>` and records the resolved commit. `dependency inspect <source>` lists resources only when a source exposes an inventory. `dependency check [<id>]` reports `unchanged`, `changed`, or `unavailable` without modifying snapshots.
- `dependency update <id>` previews source and downstream validation changes. `--apply` replaces the snapshot and lock record; newly introduced/worsened errors or unassessable affected required checks also require `--accept-impact`. Use the [normative diagnostic identity and impact comparison](../mvp-technical-architecture/contracts/file-and-output-schemas.md#diagnostic-identity-and-impact-comparison): match semantic conditions, compare severity and multiplicity, and disclose blocked coverage. Unchanged unrelated baseline errors do not require acceptance; resolved errors cannot offset new ones. An unavailable or unparsable replacement leaves the current snapshot intact. `dependency rename <old> <new>` previews its changes and uses `--apply` to update the lockfile, snapshot directory, owned views, and project references without changing RDF IRIs.
- `--accepted-preview <sha256-digest>` binds an applying command to a concrete preview fingerprint in addition to its existing application/acceptance flags. For CLI application of acquired external bytes (`dependency add`, `update`, and `support set`), a missing binding returns a preview with exit `3`; a later invocation reacquires and regenerates, rejects changed fingerprints without writes, and requires renewed review. Other local operations may plan/apply in one invocation but must check a supplied binding. This concretizes the previously required changed-preview rejection; add/support set gain no `--accept-impact` flag. Exact fingerprints and revision fields are defined in the [schema contract](../mvp-technical-architecture/contracts/file-and-output-schemas.md#revisions-and-accepted-previews).
- `resource move <from> <to>` previews by default and uses `--apply` to move the source and filename-associated support graphs together. It updates project-owned path references, reports any generated named-graph IRI that will change with the path, and refuses collisions. `refactor iri` also previews by default; `--apply` refuses a new IRI already declared by a different project-owned resource. Neither operation edits a locked snapshot.
- Commands that delete a resource, plus `model schema remove`, preview affected files and references without `--confirm`; `--confirm` performs the removal even if known references remain. `clear` commands remove a choice or association without deleting its resource. Bulk reference repair uses explicit scope and `--apply` instead; garbage collection requires both `--apply` and `--confirm`. Multi-file operations preserve the prior files and lock record on normal failures.
- `query run --file <path>` reads an ad hoc SPARQL file, while `query run --saved <name>` uses a saved query. `--graph <selector>` limits the dataset to one graph. `--bindings <path.json>` supplies a JSON object mapping variable names to typed RDF terms (`iri` or `literal`, with optional datatype or language); raw text substitution is not supported. `query save <name> --file <path>` stores a `.rq` file and a sibling `.query.toml` parameter declaration under `queries/`. Query execution rejects SPARQL Update, `SERVICE`, `FROM`, and `FROM NAMED` so it cannot fetch other datasets.

- One web server serves one fixed project. `web` reuses an existing verified server and attaches a log/control console by default; `--background` reports readiness and an opening URL without attaching. An attached console can detach without stopping the server; Ctrl+C requests shutdown. Unexpected terminal disconnection or browser-tab closure leaves it running. `web status` reports its state and URL without starting or attaching; `web stop` requests graceful shutdown. `web --json` emits one readiness envelope and returns without attaching. This approved lifecycle extension and its authentication, preview, packaging, and compatibility contract are recorded in [Choose the shared CLI and loopback web architecture](../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).

### Command signatures

`<...>` denotes a required value, `[...]` an optional value, and `...` a repeatable value. `--project` and `--json` are global options accepted by every command; `--accepted-preview` is additionally accepted by commands that prepare/apply impact plans. A project resource selector is a relative path; a graph selector may also be `dep:<id>` or `dep:<id>/<file-key>`.

```text
tbspec init [<directory>] [--base-iri <iri>]
tbspec status
tbspec graph list
tbspec graph show <path>
tbspec config show
tbspec config model-type list
tbspec config model-type set <name> --ontology <graph-selector> [--accept-impact]
tbspec config model-type disable <name>
tbspec config model-type enable <name>
tbspec config model-type reset <name> [--accept-impact]
tbspec config model-type remove <name> [--confirm]
tbspec config model-type design set <name> <graph-selector>
tbspec config model-type design clear <name>
tbspec ontology list
tbspec ontology show <path>
tbspec ontology create <path> [--iri <iri>]
tbspec ontology import <source-selector> <path> [--iri <new-iri>]
tbspec ontology remove <path> [--confirm]
tbspec model list
tbspec model show <path>
tbspec model create <path> --type <name> [--profile conceptual|concrete] [--schema <graph-selector> ...] [--iri <iri>]
tbspec model import <source-selector> <path> --type <name> [--iri <new-iri>]
tbspec model schema list <concrete-model-path>
tbspec model schema add <concrete-model-path> <conceptual-model-selector>
tbspec model schema remove <concrete-model-path> <conceptual-model-selector> [--confirm]
tbspec model remove <path> [--confirm]
tbspec view list <source-graph-selector>
tbspec view show <view-path>
tbspec view create <source-graph-selector> <view-name> [--protocol <graph-selector>]
tbspec view remove <view-path> [--confirm]
tbspec design list
tbspec design show <graph-selector>
tbspec design create <path> [--iri <iri>]
tbspec design import <source-selector> <path> [--iri <new-iri>]
tbspec design remove <path> [--confirm]
tbspec design select <concept-iri> <graph-selector>
tbspec design clear <concept-iri>
tbspec shapes list [--source <path>]
tbspec shapes create <source-path>
tbspec shapes remove <shapes-path> [--confirm]
tbspec dependency list
tbspec dependency show <id>
tbspec dependency inspect <source> [--ref <git-ref>]
tbspec dependency add <source> --id <id> --kind ontology|model|design [--resource <source-path>] [--ref <git-ref>]
tbspec dependency check [<id>]
tbspec dependency update <id> [--apply] [--accept-impact]
tbspec dependency rename <old-id> <new-id> [--apply]
tbspec dependency select <ontology-iri> <id>
tbspec dependency clear <ontology-iri>
tbspec dependency support set <id> --role shacl|design --source <source> [--resource <source-path>]
tbspec dependency support clear <id> --role shacl|design --resource <support-selector>
tbspec dependency remove <id> [--confirm]
tbspec impact <kind> <selector>
tbspec resource move <from-path> <to-path> [--apply]
tbspec refactor iri <old-iri> <new-iri> [--apply]
tbspec references list [--target <iri> | --dangling]
tbspec references redirect <old-iri> <new-iri> (--file <path> ... | --all) [--apply]
tbspec references remove <target-iri> (--file <path> ... | --all) [--apply]
tbspec gc [--resource <path> ... | --all] [--apply --confirm]
tbspec query list
tbspec query show <name>
tbspec query save <name> --file <path> [--parameters <path.toml>]
tbspec query run (--file <path.rq> | --saved <name>) [--graph <graph-selector>] [--bindings <path.json>]
tbspec query remove <name> [--confirm]
tbspec validate [<graph-selector>]
tbspec web [--port <port>] [--background]
tbspec web status
tbspec web stop
tbspec llms [<topic> ...]
```

`--profile` applies only to the default `data` model type; it defaults to `conceptual`. The `concrete` profile writes the concrete-data declaration and is editable in the generic web editor. Repeatable `--schema` selects conceptual data models at creation; `model schema add/remove` changes those associations later. A source selector for an editable import is a local file or a locked `dep:<id>`; Git or URL content can first be added as a dependency. `--iri` is required when no project `base_iri` can derive a new IRI. `impact` accepts `model-type`, `ontology`, `model`, `view`, `design`, `shapes`, `dependency`, or `query` as its kind, using a path for project-owned graphs and an ID or name for the other kinds.

Editable imports assign a new graph-root IRI and record provenance, but preserve the source's class, property, and individual IRIs. The import reports collisions with existing project declarations; term changes require an explicit file edit or `refactor iri`.

A saved query's parameter file declares each variable's name, `iri` or `literal` kind, and whether it is required. For a literal it may also constrain datatype or language. A bindings JSON file supplies the same kind and a value for each bound variable; for example, `{"customer":{"kind":"iri","value":"https://example.org/customer/42"}}`. Missing required, unknown, or mismatched bindings are errors. The SPARQL engine receives parsed RDF terms, never interpolated query text.

### Agent guidance

`tbspec llms` prints the minimum instructions needed to operate the CLI and an index of next topics. Every index entry names the exact `tbspec llms ...` invocation, when to use it, and what it will explain. A topic may return its own indexed subtopics; a leaf explains the relevant commands, arguments, examples, and errors without dumping unrelated topics. For example, the root can point to `tbspec llms dependencies`, which can point to `tbspec llms dependencies check` and `tbspec llms dependencies update`. This is a hierarchical help system, not a way to retrieve project data; it tells agents which other CLI commands to run to inspect the project.

The root index has `project` (discovery and configuration), `modeling` (ontologies, models, and validation), `views` (presentation and designs), `dependencies` (sources, lockfile, check, update), `queries` (dataset and parameters), and `repair` (impact, removal, IRI refactoring, references, garbage collection). Each topic links to its command leaves and to live inspection commands such as `status`, `list`, `show`, `validate`, and `query run`. Unknown topics return a helpful error and the nearest valid index.

## Web operations

| Area | Available operations |
| --- | --- |
| Project | Open a local project; inspect contents, configuration, and validity; create, enable, disable, reset, or remove model types; change ontology and design associations with impact preview and confirmation. |
| Ontologies | List, create, import an editable copy, inspect, edit, move, and remove project-owned ontologies. Specialized forms cover classes, datatypes, properties, and individuals; the generic editor covers advanced OWL constructs. External snapshots open read-only. |
| Domain models | List, create, inspect, edit, move, and remove conceptual or concrete data, descriptive process, and descriptive state-machine models. Associate concrete data models with conceptual schema models. Specialized forms cover conceptual data and recognized process/state terms; concrete data and unfamiliar terms remain editable generically. |
| View and presentation graphs | Create, inspect, edit, move with their source, and remove multiple views per source graph. Selecting a relationship also selects its endpoints. Each saved view has its own presentation graph. |
| Visual design models | Create, inspect, edit, and remove reusable declarative rules for shape, label, color, typography, and relationship style; select or clear a complete winning design for a concept type. |
| Dependencies | Inspect source inventories where available; add, check, preview and apply updates, rename IDs, select a winner for an ontology conflict, and remove selected individual resources; inspect snapshots, signatures, drift, and impact. |
| Refactoring and repair | Preview and apply IRI renames and reference redirection or removal in project-owned files; inspect locked references without editing them. |
| Saved queries | List, inspect, save, run, and remove reusable read-only SPARQL queries with typed parameters; run ad hoc queries against one graph or the local project dataset. |
| Garbage collection | Preview orphaned project-owned support resources of deleted source graphs; remove explicitly selected candidates after confirmation. |
| Validation and exploration | Run full validation and navigate diagnostics; explore relationship graphs, concept hierarchies, and saved views. The generic canvas has a properties panel and direct RDF source access. |

## Shared behavior

- Operations that change project content persist to local files and can be versioned with the project.
- A domain model can use vocabulary from project-owned and external ontologies; a concrete data model can additionally use declarations from referenced conceptual data models.
- `model create` resolves the selected model type through effective project configuration. The configured ontology may be local or a locked external resource.
- New model types can be configured with their own ontologies. Disabling a model type prevents new models of that type but leaves existing models valid and editable against the retained ontology association.
- Replacing a model type's ontology when models of that type exist requires an advance warning. In the non-interactive CLI, the first attempt reports impact and makes no change; `--accept-impact` commits the change. The web interface asks for confirmation. The tool leaves model files unchanged and does not migrate their terms; validation reports any resulting incompatibilities.
- Replacing an ontology disconnects its old visual design association. Until a design is explicitly selected, the generic graph editor and generic fallback rendering remain available. The new design uses the replacement ontology's own concepts. A local copy can explicitly reuse the original design, extending it where needed. No semantic mapping to the tool-supplied ontology is required or implied.
- Importing an ontology as a project-owned copy makes it editable. Adding it as a dependency keeps it as a locked external snapshot; these are separate operations.
- An imported editable copy receives its own ontology identity and records the source it was derived from.
- Validation identifies the affected file, stable diagnostic code, severity, and reason; it includes location when known and supports JSON output.
- Before removing a model type, ontology, model, dependency, or visual resource, the CLI and web interface show its direct and downstream references and affected files within the known project, including ordinary IRI occurrences that do not imply required local targets. Removal requires explicit confirmation and may leave broken managed references or explicit constraint violations. When it does, the project remains invalid until those errors are resolved; `status` and `validate` expose them. Removal does not silently rewrite referring graphs.
- `tbspec impact <kind> <selector>` is read-only and can be used before deciding whether to remove a resource. CLI resource deletions and `model schema remove` require `--confirm`; bulk reference deletion requires explicit scope and `--apply`. The web interface presents the same impact before confirmation.
- `tbspec refactor iri` previews changes by default and applies them only with `--apply`. It updates references in project-owned RDF graphs and configuration as one operation; it reports references in locked dependencies but does not change their snapshots.
- A broken managed reference has a required target evidenced by current project files or locked metadata: configuration/model-type bindings and explicit ontology/schema/support/design/view/presentation associations must resolve in their declared context; class/property uses must resolve against available ontologies, referenced conceptual data models, and local declarations. View selections require elements/relationships in their selected source. Arbitrary individual IRIs used as data values do not require local targets, including an IRI whose local individual was deleted. Applicable SHACL constraints can independently reject such a value. No deleted-identity registry, namespace-based ownership inference, or network dereferencing is used. See the [managed-reference scope contract](../mvp-technical-architecture/contracts/file-and-output-schemas.md#managed-reference-scope).
- The CLI can inspect dangling managed references and preview either redirection to an available resource or deletion of selected references. `references list --dangling` reports only demonstrably broken managed references; `references list --target <iri>` and removal impact list all exact known occurrences, including ordinary values and locked references. It lists each occurrence before changing it, including subject, predicate, and object positions and project configuration associations. CLI repair can scope changes to one or more files or all occurrences; individual statements can be edited directly in files. Repair operations change only project-owned parseable graphs and project configuration. A syntactically invalid RDF file must be corrected in source before a graph operation can safely edit it.
- A confirmed garbage collection operation removes only orphaned project-owned support resources associated with deleted ontologies, models, or locked sources, such as views, presentation graphs, and SHACL graphs. It does not collect independent designs or other locked dependencies. Its default invocation previews candidates and affected files; application requires named candidates or explicit `--all`, plus `--apply --confirm`. Projects that track these files in Git can restore tracked deletions through Git; the tool does not implement its own revision history.
- Generic web editing can modify any supported project-owned RDF graph, regardless of its concept types; external snapshots open read-only until imported as editable copies. Specialized editors must preserve data they do not understand.
- A domain model using a class or property absent from its available ontologies, referenced conceptual data models, and its own declarations fails validation. A concrete data model also reports a broken schema association when its referenced conceptual model is missing or has the wrong classification. Presentation graphs use their own validation rules.
- A concept with no custom visual definition remains editable through the generic graph editor.
- If a selected design does not cover a concept, render it generically and show a visual-editor warning. Missing appearance rules do not invalidate RDF or the model.
- Validation of a model applies its own SHACL graphs and every SHACL graph associated with each available ontology it uses. A concrete data model also applies SHACL graphs associated with its referenced conceptual data models. Each diagnostic identifies the SHACL graph that produced it.
- When adding an ontology dependency, include its declared dependency closure and only the support graphs directly associated with the selected resources: discoverable SHACL, visual design, and design-choice metadata. Support graphs of a standalone resource URL can be associated explicitly when the source provides no discoverable inventory.
- A support graph manually associated with a standalone dependency is snapshotted and recorded in the lockfile. Clearing its association does not silently remove the underlying resource.
- SPARQL `SELECT`, `ASK`, `CONSTRUCT`, and `DESCRIBE` queries are read-only; SPARQL Update and remote `SERVICE` are not accepted by `query run`. Saved queries are versioned project files with declared named RDF-term parameters such as IRIs and literals. Bindings are passed by name to SPARQL variables, rather than interpolating raw strings into query text.
- Every graph in the effective project registry is exposed to SPARQL as a named graph. Resolve ontology candidates before assembling that registry: load the winning ontology and its effective support/associations, while retaining losing snapshots for isolated selection under their original graph IRIs. The default project dataset is the union of effective ontologies and domain models, including their resolved locked dependencies. SHACL, view, presentation, and visual design graphs in the registry remain available by graph name; a query can also target one selected graph, including a retained losing file. Query execution uses local project files and locked snapshots without fetching remote data. A query over the project dataset fails for unresolved ontology choices, genuine duplicate graph IRIs after resolution, or a malformed RDF file required for resolution or the loaded dataset; a query targeting another parseable graph can still run. This registration amendment was explicitly approved in [Choose dependency snapshot and resolution mechanics](../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- When designs compete for a concept type, use this precedence: (1) an explicit choice in the consuming project, (2) a project-owned design, (3) a design associated with the selected ontology, including an inherited source choice, and (4) other inherited designs, with nearer dependencies ahead of more distant ones. If multiple candidates remain at the same level and distance, report an error. Both the web interface and CLI can record an explicit winner.
- When dependency closure contains different content for the same ontology IRI, use an explicit consuming-project choice first, then a project-owned ontology, then a direct dependency, then the nearest transitive dependency. Identical signatures are one effective candidate. A same-level tie is an error until `dependency select` or the web interface chooses a winner. The losing snapshot remains locked for its original dependent resource but is not merged into the effective ontology graph.
- The web source editor can save invalid RDF with visible diagnostics; graph-based editing requires parsable RDF.
- The generic web editor shows the complete graph without requiring a saved view model. Saving a selected subset and its layout creates a view model and presentation graph.
- In a web view editor, selecting a relationship automatically selects both endpoints and makes that addition visible. `validate` reports a view whose file lists a relationship without both endpoints; it does not silently modify the file.
- Source editing reports syntax problems as the user works. Full vocabulary and SHACL validation runs on request from the web interface or CLI.
- `dependency inspect` only enumerates resources when the source exposes a discoverable inventory; a direct resource URL can still be added without an inventory.
- Visual conflict resolution selects one complete design for a concept type, rather than merging individual properties from competing designs.
- A consuming project can use inherited design selections and precedence without configuring every conflict again. An explicit local choice takes precedence over all inherited choices.
- View protocols can be supplied by project ontologies. C4 and 4+1 are examples only; neither is required as a built-in MVP protocol.
- The initial specialized web editors cover ontologies, conceptual data models, process models, and state machine models. Their starter vocabularies appear below; exact extension term IRIs remain an implementation prerequisite.
- Specialized forms recognize known RDF terms rather than following the selected visual design. They remain usable for unchanged terms in a local ontology copy; unfamiliar terms use generic editing.
- Process editing covers activities, decisions, inputs, outputs, responsible parties, and flows as descriptions; it does not run processes.
- State machine editing covers initial and final states and transitions with events, conditions, and actions, without hierarchical or parallel states or runtime execution.
- Data editing covers conceptual entities, attributes, and relationships, without physical database schema design.
- A concrete data model contains RDF individuals and their values. Its graph declaration distinguishes it from a conceptual data model; the generic editor can inspect and edit it in the MVP.

## Visual extensibility

The MVP includes a fallback representation for any RDF graph and declarative appearance rules keyed by the concepts of the ontology actually selected by the project. These rules configure generic node and edge renderers and can be reused through dependencies. A replacement ontology does not need to resemble the tool-supplied ontology. Executable visual plugins are outside the MVP. React Flow supports custom nodes and edges through registered React components; using configurable generic components for these rules is an inference about how it could be used, not a choice of UI framework. See its [custom node](https://reactflow.dev/learn/customization/custom-nodes) and [custom edge](https://reactflow.dev/learn/customization/custom-edges) documentation.

## Starter vocabulary choices

These choices use standards where they fit the agreed editor fields; the standard vocabularies do not cover every field. The tool-supplied ontology and its SHACL and visual design files are versioned ordinary RDF resources, so a project can replace or copy them.

| Model type | Vocabulary and specialized forms | Reason and limit |
| --- | --- | --- |
| `data` | [OWL 2](https://www.w3.org/TR/owl2-quick-reference/) and [RDF Schema](https://www.w3.org/TR/rdf-schema/) for conceptual classes, datatype properties, object properties, labels, domains, and ranges; RDF individuals and values for concrete data models. | The graph's own `owl:Ontology` or `tbspec:ConceptualDataModel` / `tbspec:ConcreteDataModel` declaration distinguishes its role even when a conceptual model declares classes and properties. A term declared in that conceptual model is available for its own validation. The MVP form specializes conceptual models; concrete data models remain fully editable in the generic editor. |
| `process` | [P-Plan](https://www.opmw.org/model/p-plan/) for Plan, Step, Variable, and input/output associations; a small tool-supplied extension for Decision, immediate Flow with source/target and optional condition, and planned responsible party. | P-Plan covers planned work but its `isPreceededBy` is transitive and does not directly describe an immediate branch. [PROV-O](https://www.w3.org/TR/prov-o/) models executed activities and their agents; using its activity association for planned responsibility would change the meaning. The extension must be published as RDF, not hidden in editor code. |
| `state-machine` | A small tool-supplied RDF ontology for StateMachine, State, InitialState, FinalState, and Transition with source, target, event, condition, and descriptive action. | [SCXML](https://www.w3.org/TR/scxml/) is XML and specifies execution; [UML through MOF2RDF](https://www.omg.org/spec/MOF2RDF/) brings a much larger metamodel. Neither is a small RDF-native fit for this non-executable editor. Projects can replace the starter ontology. |

The process and state-machine extension terms and their SHACL shapes must be published with stable IRIs before implementation. The specialized forms recognize these exact terms; other vocabularies remain editable through the generic graph editor. No automatic semantic mapping is implied.

## File and state contract

- `tbspec.toml` is the human-edited manifest; `tbspec.lock` is a versioned, tool-written TOML lockfile. Each lock entry records the dependency ID, source locator and selected resource, kind, resolved Git commit when applicable, snapshot path, and SHA-256 of every snapshotted file. Snapshots are kept under `.tbspec/dependencies/<id>/` and may be committed to Git. Secrets and URL credentials are not written to the lockfile.
- The [version-1 schema contract](../mvp-technical-architecture/contracts/file-and-output-schemas.md) defines exact manifest/lock/query fields, JSON envelopes and diagnostic codes, typed RDF bindings/results, parser contexts and signatures, runtime wire records, and preview acceptance. Runtime credentials, server registration, operation locks, transaction staging, and uncommitted preview workspaces are ephemeral and excluded from project versioning/dependency inventories; dependency snapshots remain versionable.
- `init` records the bundled starter ontology and visual design versions in the lockfile and copies their snapshots into the project. A later tool upgrade never silently changes those defaults. Resetting a model type restores the version already locked by that project; updating starter resources is an explicit dependency update.
- An HTTP(S) URL identifies one RDF graph. Directory and Git sources identify one selected graph by source-relative path. The MVP accepts single-graph serializations supported by the chosen RDF framework; dataset files with multiple named graphs need a later explicit selection model. Discovery of associated support graphs follows the source project's manifest and naming conventions, and never pulls in unrelated resources.
- A selected resource from a tbspec project brings only its declared dependency closure needed for interpretation, including selected ontologies and their associated support. A standalone URL with no discoverable manifest is not recursively crawled; unresolved ontology references are reported, and the user can add or associate those resources explicitly.
- A project-owned source graph `<stem>.ttl` may have `<stem>.shacl.ttl` beside it. A view named `<view>` uses `<stem>.<view>.view.ttl` and `<stem>.<view>.presentation.ttl` beside a project-owned source. Views of a locked source live under `views/<dependency-id>/<view>.view.ttl` and `views/<dependency-id>/<view>.presentation.ttl`; they are still project-owned. Standalone designs live in `designs/`; saved queries use `queries/<name>.rq` plus `queries/<name>.query.toml` for parameter declarations. The manifest records associations that cannot be inferred from these names.
- The SPARQL named-graph IRI is the declared graph root IRI when there is one. Support and unclassified graphs without a root receive deterministic project-local graph IRIs derived from their resource selectors. `graph list`, `graph show`, and `dependency show` report the actual graph IRI accepted by SPARQL `GRAPH` clauses.
- A view selects IRIs from one source graph and relationships between selected IRI resources. Literal-valued properties appear in the properties panel; blank nodes remain visible in the generic graph editor. Saved view membership of blank nodes is deferred because their identifiers are not stable across source rewrites. A view's presentation graph may hold positions and local appearance overrides; reusable design models hold rules, not positions of concrete elements.
- A visual rule targets an exact class or property IRI and describes a generic node or edge appearance: shape, label choice, colors, typography, and line style. The generic renderer covers uncovered terms. Explicit local winning choices live in `tbspec.toml`; discoverable choices from a source project are retained with its selected dependency snapshot and recorded in `tbspec.lock`. Resolution uses the already agreed precedence. No executable project-supplied React component or code is loaded.
- `validate` checks every parseable graph for relevant syntax, vocabulary, association, view, and SHACL errors while reporting unparseable files separately. An unparseable source cannot be edited through graph operations or queried as part of a dataset requiring it. `status` reports the project's valid or invalid state and diagnostic counts. A missing visual rule is a canvas warning, not a validation failure.
- The local web server binds to loopback only. It only writes project-owned files under the selected root, requires authorization for project reads, mutations, and server controls, validates request host/origin at the HTTP boundary, and rejects a save when the underlying file changed since the editor loaded it. An opening link provides one-use browser authentication bootstrap; long-lived tokens do not appear in URLs or project files. Dependency acquisition is an explicit user action; validation and canvas rendering do not fetch remote content. Web impact confirmation applies the exact staged bytes and expected revisions shown in its preview; console detachment preserves previews, while cancellation, restart, or relevant file changes require a new preview. See the [shared CLI/web contract](../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- Project and lockfile changes made by one CLI operation are staged and committed together on normal success; on a recoverable error, the prior project state remains available. A crash can require Git or manual recovery. Removing a resource remains an intentionally permitted way to make the project invalid.

## Inference boundary

The MVP's core editor and validation rules do not depend on implicit entailment. Before implementation, evaluate the selected RDF framework for straightforward RDFS subclass and subproperty closure. If available without custom reasoning code, use that closure for hierarchy display and term recognition; report which inferred relationships were used. Do not promise full RDFS or OWL reasoning, inferred persistence to source files, or inference-dependent SHACL behavior in the MVP.

## Acceptance scenarios

1. **Project and data model:** `tbspec init` creates `tbspec.toml`; `status` discovers it from a subdirectory. A project with `base_iri` can create a conceptual data model without repeating its IRI. The web editor shows its OWL/RDFS classes and properties in specialized forms and also opens the complete RDF graph generically. A concrete data model can reference that conceptual model, use its declared classes for individuals, and open in the generic editor; validation reports a missing schema association.
2. **External ontology:** Adding one selected ontology from a Git repository, directory, or HTTP(S) URL records an ID, source, snapshot, and signature. Discoverable associated support graphs are included; a bare URL can have support graphs associated explicitly. `validate` works offline, `dependency check` reports drift or unavailability without changing the snapshot, and `dependency update` previews effects before application.
3. **Vocabulary replacement:** Replacing the configured process ontology while process models exist first reports affected models. After explicit acceptance, their files remain unchanged, the old visual design is disconnected, generic editing still works, and validation reports any unknown terms. Explicitly selecting the old design for a compatible local copy is possible.
4. **Views and visual conflicts:** One model has two views with different selected IRI resources and distinct positions. Choosing a relationship in the web editor adds its endpoints. Two equally ranked designs for one concept produce a conflict until `design select` or the corresponding web action records a winner; an uncovered concept renders generically.
5. **Ontology-version conflict:** Two transitive dependencies supply different snapshots with the same ontology IRI. The nearer one becomes effective. If both are equally near, validation reports a conflict until `dependency select` chooses one; the other snapshot is retained without merging its triples.
6. **Removal and repair:** Removing a referenced model shows impact and requires confirmation. A retained schema/view/support association to the removed resource makes the project invalid. Removing a local individual instead leaves an ordinary cross-graph individual-valued link permitted unless an explicit association or constraint requires its target. `references list --target <iri>` still identifies exact subject, predicate, and object occurrences; `--dangling` includes only broken managed references. `references redirect` or `references remove` previews scoped changes. `gc` separately previews orphaned support files and requires explicit candidates, application, and confirmation.
7. **Malformed RDF and queries:** A syntactically invalid project-owned graph can be saved in the web source editor with a diagnostic. Graph editing of that file and a query requiring the whole project dataset fail with its path; a query selecting another parseable graph succeeds. `validate --json` reports file, code, severity, and available location or SHACL source.

## Decisions recorded

- Classify an ontology by its graph IRI's `owl:Ontology` declaration; classify conceptual and concrete data models through their own RDF graph declarations. Concrete data models contain individuals and values.
- Use `tbspec.toml` as the project root marker and human-edited configuration file; CLI and web edits preserve unrelated keys and comments.
- Address project-owned RDF resources by project-relative path and locked external resources by project-unique dependency ID; keep RDF IRIs separate from these CLI selectors.
- Require explicit dependency IDs; preview resource moves and dependency updates; accept affected updates explicitly; allow an optional project base IRI or an explicit IRI when creating resources.
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
- Use OWL/RDFS for the default data vocabulary, P-Plan with a small extension for process, and a small RDF vocabulary for descriptive state machines; publish exact extension terms before implementation.
- Provide `dependency check` to detect source drift; `validate` uses locked snapshots without network access.
- Apply each model's SHACL constraints, those of every ontology it uses, and, for concrete data models, those of referenced conceptual schema models; name the source shapes graph in diagnostics.
- Allow saving invalid RDF source with diagnostics; graph-based editing needs parsable RDF.
- Associate support graphs with original graphs through file naming conventions.
- Include specialized web editors for ontologies, conceptual data models, process models, and state machine models; concrete data models use the generic editor in the MVP.
- Define visual shape, label, color, typography, and relationship style per concept type; position remains view-specific presentation data.
- Resolve visual conflicts by choosing one complete design per concept type.
- Let projects supply view protocols through ontologies; do not require C4 or 4+1 as built-in MVP protocols.
- Add individual external resources, even when a source directory or repository contains several.
- Make CLI project operations non-interactive with stable exit codes and optional JSON output; add `tbspec llms` with selective agent guidance. The web lifecycle may attach a foreground log/control console, with explicit background/status/stop alternatives and single-envelope JSON startup output.
- Provide specialized ontology forms for classes, datatypes, properties, and individuals; use the generic editor for advanced OWL constructs.
- Keep specialized data forms conceptual while allowing concrete data models in the generic editor; keep process models descriptive and state-machine models non-executable and non-hierarchical in the MVP.
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
- Discover a project by searching upward for its configuration marker or by explicit `--project`, without requiring Git initialization.
- Let a graph-specific query run when another project file is malformed; fail a project-wide query requiring the malformed file and identify it.
- Treat only missing managed resources and unavailable vocabulary terms as broken references, while allowing external individual IRIs as data values.
- Allow read-only inspection and repair operations while the project has broken references. Surface RDF parse errors and require source correction before graph operations that would edit an unparseable file.
- Allow explicit association of SHACL and visual design resources with dependencies lacking a discoverable inventory; snapshot and lock the associated resources.
- Provide confirmed garbage collection for orphaned project-owned support resources associated with deleted source graphs, with preview as the default action; leave independent designs and locked dependencies to explicit removal commands.
- Apply garbage collection only to named candidates or with explicit `--all`, followed by `--apply --confirm`.
- Preview each selected occurrence of a dangling IRI across subject, predicate, and object positions before bulk redirection or removal.
- Scope CLI reference repair to selected files or all occurrences; agents can edit individual statements directly.
- Disconnect the old visual design when a model type's ontology changes; allow generic graph editing until a new design is explicitly selected, including when reusing a supplied design for a local ontology copy.
- Give imported editable ontologies new identities and record provenance.
- Warn before changing a model type used by existing models; require `--accept-impact` in the CLI and confirmation in the web interface; do not migrate their files.
- Allow projects to create model types and override, disable, and reset default types. Disabling prevents new model creation while retaining existing models as valid and editable.
- Include basic relation inference in the MVP only if the selected RDF framework exposes it as a straightforward, reliable capability; do not imply full OWL reasoning.
- Keep `llms` documentation-only and direct agents to `status`, `list`, `show`, and other commands for live project context.

## Technical prerequisites for implementation

- Publish the tool's RDF metadata vocabulary, starter process and state-machine terms, their exact IRIs, and their SHACL shapes as versioned resources. Include graph self-declaration classes for conceptual and concrete data models.
- Choose an RDF framework that parses the agreed standard graph formats and supports the required SPARQL and SHACL operations. Run a small integration check for subclass and subproperty inference; include only the behavior described in **Inference boundary** if the framework makes it straightforward.
- Define the concrete TOML schemas for `tbspec.toml`, `tbspec.lock`, and saved-query parameter declarations, plus the JSON schemas for command output and query bindings, without changing the behavior specified above.
- Turn the acceptance scenarios into implementation checks for CLI and web behavior. No further product decision is required for this first functional specification.

## Outside the MVP

- Git history or branching commands, automatic ontology migration, and CLI editing of individual RDF statements.
- Executing process or state-machine models, physical database schema generation, and built-in C4 or 4+1 protocols.
- Project-supplied executable visual plugins, automatic mapping between incompatible ontologies, and a general visual form-definition framework.
- SPARQL Update, remote `SERVICE` and remote dataset clauses, full OWL reasoning, and automatic dereferencing of data-value IRIs during validation.
- Multi-graph dataset imports and saved view membership for blank nodes; the generic editor can still display blank nodes in parseable graphs.
