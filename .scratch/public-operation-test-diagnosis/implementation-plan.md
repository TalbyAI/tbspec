# CLI and public-operation performance implementation plan

> **For agentic workers:** Execute this approved plan inline with the executing-plans and test-driven-development skills. Keep this ledger current after verification; do not repeat completed tasks after compaction.

**Goal:** Improve CLI startup and public-operation test execution while preserving the contracts approved in [hypotheses.md](hypotheses.md).

**Architecture:** The CLI process adapter interprets arguments through an importable, side-effect-free preparation function and executes the resulting deferred operation. Heavy operation families load only during execution. Starter digest reuse belongs to one captured snapshot; SHACL query engines remain local to one `runShapes` call and are constructed only at query-use sites.

**Tech stack:** Existing Node 24, TypeScript, node:test, RDF.js, SHACL/Comunica packages; no dependency changes.

## Global constraints and rulings

- Approval: user accepted the investigation summary with “De acuerdo.” Implement its first scope without another approval gate.
- Preserve all public commands, validation precedence, JSON/text framing, diagnostics, exit categories, offline behavior, native ownership, preview regeneration, transaction/revision checks, and current graph-retention limits.
- Preserve the top-level test filenames and default discovery/partition membership. Do not edit the pipeline or disable coverage.
- No global graph or query-engine cache, persistent CLI worker, incremental validation, dependency update, or unrelated Intel regression fix.
- Ruling: continue in the existing `feat/mvp-integration` checkout with its ongoing diagnostic artifacts; no other implementation writer is active. The branch is not `main`. Do not commit, push, or publish as part of this task.
- Ruling: keep this plan and its ledger beside the approved `.scratch/` investigation, following the repository's existing feature-document convention. Execute inline; the approval already authorizes the resulting implementation.
- Pre-flight: tasks 1 and 2 share `parseCli`; tasks 3 and 4 change operation internals only and must not alter its interface. Final validation covers their composition.

## Task 1: Lightweight process entry and deferred CLI preparation

Status: Complete.

**Files:** Create `app/src/cli-command.ts` and `app/src/version.ts`; modify `app/src/cli.ts`, `app/src/runtime.ts`, and `app/tests/cli.test.ts`.

**Consumes:** Existing command signatures, operation functions, `Result`, and output rendering.

**Produces:** `parseCli(argv: readonly string[]): CliInvocation`, where `CliInvocation` contains `json: boolean`, `foreground: boolean`, `initialized: boolean`, and `execute: () => Promise<Result>`. Parsing can throw `ProjectError`; valid operations are deferred and do not run while parsing.

- [x] Add a child-process loader guard to the existing CLI tests: help, version, guidance, and invalid signatures must not resolve operation modules. Run it against the original eager CLI and observe the forbidden-module failure.
- [x] Move the existing argument/signature logic without reordering branches. Replace each operation return with a deferred async closure that imports its owning module, then calls the existing function with the unchanged arguments. Query file reads must remain inside the closure.
- [x] Keep CLI rendering/exit behavior in `cli.ts`; execute the prepared invocation and lazily import console attachment only for a successful foreground web operation.
- [x] Move installed-package version reading to `version.ts`; preserve `runtime.ts`'s exported `applicationVersion` compatibility.
- [x] Check source CLI behavior and run `npm run typecheck` from `app`. Compare source/compiled startup after a real build in final verification.

## Task 2: In-memory argument matrices and conservative fixture setup

Status: Complete.

**Files:** Modify `app/tests/cli.test.ts`; keep other test files in place.

**Consumes:** Task 1's `parseCli` and deferred `execute` interface.

**Produces:** The existing assertion matrix at the appropriate boundary, retaining real process checks for unique routes and OS/output guarantees.

- [x] Test that preparing valid project/query invocations does not read query files, create files, change the current directory, or execute project operations. Retain mixed-invalid/help/version precedence checks.
- [x] Move pure guidance and syntactic-error variants to direct `parseCli`/immediate-result calls. Retain process smoke checks for success, argument-error stderr/exit behavior, plain text, JSON framing, Node-only/offline execution, and every unique successful operation route. Keep semantic init base-IRI errors as real operation tests.
- [x] Replace only the first two model-create fixture subprocesses in the schema/shapes validation case with `authorResource`; keep schema-add and shapes-create as subprocesses. Reuse the already checked guidance result instead of invoking it twice.
- [x] Run the affected focused CLI cases. Record the coverage mapping and verify no top-level test file was added/removed/renamed.

## Task 3: Capture-local verified starter digest reuse

Status: Complete.

**Files:** Modify `app/src/repair.ts`, `app/src/resource-lifecycle.ts`, `app/tests/repair.test.ts`, and `app/tests/resource-lifecycle.test.ts`. Inspect `app/src/support.ts`; change it only if a repeated per-capture load is demonstrated.

**Consumes:** Existing captured snapshot, lock records, `loadStarters`, and `parseGraph` integrity/vetting checks.

**Produces:** Lazy `Promise<string>` digest state on the internal capture, released with that capture; all project graphs are still verified and parsed as before.

- [x] Add a real-operation regression that bounds installed-starter inventory reads during reference inspection. Watch the original per-locked-graph behavior exceed the three-load budget for interpretation, validation, and reference parsing.
- [x] Store the lazy verified digest on the existing internal repair snapshot and use it for each locked graph, without retaining a mutable starter bundle or parsed project Store.
- [x] Apply equivalent reuse to lifecycle reference scanning on its captured snapshot. Preserve lazy loading so owned-only work does not acquire unrelated installed resources earlier.
- [x] Check relevant reference, integrity, malformed-graph, RDF/XML, revision, rollback, and HTTP repair cases. Reprofile the original HTTP repair workload with the existing diagnostic hook.

