# Test execution and CLI startup: hypothesis investigation

Date: 2026-10-15. Source commit: `720d3496595f74c1f5c52785965dc7b3b1d33412`.
State: discovery complete; proposed implementation scope awaits explicit approval through auto-grill.

## Recovered goal and settled constraints

Improve local and eventual pipeline execution by improving CLI startup, removing repeated test work, and organizing coverage around appropriate boundaries. Preserve the behavior of public operations and the security, offline, revision, and transaction guarantees. Investigate locally before changing workflow scheduling.

The [previous diagnosis](README.md) supplies complete same-commit CI timings, three local operation profiles, and a conservative fixture experiment. It does not establish a passing complete local suite or a safe whole-test deletion. Its initial four-call fixture experiment lost unique positive CLI route coverage and was replaced by a two-call experiment that retained it.

This investigation adds read-only startup and constructor probes, source/contract inspection, and an [independent risk review](hypothesis-review.md). It changes no application, existing test, dependency, build output, or workflow. Research notes and measurements are the only repository additions. Implementation remains paused.

## New evidence

### Startup is expensive even when no project operation runs

Five fresh processes were measured per case, sequentially, rotating case order. Each child used an absolute Node executable, empty `PATH` and `NODE_OPTIONS`, and the same installed dependencies. CLI probes checked the exit status and a single version-1 JSON envelope. The machine and Node version match the prior diagnosis; filesystem caches were warm and ordinary desktop noise was not controlled.

| Existing code path                               | Median wall time |
| ------------------------------------------------ | ---------------: |
| Node with an empty expression                    |          54.9 ms |
| Import `output.ts` only                          |         100.8 ms |
| Import `guidance.ts` only                        |          96.0 ms |
| Import `runtime.ts` only                         |         137.6 ms |
| Import `project.ts` only                         |         181.8 ms |
| Import `shacl-execution.ts` only                 |         596.6 ms |
| Source CLI `--help --json`                       |         879.5 ms |
| Source CLI `--version --json`                    |         809.1 ms |
| Source CLI `llms views designs --json`           |         789.2 ms |
| Source CLI `validate --confirm --json`, rejected |         822.8 ms |

The existing compiled output was verified against normalized ESM emission from all 41 non-declaration source files using the installed TypeScript version and current compiler options. No output was written. The initial isolated NodeNext transpilation probe emitted CommonJS; the comparison explicitly selected ESM to match the package's `type: module`. All 41 files then matched existing `dist` output.

A separate five-repetition batch using that compiled CLI measured help at 661.4 ms, version at 667.0 ms, guidance at 669.6 ms, and the rejected invocation at 654.2 ms. The separate batches are not a controlled TypeScript-versus-JavaScript speedup experiment. They do show that a substantial startup cost remains in the current compiled CLI.

[cli.ts](../../app/src/cli.ts) statically imports all operation families before `dispatch()` can handle help, version, guidance, or malformed arguments. [shacl-execution.ts](../../app/src/shacl-execution.ts) and [query.ts](../../app/src/query.ts) import the Comunica stack. The evidence supports a lightweight entry and deferred operation imports; it does not measure the eventual improvement of that change.

### Query-engine construction is a second optimization hypothesis

[runShapes](../../app/src/shacl-execution.ts) constructs a `QueryEngine` on every call, before knowing whether any query execution is needed. The installed [QueryEngine implementation](../../app/node_modules/@comunica/query-sparql-rdfjs-lite/lib/QueryEngine.js) constructs its default actor engine when no engine is supplied.

In a warm-process ten-iteration microbenchmark, median constructor time was 28.5 ms; the first construction was 499.1 ms. Running the existing `runShapes` on empty shapes and data took a median 27.6 ms and returned a conforming report. The first explicit constructor precedes the first empty-shape call, so the latter does not measure cold initialization. The previous dependency profile observed 552 `runShapes` calls in one test.

This establishes construction overhead, not an achievable end-to-end saving. Do not multiply the microbenchmark median by all historical calls and advertise that number as an expected reduction.

Raw repetitions, freshness checks, and environment notes are in [hypotheses/measurement.json](hypotheses/measurement.json). Earlier operation profiles remain unchanged in [measurement.json](measurement.json).

## Ranked hypotheses and falsification tests

Priority expresses experiment order and correctness risk, not a promised saving.

