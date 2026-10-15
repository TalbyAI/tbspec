# Third performance iteration results

Date: 2026-10-15. Baseline commit: `c59f78c8ab8ffc088177d39ab1ab869931dd1f1b`.

This implements the [approved third-iteration plan](session-3-plan.md). The implementation and measurements were completed locally on `feat/mvp-integration` before publication was authorized. No workflow or dependency changes were made. The [coverage review](session-3-coverage.md) records which repeated integrations are removed and which guarantees remain.

## Production changes

- Inventory and configuration inspection load `support.ts` only for shapes/schema listing. Ordinary inventory/configuration no longer imports validation, SHACL, the SPARQL parser or XPath regex support through that unused branch.
- Saved-query management loads no Comunica execution dependencies. Actual query execution imports the real engine and bindings factory inside the existing error boundary, after validating input and verifying captured reads. Query data and bindings retain their existing semantics.

The two fresh-process loader regressions failed on the original eager imports and pass after these changes. The query regression also verifies nonempty saved-query save/list/show/remove, rejection of an unsafe query and the established `unavailable`/`IO_FAILURE` envelope when execution dependency loading fails. Existing tests still execute real bound queries.

## Command latency

Five fresh-process samples per version, entry and command, alternating baseline/current in the order baseline/current/current/baseline/baseline/current/current/baseline/baseline/current. Both versions use the same synchronous source-override hook and perform its extra authored-source read. Baseline source, tests and fresh emitted JavaScript were captured before production changes, with hashes. Current samples use the freshly built JavaScript. Both modes select the same initialized empty project, use an empty `PATH`, and perform normal native identity checks.

These measurements include complete command startup, project access and shutdown. They do not isolate import time or establish a latency guarantee for populated projects. No test, build, package verifier or other benchmark from this task overlapped these accepted command samples. Filesystem caches are warm and ordinary desktop activity is uncontrolled.

| Entry    | Command       |        Before median (range) |     After median (range) | Median reduction |
| -------- | ------------- | ---------------------------: | -----------------------: | ---------------: |
| Source   | `config show` | 1,068.9 ms (1,037.6–1,133.7) |   860.4 ms (842.5–869.3) |            19.5% |
| Source   | `model list`  | 1,150.4 ms (1,126.9–1,194.7) | 953.8 ms (931.7–1,031.1) |            17.1% |
| Source   | `query list`  | 1,456.6 ms (1,385.6–1,478.8) | 983.1 ms (962.3–1,031.2) |            32.5% |
| Compiled | `config show` |       952.1 ms (928.0–978.1) |   795.2 ms (769.4–834.8) |            16.5% |
| Compiled | `model list`  | 1,047.4 ms (1,004.9–1,073.1) |   892.0 ms (851.3–956.7) |            14.8% |
| Compiled | `query list`  | 1,370.3 ms (1,310.4–1,388.5) |   907.4 ms (875.9–948.6) |            33.8% |

All six operational before/after ranges are separated in this small local sample. Help/version ranges overlap; their small variations are not evidence of a meaningful change. Compiled help medians are 70.5/67.4 ms and version medians 69.2/66.7 ms.

Separate loader traces confirm the mechanism: config/model listing now resolves none of the traced support/validation/SHACL/SPARQL/regex modules. Query listing still loads the parser/profile required to validate saved queries but resolves no Comunica package. These traces are excluded from timing comparisons.

## Test consolidation and validation

Three serial unchanged-workload baseline rounds passed before production edits, followed by three passing current rounds. Both versions use the same source-override hook, including their spawned CLI processes, and fresh per-test projects. Each cell sums top-level test-body elapsed time, excluding file loading and test-runner startup. No test, build, installed verifier or other benchmark from this task overlapped these samples. The batches were taken before/after rather than randomized or alternated; ordinary desktop activity remains a source of variation.

| Workload                                                                |    Before median (range) |     After median (range) | Median reduction |
| ----------------------------------------------------------------------- | -----------------------: | -----------------------: | ---------------: |
| Dependency CLI group, three cases consolidated into two                 | 179.24 s (177.11–207.02) | 140.06 s (139.89–144.20) |            21.9% |
| Entire SHACL Core file, including the new public attribution case       |    45.86 s (44.68–47.13) |    29.56 s (28.94–30.16) |            35.5% |
| Design create/show and namespace group, two cases consolidated into one |    11.15 s (11.00–12.96) |       8.29 s (8.10–8.55) |            25.6% |

