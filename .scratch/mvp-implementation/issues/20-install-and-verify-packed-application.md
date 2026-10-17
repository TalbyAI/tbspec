# Install and verify the complete application on supported platforms

Type: task
Status: ready-for-agent
State: open
Blocked by: none
Assigned to: Codex
User stories covered: 9, 54, 117

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can install one actual npm artifact and use the complete CLI and local browser offline on Windows, macOS, and Linux with Node as the only mandatory installed runtime. Verify packaging, immutable starter inventory, upgrade compatibility, and the fully assembled user workflows against the installed artifact rather than a development checkout. External npm publication, hosting, and deployment remain separate release actions.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close only after all feature tickets and their mapped extension obligations are implemented and verified, then demonstrate all seven assembled acceptance scenarios using the actual installed artifact and actual Windows/macOS/Linux process/filesystem checks. Missing platform execution is incomplete evidence. This ticket verifies integration/distribution; it does not absorb unfinished feature implementation or authorize public publication/deployment. Documentary audit coverage is not runtime evidence.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [x] Produce one packed artifact containing compiled TypeScript CLI/server entry points, matching prebuilt local React/Vite/React Flow assets and ELK worker, pinned production dependencies, immutable starter releases/digests/parser contexts, and complete license/source inventory.
- [x] Install and run the actual packed artifact in clean environments with Node 24 and without build tools, repository files, or prototype dependencies. Git is optional and required only for explicit Git acquisition; unsupported requested resource releases fail rather than substituting.
- [x] Initialization, ordinary status/configuration/lifecycle operations, validation, queries, and browser graph/form/view/layout use work without network access. Rendering/query/validation never initiate hidden acquisition requests.
- [x] Package upgrades leave canonical project schema versions, locked resources, snapshots, and descriptions unchanged. Reset restores the project's locked defaults; no automatic migration/update/restart occurs.
- [x] Document stop-before-replacement guidance and verify compatible reconnection versus incompatible protocol refusal. Browser assets/API remain tied to the launched server release, and status reports that actual version.
- [x] Run platform-sensitive ownership/protected records, process identity/lifecycle, path/link/alias confinement, staged publication/rollback, acquisition, and package checks on Windows, macOS, and Linux with real processes/filesystem boundaries before claiming support for all three.
- [x] Execute all seven original functional acceptance scenarios against the assembled application: project/conceptual/concrete/schema creation; acquisition/check/update; accepted vocabulary replacement; independent views/design ties; retained ontology conflicts; breaking removal/repair/GC; and malformed RDF with isolated querying/partial diagnostics.
- [ ] Check every public command family has exact routing/help/guidance and one-envelope JSON/error/exit behavior, including version-1 field/nullability conformance, partial-result and exit precedence, completed intentional-invalidity results, and exact ServerRecord states. Verify transient opening-link output is labeled as specified and excluded from operation previews/fingerprints. Use focused real browser/HTTP checks for bootstrap, drafts, forms, canvas/views/layout, staged previews, and lifecycle rather than duplicating all core permutations.
- [x] Record artifact identity, Node/OS versions, exact install/run/check commands, measured outcomes, and material limitations. Missing platform execution is explicit incomplete evidence, not a passed mock or an assumption from prototype verdicts.
- [x] Tests introduced by earlier tickets remain the primary public-operation seam; broaden integration only to installed-artifact, cross-platform, and cross-feature risks that those checks cannot establish. Do not claim multi-file crash atomicity, network-share guarantees, public publication, or vocabulary hosting.

## Blocked by