## Task 4: Demand-driven SHACL query-engine construction

Status: Complete.

**Files:** Modify `app/src/shacl-execution.ts` and `app/tests/shacl-core.test.ts`.

**Consumes:** Existing `runShapes` and both `queryBindings` use sites: explicit SHACL SELECT and Core comparison fallback.

**Produces:** A query engine created at most once per `runShapes` call, only if that call actually executes a query. No engine survives the call through a new shared cache.

- [x] Add an isolated constructor-count regression using the real engine: Core count-only validation constructs zero engines, while numeric comparison and explicit SELECT still construct engines and produce their real violations. Observe the eager constructor fail the zero-engine assertion.
- [x] Replace the eager constructor with a local lazy getter used at both query sites.
- [x] Run the Core/SPARQL/regex and validation retention cases. Record actual engine demand on the original dependency and repair workloads; retain the change only if reduced construction is demonstrated.

## Task 5: Combined verification, evidence, and review

Status: Complete.

- [x] Run application typecheck/build and a complete serial source suite, redirecting verbose logs to a local temporary evidence directory. Diagnose failures before attributing them to this change; preserve the known Intel-only failure visibility.
- [x] Compare uninstrumented startup and representative CLI/direct/HTTP timings against the existing baseline; record repetitions, medians, counts, and limitations in a new result artifact. Preserve earlier raw measurement files unchanged.
- [x] Pack and install the artifact offline into a fresh temporary consumer; verify deferred imports, version/help, project initialization, and representative public routes from installed JavaScript with Node-only invocation.
- [x] Run one independent review of the final implementation and its connected contracts; resolve material findings and rerun the corresponding checks.
- [x] Run root `npm ci`, `npm run format`, and `npm run check`; inspect the final diff for unrelated changes and test-discovery drift.

## Execution ledger

- Plan created before source changes. Existing measured baselines: compiled simple CLI approximately 0.66 s; two-model fixture reduction 10.0%; repair HTTP 150 starter loads; original dependency test 552 `runShapes` calls.
- Task 1: loader-guard regression failed on eager `authoring.ts` resolution, then passed after deferred preparation. Application typecheck passed. Exact envelope parity passed for 23 source invocations against the unchanged original compiled CLI.
- Task 2: seven focused CLI tests passed, including query/configuration routes, preserved process output, pure preparation, and schema/shapes validation. No test file was moved or added.
- Task 3 ruling: initial whole-operation expectation of one starter read was too strict. `listReferences` legitimately verifies starters for interpretation and validation as well as reference parsing; retain those checks and cap total reads at three per operation. The original implementation measured 27. Lifecycle impact measured 26 before reuse and passed its two-load budget afterward.
- Task 4: the constructor regression failed with one eager engine on Core count-only work. It passed after lazy construction, including real typed comparison and SELECT violations; no engine sharing was introduced.
- Task 3 ruling: `support.ts` has no demonstrated repeated starter load within one capture; leave it unchanged.
- Combined verification: application typecheck passed twice; a fresh application build passed. The same 47 top-level source test filenames remain, preserving the current partition mapping. Root `npm ci` passed. Full serial source tests are running; raw logs and pending run summary are under `%TEMP%/tbspec-performance-implementation-720d349/`.
- Independent review completed without correctness findings. Its two bookkeeping requests were to update task status and record real workload engine demand before completion.
- Packed verification passed 14 installed-JavaScript checks, including saved queries and web start/status/stop. The consumer has its own package manifest to prevent npm from walking up to unrelated user-level package state. Install timeout matches the repository verifier's 600-second bound. No packaging or dependency change was needed.
- Root formatting and read-only quality checks passed. Repeat them after filling final evidence documents.
- Complete serial source verification exited successfully: 300 tests including nested cases, 297 passed, three existing platform skips, zero failures/cancellations. There are 298 top-level cases across the unchanged 47 files. Wall time was 2966.1 seconds; overlapping packaging work makes it unsuitable for an isolated speedup comparison.
- Five fresh processes per simple CLI case: compiled medians fell from 654–670 ms to 65–67 ms; source medians are now 107–110 ms. Detailed samples will accompany the final workload results.
- Workload comparisons passed: CLI median 41.06 → 28.87 s (two samples each); dependency 74.51 → 63.01 s and repair HTTP 58.58 → 47.27 s (one pair each). Both modes used the same source-loader hook. These are local combined-scope observations, not whole-pipeline forecasts.
- Demand probes passed: dependency retains 552 shape executions and constructs 60 engines; repair HTTP retains 308 executions and constructs 33. Old eager allocation was one per shape execution. HTTP starter loads fell from 150 to 30; validation counts remain 20/11. This satisfies the evidence condition for retaining lazy construction.
- Final root formatting and read-only checks passed. Diff inspection found only the intended source/test changes and diagnostic artifacts. Source and measurement hashes were unchanged by formatting; the same 47 top-level test filenames remain. No workflow, dependency, or lockfile changed.
- The final report is [implementation-results.md](implementation-results.md); raw numeric summaries and the full top-level inventory are under `implementation/`. All five tasks are complete.

## Deployment

No deployment or pipeline modification is part of this task. Leave changes reviewable in the working tree; any later PR or release uses the repository's normal branch workflow.
