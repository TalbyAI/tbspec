# Public-operation test performance diagnosis

Date: 2026-10-15. Investigated commit: `720d3496595f74c1f5c52785965dc7b3b1d33412`.

## Findings

The main opportunity is to avoid repeating expensive work inside tests and operations before changing CI scheduling. The same-commit Ubuntu run spends 58.3% of measured test-body time in four files: `cli.test.ts`, `dependencies.test.ts`, `repair.test.ts`, and `resource-lifecycle.test.ts`. Local profiles identify two different costs: repeated whole-project validation in dependency/repair operations, and repeated Node/PowerShell startup in CLI tests. A conservative fixture experiment reduced one test's median by 10.0% while retaining its unique positive CLI route checks.

The initial diagnosis below changed no application source, existing test, dependency version, or workflow. The hooks in this directory transform modules in memory only when explicitly imported. The subsequently approved implementation and its verification are documented separately in [implementation-results.md](implementation-results.md), with the execution ledger in [implementation-plan.md](implementation-plan.md).

## Scope and measurement method

- Local machine: Windows x64, build `10.0.26200`, Intel Core i9-10900K, 20 logical CPUs, 63.9 GiB RAM, Node `24.14.1`, npm `11.17.0`.
- Installed the root and isolated application dependencies with `npm ci`. Existing application build output was present. The selected cases exercise TypeScript source operations and HTTP routes; no new application build was needed for these probes.
- Used serial Node test execution, as the workflow does. Benchmarks ran sequentially, without another test benchmark running alongside them. Normal desktop activity and filesystem caches were not controlled.
- Started an uninstrumented serial suite and retained 21 completed test results: all four authoring HTTP tests, all 14 direct authoring tests, and the first three CLI tests. Explicitly stopped the runner before completing the suite to concentrate on bounded diagnostic probes. This is a partial sample, **not a passing local full-suite run**. Its interrupted runner exit status does not indicate a test assertion failure.
- Used the [same-commit completed workflow run](https://github.com/TalbyAI/tbspec/actions/runs/38625060912) for the complete per-test inventory. CI uses Node `24.19.0`; its Windows job runs as a standard user. Local timings are not directly interchangeable with hosted or macOS timings.
- Profiled three representative existing tests separately. The profiling hook counts function completions and measures elapsed wall time, including asynchronous waits, in test processes and workers. These are inclusive spans, **not CPU samples**. Parent/child and nested spans overlap; do not add their durations together or treat summed process lifetimes as suite duration.
- Compared the original CLI validation test with an exploratory four-call fixture-setup change, using three repetitions of each version in the order control, variant, variant, control, control, variant. Coverage review then led to a conservative two-call variant, measured in three further runs followed by a fresh control. These comparison runs have no profiling hook. Report test-body medians rather than mixing them with initial or instrumented runs.

The complete CI inventory is in [ci-tests.csv](ci-tests.csv), the completed local prefix in [local-sample.csv](local-sample.csv), and numeric summaries and repetition results in [measurement.json](measurement.json). Raw TAP and profiling traces remain in the local temporary directory recorded in that measurement file.

## Complete CI inventory

These durations describe the public-operations source-test step, excluding dependency installation, compilation, packing, and queue time.

| Platform / source partition | Step wall time | Result |
| --------------------------- | -------------: | ------ |
| Ubuntu, full                |        39m 47s | Passed |
| Windows standard user, full |        56m 26s | Passed |
| macOS ARM, full             |        38m 24s | Passed |
| macOS Intel, partition 1/3  |        19m 00s | Passed |
| macOS Intel, partition 2/3  |        29m 07s | Failed |
| macOS Intel, partition 3/3  |        45m 47s | Failed |

The three full source runs contain 292 tests each, including platform skips. Intel partitions contain 95, 116, and 81 tests. File counts therefore do not approximate cost. Partition 3 combines the heaviest CLI and repair files; this explains the scheduling imbalance, but repartitioning is outside this diagnostic change.

The following file totals sum test-body durations, so they exclude module loading and test-runner overhead.

| File                           |  Ubuntu | Windows | macOS ARM |
| ------------------------------ | ------: | ------: | --------: |
| `cli.test.ts`                  | 543.7 s | 739.3 s |   559.1 s |
| `dependencies.test.ts`         | 375.1 s | 531.7 s |   353.6 s |
| `repair.test.ts`               | 270.7 s | 327.3 s |   240.9 s |
| `resource-lifecycle.test.ts`   | 189.2 s | 233.3 s |   197.9 s |
| `element-deletion-web.test.ts` | 102.4 s | 160.8 s |    96.7 s |
| `editing.test.ts`              |  90.9 s | 139.3 s |    79.2 s |
| `web.test.ts`                  |  93.7 s | 180.8 s |   105.7 s |

The heaviest Ubuntu tests include:

| Test location                                                             | Test / scenario                                      | Ubuntu body time |
| ------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------: |
| [cli.test.ts:609](../../app/tests/cli.test.ts)                            | Manual dependency support through update and clear   |          102.5 s |
| [cli.test.ts:231](../../app/tests/cli.test.ts)                            | Dependency rename and removal                        |           82.0 s |
| [dependencies.test.ts:169](../../app/tests/dependencies.test.ts)          | Update requiring acceptance of a new SHACL violation |           73.7 s |
| [cli.test.ts:1177](../../app/tests/cli.test.ts)                           | Impact, removal, and resource moves                  |           61.3 s |
| [views-layout-web.test.ts:334](../../app/tests/views-layout-web.test.ts)  | 1,000-member layout payload                          |           57.6 s |
| [views-transaction.test.ts:67](../../app/tests/views-transaction.test.ts) | Dependency rename preserving a locked-source view    |           56.2 s |

## Local diagnosis

### CLI tests repeatedly pay for process startup and native identity

The initial uninstrumented CLI validation case took 52.5 s. Its separate instrumented run took 41.7 s, demonstrating why initial runs should not be used as a precise optimization baseline.

In the profiled case, 16 synchronous CLI subprocesses occupied 39.4 s. Twelve native identity queries occupied 16.0 s; the starter loader occupied 2.2 s across 30 calls. The four subprocesses used only to prepare the schema/model/shapes fixture took 11.2 s. Invalid argument subprocesses still took approximately 0.77–0.85 s each, even though they did not need project validation.

[ownership.ts](../../app/src/ownership.ts) caches the current process identity, but each new CLI process starts a fresh cache and invokes Windows PowerShell/CIM once it needs a project lock. [cli.ts](../../app/src/cli.ts) also eagerly imports the application modules before dispatching help or argument errors. This is a startup cost as well as a test-design cost; removing identity or ownership checks is not an appropriate optimization.

The initial exploratory experiment replaced all four setup CLI invocations in `CLI validates, lists shapes and confirms schema removal offline with exact signatures` with `authorResource` calls. It retained successful setup outcome checks and subsequent CLI assertions, reducing subprocesses from 16 to 12:

| Version        | Three test-body repetitions |  Median |
| -------------- | --------------------------- | ------: |
| Original setup | 42.55 / 40.01 / 39.81 s     | 40.01 s |
| Direct setup   | 30.31 / 30.59 / 31.21 s     | 30.59 s |

All six executions passed. The median fell by 9.41 s, or 23.5%, but coverage review found that schema-add and shapes-create had their only positive CLI route checks in this setup block. **The four-call variant is not a coverage-preserving recommendation**, despite passing. This illustrates why passing assertions alone do not prove that a test reduction is safe.

The retained [fixture-setup experiment](fixture-setup.mjs) instead replaces only the two `model create` setup subprocesses. Their CLI family/profile coverage exists independently in `cli.test.ts:905`. It preserves schema-add and shapes-create as real CLI subprocesses, as well as schema/shapes listing, selected and whole-project validation, preview/fingerprint confirmation, and invalid arguments. The subprocess count falls from 16 to 14. Exact results for both experiments are in `measurement.json`; neither is a forecast for the complete pipeline or other operating systems.

| Conservative comparison                   | Test-body repetitions           |  Median |
| ----------------------------------------- | ------------------------------- | ------: |
| Original setup, including a fresh control | 42.55 / 40.01 / 39.81 / 41.77 s | 40.89 s |
| Two model creations prepared directly     | 37.04 / 36.54 / 36.80 s         | 36.80 s |

The conservative variant saves a median 4.09 s, or 10.0%, against the four controls. All three variant runs and the fresh control passed. This is a small repeated desktop experiment, not a statistical estimate of hosted CI savings.

### Dependency operations repeatedly validate unchanged graphs

The existing `dependency update requires impact acceptance for a new manual SHACL violation` test passed locally in 76.9 s under instrumentation:

| Span                    | Calls | Inclusive elapsed time |
| ----------------------- | ----: | ---------------------: |
| `validateInspection`    |    20 |                 66.7 s |
| `runShapes`             |   552 |                 35.6 s |
| `parseGraph`            | 6,957 |                 10.6 s |
| `loadStarters`          |    61 |                  3.6 s |
| Native process identity |     1 |                  1.4 s |

Here, approximately 87% of the test body is inside validation. Startup is not its main problem. [dependencies.ts](../../app/src/dependencies.ts), notably `prepareDependencyPlan` and the acquisition/update preparation path, runs `inspectSnapshot(..., { command: "status" })` for both baseline and proposed state. Repeated previews, acceptance refusals, and stale-input checks repeat that work across the installed starter graphs.

These assertions cover different safety outcomes and are not demonstrated redundant. Prefer reusing immutable parsed inputs within one coherent operation, and investigating validation of affected graphs, over deleting the stale-manifest, changed-inventory, or explicit-acceptance cases. Any scoped validation must still detect changed prerequisites, vocabulary winners, negative reads, and externally edited bytes.

### Repair repeats starter loading inside a per-graph helper

The authenticated repair test passed locally in 62.4 s under instrumentation:

| Span                             | Calls | Inclusive elapsed time |
| -------------------------------- | ----: | ---------------------: |
| `validateInspection`             |    11 |                 35.8 s |
| `runShapes`                      |   308 |                 18.3 s |
| `parseGraph`                     | 6,828 |                 10.8 s |
| `loadStarters`                   |   150 |                  8.5 s |
| Native runtime permission checks |    10 |                  7.2 s |
| Native process identity          |     2 |                  3.0 s |

[repair.ts:149](../../app/src/repair.ts) calls `loadStarters()` inside `parseCapturedGraph()` for every locked graph, only to obtain `vettedDigest`. [starters.ts](../../app/src/starters.ts) rereads the installed inventory and parses/verifies every starter graph on each call. Passing one verified starter bundle or digest through a coherent repair capture is a concrete optimization candidate. Snapshot-scoped reuse avoids introducing a global mutable cache. This optimization has not been implemented or benchmarked here.

## Redundancy and coverage decisions

No complete existing test has been proved safe to delete. The useful distinction is between repeated setup, overlapping domain scenarios, and independent guarantees at each public boundary.

| Candidate                                                                | Evidence                                                                                                                                                                  | Recommended change / coverage to preserve                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repeated CLI fixture construction                                        | Four setup processes; two repeat model creation covered at cli.test.ts:905, while two are unique positive CLI route checks                                                | Replace the two model-creation setup calls with direct operations. Preserve schema-add and shapes-create as CLI calls.                                                                                                                                 |
| Exact duplicate guidance invocation                                      | `cli.test.ts:978` loop already invokes `llms views designs`; line 1001 invokes the same command again in the same directory                                               | Retain the first result and apply the additional text assertions to it. This is a confirmed redundant subprocess call; its individual saving was not measured.                                                                                         |
| Schema and shapes lifecycle                                              | Direct coverage in `validation.test.ts:147,201`, CLI coverage in `cli.test.ts:34`, HTTP coverage in `validation-web.test.ts:11`                                           | Keep the full domain edge-case matrix direct; keep command routing, envelope/exit status, authentication, and foreign-session preview rejection at the relevant transport boundary. Reduce repeated setup first.                                       |
| Dependency acquisition/support/update                                    | Direct coverage in `dependencies.test.ts`, source-provider coverage in `dependency-sources.test.ts`, long CLI cases at lines 417/609, long HTTP case in `web.test.ts:161` | Review repeated domain combinations across transports. Keep distinct CLI source syntax, HTTP cancellation/responsiveness, staged handles, source drift, and acceptance rules. Similar names alone do not establish redundant coverage.                 |
| Refactor / redirect / removal / GC                                       | Direct coverage in `repair.test.ts`, plus `cli.test.ts:89` and `repair-web.test.ts`                                                                                       | Keep direct exact-byte, RDF/XML, collision, scope, and locked-resource cases. Transport tests should prove routing, wrong-apply-route rejection, session binding, and a representative preview/apply flow.                                             |
| SHACL lexical and parameter matrices                                     | `shacl-core.test.ts` repeatedly initializes a project and validates file-based fixtures; lower-level regex tests already exist                                            | Consider moving pure lexical cases to the correct engine/profile seam, while keeping representative public validation tests for diagnostics and attribution. These tests are a secondary priority because the entire file costs only 32.2 s on Ubuntu. |
| 1,000-member layout                                                      | Explicit HTTP payload regression; 57.6 s Ubuntu and 118.8 s Intel                                                                                                         | Keep the large boundary regression. Use small fixtures for other layout behavior. Reducing this case to a small graph would remove its intended guarantee.                                                                                             |
| Ownership, rollback, worker lifecycle, and deletion/view synchronization | Independent security, filesystem, and process behavior                                                                                                                    | Preserve these cases. Optimize their setup or underlying repeated work; do not infer redundancy from happy-path domain tests.                                                                                                                          |

## Existing CI failures must remain visible

The inspected Intel run has two deletion tests failing their 90-second timeout: `element-deletion-web.test.ts:200` and `:402` (observed durations 96.1 s and 116.8 s). Both exercise synchronization/preservation across views; they do not duplicate a simple deletion happy path.

`web.test.ts:805`, generated scenario `dependency worker shutdown settles recovery-during-stop`, fails with `2 !== 1`: shutdown created a replacement worker. It is an assertion failure, not a slow-test timeout. This was observed in hosted Intel logs and was not reproduced or fixed locally in this performance investigation.

## Recommended implementation order

1. Replace duplicated model-creation CLI setup with direct setup, starting with the conservative measured case. Preserve the unique schema-add and shapes-create route checks. Reuse the duplicate guidance result. Run the original tests and keep the existing pipeline configuration while measuring the resulting suite.
2. Hoist starter loading out of repair's per-graph path. Preserve digest/integrity checking, RDF/XML vetting, and coherent revision checks. Benchmark direct and HTTP repair cases before and after.
3. Investigate snapshot-scoped parsed graph/shape reuse and avoid revalidating unaffected starter graphs during dependency previews. Keep all acceptance and stale-input assertions. This offers more potential than starter-loader caching alone, but has a larger correctness surface.
4. Reduce repeated domain matrices across CLI/HTTP only after mapping each assertion to remaining direct or transport coverage. A small dispatch seam could test argument matrices without spawning a complete application for every malformed command; retain real-process smoke tests.
5. Once test and operation costs have been reduced, reconsider duration-based partitioning and bounded concurrency separately. The measured Intel imbalance is real, but scheduling changes would not remove redundant execution.

No whole-suite percentage saving is claimed. The report separates measured costs, one controlled fixture experiment, and unimplemented optimization candidates.

## Reproduce locally

Install dependencies from their respective directories:

```powershell
npm ci
Push-Location app
npm ci
Pop-Location
```

Run one uninstrumented case from `app`:

```powershell
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern='^CLI validates, lists shapes and confirms schema removal offline with exact signatures$' tests/cli.test.ts
```

Run a focused profile from `app` in a fresh PowerShell session. The output is append-only; select a new filename for each run. `NODE_OPTIONS` propagates the hook to CLI subprocesses and worker threads. The `finally` block restores the previous environment.

```powershell
$diagnosticHook = (Resolve-Path ../.scratch/public-operation-test-diagnosis/profile.mjs).Path
$diagnosticPreviousOptions = $env:NODE_OPTIONS
$diagnosticPreviousOutput = $env:TBSPEC_PROFILE_OUTPUT
try {
  $env:NODE_OPTIONS = "--import=$(([uri]$diagnosticHook).AbsoluteUri)"
  $env:TBSPEC_PROFILE_OUTPUT = Join-Path $env:TEMP "tbspec-profile-$([guid]::NewGuid()).ndjson"
  node --test --test-concurrency=1 --test-reporter=tap tests/repair-web.test.ts
} finally {
  $env:NODE_OPTIONS = $diagnosticPreviousOptions
  $env:TBSPEC_PROFILE_OUTPUT = $diagnosticPreviousOutput
}
```

To profile the dependency case instead, use:

```powershell
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern='^dependency update requires impact acceptance for a new manual SHACL violation$' tests/dependencies.test.ts
```

For a fresh six-run setup comparison, from `app`, copy `fixture-setup.mjs` and `run-ab.ps1` together to a new temporary directory and invoke the copied `run-ab.ps1`. The runner writes `ab-*.tap` and `ab-results.json` next to its copy. Run it in a fresh PowerShell session, without another benchmark running. It clears `NODE_OPTIONS` for the comparison. The fixture hook fails explicitly if the original setup block no longer matches.

Both hooks are tied to the inspected source seams. A missing declaration/setup block should stop the experiment rather than silently profile a different workload. The profiler performs synchronous trace writes, so use uninstrumented repetitions to evaluate speedups. Appended traces from multiple runs must not be treated as a single run.

## Validation

- All three focused profiled tests passed.
- All ten uninstrumented comparison executions passed: six exploratory runs and four conservative-refinement runs. The initial 21-result suite prefix is reported separately and remains incomplete.
- The retained profiling hook passed a smoke check for independent starter loads, correct span counts, and preserved asynchronous subprocess success/error results.
- Ran `npm run format` and `npm run check` from the repository root. Both passed; no application or workflow files changed.
