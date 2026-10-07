# tbspec application

This is the isolated production Node 24/TypeScript package. It imports no prototype code. Root dependencies own repository quality tooling; application dependencies and their pinned transitive graph live here.

## Build and run

From this directory:

```sh
npm ci
npm run typecheck
npm run build
node dist/cli.js --help
node dist/cli.js init ./knowledge --base-iri https://example.org/knowledge/ --json
node dist/cli.js llms projects init --json
npm test
```

The compiled executable and immutable `starters/0.1.0/` assets form the package runtime. After dependency installation and compilation, initialization needs Node and the platform's built-in process-identity facilities, with no Git or network access. Source tests use Node's TypeScript stripping; installed execution uses compiled JavaScript. `npm pack` builds a local artifact and does not publish it.

Only `init`, recursive `llms`, help and version are CLI commands in this ticket. The next feature ticket adds live status/configuration/resource inspection. Guidance names those inspection commands explicitly without representing documentation as live project data.

`init [directory] [--base-iri <iri>]` defaults to the working directory. Global `--project <dir>` can select the initialization directory instead of a positional directory. Base IRIs must be absolute and end in `/` or `#`. Every `--json` invocation, including help, version and argument errors, writes one schema-version-1 envelope to stdout. Diagnostics go to stderr. Exits are 0 success/preview, 1 invalidity, 2 arguments/policy, 3 conflict/recovery/acceptance and 4 unavailable/I/O. Initialization reports resulting validity as `unchecked`; full project validation belongs to its feature ticket.

## Shared operations

`src/project.ts` provides `initializeProject`, canonical upward/explicit `discoverProject`, coherent `readProject`, surgical `setProjectBaseIri`, and read-only `inspectRecovery`. Explicit project selection requires a manifest at that root and never falls back to another project. Manifest/lock incompatibility and corrupt/missing snapshots fail without migration, repair or acquisition. Missing starter defaults never fall back to the installed release. The common metadata binding is independent of current model-type overrides.

`capture`, `preparePlan` and `publishPlan` in `src/transactions.ts` are the trusted adapter boundary for later operations. Capture exact file/absence revisions and disclosed inventories, release the operation lock during computation/review, then publish the prepared plan with the same revisions. Capture every input and destination used by an operation; declare inventory scopes when discovery affects a plan. Low-level publication accepts only trusted in-process plans, never an HTTP/client-supplied write plan. Each higher-level operation remains responsible for semantic policy, locked-versus-owned resource authorization and its acceptance flags.

The version-1 schemas, source contexts, byte/graph/interpretation signatures and canonical encoding follow the [normative contract](../.scratch/mvp-technical-architecture/contracts/file-and-output-schemas.md). Human TOML setting changes replace a verified source span and reparse it, preserving unrelated content. Unsupported source syntax fails without rewriting the document.

## Publication and recovery

The exclusively created `.tbspec/operation.lock` records a random acquisition token and OS host, boot, PID and process-start identity. Contenders fail immediately; partial, abandoned or unverifiable records remain untouched. Normal release verifies the entire record and process identity. The root may be selected through a junction, but internal links/junctions, multiply linked writable files, aliases, invalid portable paths and case-equivalent destinations are rejected.

Transactions stage complete proposed bytes, exact before-images and a progress journal beneath `.tbspec/transactions/` on the local filesystem. Replacements use native rename; creates and move destinations use exclusive native linking of staged bytes, then remove the temporary link. Recheck inputs before publication and affected paths before actions. Normal failures roll back in reverse order, preserving intervening edits. Interrupted/incomplete rollback blocks subsequent operations and retains evidence. Completed cleanup failure returns success with `CLEANUP_RETAINED` warning.

For manual recovery, stop all project CLI/web processes and prevent new invocations. Preserve the lock, journals and originals. Use `inspectRecovery` or direct read-only filesystem inspection to identify affected paths and incomplete artifacts. Restore or explicitly accept a coherent project state before clearing retained evidence. Leave the lock if exclusive access cannot be established. There is no automatic clearing or crash replay, no persistent undo history, and no multi-file crash/power-loss atomicity claim. The coordination guarantee assumes ordinary local filesystems and cooperating tool processes; hostile writers and network filesystems are outside it.

Windows identity uses MachineGuid, OS boot time and process start time through built-in PowerShell. Linux uses machine-id, kernel boot ID and `/proc` process-start ticks. macOS currently fails closed because its full process-identity adapter is not implemented; ticket 20 must add it and establish actual Windows/macOS/Linux evidence before a cross-platform release claim. Windows is the platform executed for this implementation.

## Bundled resources and evidence

The release includes metadata/process/state-machine ontologies, release-scoped shapes and designs, local standard vocabularies, and exact attributed P-Plan 1.3 RDF/XML. [Source and license inventory](starters/0.1.0/SOURCES.md) records upstream files and the authored XML Schema extraction. Initialization validates the immutable inventory and every asset before publication, copies exact bytes and adds the inventory digest to bundle sources in the consumer lock. DTD-bearing RDF/XML is allowed only when its bytes match the installed vetted P-Plan inventory; a source-provided lock cannot grant the exception.

`scripts/author-starters.ts` records initial release authoring. It is excluded from the installed artifact and is never invoked by initialization or an upgrade. Do not regenerate or mutate a published release; future changed resources require new release identities. It reuses already-downloaded standard/P-Plan files and performs no acquisition itself.

The tests exercise public project/transaction operations, CLI child processes with network access blocked and Git absent from PATH, Windows sharing errors, real process interruption/contention, ownership write/close failures, confinement, byte-preserving TOML edits, canonical golden vectors, integrity failures and bundled Core/SELECT constraints. `validateStarterGraph` is a narrow resource-authoring check over trusted packaged shapes; it is not the later full project validation operation. Explicit hierarchy triples are included in both validation data and shapes datasets for the approved engine, without persisting inferred model statements. Each SELECT constraint lives in its own anonymous helper shape because the pinned engine combines multiple `sh:sparql` values on one shape incorrectly.
