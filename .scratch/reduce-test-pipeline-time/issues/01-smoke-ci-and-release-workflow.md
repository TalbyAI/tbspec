# 01 — Implement smoke CI and verified npm releases

Status: ready-for-agent
Type: task
State: open
Assigned to: implement-spec

Approved design: [Fast pull-request checks and verified release publication](../spec.md).

## Outcome

Routine PRs and `main` pushes use four-platform smoke verification instead of the exhaustive application matrices. Versioned release branches run all checks on every push. Local npm scripts prepare release branches and publish only the archive validated by complete CI for the current release commit.

The user confirmed the design on 2026-10-16 and requested this durable ticket for continuation in another session. Implementation on `t3code/reduce-test-pipeline-time` is paused at the user's request on 2026-10-17; execution evidence and the resume checkpoint are recorded under Comments. The detailed specification is normative; earlier alternatives in the conversation are superseded by it.

## Scope and code entry points

| Area                              | Existing entry point                                                                                   | Required change                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| CI routing and artifact transport | [application.yml](../../../.github/workflows/application.yml)                                          | Smoke on PR/`main`; full on each `release/*` push and eligible manual dispatch; unambiguous result modes and complete-lane gates |
| Repository quality                | [quality.yml](../../../.github/workflows/quality.yml)                                                  | Preserve quality coverage and include release commits in complete acceptance                                                     |
| Installed verification            | [verify-packed-application.mjs](../../../app/scripts/verify-packed-application.mjs)                    | Reuse installed/offline helpers for bounded smoke; retain all full scenarios and verified cleanup                                |
| Test discovery                    | [test-source.mjs](../../../app/scripts/test-source.mjs), [app/package.json](../../../app/package.json) | Preserve full-suite discovery and all Intel partitions; no silent omission when adding test files                                |
| Release tooling                   | [app/scripts](../../../app/scripts), application manifest and lockfile                                 | Add cross-platform local npm preparation/publication commands; keep root tooling private                                         |
| Operator documentation            | [app/README.md](../../../app/README.md) and relevant CI documentation                                  | Document exact preparation, push, validation, publication and hotfix-return procedures                                           |
| GitHub settings                   | Live `TalbyAI/tbspec` branch protection or rulesets                                                    | Require stable PR checks on `main`, including for admins, without requiring another person's approval                            |

## Approved decisions

- Linux and each macOS lane have five minutes for installed-package installation, smoke assertions and cleanup. Standard-user Windows has ten minutes for account/setup, artifact copy, installation, smoke assertions and verified cleanup. Checkout, Node setup, dependency/build preparation, quality checks and runner queueing are outside these intervals. The Windows increase was approved after the combined step hit its five-minute hosted timeout in run 38978483654; its earlier 264,478 ms verifier-only measurement excluded the outer setup and cleanup.
- Full runs happen on every direct push to `release/<version>` and can be launched manually there. No PR is needed to trigger them. No nightly schedule and no automatic full suite on ordinary PRs or `main`.
- A failed full run blocks that release only. Hotfixes are made on the release branch and later return to `main` by PR; they need not be integrated before publication.
- `prepare-release <version>` requires clean, up-to-date `main`; creates a versioned branch, updates version/lockfile and commits locally. It does not push. The author reviews and pushes.
- `publish-release` is manual, from a clean release checkout. It requires an unpublished version, npm authentication and the latest successful complete verification for the exact current commit. It publishes the downloaded, digest-checked CI archive, without rebuilding it.
- GitHub Free supports the desired protection for this public repository. Apply it to admins too. Recheck live repository settings before making changes.

## Acceptance criteria