| ID / priority        | Hypothesis and prediction                                                                                                                                                                                                   | Smallest experiment after approval                                                                                                                                                                                                                                         | Reject or revise if                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1 / first           | Eager imports dominate simple CLI startup. If operation modules load only after argument handling, help/version/guidance and invalid arguments should get faster in both source and compiled builds.                        | Keep the existing validation order and rendering; defer the heavy operation imports by family. Measure identical fresh-process invocations before/after. Record loaded modules and verify simple paths do not load the query/SHACL stack.                                  | Diagnostics or exit precedence change, output gains extra lines, ordinary operation startup regresses materially, or the heavy stack still loads through a transitive import. |
| H2 / first           | Most argument/guidance matrices need command interpretation, not a new OS process. An importable argument-validation boundary should make these matrices cheap while real-process smoke tests preserve the binary contract. | Extract the existing interpretation/validation logic without changing it. Move equivalent argument assertions to direct calls. Retain actual process checks for JSON/text output, stderr, exit mapping, offline preload, root discovery, and each unique successful route. | Tests now exercise a replacement parser, read project state while parsing, change diagnostic order, or lose process/route assertions.                                         |
| H3 / first           | Fixture construction repeats behavior already tested elsewhere. Direct setup reduces Node and native identity lookups.                                                                                                      | Apply only the previously measured two-model-creation change and reuse the duplicate guidance result. Re-run the original case and independent family/profile route coverage.                                                                                              | A setup call is the only successful route test, fixture bytes/semantics change, or isolation/offline guarantees are lost without equivalent remaining coverage.               |
| H4 / first           | Repair/lifecycle/support helpers reload installed starters per locked graph when they only need a verified digest. A capture-local bundle/digest should remove repeated loading.                                            | Pass one verified `vettedDigest` through a coherent capture; inspect the analogous call sites in repair, lifecycle, and support separately. Count loader calls and run the relevant direct/CLI/HTTP tests.                                                                 | It becomes a global mutable cache, fails to detect corrupted installed/project bytes, changes RDF/XML vetting, or accidentally reads resources outside the command's scope.   |
| H5 / second          | Some `runShapes` calls build a query engine they never use. Lazy construction might avoid that cost; later, carefully bounded reuse might reduce repeated construction further.                                             | First count real constructor and `queryBindings` calls by use: SHACL SELECT and Core comparison fallback. Then make construction lazy at the actual query-use points. Consider pass-local reuse only if needed and independently validated.                                | A Core constraint now silently skips query comparison, a shared engine retains prior datasets, cross-project results leak, or memory grows with processed targets.            |
| H6 / later           | Repeated parsing/shape preparation may be reusable inside a verified, bounded interpretation context.                                                                                                                       | Establish exact parse/compile counts and peak memory; compare a bounded design against full-validation diagnostics, revisions, and retained-store invariants. Prefer small immutable installed metadata over retaining project Stores.                                     | Reuse depends only on a path/digest, ignores base IRI/profile/blank-node scope, retains unrelated target graphs, or removes deferred-read/revision checks.                    |
| H7 / separate design | Revalidating only affected graphs could reduce the 20 full validation passes observed in dependency workflows.                                                                                                              | Design dependency/negative-read invalidation first; compare optimized results against full baseline/proposed validation on the same snapshots and fault cases. Keep a full-validation oracle during development.                                                           | New graph identities, missing files, association/design/winner changes, stale inventories, or intentional invalidity diverge from full validation.                            |
| H8 / deferred        | Test scheduling can shorten elapsed CI time without reducing total work.                                                                                                                                                    | Once operation costs stabilize, measure bounded concurrency and duration-aware partitioning.                                                                                                                                                                               | Global mocks, fixed ports, process races, memory pressure, or unbalanced new partitions erase the gain. Workflow changes require a later scope decision.                      |

## Chosen architecture direction and alternatives

**Recommended: targeted CLI separation plus conservative test organization.** Keep a small process entry responsible for stdout, stderr, exit status, and optional foreground-console attachment. Make argument interpretation callable without process-global effects, and load operation families only after their signatures have been validated. Reuse the current operation functions and formatter semantics. Extract a small number of modules only where those boundaries require them; do not introduce a command framework or a generic plugin/handler registry.

The intended internal boundary is pure interpretation of supplied argument tokens, followed by existing operation execution. Parsing must not discover a project, initialize native identity, read files, acquire locks, or change the current directory. The exact internal TypeScript representation belongs in the implementation plan; no new public API is proposed. Preserve the current validation precedence, including rejection of unknown options before help. Capture current mixed-invalid/help/version cases before moving branches.

