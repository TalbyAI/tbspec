# Second performance iteration results

Date: 2026-10-15. Starting commit: `829d0b129defc850a6ddf352a37bf158fb7ca389`.

This continues the completed first iteration under the [approved second-iteration plan](session-2-plan.md). Changes remain uncommitted and unpublished on `feat/mvp-integration`. No workflow, dependency, lockfile, or top-level test filename changed.

## Changes and coverage

- SHACL imports Comunica and its bindings factory only when Core comparison fallback or explicit SELECT actually needs them. Core count-only work now loads neither package. One query context still belongs to one `runShapes` call.
- Completed Core expression results are reused only within that same call. Keys preserve both RDF terms' type, lexical value, language and datatype, plus the comparison operator. Retention stops at 256 entries; keys longer than 2,048 UTF-16 code units are not retained. Thrown failures are not cached. Arbitrary SELECT queries still execute normally against their dataset.
- Nineteen invalid-signature assertions use the existing in-memory CLI interpretation seam. An independent AST-based audit confirmed every moved case throws `ARGUMENT_INVALID` during `parseCli`, before `execute()`. Semantic-invalid model type/profile/schema cases remain subprocesses with the original project root. Distinct successful CLI routes, unique schema-add/shapes-create coverage, process errors, stdout/stderr, exit statuses, and offline checks remain.
- Both dependency and inspection recovery refuse replacement workers after stop is requested. They also refuse posting new work after readiness if stop has begun. Existing runtime ownership/publication checks and failed-publication retry behavior remain.

The shutdown root cause is a publication interval: `replaceRuntime` can publish `stopping` on disk while the server's in-memory `record.state` is still `running`. Recovery previously checked only the latter. The existing stop promise now supplies the synchronous stop-request guard without moving or weakening registration checks.

The regression gates the rename completion after publishing the stopping record, resumes failed-worker recovery in that interval, and checks that only one worker was created. Both worker families reproduced the exact `2 !== 1` assertion before the corresponding fix. Six normal recovery/shutdown cases pass afterward. This demonstrates the defect locally; it does not independently prove every earlier hosted failure had the same cause.

## CLI command latency

Five sequential fresh processes per version, entry and command, alternating batches in the order baseline/current/current/baseline/baseline/current/current/baseline/baseline/current. Both modes preload the same source-override hook. Baseline sources come from the starting commit; compiled baseline overrides use the installed TypeScript compiler with the application's target/module/import-extension settings. Commands select the same initialized empty project. `PATH` is empty. No other benchmark, suite, build or package verification from this task overlaps this accepted batch. Filesystem caches are warm and desktop activity is uncontrolled.

These are complete command elapsed times, including project reads and process/module startup. They do not isolate module-loading time.

| Entry    | Command       |         Before median, range |          After median, range | Median reduction |
| -------- | ------------- | ---------------------------: | ---------------------------: | ---------------: |
| Source   | `model list`  | 1,522.5 ms (1,457.8–1,828.1) | 1,134.2 ms (1,111.9–1,181.3) |            25.5% |
| Source   | `config show` | 1,425.3 ms (1,353.2–1,768.2) | 1,037.2 ms (1,006.4–1,105.0) |            27.2% |
| Compiled | `model list`  | 1,500.7 ms (1,397.7–1,724.6) | 1,063.3 ms (1,024.8–1,168.9) |            29.1% |
| Compiled | `config show` | 1,395.8 ms (1,354.7–1,448.0) |     968.3 ms (963.2–1,027.4) |            30.6% |

Compiled help/version medians remain around 70 ms (74.7/73.4 ms before, 71.6/72.3 ms after). Their small differences overlap observed variation and are not evidence of a further meaningful improvement. Source help is also effectively unchanged.

## Query classification

Separate instrumented executions count actual calls and repeated query/binding pairs within each engine. Counter elapsed times are excluded from timing comparisons. The HTTP probe explicitly installs the hook in both server workers and writes counts before termination; its installation records identify all participating contexts.

| Workload                     | Engines before/after | Core calls before | Distinct Core pairs within runs | Core calls after | SELECT calls before/after |
| ---------------------------- | -------------------: | ----------------: | ------------------------------: | ---------------: | ------------------------: |
| Dependency impact acceptance |              60 / 60 |             2,880 |                             140 |              140 |             7,260 / 7,260 |
| Repair HTTP                  |              33 / 33 |             1,584 |                              77 |               77 |             3,993 / 3,993 |

There are also repeated SELECT pairs (3,660 distinct pairs among 7,260 dependency calls and 2,013 among 3,993 HTTP calls). This iteration deliberately preserves their execution: arbitrary graph-dependent query reuse needs a separate design.

The bounded-cache regression fails with 12 Core calls before reuse and passes with one afterward. It verifies separate concurrent runs, exact lexical/datatype/language keys, invalid integers, infinity/NaN, date-time timezone behavior, the 256-entry limit, oversized-key bypass, and retry after a thrown query failure. The loader regression fails on the old eager import and passes with count-only work; the existing real-engine regression still exercises typed Core comparisons and SELECT.