- [ ] All approved behavior in the specification is implemented and documented in English.
- [ ] Ordinary PRs, including release-fix PRs into `main`, and `main` pushes run quality, type/build and smoke; no exhaustive application matrix is required for these events.
- [ ] Four hosted smoke lanes cover the minimum installed CLI, project read/write, asset, authenticated/unauthenticated HTTP and verified shutdown behavior. Windows runs as a standard user.
- [ ] Installation, assertions and cleanup complete within five minutes on Linux and both macOS platforms and within ten minutes on standard-user Windows, with recorded actual durations. A timeout is failure, not evidence that coverage fits.
- [ ] A new release-branch push and a later direct hotfix push each trigger complete CI without a PR. Eligible manual full runs work as well.
- [ ] Full verification retains the source suite across all platforms/Intel partitions and all exhaustive installed-artifact scenarios, including the shared smoke assertions.
- [ ] Partial/manual diagnostic runs, skipped lanes, empty selections and cleanup failures cannot authorize a release.
- [x] Release preparation rejects dirty/divergent/non-`main` checkouts, invalid versions and branch collisions without discarding work; a valid preparation creates only the intended version changes/commit and does not push.
- [x] Publication rejects a non-release checkout, branch/version mismatch, dirty state, existing published version, registry uncertainty, missing authentication, wrong commit, incomplete/failed/cancelled/pending verification and missing/expired/mismatched artifacts.
- [x] A local stubbed success-path check proves publication receives the exact downloaded archive and no local build/repack occurs. No real package is published during automated validation.
- [ ] Artifact/evidence metadata binds verification mode, commit, run, expected platform coverage and SHA-256; logs redact credentials. Retention supports the documented manual handoff and expiry fails clearly.
- [x] Stable required checks protect `main` for ordinary contributors and admins; configuration does not block direct release hotfix pushes or introduce mandatory second-person approval. Verify the resulting live settings and record them.
- [ ] Root `npm ci`, `npm run format` and `npm run check` pass; run appropriate application type/build, script checks and hosted workflow verification for the implementation.

## Suggested implementation sequence

1. Re-read the specification and current files/settings. Inspect npm ownership/authentication prerequisites without publishing or changing package identity silently.
2. Add the smallest shared installed-artifact smoke path and meaningful checks for its success/failure accounting. Preserve full verification and its existing error handling.
3. Separate smoke/full event routing, complete-run evidence and stable aggregate checks. Extend artifact retention and verify all full lanes remain discoverable.
4. Implement release preparation and publication as local npm scripts using existing Node tooling. Test external effects with isolated fixtures/stubs, including commit/run/artifact mismatches and rejected npm registry responses.
5. Document exact operator commands and run the required repository/application checks. Exercise actual hosted smoke lanes and full release routing without publishing an npm version.
6. Once the final smoke check names exist and have run, configure and verify `main` protection with admin enforcement. Preserve unrelated settings; link any PR worked on to the T3 thread when the linking tool is available.
7. Record implementation results, measured smoke durations, workflow/run links, actual artifact retention, branch protection and remaining limits in this ticket. Leave acceptance items incomplete until backed by evidence.

## Resume checklist

- [ ] Start with `git status --short` and the current branch. This handoff was written on `t3code/reduce-test-pipeline-time`, based on `a2d7fdb9`; do not assume a future session has the same checkout or clean state.
- [ ] Read this ticket and [the approved specification](../spec.md); do not repeat the design interview or treat earlier proposals as decisions.
- [ ] Read root `AGENTS.md`, [issue conventions](../../../docs/agents/issue-tracker.md) and [formatting instructions](../../../docs/agents/formatting.md). Do not modify `main` directly.
- [ ] Review current workflow inputs and verifier helpers before adding parallel implementations. Root quality dependencies and application dependencies are separate installations.
- [ ] Recheck GitHub settings, registry permissions and artifact availability live. The prior inspection is evidence of session state, not a permanent guarantee.

## Comments

### 2026-10-17 — User-requested pause and resume checkpoint

The user requested stopping until tomorrow. Functional changes are committed and pushed through `147040a4c5132c23933dd70a3c9c440cb9610492` on the original integration branch, `t3code/reduce-test-pipeline-time`. The checkout was clean before this documentation checkpoint. All implementer/reviewer agents have finished; no local background implementation is running. Do not mark this ticket resolved yet.