- [01 - Initialize an offline project with bundled resources and safe publication](01-initialize-offline-project.md).
- [02 - Inspect the project from CLI and an authenticated browser](02-inspect-project-and-authenticated-web.md).
- [03 - Create and import editable ontologies and domain models](03-create-and-import-owned-resources.md).
- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).
- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).
- [06 - Run and manage reproducible SPARQL queries](06-run-and-manage-sparql-queries.md).
- [07 - Configure model types and accept vocabulary changes](07-configure-model-types-and-vocabulary-changes.md).
- [08 - Acquire dependencies from directories, HTTP, and Git](08-acquire-directory-http-and-git-dependencies.md).
- [09 - Resolve ontology versions and detect source drift](09-resolve-ontology-versions-and-check-drift.md).
- [10 - Update dependencies and manage explicit support](10-update-dependencies-and-manual-support.md).
- [11 - Rename and deliberately remove dependencies](11-rename-and-remove-dependencies.md).
- [12 - Move and remove owned resources with impact review](12-move-and-remove-owned-resources.md).
- [13 - Maintain independent views and synchronize their selections](13-maintain-independent-saved-views.md).
- [14 - Create reusable designs and customize each view](14-author-designs-and-view-appearance.md).
- [15 - Organize and explore the canvas without losing positions](15-organize-and-explore-canvas.md).
- [16 - Edit descriptive processes with specialized forms](16-edit-descriptive-process-forms.md).
- [17 - Edit descriptive state machines](17-edit-descriptive-state-machine-forms.md).
- [18 - Delete elements precisely and clean affected views](18-delete-elements-and-clean-view-selections.md).
- [19 - Refactor identities, repair references, and collect orphaned support](19-refactor-repair-and-collect-orphaned-support.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 05](../../mvp-technical-architecture/issues/05-select-rdf-stack.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 15](../../mvp-technical-architecture/issues/15-layout-and-exploration-policy.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

- On 2026-10-07, the user approved implementing the macOS full-process identity adapter in ticket 01, with foundation CI on arm64 and Intel. This ticket verifies the complete installed artifact and platform-sensitive assembled workflows; ownership of final acceptance does not defer platform implementation from earlier feature tickets.

- On 2026-10-14, the exact producer archive passed the four offline installed-artifact consumers and native T3 browser acceptance. Mac source coverage was reconciled from the three Intel partitions and fresh exact-name timeout-corrected HTTP cases (275 unique cases, 273 pass, two environment skips). Historical full-suite fixture failure and timeout/cancellation results remain explicit in the Answer; no monolithic Intel pass is claimed.

- On 2026-10-14, the local candidate passed root `npm ci`, `npm run format`, and `npm run check`, plus app `npm run typecheck`. `npm pack` produced `E:/talby/tbspec-worktrees/mvp20-final-packed-20261014/tbspec-0.1.0.tgz` (11,957,063 bytes; SHA-256 `cbedd10e68cceb17e60edaa469272912c1d26afcd3d8f4e54d35753d9f3e985e`). The fresh Windows verifier passed on Node 24.14.1/npm 11.17.0, Windows 10.0.26200 x64: both installs used empty npm caches and exited 0; all eight groups (runtime compatibility and the seven original scenarios) passed with 179 assertions, 118 CLI commands, and 46 HTTP checks. It verified 487 production package instances, 17 starter files, six browser assets, 112 notice-text hashes for 507 package-instance records, and 202 clean distribution files. Sanitized evidence: `E:/talby/tbspec-worktrees/mvp20-final-evidence-windows.json` (SHA-256 `20868b9c0ecce3d3f755e5cbdccd6cb72164fcf20ec5ce1a6abc3bef2f521d2c`). The candidate source suite previously passed 275 tests (273 pass, two platform skips, zero failures) in `E:/talby/tbspec-worktrees/mvp-20-source-tests.log`.

- The verifier now checks the npm-installed public shim under `node_modules/.bin`, checks the imported ontology using its copied root IRI as the `owl:imports` subject, and expects unresolved ontology query conflicts to use exit 3/status `conflict`. These align with the observed consumer filesystem, installed CLI response, and normative query/exit contracts. Prior failed verifier evidence remains at `E:/talby/tbspec-worktrees/mvp20-final-evidence-windows-failed-01.json` and `E:/talby/tbspec-worktrees/mvp20-final-evidence-windows-failed-02.json`.

- At the local preflight stage, Ticket 20 remained open because a local Windows archive did not establish cross-platform support or native browser acceptance. The Answer below records the later producer-artifact, platform, and native-browser evidence that closed those gaps.

## Answer

The packed application is version `0.1.0`, 11,958,645 bytes, SHA-256 `ce881b81ce9cabe385d5766b3af2a05cf4207f6542e265ea8bfe0229746505c7`. Producer runs [38535136581](https://github.com/TalbyAI/tbspec/actions/runs/38535136581) and [38538034403](https://github.com/TalbyAI/tbspec/actions/runs/38538034403) produced the same digest; the corrected packed-only consumer workflow in run 38538034403 installed that exact archive on four platforms. Each platform completed two empty-cache offline installs and passed all eight verifier groups, 118 CLI envelopes, 46 HTTP checks, and 178 assertions on Unix or 179 on Windows. Each recorded six normal owned-process stops and verified removal of its owned temporary root. The verifier checked 487 production package instances, 17 immutable starter files, six browser assets, 112 license-text hashes across 507 package-instance records, and 202 clean distribution files. Per-platform evidence is under `E:/talby/tbspec-worktrees/mvp20-ci-38538034403/evidence/`; the aggregate is `E:/talby/tbspec-worktrees/mvp20-ci-38538034403/accepted-platform-summary.json`, and the producer archive plus digest are under `E:/talby/tbspec-worktrees/mvp20-ci-38538034403/producer/`.

The consumers reported: Ubuntu Linux `6.17.0-1022-azure` x64, Node 24.21.0/npm 11.19.0; standard-user Windows `10.0.26100` x64, Node 24.21.0/npm 11.19.0; macOS (Darwin `25.6.0`) arm64, Node 24.20.0/npm 11.19.0; and macOS (Darwin `24.6.0`) x64, Node 24.19.0/npm 11.17.0. They exercised runtime compatibility, offline package inventory and license provenance, lifecycle and reconnect, and all seven assembled scenarios: project/conceptual/concrete/schema creation; dependency acquisition/check/update; accepted vocabulary replacement; independent views and design ties; retained ontology conflicts; breaking removal/reference repair/support collection; and malformed RDF with isolated querying and partial diagnostics. The verifier's process-scoped Node network-guard self-check denied non-loopback `fetch` and direct sockets while allowing loopback and local IPC; it does not establish host-wide network isolation. The separate native browser evidence observed loopback resource origins.

Native T3 browser acceptance used the same producer digest. `E:/talby/tbspec-worktrees/mvp20-native-evidence-38535136581.json` records 21/21 checks and SHA-256 `ad8a5250c446a79ba2fb2420ee1644178e9a99a0c9013d9ae0fbafa76fd673af`. The actual DOM, controls, and workers covered bootstrap, served assets, a 33-node/62-edge graph, drafts and OWL/P-Plan/state-machine forms, independent saved views, measured layout, cancellation and apply, presentation-only writes, remount, and reconnect to the same running instance. The server stopped normally; its process was absent and port was unbound. Screenshot capture failed, so this evidence supports functional DOM/worker behavior and makes no pixel-inspection claim.

Hosted Linux and Windows source runs in [run 38535136581](https://github.com/TalbyAI/tbspec/actions/runs/38535136581) each completed all 275 tests. Ubuntu passed 271 with four platform/environment skips; standard-user Windows passed 272 with three skips. The skips were the two native macOS identity/ACL tests on non-macOS systems, the Windows sharing-error injection outside Windows, and the default-port-80 probe where port 80 was occupied or required OS privileges. The Mac ARM full-source run had 272 passes, two such skips, and one test-only rollback-fixture failure: its injector used lexical `/var` while project discovery used canonical `/private/var`. The fixture was corrected to canonicalize its temporary parent without changing production rollback logic or assertions. Corrected native transaction/identity checks passed on both Mac architectures in [run 38546134309](https://github.com/TalbyAI/tbspec/actions/runs/38546134309), and the focused run [38557503795](https://github.com/TalbyAI/tbspec/actions/runs/38557503795) passed 15/15 focused identity, transaction, editor, views, and dependency cases on each architecture with no skips or failures.

There was no single green full Intel source-suite run. The original monolithic Intel job in run 38535136581 was cancelled at its 90-minute deadline after a test timeout. The three-partition Intel source evidence is reconciled at case level in `E:/talby/tbspec-worktrees/mvp20-source-composite-audit.json`: [run 38553822924](https://github.com/TalbyAI/tbspec/actions/runs/38553822924) partition 0 passed 92/92 and partition 2 passed 74/74; the later partition 1 result in [run 38557503630](https://github.com/TalbyAI/tbspec/actions/runs/38557503630) recorded 106 passes, one repair HTTP timeout cancellation, and two environment skips. The two timeout-corrected HTTP cases were rerun by exact name on both actual Mac architectures in [run 38562290112](https://github.com/TalbyAI/tbspec/actions/runs/38562290112): on ARM, dependency and repair passed 1/1 each in 43.0s and 45.7s; on Intel, they passed 1/1 each in 103.5s and 113.2s. The composite coverage replaces the prior dependency result with its current test and replaces the one cancelled repair case with its fresh exact result, yielding 275 unique source cases: 273 pass and two environment skips. The two skips are the Windows-only sharing-error injection on Intel and the port-80 probe (occupied or requiring OS privileges). The audit confirms the 47-file partition mapping and assertion bodies remain unchanged. The historical Intel cancellation and partition timeout remain recorded; this composite must not be described as one all-green full-suite run.

The workflow commands and test commands were:

- In original full run 38535136581, the Unix source lanes ran `npm ci`, `npm run typecheck && npm run build`, and `npm run test:serial`; the standard-user Windows lane ran `node --test --test-concurrency=1 --test tests/*.test.ts`. The producer ran `npm pack --pack-destination ../packed-application` and `node scripts/write-artifact-digest.mjs ../packed-application`; consumers ran `npm run verify:packed -- ../packed-application ../packed-evidence/<runner>.json` from `app/`. This historical workflow predated Intel partition inputs.
- The packed-only producer/consumer rerun used `gh workflow run application.yml --ref feat/mvp-ticket-20 -f packed_only=true` (run 38538034403).
- Initial Intel partition run 38553822924 was dispatched with `gh workflow run application.yml --ref feat/mvp-ticket-20 -f macos_intel_source_only=true`; the partition selector did not yet exist and the workflow ran all three jobs with `node scripts/test-source.mjs 0 3`, `node scripts/test-source.mjs 1 3`, and `node scripts/test-source.mjs 2 3`. The later focused partition retry 38557503630 used `gh workflow run application.yml --ref feat/mvp-ticket-20 -f macos_intel_source_only=true -f macos_intel_partition=1`, which ran `node scripts/test-source.mjs 1 3`.
- The current default source workflow runs `npm run test:serial` for full Unix rows and uses `node scripts/test-source.mjs <index> 3` for each Intel partition; the standard-user Windows command remains `node --test --test-concurrency=1 --test tests/*.test.ts`.
- All focused Mac checks ran with `gh workflow run application.yml --ref feat/mvp-ticket-20 -f macos_regressions_only=true` (run 38557503795).
- Final slow HTTP checks ran with `gh workflow run application.yml --ref feat/mvp-ticket-20 -f macos_regressions_only=true -f macos_regression_set=slow-http` (run 38562290112). After `npm ci` and `npm run typecheck && npm run build`, this mode ran `node --test --test-name-pattern='authenticated HTTP stages, applies, lists and shows an acquired directory dependency' tests/web.test.ts` and `node --test --test-name-pattern='authenticated repair API stages IRI refactor, scoped removal and separately selected GC' tests/repair-web.test.ts` on ARM and Intel.

Run links and sanitized logs are also recorded in `E:/talby/tbspec-worktrees/mvp20-resume-report.md`.

Root `npm ci`, `npm run format`, `npm run check`, and app `npm run typecheck` passed on the final test/workflow revision `6cf803edf5cb18b1db7b70fe1eb1983d82b4920d`. This ticket does not claim public npm publication, hosting, deployment, screenshot/pixel inspection, multi-file crash atomicity, network-share guarantees, or vocabulary hosting.

- On 2026-10-17, merge reconciliation retained the implementation answers and verification history from `main`. The ticket is reopened only for expanded semantic-audit criteria whose complete evidence has not been reconciled; unchecked criteria do not establish a production failure or authorize new implementation.