**Smaller alternative: deferred imports only.** Lower initial change surface and directly targets startup, but leaves argument matrices coupled to complete subprocesses. It is useful as the first independently measured change inside the recommended approach.

**Broader alternative: a persistent CLI worker, global caches, or bundling into a new runtime shape.** These can amortize startup but introduce lifecycle, packaging, state, memory, and isolation contracts. They are not justified for the first implementation. Switching tests to compiled output alone would also leave the measured compiled startup problem and native identity costs.

## Test organization by responsibility

Organize assertions by the guarantee they protect, preserving existing public boundaries. A case may have distinct domain and transport assertions; overlap is not by itself redundancy.

| Responsibility                                 | Preferred seam and setup                                               | Must remain observable                                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure algorithms and lexical rules              | In-memory values at the actual algorithm/profile boundary              | Exact semantics, bounds, diagnostic attribution where relevant; representative public integration remains.                                              |
| CLI interpretation and guidance                | Callable argument logic and table-driven named cases                   | Existing precedence, signatures, option values, repeated flags, guidance content, and result categories.                                                |
| Project operations                             | Fresh per-test projects; small fixture helpers or direct operations    | Actual disk bytes, coherent snapshots, acceptance, rollback, stale reads, locked resources, and deliberate invalidity.                                  |
| CLI binary and packaging                       | Real subprocesses and installed artifact checks                        | Output encoding/framing, exit codes, stderr, Node-only/offline execution, current-directory discovery, dynamic import paths, and foreground attachment. |
| HTTP transport                                 | Real loopback server with minimum domain setup needed by the assertion | Origin/Host/authentication, schema version, session/instance-owned handles, replay rejection, correct route dispatch, and responsiveness.               |
| OS identity, locking, process/worker lifecycle | Independent processes and real native facilities                       | True contention, PID reuse, owner death, sharing errors, cancellation, recovery, and shutdown races.                                                    |
| Size/capacity regressions                      | Explicit representative large fixtures                                 | The existing 1,000-member layout boundary and relevant native/worker resource limits.                                                                   |

Start with logical groups and helpers inside existing files. Keep the current top-level discovery working and retain every required default check. Do not silently create a local-only fast suite that hides coverage from CI.

[test-source.mjs](../../app/scripts/test-source.mjs) enumerates only top-level `*.test.ts`, sorts filenames, and partitions by index modulo three. The package scripts also use a top-level glob. Moving tests into nested folders would omit them; adding, removing, or renaming top-level test files changes Intel partition membership without editing YAML. The first phase therefore avoids physical relocation and new top-level test files. A later split of the large CLI file must include explicit old/new discovery and partition manifests, plus an audit of focused workflow file references.

Avoid shared mutable project roots and cloning live `.tbspec` runtime/lock/preview state. Reuse fixture definitions rather than a running server, authenticated session, ownership identity, or mutable project directory. Keep real process isolation for tests that mutate built-ins, environment variables, clocks, or platform identity. Do not enable suite-wide in-process isolation removal as a shortcut.

## Safety and memory constraints that change the design

1. **The caches are not simply missing.** [validation.ts](../../app/src/validation.ts) already has resource/shape maps and deliberately clears `stores`, `active`, and `shapeGraphs` after each target. [inspection-retention.test.ts](../../app/tests/inspection-retention.test.ts) asserts current-target-only retention and empty Stores after the operation. A global parsed-graph cache contradicts this behavior.
2. **No SPARQL declaration does not mean no query engine is needed.** [shacl-execution.ts](../../app/src/shacl-execution.ts) uses `queryBindings` for both explicit constraints and Core range/comparison fallback. Lazy creation must happen at both actual query-use sites; do not select a weaker validation engine from a superficial shape scan.
3. **CLI preview regeneration is a contract.** [The runtime boundary decision](../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md) requires later CLI apply to reacquire/regenerate and accept current impact. Reusing a prior CLI preview to avoid all before/after validation would change that contract. HTTP retained handles have their own exact-byte/session ownership guarantees.
4. **Cache correctness is interpretation-dependent.** Identical bytes may have different base IRIs, parser profiles, blank-node scopes, roles, and source-bound vocabulary contexts. Any reuse must preserve those inputs, project isolation, snapshot revisions, and negative reads.
5. **Native ownership remains real.** [ownership.ts](../../app/src/ownership.ts) already caches a successful identity for the current process; other-process identity must remain verified. Faster tests should reduce unnecessary process starts, not bypass identity, ACL, lock, or recovery checks.
6. **Packaging remains a separate verification surface.** [tsconfig.json](../../app/tsconfig.json) rewrites relative import extensions, and the package runs `dist/cli.js`. Deferred imports must work in emitted and installed files, not just TypeScript source. Existing worker paths, local assets, and version metadata must still resolve without the source tree or a network.

