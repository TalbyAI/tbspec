# Third performance iteration

Date: 2026-10-15. Baseline commit: `c59f78c8ab8ffc088177d39ab1ab869931dd1f1b`.

The user approved the auto-grill summary and requested before/after baseline measurements and no remote publication. Continue inline on `feat/mvp-integration`; leave changes uncommitted and unpublished. This plan follows the existing local diagnosis convention. The approved summary supplies the design gate.

## Constraints

Preserve CLI syntax, diagnostic precedence, envelopes, exit codes, offline execution, ownership, revisions, transactions, worker isolation and graph retention. Keep all 47 top-level test filenames and Intel partition membership. Do not change dependencies, workflows, timeouts, concurrency, global caching or the installed application contract.

## Task 1: Capture and measure the baseline

- [x] Inspect recent commits and previous iteration evidence; confirm a clean non-main branch.
- [x] Run root `npm ci` and build the unchanged application before capturing source, tests and emitted JavaScript outside the repository.
- [x] Record source/compiled help, config, model-list and query-list startup samples before changes.
- [x] Run unchanged representative CLI dependency, SHACL and design tests before implementation. Preserve raw TAP, complete sample durations and environment.
- [x] Use the same override hook for both versions in repeated serial comparisons; separate instrumentation from timings and avoid overlapping test/build/package workloads.

## Task 2: Defer operation-only imports

Files: `app/src/inspection.ts`, `app/src/query.ts`, `app/tests/cli.test.ts`, `app/tests/queries.test.ts`.

- [x] Add loader guards for config/model inspection and saved-query management; demonstrate failure before production edits.
- [x] Load `support.ts` only for support listing. Load Comunica and its binding factory inside query execution, preserving normal parser and query validation.
- [x] Verify real execution, nonempty saved-query validation, source and emitted CLI behavior, and loader failure mapping.

## Task 3: Remove repeated integration work

Files: `app/tests/cli.test.ts`, `app/tests/shacl-core.test.ts`, `app/tests/views-cli.test.ts`.

- [x] Merge the simple dependency-update CLI scenario into the manual-support scenario, preserving source reacquisition, stale fingerprint refusal, unchanged bytes before acceptance, apply flags and retained attachments. Keep no-impact update coverage at the direct and installed-artifact boundaries.
- [x] Audit expensive canonical-source and rename scenarios; remove only proven repeated setup or parser-only invocations, preserving unique route and domain assertions.
- [x] Exercise pure SHACL lexical/parameter matrices with `prepareShapes` and `runShapes`; keep representative public checks for diagnostic attribution, preflight failures and integration.
- [x] Fold the foreign-namespace design regression into the existing create/show scenario without losing its triples/appearance assertions.
- [x] Record exact deletions, retained guarantees, discovered cases and unchanged partition manifests.

## Task 4: Measure, verify and review

- [x] Run repeated serial before/after workloads and fresh-process command samples; report medians, ranges and limits, without extrapolating to the entire pipeline.
- [x] Run app typecheck, fresh build, focused checks, one complete serial source suite and the freshly packed installed verifier. Keep functional runs separate from performance samples.
- [x] Review behavior, coverage and measurements; address substantive findings.
- [x] Run root `npm run format` followed by `npm run check`, review the complete diff and record results in English beside this plan.
- [x] Confirm no commit, push, remote publication or workflow change occurred.

## Execution ledger

- Preflight: Node 24.14.1, npm 11.17.0, Windows x64; clean `feat/mvp-integration`. Root installation and unchanged application build passed. Existing dependency audit and third-party build warnings remain unchanged.
- Captured baseline sources, tests and emitted JavaScript under `%TEMP%\tbspec-performance-session-3-c59f78c`, with SHA-256 hashes and environment in `manifest.json`.

- Baseline: all three original-byte workload rounds passed before production edits. CLI body medians are 179.24 s (177.11–207.02 s), SHACL 45.86 s (44.68–47.13 s), design 11.15 s (11.00–12.96 s). Initial source/compiled startup samples are preserved separately.
- TDD: both new loader regressions failed on the original eager imports, then passed after the two production changes. Application typecheck, 34 SHACL/views checks, query checks (13 passed, one platform skip), root format/check and local artifact build/pack passed. These functional checks are excluded from performance samples.
- Review: independent read-only review supports both consolidations and the import boundaries. Canonical-source and rename cases remain intact. Acquired update inventory explicitly includes both retained support files as well as the primary resource.

- Accepted measurements: five alternating fresh-process samples per entry/command and three serial before/after workload rounds. Compiled config/model/query-list medians fell 16.5%/14.8%/33.8%; selected dependency CLI, SHACL Core and design groups fell 21.9%/35.5%/25.6%. All operational/workload ranges are separated locally; these are not whole-pipeline or other-platform gains.
- Final functional verification: the complete serial source suite passed 305 tests including nested cases (302 passes, three platform skips, zero failures/cancellations), with 303 top-level cases in all 47 files. Elapsed time was 39m 18s. The installed verifier passed eight scenarios, 179 assertions, 118 commands and 46 HTTP observations in 12m 08s. Its run overlapped the suite; neither elapsed time is used as a performance comparison.
- Installed coverage: both empty-cache consumer installations succeeded offline. The directory ontology update applied without `--accept-impact`, independently retaining that no-impact CLI guarantee after the source-case consolidation.
- Final state: the durable measurement record and full local inventory are in `session-3/`. Prior measurement records, all 47 filenames and Intel partition membership are unchanged. Source hashes still match the measured/built version. The branch remains `feat/mvp-integration` at the baseline commit with uncommitted changes; no remote publication occurred. Final root formatting/check runs after this ledger update.