The approved budget is now ten minutes only for standard-user Windows and five minutes for Linux and both macOS platforms. All four platforms and every smoke assertion remain enabled. Commit `58435078`, merged as `e0d24512`, updates the workflow timeout, outer/inner monotonic limits, evidence validation, tests and documentation consistently. No application source, application tests or dependency graph was changed.

Latest validation state:

- Root/application `npm ci`, format/check, application typecheck/build, actionlint and PowerShell syntax checks passed during implementation. After the last functional changes, format/check, application typecheck, all 43 release-tooling tests, actionlint and a real PowerShell-to-Node finalizer invocation with a path containing spaces passed. The merger independently repeated root checks and all 43 tests.
- [Smoke run 38980104507](https://github.com/TalbyAI/tbspec/actions/runs/38980104507), on `e0d24512`, passed Ubuntu (49,328 ms), macOS ARM (47,807 ms) and macOS Intel (108,704 ms). Windows failed after 354,789 ms, within its ten-minute budget: the installed `init` command returned exit 4, `unavailable`, `IO_FAILURE`. Account, shared-directory and owned temporary-root cleanup all passed. The original CLI diagnostic message was missing, and the wrapper incorrectly replaced the child failure with an outer-cleanup failure. A Windows process-identity query failure is a hypothesis, not an established cause.
- Commit `675bf5fa`, merged as `147040a4`, preserves the original child failure when outer cleanup succeeds and retains sanitized `IO_FAILURE` messages using the existing runtime-diagnostic redaction rules. Outer cleanup/budget errors still fail verification. This changes diagnostics only; it does not add retries, weaken assertions or change runtime ownership behavior.
- [Latest smoke run 38981802038](https://github.com/TalbyAI/tbspec/actions/runs/38981802038), on `147040a4`, was still running at the pause. Quality/build and Ubuntu (31,142 ms), macOS ARM (55,446 ms), and macOS Intel (108,666 ms) had passed. Windows was in progress. Let this already-dispatched run finish; its final result must be inspected on resumption. Its candidate SHA-256 is `fc6cecf427d4efee57f0646c6d79e6d43a548fdc15fb59ca30efeca77117c5b8`.
- [Complete release run 38978682620](https://github.com/TalbyAI/tbspec/actions/runs/38978682620), on release commit `825ce2d04c2ad428b653da3f96ab0d4360d775c0`, finished **failed**. Five source lanes passed; Intel partition 3/3 timed out in the unchanged `state-machine-web.test.ts` (60,000 ms) and the 1,000-member layout test in `views-layout-web.test.ts` (120,000 ms). Its other 89 tests passed. Do not report this run as complete release authorization or change unrelated tests/timeouts merely to obtain green CI.
- All four installed lanes of that complete run passed every original exhaustive scenario (eight per platform), shared smoke assertions and verified cleanup: Ubuntu 214,072 ms / 196 assertions; Windows 1,191,219 ms / 198 assertions; macOS ARM 469,171 ms / 196 assertions; macOS Intel 682,385 ms / 196 assertions. Independently downloaded records passed the evidence validator. Their candidate SHA-256 is `5fb8257a6a835e1bd21c2ec6d7bd7606263582665a40152eac4e4bab8792f60e`. Comparing all 19,687 files in this archive with the newer smoke archive found only `package/README.md` different; executable application/dependency bytes are identical.
- The failed source lane correctly failed `Complete verification` before its authorization manifest could be uploaded. A clean release checkout using real GitHub APIs and a fully stubbed npm CLI rejected this latest failed run and never reached simulated publication. Wrong-commit and pending-run rejection were also exercised earlier. The real-GitHub success-path probe remains unperformed because no successful complete run exists; local isolated success-path tests pass. No npm package was published.

Live external state is intentional: `main` remains protected for contributors and administrators by the strict `Repository quality`, `Application typecheck and build`, and `Application smoke` checks (GitHub Actions app 15368), with PR integration and zero required approvals. No PR was created and `main` was not modified. Temporary remote `release/0.1.0` remains at `825ce2d0` for reproducibility; its direct push proved full routing after protection. Artifacts have 90-day retention, confirmed through GitHub's expiry metadata. npm authentication as `isksz` and account-access queries succeeded, but authenticated package metadata returned `E404` for `tbspec`; first-publication permission and any OTP requirement remain unproven without an explicit real publication.

Resume from this checkpoint:

1. Check the integration branch and clean status, then inspect run `38981802038`. Download its Windows evidence and independently validate the complete four-platform set. If it failed, use the newly preserved diagnostic instead of guessing or silently changing the approved budgets.
2. Preserve the distinction between successful installed verification and the failed complete release gate. Record the two source timeouts as unresolved; no release is publishable from the failed run. A retry intended to authorize publication must rerun **all jobs**, so artifact/evidence run attempts agree.
3. Complete the acceptance record only with actual evidence. Keep the new smoke commit/archive distinct from release commit `825ce2d0` and its archive. Do not claim the full suite passed on the integration tip.
4. Finish remaining review/validation and ticket closure, then clean up the temporary implementer worktrees and the test release branch/worktree. Preserve the unrelated user worktree at `E:/talby/tbspec`. Do not publish npm or create/merge a PR without a corresponding user request.

Retained worktrees and evidence for resumption:

- Integration: `C:/Users/iskan/.t3/worktrees/tbspec/t3code-a06c103c`.
- Implementer: `C:/Users/iskan/.t3/worktrees/tbspec/pipeline-implementation`, branch `codex/reduce-test-pipeline-time`, clean at `675bf5fa`; all changes are merged.
- Release tooling implementer: `C:/Users/iskan/.t3/worktrees/tbspec/release-cli-tooling`, branch `codex/release-cli-tooling`; all changes are merged.
- Publication probe: `C:/Users/iskan/AppData/Local/Temp/tbspec-publish-live-gh-20261017/checkout with spaces`, local `release/0.1.0` at `825ce2d0`. The sibling `npm-stub.mjs` intercepts every npm command and cannot write to the registry. No publication-capture file was created by the failed-run probe.
- Downloaded latest smoke candidate and three completed platform records: `C:/Users/iskan/AppData/Local/Temp/tbspec-hosted-smoke-38981802038/{artifact,evidence}`. The preceding failed smoke, including Windows evidence, is under `tbspec-hosted-smoke-38980104507` in the same temp parent.
- Complete-run archive, all four installed records, normalized `evidence/`, and `run-summary.json`: `C:/Users/iskan/AppData/Local/Temp/tbspec-full-38978682620`.
- Standalone actionlint 1.7.12: `C:/Users/iskan/AppData/Local/Temp/tbspec-actionlint-1.7.12/actionlint.exe`; use `-shellcheck='' -pyflakes=''` for the two workflow files. This tool is outside the repository dependency graph.

### 2026-10-17 — Implementation integrated; complete hosted verification running

The implementation and review fixes are integrated as `825ce2d04c2ad428b653da3f96ab0d4360d775c0`. Root/application installs, format/check, application typecheck/build, actionlint 1.7.12, embedded PowerShell syntax parsing, and all 40 release-tooling tests passed. The review corrected Windows timing to cover standard-user setup, installation, assertions and verified account/directory cleanup in one bounded step, tightened npm version and registry-response validation, and shared release-ref parsing.

The [initial four-platform smoke run](https://github.com/TalbyAI/tbspec/actions/runs/38975987342) passed on `c4a2d968158284f199e0c23e10f0669d3dc404ab`. Its verifier durations were Ubuntu 49,889 ms, Windows standard user 264,478 ms, macOS ARM 42,068 ms and macOS Intel 114,630 ms. The Windows shell step took 286 seconds, with account/directory cleanup in a subsequent two-second step. All four records named the same archive digest, `11664c9eb381cfa9fc6bed248dee23f2676502ff6aa0896b2e43c6c50e0c711a`; an independent download and evidence validation passed. The [updated smoke run](https://github.com/TalbyAI/tbspec/actions/runs/38978483654) verifies the corrected combined Windows timing boundary.

Creating the temporary remote `release/0.1.0` branch triggered [automatic full verification](https://github.com/TalbyAI/tbspec/actions/runs/38975994955), and an eligible [manual full dispatch](https://github.com/TalbyAI/tbspec/actions/runs/38976046569) selected the full inventory. These routing probes were deliberately cancelled to release hosted runner capacity. A second direct push after `main` protection triggered [complete verification of the integrated implementation](https://github.com/TalbyAI/tbspec/actions/runs/38978682620). Its final result is still pending; cancelled probes are not release authorization.

Live `main` protection was applied and independently re-read: PR integration is required, administrators are included, zero approvals are required, and strict checks are `Repository quality`, `Application typecheck and build`, and `Application smoke`, each bound to the GitHub Actions app (15368). No unrelated protections or rulesets existed. Release branches remain outside this policy.

After the author authenticated npm, `npm whoami` confirmed `isksz`, and the account package-access query succeeded. Authenticated metadata still returned `E404` for the unscoped `tbspec` package, so no existing package owner or ACL was present to inspect. First-package creation and any additional authentication remain registry decisions at the author's explicit publication. No registry writes have occurred.

The public npm commands were exercised directly for invalid preparation/non-release publication and preserved the checkout. A separate clean release worktree also exercised the real GitHub history API with npm fully stubbed: absence of an exact-commit full run and the later pending full run both blocked publication. The real-artifact success probe and final hosted acceptance remain pending. Candidate archives, platform evidence and complete manifests use 90-day retention; operators must rerun all jobs after expiry or when retrying an attempt.

### 2026-10-17 — Windows smoke budget amendment approved

The user approved a ten-minute Windows smoke budget while retaining five minutes for Linux, macOS ARM and macOS Intel. The combined Windows setup, artifact copy, installation, assertions and verified cleanup step hit its five-minute timeout in [run 38978483654](https://github.com/TalbyAI/tbspec/actions/runs/38978483654). The earlier 264,478 ms Windows verifier result from the initial run excluded outer setup and cleanup, so it did not establish that the complete bounded operation fit. The updated hosted smoke measurement remains pending; no platform or assertion was removed.

### 2026-10-17 — Implementation baseline

Implementation uses the existing `t3code/reduce-test-pipeline-time` branch, as requested. The starting application commit is `a2d7fdb95c1994cf8a7df078d81e50bafc73b354`. Its 47 top-level source test files are distributed across the three Intel partitions as 16, 16 and 15 files.

Root `npm ci`, `npm run format`, `npm run check`, application `npm ci`, `npm run typecheck` and `npm run build` passed before implementation. Root installation reported eight existing tooling advisories; the application installation reported none. No dependency changes or unsafe fixes were applied.

Live GitHub inspection confirmed the public repository, administrator access, no protection on `main`, and no repository rulesets. Public npm metadata returned `E404` for `tbspec`; `npm whoami --registry=https://registry.npmjs.org` returned `E401`. Package ownership and actual publication permissions remain unverified until valid npm authentication is available. No package was published.

### 2026-10-16 — Approved interview and documentation handoff

The user first selected fast PR feedback over exhaustive coverage on each PR, then explicitly selected the five-minute smoke design. The grilling interview settled budget boundaries, retaining all four platforms pending measurement, admin-enforced `main` protection, manual npm publication, continued PR flow after full-test failures, and allowing release fixes to return to `main` after publication.

The final release model supersedes earlier suggestions of a permanent `release` branch, complete verification on `main` before every publication, a Justfile, GitHub Release publication, and requiring hotfix integration before release. The user instead requested two npm scripts and a new versioned release branch, automatic full verification on every direct branch push, and publication only after exact-commit validation. They selected clean/up-to-date `main` as the preparation source and manual review/push after the local preparation commit.

The user approved the consolidated design and requested only a ticket/specification handoff in this turn. No workflow/code implementation, protection change, credential setup or package publication is part of this documentation handoff.
