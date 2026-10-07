# Initialize and discover an offline project

Type: task
Status: ready-for-agent
State: resolved
Blocked by: None
User stories covered: 1, 2, 3, 4, 7, 9, 10, 11, 12, 105, 106, 107, 108, 109

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can initialize a reproducible local project with ready-to-use data, process, and state-machine resources, then run commands from a subdirectory or against an explicitly selected project. Initialization creates versioned configuration and locked bundled snapshots without requiring network access or initializing Git. Deliver the production CLI entry point and shared project-operation boundary through this real workflow, including safe coordinated publication rather than a scaffolding-only milestone.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Initialization accepts the specified directory/base-IRI options, upward discovery finds the intended manifest, and explicit project selection takes precedence. Existing destinations or incompatible project versions produce actionable failures without replacing content.
- [x] Author and bundle the approved immutable metadata, process, and state-machine 0.1.0 releases, standard vocabulary resources, attributed P-Plan 1.3, shapes, and designs. Preserve exact permanent identities, parser contexts, digests, license/source inventory, and the independent common metadata binding.
- [x] Initialization copies and locks all required defaults offline. Ordinary initialization works with Node alone, starts no Git repository, and leaves snapshots versionable while surgically excluding only the specified ephemeral runtime, preview, operation-lock, and recovery paths.
- [x] Implement the version-1 manifest and starter lock schemas and canonical signature golden vectors. Missing/unsupported required versions and invalid semantic lock fields are explicit failures; human-authored unrelated manifest keys, comments, and line endings survive tool edits.
- [x] Public operations capture coherent bytes/inventories under a short-lived exclusive project lock, verify full token/process ownership, fail immediately on contention, and release the lock during computation or review. Unknown/abandoned ownership and pending recovery evidence block normal operations without automatic clearing.
- [x] Plans bind exact file revisions, destination absence, and relevant inventories; publish only after all staged bytes, before-images, and progress records are prepared and verified on the local filesystem. Recheck revisions before commit and filesystem actions.
- [x] Owned writes reject traversal, drive/UNC/alternate-stream escapes, internal links/junctions, multiply linked writable files, aliases, and platform-equivalent collisions. Different canonical projects coordinate independently.
- [x] Normal publication failures restore prior bytes; rollback never overwrites intervening external edits. Interruption/incomplete rollback retains evidence and blocks operations; cleanup failure after successful publication is success with warning.
- [x] Every implemented CLI invocation follows the exact signatures, single version-1 JSON envelope, stderr separation, and exit categories, including argument errors/help/version. Help and recursive documentation-only llms guidance work without a project and point to live inspection commands.
- [x] Use the approved Node 24/TypeScript and pinned RDF baseline with isolated production dependencies. Public-operation, CLI-process, real filesystem-failure, and independent-process contention checks demonstrate offline initialization and the specified recovery/confinement behavior; production imports no prototype code.

## Blocked by

None - can start immediately.

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 05](../../mvp-technical-architecture/issues/05-select-rdf-stack.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Answer

Implemented the isolated production [application package](../../../app/README.md), with the offline `init` CLI workflow, canonical explicit/upward discovery, shared project operations, version-1 schemas/signatures, and immutable [0.1.0 starter inventory](../../../app/starters/0.1.0/SOURCES.md). Initialization publishes the manifest, lock, required snapshots and exact ephemeral ignore patterns through the coordinated transaction boundary. It never initializes Git or acquires remote content.

The transaction boundary captures byte/absence/inventory revisions under short-lived full-process ownership, rejects unsafe owned paths, verifies staged bytes and before-images, rechecks before publication, and performs guarded rollback. Unknown ownership and incomplete recovery evidence remain untouched and block normal operations. Read-only recovery inspection reports incomplete records and observed artifact revisions. Completed cleanup failures remain successful with warnings; simultaneous work/release failures retain diagnostics and exit precedence.

Verification on 2026-10-07 used Windows, Node 24.14.1 and npm 11.17.0:

- Root `npm ci`, `npm run format`, and `npm run check` passed.
- Application typechecking and compilation passed. The full suite passed all 25 tests with no skips, covering public project operations, CLI child processes, real Windows sharing failures, independent-process contention/interruption, guarded rollback, canonical signatures, malformed schemas, and confinement. Focused tests ran throughout development and after review fixes.
- The compiled CLI initialized and reopened a project with networking blocked and PATH empty, retaining all six default dependencies and the independent metadata binding. Package dry-run inspection included compiled runtime and immutable resources and excluded authoring scripts/source tests.
- Parallel standards/specification review identified recovery reporting/coherence, dual-failure diagnostics, source-selection constraints and guidance gaps. These were corrected with regression evidence. The deliberate two small initialization/config result call sites remain explicit.

Live status/configuration/resource CLI inspection belongs to issue 02; later guidance topics disclose their delivery scope. Windows execution is established here. Windows/Linux/macOS identity adapters are implemented in this ticket. macOS uses built-in ioreg/sysctl plus osascript JXA for the numeric kernel process query, with microsecond process-start identity and strict LP64 layout validation. Identity availability is checked before creating coordination files; existing unknown/partial locks remain untouched. Foundation CI includes Linux, Windows, macOS arm64 and macOS Intel. Native execution evidence must be recorded separately from source/decoder checks; ticket 20 retains installed-artifact and fully assembled supported-platform acceptance. External npm publication and public vocabulary hosting are not claimed.

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

- On 2026-10-07, implementation and focused verification completed on branch `feat/initialize-offline-project`. See Answer for delivered behavior, review corrections and platform limits.

- On 2026-10-07, the user approved correcting two implementation assumptions: macOS identity belongs to the initialization foundation rather than being deferred to ticket 20, and persisted HTTP(S) locators must use a conservative no-userinfo/no-query/no-fragment policy rather than credential-name heuristics. This also applies to effective URLs, HTTPS Git/inherited provenance and HTTP(S) parser bases without altering RDF identities. Existing locks with prohibited components fail without automatic migration; capability secrets in arbitrary paths/hosts cannot be universally detected. Ticket 08 owns transport authentication/redirect enforcement; ticket 20 owns complete installed-artifact acceptance.

- Correction verification on Windows with Node 24.14.1: root `npm ci`, `npm run format`, `npm run check`, application typecheck/build and all 31 applicable tests passed (32 total, one native macOS test skipped). Regression checks first reproduced accepted unknown query secrets and premature coordination-file creation; both passed after correction. Synthetic macOS decoder checks cover microsecond precision, padding, record lengths, PID/state mismatches and malformed observations. Native platform execution remains separate evidence.
