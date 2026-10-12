export interface Guidance extends Record<string, unknown> {
  text: string;
  topics: { invocation: string; description: string }[];
}
const tree: Record<string, Guidance> = {
  "": {
    text: "tbspec manages local RDF/TOML projects. Initialize offline with tbspec init [directory] [--base-iri <iri>]. Run commands from any project subdirectory, or select the root with --project <dir>. Use --json for one version-1 envelope. Exit codes: 0 success/preview, 1 invalid project, 2 arguments/policy, 3 conflict/recovery/acceptance, 4 unavailable/I/O. Guidance contains no live project data. For live inspection use tbspec status, tbspec config show, tbspec graph list/show and tbspec dependency list/show as those commands become available.",
    topics: [
      {
        invocation: "tbspec llms project",
        description: "Use for discovery, initialization and configuration.",
      },
      {
        invocation: "tbspec llms modeling",
        description: "Use for ontology/model roles and validation guidance.",
      },
      {
        invocation: "tbspec llms views",
        description: "Use for independent views, presentation and designs.",
      },
      {
        invocation: "tbspec llms dependencies",
        description: "Use for offline sources, locked snapshots and later acquisition.",
      },
      { invocation: "tbspec llms queries", description: "Use for dataset and parameter guidance." },
      {
        invocation: "tbspec llms repair",
        description: "Use for conflict, recovery, impact, removal and move workflows.",
      },
      {
        invocation: "tbspec llms projects",
        description: "Initialization, selection and reproducibility.",
      },
      { invocation: "tbspec llms safety", description: "Conflict and manual recovery guidance." },
    ],
  },
  project: {
    text: "Initialize with tbspec init [directory] [--base-iri <iri>]. Explicit --project <dir> takes precedence over upward tbspec.toml discovery. Inspect effective settings with tbspec config show or tbspec config model-type list/show. Configure model-type ontology/design selectors and creation enablement with tbspec config model-type set, design set/clear, enable/disable or reset. Used vocabulary changes preview affected model validity and require --accept-impact. Status validates offline with explicit coverage.",
    topics: [
      {
        invocation: "tbspec llms projects init",
        description: "Exact initialization options, defaults and failures.",
      },
      {
        invocation: "tbspec llms project inspect",
        description: "Live inventory, selectors and validation coverage.",
      },
      {
        invocation: "tbspec llms project web",
        description: "Authenticated browser and independent server lifecycle.",
      },
    ],
  },
  "project inspect": {
    text: "tbspec status; tbspec graph list; tbspec graph show <selector>; tbspec config show; tbspec config model-type list/show. Use --project <dir> and --json as needed. Graph list contains owned RDF only. Show accepts an owned path, dep:<id>, or an exact retained dep:<id>/<file-key>; it returns the expanded selector, physical file, declared/generated graph IRI, source text and scoped RDF terms. Unclassified graphs remain visible; ambiguous roots and malformed RDF are diagnosed. Configuration identifies manifest replacements and locked defaults; absent override design means disconnected. Status establishes validity from syntax, classification, vocabulary, associations and SHACL; errors or required skipped checks produce invalid/1, and coverage reports what ran. No reads fetch remote content.",
    topics: [],
  },
  "project web": {
    text: "tbspec web [--port <port>] [--background]; tbspec web status; tbspec web stop. One server per canonical project binds 127.0.0.1. Start/reconnect defaults to an attached bounded log/control console; type detach to preserve the server, and Ctrl+C to request verified graceful shutdown. Browser/terminal closure and console transport loss leave it running. Non-TTY attaches without prompting; EOF disconnects. --background and --json return readiness without attaching; JSON is one envelope with no logs. Status never starts/attaches; absent stop succeeds. Report actual running application/protocol versions, not merely the installed version. Different explicit ports conflict; incompatible control versions require the running version's CLI to stop. The canonical base URL does not authenticate. Opening links contain a single-use 60-second fragment bootstrap; treat them as transient and never archive them as configuration. Browser sessions are tab-scoped for 12 hours or until restart, independent of native-control credentials. Obtain a fresh link with web status. The browser provides complete-graph exact RDF editing, Turtle repair and ontology/conceptual forms. Edits retain unknown values and compare captured byte revisions; review stale drafts explicitly before saving again. Locked snapshots require editable import. Individual statements have no CLI edit commands. Stop before replacing an installed release in place. Unknown registrations are preserved; only a start with demonstrably ended ownership can clean up a stale runtime record. Operation locks and recovery artifacts always retain their independent manual-recovery rules.",
    topics: [
      {
        invocation: "tbspec llms safety recovery",
        description: "Unknown ownership and retained transaction evidence.",
      },
    ],
  },
  modeling: {
    text: "Create, inspect and import owned ontologies/models; maintain concrete-model schemas and associated shapes. Validate a selected graph or the whole project offline with explicit diagnostic categories and coverage. New roots use --iri or configured base_iri. Locked snapshots remain read-only. Authoring reports unchecked validity until validation establishes it.",
    topics: [
      {
        invocation: "tbspec llms modeling ontologies",
        description: "Ontology creation and editable import.",
      },
      {
        invocation: "tbspec llms modeling models",
        description: "Enabled types, model profiles and editable import.",
      },
      {
        invocation: "tbspec llms modeling validation",
        description: "Offline checks, supported shapes and partial coverage.",
      },
      {
        invocation: "tbspec llms modeling schemas",
        description: "Concrete-model associations and confirmed removal.",
      },
      {
        invocation: "tbspec llms modeling shapes",
        description: "Associated shapes creation and inventory.",
      },
    ],
  },
  "modeling validation": {
    text: "tbspec validate [<graph-selector>]; tbspec status. Whole-project validation scans owned RDF and every retained locked file. Selected validation checks the target and its prerequisites, without validating downstream models. The owned inventory resolves graph identities; unrelated owned parse errors are excluded from the selected result, and unrelated dependency bytes are not loaded. No network, inferred persistence or implicit acquisition occurs. SHACL data contains only target triples and explicit effective vocabulary/schema subclass/subproperty hierarchy, also supplied in shapes for class checks. Locked external models retain source bindings. Syntax, classification, vocabulary, associations, view/presentation and SHACL checks have explicit failed/skipped coverage. Malformed prerequisites block dependent checks; independent shapes and resources continue. Results name target, source shapes graph, focus, shape, component, path and value. Violation/Warning/Info map to error/warning/info; warnings alone succeed. Supported shapes: Core and sh:sparql SELECT, with validated prefixes/PATH and explicit this projection. Update, SERVICE, FROM, MINUS, VALUES, AS rebinding of this, missing subquery this, and unbound shapesGraph/currentShape are rejected before execution. SPARQL targets, custom components, rules and JS are unsupported; a rejected graph is skipped whole.",
    topics: [],
  },
  "modeling schemas": {
    text: "tbspec model schema list <concrete-model-path>; tbspec model schema add <concrete-model-path> <conceptual-model-selector>; tbspec model schema remove <concrete-model-path> <conceptual-model-selector> [--confirm]. Zero schemas is valid. Schema declarations supplement the model's selected ontology and local declarations. Removal previews departing declarations, newly unavailable uses and affected checks. --confirm deliberately publishes even semantic invalidity; status/validate subsequently reports it. Malformed rewritten graphs, stale revisions and unsafe paths still refuse publication. Optional --accepted-preview binds CLI acceptance; browser previews retain exact session/instance-owned bytes for fifteen minutes and require the disclosed confirm flag.",
    topics: [],
  },
  "modeling shapes": {
    text: "tbspec shapes list [--source <path>]; tbspec shapes create <source-path>; tbspec shapes remove <owned-shapes-path> [--confirm]. Create an empty declared shapes graph next to an owned ontology/model as <stem>.shacl.ttl, with source graph IRI followed by /shapes. Non-Turtle sources also receive an explicit manifest association, preserving existing manifest bytes. Removal previews the affected graph and managed IRI references, then requires --confirm; it removes only the shapes file and leaves incoming triples intact, so resulting invalidity is deliberate. Browser operations use a session-owned preview.",
    topics: [],
  },
  "modeling ontologies": {
    text: "tbspec ontology list; tbspec ontology show <path>; tbspec ontology create <path> [--iri <iri>]; tbspec ontology import <source-selector> <path> [--iri <new-iri>]; tbspec ontology remove <owned-path> [--confirm]. Use impact ontology <owned-path> to inspect exact known managed IRI occurrences in all known RDF and configuration inputs before removal. Removal leaves incoming triples and associated support files in place; confirm accepts resulting semantic invalidity. Move a graph with resource move <owned-path> <destination>; preview first, then apply with its exact --accepted-preview fingerprint.",
    topics: [
      {
        invocation: "tbspec llms modeling ontologies create",
        description: "Identity and safe publication.",
      },
      {
        invocation: "tbspec llms modeling ontologies import",
        description: "Term preservation and source selection.",
      },
    ],
  },
  "modeling ontologies create": {
    text: "tbspec ontology create <path> [--iri <iri>]. Supply --iri without base_iri. Derived IRIs use the final filename without .ttl, not its directory. Occupied destinations, duplicate graph identities, ambiguous/malformed required graphs, unsafe paths, stale inputs and retained recovery refuse publication and preserve existing files. Creates are staged and exclusively published. CLI local authoring applies directly; optional --accepted-preview <digest> verifies the reviewed plan and returns conflict/3 with a fresh preview on mismatch. Browser authoring reviews a session/instance-owned preview before apply and invalidates it on cancellation or relevant changes.",
    topics: [],
  },
  "modeling ontologies import": {
    text: "tbspec ontology import <local-file|dep:id|dep:id/file-key> <path> [--iri <new-iri>]. Supported local formats are Turtle, N-Triples and strict RDF/XML; acquire remote sources as dependencies first. Bundled example: tbspec ontology import dep:tbspec-state-machine ontologies/state.ttl --iri urn:example:state. Only managed root metadata relocates. Class/property/individual IRIs and unknown statements remain exact. Provenance uses prov:wasDerivedFrom and dcterms:source; existing owned term declarations produce collision warnings. Source bytes and locked snapshots are preserved. Browser creation and imports require a session-bound preview applied within fifteen minutes; application uses staged bytes, rechecks project revisions and consumes the preview once. Do not automatically retry uncertain publication outcomes.",
    topics: [],
  },
  "modeling models": {
    text: "tbspec model list; tbspec model show <path>; tbspec model create <path> --type <name> [--profile conceptual|concrete] [--schema <selector> ...] [--iri <iri>]; tbspec model import <source-selector> <path> --type <name> [--iri <new-iri>]; tbspec model remove <owned-path> [--confirm]. Select an enabled effective type; disabled/missing/unusable types are diagnosed. Graph roots determine classification, never filenames or business types. Show reads only the selected graph and configuration: schema IRIs remain visible even when no owned-file selector is resolved. Use impact model <owned-path> to inspect known managed IRI references before removing a model. Removal preserves incoming triples and linked support resources and may deliberately leave invalid references. Move a graph with resource move <owned-path> <destination>, review the preview and apply using the exact fingerprint.",
    topics: [
      {
        invocation: "tbspec llms modeling models create",
        description: "Data profiles and descriptive process/state roots.",
      },
      {
        invocation: "tbspec llms modeling models import",
        description: "Deliberate receiving types and missing vocabulary.",
      },
    ],
  },
  "modeling models create": {
    text: "tbspec model create <path> --type <name> [--profile conceptual|concrete] [--schema <selector> ...] [--iri <iri>]. --profile applies only to data and defaults conceptual (classes/properties); concrete supports generic individual/value editing in the browser. Repeat --schema only for concrete creation, targeting conceptual models. Process and state-machine models are empty descriptions. Recognized selected vocabulary adds p-plan:Plan or sm:StateMachine to their root; replacements receive no invented mapping. Custom types use tbspec:Model. Every owned model gets one literal tbspec:modelType binding.",
    topics: [],
  },
  "modeling models import": {
    text: "tbspec model import <local-file|dep:id|dep:id/file-key> <path> --type <name> [--iri <new-iri>]. Explicitly choose the receiving type; do not reuse an upstream type name implicitly. Preserve compatible source classification, terms, unknown statements and schema IRIs. The resulting copy can be semantically invalid: import still succeeds and reports VOCABULARY_UNKNOWN or broken schema associations with validity invalid. No silent dependency copy, term renaming or vocabulary rebinding occurs. Run validate on the resulting graph or whole project to obtain full constraint diagnostics. The browser previews the copy and applies staged bytes once with revision checks; inspect after uncertain outcomes.",
    topics: [],
  },
  views: {
    text: "Views select model elements; presentation stores layout and appearance independently. Bundled designs provide initial appearance rules without runtime assets. View, presentation and design commands arrive in later tickets; inspect resources with tbspec graph list/show once available.",
    topics: [],
  },
  dependencies: {
    text: "tbspec dependency inspect --source <directory|git|http-url> [--ref <revision>] [--resource <selector>]; dependency add <id> --source <source> --kind ontology|model|design [--ref <revision>] [--resource <selector>] [--accepted-preview <fingerprint>]; dependency list; dependency show <id>; dependency check [<id>]; dependency select <ontology-iri> <id>; dependency clear <ontology-iri>. Listings retain exact selectors, source provenance, support and the effective ontology candidate. Check explicitly reacquires selected source closures and reports unchanged, changed or unavailable without writing snapshots; unrelated commits and settings do not count as drift. Select chooses one dependency's recorded candidate; clear returns to normal precedence. Add first returns a concrete conflict preview; retry with that fingerprint reacquires once and applies only if the reviewed bytes, parser context, impact and project revisions still match. Unresolved references stay offline diagnostics. Persisted HTTP(S) and HTTPS Git locators reject userinfo, query strings and fragments; use transient or external authentication. SSH agent authentication and explicitly selected local Git repositories are supported. Capability secrets in a path or host cannot be universally detected from syntax. Snapshots preserve exact bytes and stable parser bases; Git commits remain provenance and unrelated commits do not change interpretation signatures. Queries, validation and rendering never fetch sources.",
    topics: [
      {
        invocation: "tbspec llms projects init",
        description: "Offline initialization and snapshot preservation.",
      },
    ],
  },
  queries: {
    text: "tbspec query list; tbspec query show <name>; tbspec query save <name> --file <path> [--parameters <path.toml>]; tbspec query run (--file <path.rq> | --saved <name>) [--graph <selector>] [--bindings <path.json>]; tbspec query remove <name> [--confirm]. Queries accept SELECT, ASK, CONSTRUCT and DESCRIBE over local in-memory RDF only. Save validates SPARQL and declarations without running the query. Run never changes project files. Removal previews both files and requires --confirm.",
    topics: [
      {
        invocation: "tbspec llms queries parameters",
        description: "Declaration fields and typed RDF-term bindings.",
      },
      {
        invocation: "tbspec llms queries dataset",
        description: "Default union, named graphs, isolation and query policy.",
      },
    ],
  },
  "queries parameters": {
    text: "Saved queries use queries/<name>.rq and queries/<name>.query.toml with schema_version = 1 and a parameters array. Each parameter requires name (SPARQL variable without ?/$), kind = iri|literal and required = true|false. Literal declarations may constrain one absolute datatype IRI or one well-formed BCP 47 language tag. Bindings JSON maps bare variable names to {kind,value} RDF terms; literals may add datatype or language. Required, unknown, malformed or mismatched bindings fail before execution. Values are RDF terms passed as initial bindings; no text substitution occurs. Parameter errors do not echo binding values.",
    topics: [],
  },
  "queries dataset": {
    text: "Without --graph, every effective resource is registered under its exact declared or generated graph IRI. Only effective ontology and model triples enter the default union; support and unclassified graphs remain named-only. Use GRAPH <iri> to query a named resource. --graph <selector> loads only that graph as both default and named graph, so unrelated malformed files and ontology-choice conflicts do not block isolated queries. Update, SERVICE at any depth, FROM and FROM NAMED are rejected by parsed-AST validation before engine execution. Query execution uses local project files and locked snapshots and makes no acquisition or dereferencing requests. ASK false is successful; SELECT omits unbound cells; returned blank nodes have scope=result.",
    topics: [],
  },
  impact: {
    text: "tbspec impact <ontology|model|shapes|model-type> <exact-owned-selector-or-name>. The read-only report lists each known occurrence of managed IRIs in owned and retained locked RDF, and exact configuration values in tbspec.toml/tbspec.lock, plus affected files and model bindings. It does not scan arbitrary files or infer references from prefixes, substrings or external resources. Impact is informational; remove and move each use their own captured preview and revision guards.",
    topics: [],
  },
  resource: {
    text: "tbspec resource move <owned-selector> <destination> previews a same-format move. Review changed paths, manifest selector rewrites, linked .shacl.ttl moves and any generated graph-identity change. Apply only by rerunning with --apply --accepted-preview <fingerprint>. The move carries source bytes and revisions through the shared transaction boundary; occupied destinations, unsupported formats, identity collisions and stale plans refuse publication.",
    topics: [],
  },
  repair: {
    text: "Use impact <kind> <selector> for a read-only inventory of known managed references. Owned graph and custom model-type removals return previews and require --confirm; they do not cascade or rewrite incoming RDF. resource move previews path and manifest selector changes, then requires --apply with the exact --accepted-preview fingerprint. Stale revisions require a fresh plan; unknown ownership and pending recovery require exclusive manual inspection.",
    topics: [
      {
        invocation: "tbspec llms safety recovery",
        description: "Preserve interrupted-transaction evidence and establish exclusive access.",
      },
    ],
  },
  projects: {
    text: "A project is identified by tbspec.toml. Explicit --project selects that root and takes precedence over upward discovery. Dependency snapshots are versionable; Git initialization is separate. Application upgrades do not change schema versions or locked defaults. Inspect live resources with status, config show, graph list/show and dependency list/show.",
    topics: [
      {
        invocation: "tbspec llms projects init",
        description: "Exact initialization options, defaults and errors.",
      },
    ],
  },
  "projects init": {
    text: "tbspec init [directory] [--base-iri <iri>] [--project <dir>] [--json]. Directory defaults to the working directory, or the explicit project root. Supply either a positional directory or --project, not both. Base IRI must be absolute and end in / or #. Example: tbspec init ./knowledge --base-iri https://example.org/knowledge/ --json. Creates schema-version-1 manifest/lock and independent common metadata binding, plus data/process/state-machine defaults and local shapes/designs. Copies verified bundled 0.1.0 resources without network or Git. Existing destinations are preserved and produce conflict/3. A malformed or unsupported required file produces invalid/1 when read. Use dependency show to inspect exact locked-file selectors when that command is available.",
    topics: [],
  },
  safety: {
    text: "Operations capture coherent bytes under an exclusive short-lived project lock, release it for computation/review, and recheck exact revisions before publication. Contention fails immediately. Preserve drafts and prepare a new plan after a stale revision. No automatic lock clearing or crash replay occurs. Writes reject unsafe paths, internal links/junctions, hardlinks and aliases.",
    topics: [
      {
        invocation: "tbspec llms safety recovery",
        description: "Preserve evidence and establish exclusive access for manual recovery.",
      },
    ],
  },
  "safety recovery": {
    text: "Unknown or abandoned .tbspec/operation.lock and pending .tbspec/transactions block normal operations. Stop every CLI/web process and prevent new invocations. Preserve ownership records, transaction records and before-images. Inspect affected files and missing/incomplete artifacts; restore or explicitly accept a coherent on-disk state before manually removing retained evidence. Leave the lock if exclusive access cannot be established. inspectRecovery is the read-only shared operation; no automatic recovery CLI command is provided. Completed cleanup failure is success with CLEANUP_RETAINED warning. The transaction contract does not guarantee multi-file crash atomicity or network-filesystem safety.",
    topics: [],
  },
};
export function guidance(topics: string[]): { found: boolean; data: Guidance } {
  const key = topics.join(" ");
  if (tree[key]) return { found: true, data: tree[key] };
  while (topics.length && !tree[topics.join(" ")]) topics = topics.slice(0, -1);
  const nearest = tree[topics.join(" ")] ?? tree[""];
  if (!nearest) throw new Error("Guidance index unavailable.");
  return {
    found: false,
    data: {
      ...nearest,
      text: `Unknown guidance topic: ${key}. Nearest valid index:\n${nearest.text}`,
    },
  };
}
export function help(command: string): Guidance {
  if (command === "dependency")
    return {
      text: "Usage: tbspec dependency inspect --source <directory|git|http-url> [--ref <revision>] [--resource <selector>]\n       tbspec dependency add <id> --source <source> --kind ontology|model|design [--ref <revision>] [--resource <selector>] [--accepted-preview <fingerprint>]\n       tbspec dependency list\n       tbspec dependency show <id>\n       tbspec dependency check [<id>]\n       tbspec dependency select <ontology-iri> <id>\n       tbspec dependency clear <ontology-iri>\nOptions: --project <dir>, --json, --help\nAdd requires review: the first call returns a concrete conflict preview and fingerprint; retrying reacquires and applies only an unchanged preview. Check reports source drift without changing snapshots. Direct HTTP(S) sources contribute one RDF graph without recursive crawling.",
      topics: [
        {
          invocation: "tbspec llms dependencies",
          description: "Acquisition, snapshots, source contexts and offline behavior.",
        },
      ],
    };
  if (command === "query")
    return {
      text: "Usage: tbspec query list\n       tbspec query show <name>\n       tbspec query save <name> --file <path> [--parameters <path.toml>]\n       tbspec query run (--file <path.rq> | --saved <name>) [--graph <selector>] [--bindings <path.json>]\n       tbspec query remove <name> [--confirm]\nOptions: --project <dir>, --json, --help\nOnly SELECT, ASK, CONSTRUCT and DESCRIBE run. Removal previews unless confirmed.",
      topics: [
        {
          invocation: "tbspec llms queries",
          description: "Saved queries, typed bindings and local dataset policy.",
        },
      ],
    };
  if (command === "validate" || command === "shapes")
    return {
      text:
        command === "validate"
          ? "Usage: tbspec validate [<graph-selector>]\nOptions: --project <dir>, --json, --help\nValidate offline; errors or required skipped checks exit 1, warnings alone exit 0."
          : "Usage: tbspec shapes list [--source <path>]\n       tbspec shapes create <source-path>\n       tbspec shapes remove <owned-path> [--confirm] [--accepted-preview <digest>]\nOptions: --project <dir>, --json, --help\nCreate empty associated shapes without overwriting occupied files. Removal previews and preserves incoming RDF references.",
      topics: [
        {
          invocation: `tbspec llms modeling ${command === "validate" ? "validation" : "shapes"}`,
          description: "Focused validation/support contract.",
        },
      ],
    };
  if (command === "model")
    return {
      text: "Usage: tbspec model list\n       tbspec model show <path>\n       tbspec model create <path> --type <name> [--profile conceptual|concrete] [--schema <selector> ...] [--iri <iri>]\n       tbspec model import <source-selector> <path> --type <name> [--iri <new-iri>]\n       tbspec model remove <owned-path> [--confirm] [--accepted-preview <digest>]\n       tbspec model schema list <concrete-model-path>\n       tbspec model schema add <concrete-model-path> <conceptual-model-selector>\n       tbspec model schema remove <concrete-model-path> <conceptual-model-selector> [--confirm]\nOptions: --project <dir>, --json, --help\nAuthoring: --accepted-preview <digest> verifies a reviewed plan before publication.",
      topics: [
        {
          invocation: "tbspec llms modeling models",
          description: "Focused authoring and lifecycle contracts.",
        },
      ],
    };
  if (command === "ontology" || command === "model")
    return {
      text:
        command === "ontology"
          ? "Usage: tbspec ontology list\n       tbspec ontology show <path>\n       tbspec ontology create <path> [--iri <iri>]\n       tbspec ontology import <source-selector> <path> [--iri <new-iri>]\n       tbspec ontology remove <owned-path> [--confirm] [--accepted-preview <digest>]\nOptions: --project <dir>, --json, --help\nAuthoring: --accepted-preview <digest> verifies a reviewed plan before publication."
          : "Usage: tbspec model list\n       tbspec model show <path>\n       tbspec model create <path> --type <name> [--profile conceptual|concrete] [--schema <selector> ...] [--iri <iri>]\n       tbspec model import <source-selector> <path> --type <name> [--iri <new-iri>]\n       tbspec model schema list <concrete-model-path>\n       tbspec model schema add <concrete-model-path> <conceptual-model-selector>\n       tbspec model schema remove <concrete-model-path> <conceptual-model-selector> [--confirm]\nOptions: --project <dir>, --json, --help\nAuthoring: --accepted-preview <digest> verifies a reviewed plan before publication.",
      topics: [
        {
          invocation: `tbspec llms modeling ${command === "ontology" ? "ontologies" : "models"}`,
          description: "Focused authoring and inspection contracts.",
        },
      ],
    };
  if (command === "impact" || command === "resource")
    return {
      text:
        command === "impact"
          ? "Usage: tbspec impact <ontology|model|shapes|model-type> <exact-selector-or-name>\nOptions: --project <dir>, --json, --help\nRead-only known-reference inventory across managed RDF and project configuration."
          : "Usage: tbspec resource move <owned-selector> <destination> [--apply --accepted-preview <fingerprint>]\nOptions: --project <dir>, --json, --help\nPreview first; apply only the exact reviewed fingerprint.",
      topics: [
        {
          invocation: `tbspec llms ${command}`,
          description: "Resource impact and lifecycle rules.",
        },
      ],
    };
  if (command === "config")
    return {
      text: "Usage: tbspec config show\n       tbspec config model-type list|show <name>\n       tbspec config model-type set <name> --ontology <selector> [--accept-impact]\n       tbspec config model-type disable|enable|reset <name>\n       tbspec config model-type design set <name> <selector>\n       tbspec config model-type design clear <name>\n       tbspec config model-type remove <custom-name> [--confirm] [--accepted-preview <digest>]\nOptions: --project <dir>, --json, --help, --accepted-preview <digest>\nConfiguration edits preserve unknown TOML content. Used vocabulary changes preview impact and require explicit --accept-impact. Custom type removal preserves models and may leave them invalid; built-in types cannot be removed.",
      topics: [
        {
          invocation: "tbspec llms project inspect",
          description: "Configuration origins and lifecycle behavior.",
        },
      ],
    };
  if (["status", "graph"].includes(command))
    return {
      text: "Usage: tbspec status\n       tbspec graph list\n       tbspec graph show <path|dep:id|dep:id/file-key>\n       tbspec config show\n       tbspec config model-type list|show <name>\n       tbspec config model-type set <name> --ontology <selector> [--accept-impact]\n       tbspec config model-type disable|enable|reset <name>\n       tbspec config model-type design set <name> <selector>\n       tbspec config model-type design clear <name>\nOptions: --project <dir>, --json, --help, --accepted-preview <digest>\nConfiguration edits preserve unknown TOML content. Used vocabulary changes preview impact and require explicit --accept-impact. Status reports offline validity and coverage; errors or required skipped checks exit 1.",
      topics: [
        {
          invocation: "tbspec llms project inspect",
          description: "Exact selectors, configuration origins and coverage.",
        },
      ],
    };
  if (command === "web")
    return {
      text: "Usage: tbspec web [--port <port>] [--background]\n       tbspec web status\n       tbspec web stop\nOptions: --project <dir>, --json, --help\nStart/reconnect with independent server process. Foreground console: detach leaves it running; Ctrl+C stops. --json returns one readiness envelope without attaching. Non-TTY does not prompt. Opening links are transient single-use credentials; status obtains a fresh link. Report actual running versions. Stop before in-place package replacement.",
      topics: [
        {
          invocation: "tbspec llms project web",
          description: "Authentication, lifecycle and safe runtime inspection.",
        },
      ],
    };
  if (command === "init")
    return {
      text: "Usage: tbspec init [directory] [--base-iri <iri>] [--project <dir>] [--json]\nExample: tbspec init knowledge --base-iri https://example.org/knowledge/ --json\nInitialize offline with locked data, process and state-machine resources. No Git repository is created.",
      topics: [
        { invocation: "tbspec llms projects init", description: "Defaults and failure behavior." },
      ],
    };
  if (command === "llms")
    return {
      text: "Usage: tbspec llms [topic ...] [--json]\nExample: tbspec llms projects init --json\nDocumentation only; topics disclose focused guidance recursively.",
      topics: guidance([]).data.topics,
    };
  return {
    text: "Usage: tbspec <command> [--project <dir>] [--json]\nCommands: init, status, validate, impact, resource move, shapes list/create/remove, graph list/show, ontology list/show/create/import/remove, model list/show/create/import/remove/schema list/add/remove, dependency inspect/add/list/show/check/select/clear, query list/show/save/run/remove, config show/model-type list/show/set/disable/enable/reset/design/remove, web [status|stop], llms\nGlobal options: --help, --version, --json, --project <dir>\nExamples: tbspec impact ontology vocabularies/core.ttl --json; tbspec dependency inspect --source ../vocabulary --json\nCLI and authenticated browser share queries, configuration, authoring, dependencies and project operations. Use tbspec llms queries, llms impact, llms resource, llms dependencies and llms project for guidance.",
    topics: [
      { invocation: "tbspec init --help", description: "Initialize an offline project." },
      { invocation: "tbspec llms --help", description: "Recursive agent guidance." },
      {
        invocation: "tbspec web --help",
        description: "Server lifecycle and authenticated browser opening.",
      },
    ],
  };
}
