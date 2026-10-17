# Published release verification implementation plan

Approved: 2026-10-17, after the auto-grill discovery summary.

**Goal:** Verify that the version in `app/package.json` is available from npm,
has registry-matching integrity, and passes installed-package checks.

**Architecture:** Add an application npm script that downloads the exact published
version into temporary storage, validates its identity and SHA-512 integrity, and
passes those downloaded bytes to the existing installed verifier. Keep the final
JSON report outside the repository and remove the download/cache directory.

**Tech stack:** Node 24 standard library, npm CLI, existing installed verifier.

## Approved behavior and constraints

- Command: `npm --prefix app run verify-release`; smoke is the default.
- Expanded command: `npm --prefix app run verify-release -- --mode full`.
- Read the exact application version, including prerelease identity; do not resolve
  `latest`, require a release branch, or require a clean checkout.
- Use only `tbspec` at `https://registry.npmjs.org/`; do not publish, rebuild,
  repack local source, install globally, or run package lifecycle scripts.
- Download with an isolated cache and install the downloaded archive offline using
  the existing verifier. Its smoke assertions and full scenarios stay unchanged.
- Reject missing versions, registry uncertainty, malformed metadata, digest or
  identity mismatches, test failures, incomplete results, and cleanup failures.
- Retain JSON evidence for success and operational failure, with version, digests,
  platform, mode, installed-verifier evidence, and cleanup outcome. Do not expose
  npm credentials or raw registry errors.
- Run on the current platform only. Full means the existing installed scenarios,
  not the source suite or the four-platform CI matrix.
- Do not compare against CI artifacts or require GitHub access. Registry integrity
  and installed behavior do not prove equality with the CI-approved archive.
- No dependencies, workflow changes, automatic publication, new functional
  scenarios, version changes, or dist-tag checks.

## Implementation and validation

- [x] Add CLI fixture tests in `scripts/tests/verify-release.test.mjs`, substituting
      only npm and the installed verifier at process boundaries. Run
      `node --test scripts/tests/verify-release.test.mjs` and observe failure before
      adding the implementation.
- [x] Add `app/scripts/verify-release.mjs`, wire `verify-release` in
      `app/package.json`, and document commands and report semantics in `app/README.md`.
      Re-run the focused tests until they pass.
- [x] Cover default and full selection, prereleases, invalid arguments/versions,
      registry/download errors, malformed metadata, integrity mismatch, installed
      identity/result mismatch, verifier failure, cleanup and diagnostic redaction.
- [x] Run `npm run test:release-tooling`, `npm run format`, then `npm run check`.
      Review the diff for unintended changes. Do not publish a version to test this.

## Execution notes

`npm ci` completed at the repository root using Node 24.14.1 and npm 11.17.0.
The existing linked worktree is on `t3code/reduce-test-pipeline-time`, not `main`.

All 69 release-tooling tests passed, including 26 new verifier tests. Root
formatting and read-only checks passed. An independent read-only review found no
correctness, security, or scope gaps.

A Windows x64 integration check used the real installed verifier against a local
12 MB application archive, with registry lookup/download substituted at the npm
process boundary. All 19 smoke assertions passed in 147,514 ms, including verified
server shutdown, verifier fixture removal, and wrapper download/cache removal.
The integration fixture was removed. This establishes wrapper/verifier integration,
not publication: the live npm command failed safely, and a separate metadata probe
returned `E404` for `tbspec@0.1.0`. No package was published.

The full mode's selection was tested with fixtures; exhaustive installed scenarios,
the source suite, and other platforms were not rerun for this wrapper-only change.
