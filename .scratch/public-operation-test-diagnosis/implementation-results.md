# Public-operation performance implementation

Date: 2026-10-15. Baseline commit: `720d3496595f74c1f5c52785965dc7b3b1d33412`.

This implements the first scope accepted after the [hypothesis investigation](hypotheses.md). It improves CLI startup, removes redundant test-process work, reuses verified starter digests within captured operations, and constructs SHACL query engines on demand. The pipeline, dependencies, public command signatures, and test-file partition membership are unchanged.

## Changes and coverage boundaries

| Area                 | Change                                                                                     | Retained verification                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| CLI preparation      | `cli-command.ts` prepares a deferred invocation; operation modules load when it executes   | Loader guards, preparation without project/query work, validation precedence, exact envelope comparison                                  |
| CLI process adapter  | `cli.ts` handles rendering, diagnostics, exits, and deferred foreground console attachment | Real subprocess help/version, text and JSON output, argument errors, offline Node-only invocation, public operation routes               |
| Argument matrices    | Pure guidance and root signature variants use `parseCli` in memory                         | Existing matrix assertions and detailed guidance assertions; semantic invalid base IRIs still execute real CLI operations                |
| Fixture preparation  | Two model-create calls in the schema/shapes scenario use `authorResource` directly         | Model-create CLI coverage elsewhere; schema-add and shapes-create remain real subprocesses in this scenario                              |
| Starter verification | Repair and lifecycle captures keep one lazy digest promise each                            | Fresh verification across captures, locked-graph parsing/integrity, malformed graphs, revisions, rollback, and reference/HTTP operations |
| SHACL                | One local engine is created only when `queryBindings` is actually needed                   | Real Core count, typed comparison, explicit SELECT, regex and validation cases; no shared engine cache                                   |

`version.ts` reads the same installed package metadata as before. `runtime.ts` retains its compatibility export. Query and parameter files are read only when the prepared invocation executes. `support.ts` was inspected and left unchanged because it has no demonstrated repeated starter load within a capture.

The top-level test inventory remains the same 47 filenames. No test was skipped or disabled as an optimization. Six regression tests were added inside existing files. Test coverage here means retained behavioral assertions and public routes; no numerical coverage percentage was collected.

## Verification and measurements

The complete serial source suite passed: **300 tests including nested cases, 297 passed, three platform skips, zero failures or cancellations**. Its 298 top-level cases remain in the same 47 files. The skips are the two native macOS cases and the POSIX-only unsafe-query-filename case. Its 49m 26s wall duration is functional evidence, not a comparable before/after benchmark.

Freshly built JavaScript was packed, installed offline into an isolated consumer, and passed 14 Node-only checks. They cover help/version/guidance, project initialization, configuration, ontology/model/shapes creation, saved-query creation/execution, reference listing, and web start/status/stop. Ordinary commands ran with a network guard; web lifecycle checks allowed local HTTP. No packaging changes were needed.

### Simple CLI startup

Each cell is the median of five sequential fresh processes in milliseconds. Both batches used this machine and Node 24.14.1 with empty `PATH` and `NODE_OPTIONS`; filesystem caches were warm and normal desktop activity was uncontrolled. The original batch preceded implementation; the new batch followed full-suite completion without another benchmark from this task running alongside it.

| Entry    | Command           | Before | After |
| -------- | ----------------- | -----: | ----: |
| Compiled | Help              |  661.4 |  66.3 |
| Compiled | Version           |  667.0 |  65.4 |
| Compiled | Guidance          |  669.6 |  65.0 |
| Compiled | Invalid signature |  654.2 |  67.5 |
| Source   | Help              |  879.5 | 107.0 |
| Source   | Version           |  809.0 | 109.8 |
| Source   | Guidance          |  789.2 | 109.1 |
| Source   | Invalid signature |  822.8 | 110.4 |

Compiled simple-command medians improve by approximately 90%. These commands do not need project operations; this is not a claim that every project command starts or completes ten times faster.

### Representative workloads and engine demand

These comparisons use the original commit's changed source modules, supplied by an in-memory loader hook, and the current source modules. Both modes load the same hook and source map, including CLI subprocesses. No timing profiler runs during these comparisons. The CLI sequence is original/current/current/original. Dependency and HTTP each have one original/current pair. Every execution passed.

| Workload                                                               | Samples per version | Original body time | Current body time | Observed reduction |
| ---------------------------------------------------------------------- | ------------------: | -----------------: | ----------------: | -----------------: |
| CLI schema/shapes validation and removal                               |                   2 |     41.06 s median |    28.87 s median |              29.7% |
| Dependency update requiring acceptance of a new manual SHACL violation |                   1 |            74.51 s |           63.01 s |              15.4% |
| Authenticated repair HTTP workflow                                     |                   1 |            58.58 s |           47.27 s |              19.3% |