## Validation and representative timings

Three uninstrumented pairs per workload run serially in the order baseline/current/current/baseline/baseline/current, using the same source hook in both modes, including server workers and CLI subprocesses. Every execution passed. No suite, build, other benchmark or package verification from this task overlapped these samples. Each cell reports top-level test-body elapsed time, excluding test-runner/module startup.

| Workload                             |  Before median, range |   After median, range | Median reduction |
| ------------------------------------ | --------------------: | --------------------: | ---------------: |
| CLI schema/shapes validation/removal | 22.91 s (22.20–23.16) | 18.98 s (18.92–20.71) |            17.2% |
| Dependency impact acceptance         | 65.48 s (65.43–67.69) | 64.10 s (63.23–71.38) |             2.1% |
| Authenticated repair HTTP            | 41.64 s (40.88–42.90) | 40.23 s (39.12–43.16) |             3.4% |

Only the CLI workload has separated before/after ranges in this small sample. Dependency and HTTP observations overlap substantially; they do not establish a reliable end-to-end latency improvement. Query count reduction must not be presented as an equivalent timing reduction.

A separate synthetic Core workload isolates the work affected by reuse: 32 focus nodes with the same integer value, two range comparisons per focus, and ten `runShapes` calls per sample after one untimed warmup. It performs no project I/O. Three uninstrumented fresh-process pairs reduce the ten-call median from 750.8 ms (743.0–766.6) to 300.5 ms (299.4–304.0), or 60.0%. This supports the bounded comparison optimization itself; it does not predict whole-operation or pipeline savings. The engine still performs actual typed queries for each distinct comparison.

The fresh packed artifact passed the complete installed-application verifier: eight scenarios, 179 assertions, and 118 commands, including offline installation and loopback HTTP checks. It ran from a separate consumer installation with the ordinary Node-only restrictions. Packaging used freshly built JavaScript and the unchanged bundled production dependency graph.

The complete serial source suite passed: **304 tests including nested cases, 301 passed, three platform skips, zero failures or cancellations**. It contains 302 top-level cases in the unchanged 47 files. The four added top-level cases cover lazy dependency loading, bounded comparison reuse, and the two inspection-worker shutdown scenarios. The skips remain the two macOS-only native cases and the POSIX-only unsafe-query-filename case.

The suite took 40m 44s. Its first 11m 45s overlapped installed-artifact verification; this elapsed time is functional evidence, excluded from the isolated comparisons above. There is no comparable second-iteration full-suite baseline, so no full-suite speedup percentage is claimed.

Application typecheck, fresh build, focused SHACL regressions, six worker recovery/shutdown cases, root `npm ci`, `npm run format`, and `npm run check` passed. Build output retains its existing third-party directive/chunk-size warnings; the installed verifier emitted an existing Node child-process deprecation warning. No unsafe formatting fixes, lint rule changes, or timeout increases were used.

An independent read-only review identified the semantic-invalid authoring cases and the inspection recovery gap. Both are corrected and covered by the completed suite. No outstanding review finding remains.

From `app/`, the main functional checks are:

```powershell
npm run typecheck
npm run build
node --test --test-concurrency=1 --test-reporter=tap 'tests/*.test.ts'
node --test --test-concurrency=1 --test-name-pattern='worker shutdown settles|a failed .* worker recovers' tests/web.test.ts
```

The packed-artifact verifier ran through `npm run verify:packed -- <fresh-archive.tgz> <evidence.json>` with its matching SHA-256 sidecar. Its complete sanitized evidence remains in the temporary evidence directory.

## Evidence and limits

Raw logs, temporary comparison/profiling helpers, captured baseline sources, startup samples and parser audit are under `%TEMP%\tbspec-performance-session-2-829d0b1`. The accepted startup samples are `startup.json` and `startup-summary.json`; the earlier overlapping startup probe and invalid compiled-override probe are retained separately and excluded. Workload samples are `workloads.json` and `workload-*.tap`; the synthetic Core samples are `core-paired.json`. Dependency profiles are `dependency-{baseline,current}-profile.ndjson`. Accepted HTTP profiles are `repair-http-{baseline,current}-workers-validated.ndjson`; earlier incomplete worker-counter probes are excluded.

The durable [measurement record](session-2/measurement.json) preserves all accepted startup/workload/Core samples, counter summaries, methods, environment, discovery and partition manifests, and completed verification summaries. The [local test inventory](session-2/local-tests.csv) records all 302 top-level cases and their file/body durations. These records are excluded from formatting; earlier iteration measurements remain untouched. The compiled override emitter was checked byte-for-byte against the actual current `tsc` output for all three captured production modules.

Environment: Windows x64 `10.0.26200`, Intel Core i9-10900K, Node 24.14.1. These local results do not establish hosted or macOS performance. The earlier Intel partition slowdown remains unexplained; neither runner variability nor a code regression has been established as its cause. No hosted CI run, retry, workflow edit, publication, or merge was performed.
