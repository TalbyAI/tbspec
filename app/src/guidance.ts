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
        description: "Use for conflicts, recovery and later impact/repair workflows.",
      },
      {
        invocation: "tbspec llms projects",
        description: "Initialization, selection and reproducibility.",
      },
      { invocation: "tbspec llms safety", description: "Conflict and manual recovery guidance." },
    ],
  },
  project: {
    text: "Initialize with tbspec init [directory] [--base-iri <iri>]. Explicit --project <dir> takes precedence over upward tbspec.toml discovery. Config inspection and editing CLI commands arrive in later tickets; use tbspec config show once available to inspect effective settings.",
    topics: [
      {
        invocation: "tbspec llms projects init",
        description: "Exact initialization options, defaults and failures.",
      },
    ],
  },
  modeling: {
    text: "Initialization locks independent common metadata plus data, process and state-machine ontologies, shapes and designs. It reports projectValidity unchecked. Model authoring and project validation commands arrive in later tickets; use tbspec graph list and tbspec validate once available for live resource and validation evidence.",
    topics: [],
  },
  views: {
    text: "Views select model elements; presentation stores layout and appearance independently. Bundled designs provide initial appearance rules without runtime assets. View, presentation and design commands arrive in later tickets; inspect resources with tbspec graph list/show once available.",
    topics: [],
  },
  dependencies: {
    text: "Init copies immutable 0.1.0 releases, standard vocabularies and attributed P-Plan 1.3 into versionable .tbspec/dependencies snapshots. The lock binds exact original bytes, parser bases, identities, signatures and source contexts. Persisted HTTP(S) locators and parser bases reject userinfo, query strings and fragments; use transient or external authentication, not signed/query-bearing URLs. URL syntax cannot identify every secret in a path or host. No network acquisition occurs. Dependency list/show/check/update commands arrive in later tickets; use list/show for live inspection once available.",
    topics: [
      {
        invocation: "tbspec llms projects init",
        description: "Offline initialization and snapshot preservation.",
      },
    ],
  },
  queries: {
    text: "Saved queries will execute against explicitly assembled local datasets with typed RDF-term parameters. Query declarations and execution commands arrive in later tickets. This guidance retrieves no project data and runs no query.",
    topics: [],
  },
  repair: {
    text: "Stale revisions require a fresh plan; unknown ownership and pending recovery require exclusive manual inspection. Impact, removal, refactoring and orphan-repair commands arrive in later tickets.",
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
    text: "Usage: tbspec <command> [--project <dir>] [--json]\nCommands: init, llms\nGlobal options: --help, --version, --json, --project <dir>\nExample: tbspec init ./knowledge --base-iri https://example.org/knowledge/\nLive inspection commands (status, config, graph and dependency) are delivered by the next feature ticket.",
    topics: [
      { invocation: "tbspec init --help", description: "Initialize an offline project." },
      { invocation: "tbspec llms --help", description: "Recursive agent guidance." },
    ],
  };
}
