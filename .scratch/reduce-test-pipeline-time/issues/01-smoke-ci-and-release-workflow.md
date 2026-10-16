# 01 — Implement smoke CI and verified npm releases

Status: ready-for-agent
Type: task
State: open
Assigned to: implement-spec

Approved design: [Fast pull-request checks and verified release publication](../spec.md).

## Outcome

Routine PRs and `main` pushes use four-platform smoke verification instead of the exhaustive application matrices. Versioned release branches run all checks on every push. Local npm scripts prepare release branches and publish only the archive validated by complete CI for the current release commit.

The user confirmed the design on 2026-10-16 and requested this durable ticket for continuation in another session. Implementation has not started. The detailed specification is normative; earlier alternatives in the conversation are superseded by it.

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

- Five minutes means installed-package installation, smoke assertions and cleanup per platform; not setup/build/quality or queueing. Start with Linux, standard-user Windows and both macOS architectures. Any budget/platform reduction needs measured evidence and a new user decision.
- Full runs happen on every direct push to `release/<version>` and can be launched manually there. No PR is needed to trigger them. No nightly schedule and no automatic full suite on ordinary PRs or `main`.
- A failed full run blocks that release only. Hotfixes are made on the release branch and later return to `main` by PR; they need not be integrated before publication.
- `prepare-release <version>` requires clean, up-to-date `main`; creates a versioned branch, updates version/lockfile and commits locally. It does not push. The author reviews and pushes.
- `publish-release` is manual, from a clean release checkout. It requires an unpublished version, npm authentication and the latest successful complete verification for the exact current commit. It publishes the downloaded, digest-checked CI archive, without rebuilding it.
- GitHub Free supports the desired protection for this public repository. Apply it to admins too. Recheck live repository settings before making changes.

## Acceptance criteria

- [ ] All approved behavior in the specification is implemented and documented in English.
- [ ] Ordinary PRs, including release-fix PRs into `main`, and `main` pushes run quality, type/build and smoke; no exhaustive application matrix is required for these events.
- [ ] Four hosted smoke lanes cover the minimum installed CLI, project read/write, asset, authenticated/unauthenticated HTTP and verified shutdown behavior. Windows runs as a standard user.
- [ ] Installation, assertions and cleanup complete within five minutes on each platform, with recorded actual durations; otherwise stop and obtain the user's budget/platform decision using the results. A timeout is failure, not evidence that coverage fits.
- [ ] A new release-branch push and a later direct hotfix push each trigger complete CI without a PR. Eligible manual full runs work as well.
- [ ] Full verification retains the source suite across all platforms/Intel partitions and all exhaustive installed-artifact scenarios, including the shared smoke assertions.
- [ ] Partial/manual diagnostic runs, skipped lanes, empty selections and cleanup failures cannot authorize a release.
- [ ] Release preparation rejects dirty/divergent/non-`main` checkouts, invalid versions and branch collisions without discarding work; a valid preparation creates only the intended version changes/commit and does not push.
- [ ] Publication rejects a non-release checkout, branch/version mismatch, dirty state, existing published version, registry uncertainty, missing authentication, wrong commit, incomplete/failed/cancelled/pending verification and missing/expired/mismatched artifacts.
- [ ] A local stubbed success-path check proves publication receives the exact downloaded archive and no local build/repack occurs. No real package is published during automated validation.
- [ ] Artifact/evidence metadata binds verification mode, commit, run, expected platform coverage and SHA-256; logs redact credentials. Retention supports the documented manual handoff and expiry fails clearly.
- [ ] Stable required checks protect `main` for ordinary contributors and admins; configuration does not block direct release hotfix pushes or introduce mandatory second-person approval. Verify the resulting live settings and record them.
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

### 2026-10-17 — Implementation baseline

Implementation uses the existing `t3code/reduce-test-pipeline-time` branch, as requested. The starting application commit is `a2d7fdb95c1994cf8a7df078d81e50bafc73b354`. Its 47 top-level source test files are distributed across the three Intel partitions as 16, 16 and 15 files.

Root `npm ci`, `npm run format`, `npm run check`, application `npm ci`, `npm run typecheck` and `npm run build` passed before implementation. Root installation reported eight existing tooling advisories; the application installation reported none. No dependency changes or unsafe fixes were applied.

Live GitHub inspection confirmed the public repository, administrator access, no protection on `main`, and no repository rulesets. Public npm metadata returned `E404` for `tbspec`; `npm whoami --registry=https://registry.npmjs.org` returned `E401`. Package ownership and actual publication permissions remain unverified until valid npm authentication is available. No package was published.

### 2026-10-16 — Approved interview and documentation handoff

The user first selected fast PR feedback over exhaustive coverage on each PR, then explicitly selected the five-minute smoke design. The grilling interview settled budget boundaries, retaining all four platforms pending measurement, admin-enforced `main` protection, manual npm publication, continued PR flow after full-test failures, and allowing release fixes to return to `main` after publication.

The final release model supersedes earlier suggestions of a permanent `release` branch, complete verification on `main` before every publication, a Justfile, GitHub Release publication, and requiring hotfix integration before release. The user instead requested two npm scripts and a new versioned release branch, automatic full verification on every direct branch push, and publication only after exact-commit validation. They selected clean/up-to-date `main` as the preparation source and manual review/push after the local preparation commit.

The user approved the consolidated design and requested only a ticket/specification handoff in this turn. No workflow/code implementation, protection change, credential setup or package publication is part of this documentation handoff.