All three ranges are separated in this local sample. These reductions combine less repeated test work and the production import changes; they are not an isolated measurement of either contribution. The CLI group includes the retained canonical-source case as well as the merged update/support case. No full-suite or pipeline speedup percentage is claimed.

The standalone dependency-update CLI case is folded into manual support, retaining operation/acquired inventory, preview immutability, source reacquisition, stale fingerprint refusal, missing-impact refusal, successful acceptance and exact resulting snapshot bytes. The new fixture includes both support attachments in its acquired inventory. Canonical-source and rename cases remain intact after review because their checks are distinct.

The design namespace case shares the existing initialized project and creation but keeps both real `design show` calls: one asserts an empty design before editing, the other checks foreign triple retention without appearance projection.

All lexical patterns, values, flags and malformed-shape matrix entries remain, tested directly through `prepareShapes`/`runShapes`. Representative public validation now explicitly checks successful completion, violation attribution and incomplete validation for a malformed shapes graph. Existing public severity, Unicode length, typed comparisons and SPARQL/path checks remain.

Functional verification passed: application typecheck; 34 SHACL/views tests; query checks with 13 passes and one platform skip; fresh build/pack; root `npm ci`, `npm run format` and `npm run check`. The installed-artifact verifier passed all eight scenarios: 179 assertions, 118 commands and 46 HTTP observations. Both consumer installations succeeded offline with empty npm caches. The installed CLI also previewed and applied the directory ontology update without `--accept-impact`, preserving the no-impact route covered by the removed standalone source test. The verifier completed in 12m 08s. It overlapped the complete serial source suite after accepted measurements; their durations are functional evidence only. The complete serial source suite passed in 39m 18s: **305 tests including nested cases, 302 passed, three platform skips, zero failures or cancellations**. It contains 303 top-level cases in the unchanged 47 files; the [complete local inventory](session-3/local-tests.csv) records their individual outcomes and body durations. The skips are the two macOS-native cases and the POSIX-only unsafe-query-filename case. No comparable full-suite baseline was taken in this iteration, so this elapsed time does not establish a full-suite speedup.

## Evidence and limits

The durable [measurement record](session-3/measurement.json) preserves all accepted startup/workload samples, summary ranges, source hashes, environment, import traces, functional verification summaries and discovery/partition manifests. Prior measurement values are unchanged; publication preparation replaces developer-specific path prefixes with `%TEMP%` and `<repo>` in three earlier records, addressing PR review feedback.

Temporary evidence: `%TEMP%\tbspec-performance-session-3-c59f78c`. It contains hashed baseline files, the common source override and measurement runner, initial pre-change startup samples, accepted `startup-paired.json`, `startup-summary.json`, separate `imports.json`, baseline/current workload TAP and sample records, and red/green loading regressions. Initial startup batches remain separate from the accepted alternating comparison. The archive and its SHA-256 sidecar are in its `packed` subdirectory; packing invokes a fresh build and does not publish anything.

Environment: Windows x64 `10.0.26200`, Intel Core i9-10900K, 20 logical CPUs, Node 24.14.1, npm 11.17.0. No hosted or other-platform performance is established. All 47 top-level test filenames and the 16/16/15 Intel partition manifests remain unchanged. Security, ownership, rollback, worker lifecycle, stale-revision and large-boundary regressions are retained.

The measured source/emitted hashes still match the final code. Independent read-only reviews found no blocking coverage, import-cycle or captured-read issue. The build retains its existing third-party directive/chunk-size warnings, and the installed verifier emitted the existing Node child-process deprecation warning. No test timeout, lint rule, dependency version or workflow changed.

## Publication follow-up

The user subsequently authorized publication to the existing PR and a hosted pipeline comparison. The latest existing full pipeline is run `38719332329` at `829d0b1`; it predates both the second and third iterations. Any comparison against that run therefore measures their combined changes and runner variability, rather than isolating the third iteration. The Windows source job failed in that reference run; its elapsed time is not a successful full-suite baseline.