CLI controls were 41.60/40.52 s; current samples were 29.22/28.51 s. These results measure the combined implementation, not an independent effect for each change. The single-pair dependency/HTTP observations are indicative and need replication before a statistical conclusion. None of these percentages estimates whole-pipeline savings.

Separate instrumented executions counted real engine construction and query calls:

| Workload    | `runShapes` calls, before and after | Eager engines before, inferred | Engines after, counted | `queryBindings` calls after | Starter loads before → after |
| ----------- | ----------------------------------: | -----------------------------: | ---------------------: | --------------------------: | ---------------------------: |
| Dependency  |                                 552 |                            552 |                     60 |                      10,140 |                      61 → 61 |
| Repair HTTP |                                 308 |                            308 |                     33 |                       5,577 |                     150 → 30 |

The old code constructs one engine per `runShapes` call; its engine totals above are inferred from that code and the original profiled call counts. The new totals are actual constructor counts. Counter installation was recorded in each participating context. Validation counts remain 20 for dependency and 11 for repair HTTP. Dependency graph parsing remains at 6,957 calls. HTTP graph parsing falls from 6,828 to 3,828 calls: removing 120 repeated starter loads eliminates 3,000 installed-starter graph parses. The project-graph parsing and integrity-check paths remain in place.

The counter probe wraps the real engine and records synchronous trace events. It perturbs elapsed time, especially across thousands of query calls. Use its counts for diagnosis; the timing table above comes from separate executions without this instrumentation. The earlier profile used fewer counters, so its elapsed spans are not a directly comparable timing control.

All samples, summaries, allocation counts, methods, and raw temporary log locations are in [implementation/measurement.json](implementation/measurement.json). The complete new top-level inventory is in [implementation/local-tests.csv](implementation/local-tests.csv). Earlier measurement records are preserved.

The constructor-count regression failed against eager construction, then passed with zero engines for Core count-only work and real engines for typed comparison and SELECT. The repair inventory-read regression observed 27 reads before reuse and now enforces at most three per operation, including independent interpretation and validation checks. Lifecycle impact observed 26 before reuse and now enforces at most two. These limits preserve the independent verification stages rather than removing them.

Twenty-three preparation/output cases matched the original compiled CLI's JSON envelopes and exit statuses exactly before rebuilding it. Seven focused CLI cases passed, including query and configuration routes. Application typecheck passed twice and a fresh build passed. One independent implementation review reported no correctness findings.

Root `npm ci`, `npm run format`, and `npm run check` passed. No dependency, lockfile, workflow, or existing top-level test filename changed.

## Reproduction

From the repository root, install root tooling with `npm ci`. Application dependencies are independent and must already be installed with `npm ci` from `app/`. From `app/`, run:

```powershell
npm run typecheck
npm run build
node --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.ts'
node --test --test-concurrency=1 --test-name-pattern='^CLI validates, lists shapes and confirms schema removal offline with exact signatures$' tests/cli.test.ts
node --test --test-concurrency=1 --test-name-pattern='^dependency update requires impact acceptance for a new manual SHACL violation$' tests/dependencies.test.ts
node --test --test-concurrency=1 tests/repair-web.test.ts
```

Startup probes invoke the absolute Node executable against `src/cli.ts` and freshly built `dist/cli.js`, with an empty `PATH` and `NODE_OPTIONS`, using help, version, guidance, and invalid arguments. Run timing probes sequentially without the full suite or another benchmark running concurrently.

## Limits and next steps

Measurements describe this Windows x64 machine with Node 24.14.1. They do not predict hosted CI savings or establish Linux/macOS compatibility. The prior same-commit CI inventory remains the complete cross-platform baseline. The known Intel-only failures were outside this implementation's scope and have not been hidden or corrected.

The full-suite run includes concurrent build/packing/install verification during part of its execution; its wall time is functional verification evidence, not an isolated before/after benchmark. Inclusive profiling spans overlap and cannot be summed into total savings. There is no completed local full-suite baseline suitable for a percentage comparison.

The largest current local file totals are CLI 668.5 s, dependencies 321.1 s, web 312.4 s, repair 219.8 s, element deletion over HTTP 177.5 s, and resource lifecycle 162.3 s. These sum top-level test-body durations and exclude runner/module overhead. Their measurements belong to the functional full-suite run, including its stated overlap; they guide investigation rather than establish a controlled comparison with historical CI.

A next hypothesis is that many of the remaining 10,140/5,577 query calls repeat the same comparison work. Classify calls at the Core-comparison and explicit-SELECT sites and measure repeated query/binding pairs before designing batching or bounded reuse within a validation. This hypothesis is untested; typed-literal semantics and retention limits need dedicated verification.

Further reductions in repeated whole-project validation require a separate design that preserves validation freshness, preview fingerprints, revision checks, and graph retention. Further CLI fixture simplification should retain a real subprocess check for every distinct successful route. Pipeline repartitioning should use measured file cost rather than equal file counts after these local changes have been reviewed.
