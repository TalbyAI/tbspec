# Fast pull-request checks and verified release publication

Approved: 2026-10-16.

Implementation ticket: [01 — Implement smoke CI and the release workflow](issues/01-smoke-ci-and-release-workflow.md).

## Goal and approval

Shorten routine pull-request feedback by replacing exhaustive application testing on every PR and `main` push with bounded smoke verification. Run the complete verification on versioned release branches and publish only the exact npm artifact validated for the current release commit.

The user explicitly accepted delayed detection of regressions outside smoke coverage. A failed full run blocks publication of that release, not unrelated PRs or continued development on `main`. This design was approved after an interactive interview. Implementation and validation evidence are recorded in the [implementation ticket](issues/01-smoke-ci-and-release-workflow.md).

## Evidence and current state

The user supplied these test-step durations; they exclude setup and compilation:

| Test lane                          | [Previous PR](https://github.com/TalbyAI/tbspec/actions/runs/38920763470) | [After merge](https://github.com/TalbyAI/tbspec/actions/runs/38934258514) |
| ---------------------------------- | ------------------------------------------------------------------------: | ------------------------------------------------------------------------: |
| Ubuntu                             |                                                                   30m 26s |                                                                   24m 30s |
| Windows, standard user             |                                                                   45m 05s |                                                                   38m 29s |
| macOS ARM                          |                                                                   35m 01s |                                                                   27m 45s |
| macOS Intel, partition 1           |                                                                   16m 34s |                                                                   14m 27s |
| macOS Intel, partition 2           |                                                                   21m 45s |                                                                   18m 04s |
| macOS Intel, partition 3           |                                                                   31m 51s |                                                                   29m 54s |
| Entire pipeline, including waiting |                                                                  100m 06s |                                                                   86m 09s |

Inspection at commit `a2d7fdb9` confirmed:

- [Application CI](../../.github/workflows/application.yml) runs source tests and installed-artifact verification on PRs, `main` pushes and manual dispatch. Its source and artifact matrices each have their own `max-parallel: 2`; this is not a global two-job limit. Source tests run serially inside each lane.
- [Intel partitioning](../../app/scripts/test-source.mjs) sorts top-level test filenames and assigns them by index modulo the partition count, without duration weighting. File moves or additions can change discovery and partition membership.
- [The installed verifier](../../app/scripts/verify-packed-application.mjs) already installs offline into isolated consumers, checks artifact identity, exercises CLI/HTTP workflows and verifies cleanup. Reuse those boundaries rather than implement parallel smoke-only replacements.
- The workflow packs one artifact, `tbspec-packed-application`, with one-day retention. Installed evidence artifacts have 30-day retention. The package expires too quickly for a reliable manual release handoff; increase and document the package retention window.
- [The application package](../../app/package.json) currently has `"private": true`; [the root package](../../package.json) contains repository quality tools. There is no Justfile or publication script. The documented distribution is currently a local `.tgz`.
- Read-only GitHub API inspection found `TalbyAI/tbspec` public, the organization on GitHub Free, current credentials with admin permission, and no protection or applicable rules on `main`. Recheck live settings before changing them. [Protected branches are available for public repositories on GitHub Free for organizations](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Prior optimization work is recorded in [the performance investigation](../public-operation-test-diagnosis/README.md) and [third-iteration results](../public-operation-test-diagnosis/session-3-results.md). It already reduced eager imports and redundant test work. Its local timings are not hosted smoke measurements, and its earlier requirement to retain the existing pipeline applied to that earlier scope.

## Approved behavior

### Routine CI

- Every PR and push to `main` runs repository quality, application type checking/building, and smoke verification. This includes a PR bringing release hotfixes back to `main`.
- Run smoke verification on Linux, Windows as a standard user, macOS ARM and macOS Intel. Allow these lanes to run in parallel instead of imposing the current artificial two-lane limit.
- Budget at most five minutes **per platform** for package installation, smoke assertions and verified cleanup together. Checkout, Node setup, dependency/build preparation, quality checks and runner queueing are outside this budget. Do not promise a five-minute end-to-end pipeline.
- Retain all four platforms initially. Measure actual hosted results before claiming the budget is achieved. If the minimum meaningful smoke does not fit, bring the concrete measurements back to the user to choose a higher budget or fewer platforms. Do not silently drop a platform or assertion.
- Check the real installed artifact: offline installation; version/public CLI; project initialization and reading; a persisted write verified by reading it back; served web assets; authenticated HTTP access and rejection without credentials; verified server shutdown and cleanup. Preserve real platform ownership/process boundaries, including the standard Windows user.
- Reuse the existing verifier. The full verification must include the smoke assertions as well as its exhaustive scenarios. A timeout, empty selection, missing required assertion/platform, cancellation or cleanup error must never count as success.
- Keep secrets and transient authentication material out of logs and retained evidence. Serving assets and checking HTTP is smoke coverage, not proof of every interactive browser workflow.

### Full verification

- Release branches are versioned, using `release/<version>`; a single permanent `release` branch was superseded during the interview.
- Every push to a release branch, including branch creation and direct hotfix commits, automatically runs complete verification. No PR is required for this trigger. Manual full verification is also available on release branches.
- Preserve the current complete source suite across all supported platforms, including all Intel partitions, and the exhaustive installed-artifact scenarios across the four platforms. Do not remove slow regressions to achieve the smoke budget.
- Full verification is no longer automatic on ordinary PRs or `main` pushes. Do not add nightly execution. Manual focused diagnostics may remain, but cannot authorize publication.
- Make full verification distinguishable from smoke, artifact-only, focused-regression and single-partition runs. A green workflow conclusion with required jobs skipped is insufficient. Validate the complete required lane/check inventory.
- Record the exact commit, workflow/run identity, verification mode, artifact SHA-256 and platform outcomes. Preserve the same producer artifact through verification and eventual publication.

### Prepare a release

Provide a local npm script, conceptually `prepare-release <version>`. No Justfile or additional task runner is required. Exact npm script wiring is an implementation detail to document.

1. Require a clean checkout of `main`, up to date with its configured remote branch. Fail clearly on dirty or divergent state; do not silently reset, discard work or merge unrelated changes.
2. Validate the requested version and create its new `release/<version>` branch without overwriting an existing branch.
3. Update the application version and corresponding lockfile consistently, then create the release-preparation commit. Keep version metadata changes inside the commit that will be validated.
4. Stop locally. The author reviews the changes and pushes the branch manually. That push starts complete CI automatically.

### Publish a release

Provide a separate local npm script, conceptually `publish-release`. The author invokes it manually from a release checkout; CI does not publish automatically. The destination is the npm registry, not a GitHub Release.

Before publication, require all of the following:

- The current branch is an eligible `release/<version>` branch and its version agrees with the application package. No uncommitted authored changes may masquerade as validated code.
- The target package version is not already published. Distinguish a genuinely absent version from network, registry or authorization failures; uncertainty must stop publication.
- npm authentication is available for the intended registry/package. Surface missing permissions or additional authentication requirements without logging credentials. A login check alone is not proof that publication will succeed.
- The latest full verification run for the current release commit and branch has completed successfully, including every required lane and scenario. Reject pending, cancelled, failed, partial or wrong-commit verification; do not fall back to an older successful attempt when the latest relevant attempt failed or is unfinished.
- The verified artifact and its matching evidence are still available. Download that exact `.tgz` and verify its SHA-256 before publication. Do not rebuild or repack locally after validation. If artifacts have expired, stop and require a new complete run.

Publish the verified archive. Do not auto-increment the version, overwrite a published version, publish from a different commit, or silently fall back to another registry/package. Keep the root tooling package private; only adjust the application package's current private setting as needed for its approved publication. Resolve actual package-name ownership and publish permissions before claiming publication readiness; do not silently rename the package.

### Main protection and hotfix flow

- Configure `main` to require PR integration and successful quality, application type/build and aggregate smoke checks. Apply the protection to administrators as well. Do not introduce a requirement for approval by another person.
- Keep required check names stable and ensure aggregate success requires every smoke platform. Separate full-release checks so moving exhaustive jobs off PRs does not leave required checks permanently pending or make skipped checks satisfy the gate.
- Inspect current live settings before applying protection; preserve unrelated rules. This repository setting change is part of the approved design, but is not performed by this documentation task.
- Allow direct hotfix pushes to release branches, each with a new complete CI run. Publication does not require those fixes to be merged into `main` first.
- Bring release fixes back to `main` through a PR, following the ordinary smoke gate. `main` may continue advancing. Publishing the exact validated release commit/package is allowed even when it is no longer the newest development commit.

## Documentation and acceptance

Write repository documentation in English. Explain exact commands and prerequisites; preparing and manually pushing a release; automatic/manual full runs; interpreting failures and partial runs; npm authentication; publishing the verified archive; artifact expiry; and bringing hotfixes back to `main`.

The implementation is accepted only after meaningful checks demonstrate workflow routing, release-script rejection paths and the artifact/commit linkage, plus hosted measurements for the four-platform smoke budget. Do not actually publish a package merely to test the scripts. Use isolated fixtures and stubbed external commands for local publication checks; any real version publication remains an explicit author action.

## Risks, exclusions and remaining verification

- Regressions outside smoke can remain in `main` until full verification on a release branch. This is an accepted trade-off; do not pause unrelated PRs automatically.
- The five-minute smoke budget has not been measured. Runner availability can still cause queue delays even when each smoke lane meets its budget.
- Confirm actual npm package ownership, authentication and publication requirements during implementation. No registry namespace, package rename, credential setup or successful publication was established in this session.
- The artifact retention duration, exact script names/locations and stable CI check names are implementation details to document. Preserve the approved behavior rather than reopen settled product choices.
- Exclude unrelated application optimization, duration-based repartitioning, test-impact selection, new dependencies/task runners, automatic npm publication, GitHub Release creation, and new nightly schedules.
- The original documentation handoff did not modify workflows, application code, package metadata, npm credentials, GitHub settings or registry contents. Subsequent implementation work is recorded in the implementation ticket.
