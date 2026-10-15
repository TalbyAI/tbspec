# Second performance iteration

Date: 2026-10-15. Starting commit: `829d0b129defc850a6ddf352a37bf158fb7ca389`.

The user approved the discovery summary with “Aprobado.” This ledger resumes the completed first iteration; it does not reopen its tasks. Execute inline in the existing `feat/mvp-integration` checkout. Keep all work uncommitted and unpublished.

## Goal and constraints

Reduce unnecessary test subprocesses and CLI operation loading, and investigate repeated SHACL comparisons. Preserve public commands, diagnostic precedence, output, offline behavior, native ownership, sessions, revisions, transaction checks, and graph retention. Preserve all 47 top-level test filenames and partition membership. Do not change dependencies, workflows, concurrency, or hosted CI runs. No global graph/engine cache or unchecked JavaScript replacement of typed comparisons.

The Windows shutdown failure and Intel partition slowdown are reliability and measurement questions, not established consequences of the first optimization. One focused local shutdown execution passed before implementation. A single hosted pair cannot establish causality or a passing-pipeline speedup.

## Task 1: Reproduce the worker shutdown interleaving

Files: `app/tests/web.test.ts`, conditionally `app/src/server.ts`.

- [x] Trace recovery, runtime publication, and stop ordering. Gate the existing shutdown test at the runtime-record rename to expose publication before the in-memory transition, without sleeps or weakened assertions.
- [x] Run `node --test --test-concurrency=1 --test-name-pattern='^dependency worker shutdown settles' tests/web.test.ts` from `app/`; retain the failing assertion before any production fix.
- [x] If reproduced, prevent replacement workers once stop is requested, preserving registration failure/retry behavior. Run shutdown and normal recovery cases.

## Task 2: Measure and reduce operational CLI loading

Files: `app/tests/cli.test.ts`, conditionally the measured import boundary in `app/src/validation.ts` or `app/src/shacl-execution.ts`.

- [x] Capture starting source bytes and uninstrumented fresh-process startup samples in a new temporary evidence directory. Measure help/version and operational command latency; use loader guards to distinguish module demand from project execution. Operational elapsed times include project reads and are not isolated import timings.
- [x] Use a loader guard to demonstrate unnecessary heavy loading before changing its boundary. Demand-driven imports must retain real typed Core comparison and SELECT execution, including emitted JavaScript.
- [x] Audit remaining invalid-signature matrices in `cli.test.ts`; move only parser assertions to the existing `interpret` helper. Retain every distinct successful subprocess route and representative process errors/output.
- [x] Compare baseline/current with the same loader and repeated paired samples; record every sample and environment. Reject unsupported changes.

## Task 3: Classify SHACL queries before selecting an optimization

Files: temporary instrumentation; conditionally `app/src/shacl-execution.ts` and existing `app/tests/shacl-core.test.ts`.

- [x] Count Core comparison versus explicit SELECT calls and repeated query/binding pairs in the dependency and repair HTTP workloads. Keep instrumented runs separate from timings.
- [x] Select bounded reuse only if duplicate work is demonstrated. Scope it to one `runShapes` call, preserve term type/language/datatype/lexical value and operator, and avoid caching graph-dependent SELECT results or transient errors.
- [x] Before production changes, add a failing count-based regression in the existing SHACL file. Check invalid literals, date/time behavior, independent and concurrent datasets, and the retention bound.
- [x] Measure representative workloads with at least three uninstrumented pairs. Record variability rather than inventing a pipeline percentage.

## Task 4: Validate and report

- [x] Run application typecheck, fresh build, relevant focused suites, and one complete serial local suite. Verify the freshly packed installed artifact where imports are affected.
- [x] Root `npm ci` precedes quality tooling. Run `npm run format`, resolve findings manually, then `npm run check`; review the full diff.
- [x] Review correctness and scope; retain original measurement records. Write `session-2-results.md` in English with commands, sample counts, raw evidence locations, coverage boundaries, and remaining Intel uncertainty.
- [x] Verify cleanly scoped changes and unchanged top-level discovery; do not commit, push, merge, rerun hosted CI, or edit workflows.

## Execution ledger

- Preflight: starting branch is `feat/mvp-integration`; worktree was clean. Root `npm ci` passed. Application dependencies are present; runtime is Node 24.14.1 on Windows x64. PR #23 was refreshed and linked to this thread.
- Design ruling: the approved auto-grill summary supplies the discovery/design gate. Keep this plan beside the existing diagnosis under the repository's local Markdown issue convention, and execute the already authorized work without another approval gate.
- Task 1: dependency shutdown reproduced the exact `2 !== 1` assertion with deterministic publication/termination barriers, then passed with stop-request guards. Independent review identified the same inspection recovery gap; its new case also reproduced `2 !== 1` before adding guards before replacement and after readiness. Preserve existing registration/ownership checks and failure retry behavior.
- Task 2: Comunica load guard failed before lazy imports and passed afterward; real typed comparisons and SELECT constructor checks pass. An AST-based audit proved all 19 moved cases reject synchronously in `parseCli`. Three semantic-invalid authoring cases remain real subprocesses using their project root.
- Task 3: dependency Core queries fell from 2,880 to 140 while 7,260 SELECT calls stayed unchanged. Proper worker instrumentation measured HTTP Core queries 1,584 to 77 with 3,993 SELECT calls unchanged. Counter timings are excluded. The count regression observed 12 repeated calls before reuse and one afterward. Reuse retains at most 256 keys of at most 2,048 UTF-16 code units per `runShapes`, preserves exact terms/operators, and does not retain thrown failures.
- Review: one independent read-only reviewer found the semantic-invalid test cases and inspection recovery gap. Both are addressed and the completed full suite covers the fixes. No outstanding review finding remains.
- Measurements: five paired startup samples per entry/command show compiled model-list/config-show medians 29.1%/30.6% lower. Three workload pairs show CLI 17.2% lower, but overlapping dependency/HTTP timings do not establish a reliable latency gain. A synthetic repeated-Core workload improves 60.0% in three uninstrumented pairs; it is explicitly separate from end-to-end timings. See `session-2-results.md` and temporary raw evidence.
- Final verification: the complete serial source suite passed at 2026-10-15 14:38 UTC with 304 tests (301 passed, three platform skips, no failures/cancellations), 302 top-level cases, and 40m 44s elapsed. Its first 11m 45s overlapped the installed-artifact verifier, which passed eight scenarios, 179 assertions, 118 commands, and 46 HTTP observations. These overlapping functional runs are excluded from performance comparisons. No verification process remains active.
- Evidence: `session-2/measurement.json` and `session-2/local-tests.csv` preserve accepted samples, environment, profiles, discovery/partition manifests and complete local inventory. All 47 original top-level filenames remain, partition sizes are 16/16/15, and the captured compiled-module emitter matches actual `tsc` output byte-for-byte. Prior measurement records are unchanged. Final formatting/check output is retained with the temporary raw logs.