## Autonomous question resolution and discovery frontier

| Question / category                                             | Resolution                                                                                                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is the objective?                                          | Reduce measured local execution work and improve CLI response; later evaluate the pipeline using the same contracts.                                                                                                       |
| Which users/behaviors matter?                                   | End users running compiled CLI, developers running source tests, and consumers of the exact JSON/text/exit contract.                                                                                                       |
| What implementation is already approved?                        | None in this follow-up; investigation is authorized, implementation waits for the approval summary.                                                                                                                        |
| Which interfaces can change?                                    | Proposed internal interpretation/dispatch seams only; public commands and envelopes remain stable.                                                                                                                         |
| Can behavior be simplified while extracting the parser?         | No. Preserve existing precedence; behavioral cleanup is a separate proposal.                                                                                                                                               |
| Can tests or slow platform checks be dropped?                   | No complete deletion is supported; map assertions before replacing any layer.                                                                                                                                              |
| Can all tests share one process/project/server?                 | No. Process, global-mutation, ownership, session, and revision tests require independent state.                                                                                                                            |
| Can parsed data survive arbitrary operations?                   | No. Preserve current memory bounds and coherent read sets; defer cache redesign.                                                                                                                                           |
| Can application checks be skipped because fixtures are trusted? | No production test flags or weaker validation paths. Use cheaper setup and correct test seams.                                                                                                                             |
| What about error cases?                                         | Preserve malformed arguments, failed imports/I/O, invalid snapshots, conflicts, and native lookup failures. Loader errors must still be mapped to the established output categories.                                       |
| What is observable?                                             | Paired uninstrumented wall time, loader/constructor/query counts, peak memory for stateful reuse, source/compiled parity, and complete discovered-test manifests.                                                          |
| How is rollout controlled?                                      | Small separately measurable changes; no dependency/Node/framework migration. Reverse any change whose benefit or contract equivalence is not supported.                                                                    |
| What validates correctness?                                     | Compiler checks, targeted existing tests, added seam-specific regressions, differential full-validation cases for later optimization, one complete local suite after the approved changes, and repository formatting/lint. |
| What remains uncertain?                                         | Achievable lazy-import speedup, actual unused engine count, bounded engine/cache retention, and cross-platform gains. These are explicit experiments, not settled results.                                                 |
| What needs an authority decision?                               | Approval of the first implementation scope; changing public semantics, skipping default coverage, workflow scheduling, or adopting persistent/global state would require a separate decision.                              |

No unresolved preference blocks the proposed first scope once it is approved. Higher-risk optimization branches are deliberately excluded rather than silently assumed safe.

## Proposed assumptions, acceptance, and next action

Proposed assumptions are that public behavior stays stable, all current default coverage remains mandatory, and the initial organization is logical within existing discovered files. These are conservative and reversible; changing them would enlarge the scope. There is no invented end-to-end saving or absolute startup SLA.

For each approved change, compare the same workload and environment before/after using repeated fresh-process or fresh-project runs. Accept a performance change only when the benefit is repeatable relative to run variation and the relevant contracts pass. Use instrumentation to explain the cause, not to report an uninstrumented speedup. Do not add nested span totals or combine percentages from overlapping changes.

The proposed first implementation scope is:

1. Establish the lightweight CLI entry with deferred operation imports and preserve parser/output behavior.
2. Extract the argument seam and reorganize assertions conservatively in existing files; apply the two-model fixture reduction and duplicate-guidance reuse while preserving distinct successful routes.
3. Hoist repeated installed-starter digest loading within the affected coherent capture paths, preserving integrity checks and state lifetime.
4. Instrument real query-engine demand and, if supported, test lazy construction at both query-use sites. Pass-local sharing remains a separate evidence-dependent decision.

Prepare a concrete file-level plan after approval, then implement and measure these items separately. Keep full incremental validation, unbounded parsed-state caching, a persistent CLI service, physical test-tree migration, workflow edits, parallelism changes, dependency migrations, and unrelated Intel regression fixes out of this first scope. Existing Intel timeouts and worker-shutdown failures must remain visible.

The implementation approval summary should ask for approval or corrections to that scope, assumptions, and exclusions before any source change.
