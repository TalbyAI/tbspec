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

## Acceptance criteria

- [ ] Produce one packed artifact containing compiled TypeScript CLI/server entry points, matching prebuilt local React/Vite/React Flow assets and ELK worker, pinned production dependencies, immutable starter releases/digests/parser contexts, and complete license/source inventory.
- [ ] Install and run the actual packed artifact in clean environments with Node 24 and without build tools, repository files, or prototype dependencies. Git is optional and required only for explicit Git acquisition; unsupported requested resource releases fail rather than substituting.
- [ ] Initialization, ordinary status/configuration/lifecycle operations, validation, queries, and browser graph/form/view/layout use work without network access. Rendering/query/validation never initiate hidden acquisition requests.
- [ ] Package upgrades leave canonical project schema versions, locked resources, snapshots, and descriptions unchanged. Reset restores the project's locked defaults; no automatic migration/update/restart occurs.
- [ ] Document stop-before-replacement guidance and verify compatible reconnection versus incompatible protocol refusal. Browser assets/API remain tied to the launched server release, and status reports that actual version.
- [ ] Run platform-sensitive ownership/protected records, process identity/lifecycle, path/link/alias confinement, staged publication/rollback, acquisition, and package checks on Windows, macOS, and Linux with real processes/filesystem boundaries before claiming support for all three.
- [ ] Execute all seven original functional acceptance scenarios against the assembled application: project/conceptual/concrete/schema creation; acquisition/check/update; accepted vocabulary replacement; independent views/design ties; retained ontology conflicts; breaking removal/repair/GC; and malformed RDF with isolated querying/partial diagnostics.
- [ ] Check every public command family has exact routing/help/guidance and one-envelope JSON/error/exit behavior. Use focused real browser/HTTP checks for bootstrap, drafts, forms, canvas/views/layout, staged previews, and lifecycle rather than duplicating all core permutations.
- [ ] Record artifact identity, Node/OS versions, exact install/run/check commands, measured outcomes, and material limitations. Missing platform execution is explicit incomplete evidence, not a passed mock or an assumption from prototype verdicts.
- [ ] Tests introduced by earlier tickets remain the primary public-operation seam; broaden integration only to installed-artifact, cross-platform, and cross-feature risks that those checks cannot establish. Do not claim multi-file crash atomicity, network-share guarantees, public publication, or vocabulary hosting.

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

- On 2026-10-14, the local candidate passed root `npm ci`, `npm run format`, and `npm run check`, plus app `npm run typecheck`. `npm pack` produced `E:/talby/tbspec-worktrees/mvp20-final-packed-20261014/tbspec-0.1.0.tgz` (11,957,063 bytes; SHA-256 `cbedd10e68cceb17e60edaa469272912c1d26afcd3d8f4e54d35753d9f3e985e`). The fresh Windows verifier passed on Node 24.14.1/npm 11.17.0, Windows 10.0.26200 x64: both installs used empty npm caches and exited 0; all eight groups (runtime compatibility and the seven original scenarios) passed with 179 assertions, 118 CLI commands, and 46 HTTP checks. It verified 487 production package instances, 17 starter files, six browser assets, 112 notice-text hashes for 507 package-instance records, and 202 clean distribution files. Sanitized evidence: `E:/talby/tbspec-worktrees/mvp20-final-evidence-windows.json` (SHA-256 `20868b9c0ecce3d3f755e5cbdccd6cb72164fcf20ec5ce1a6abc3bef2f521d2c`). The candidate source suite previously passed 275 tests (273 pass, two platform skips, zero failures) in `E:/talby/tbspec-worktrees/mvp-20-source-tests.log`.

- The verifier now checks the npm-installed public shim under `node_modules/.bin`, checks the imported ontology using its copied root IRI as the `owl:imports` subject, and expects unresolved ontology query conflicts to use exit 3/status `conflict`. These align with the observed consumer filesystem, installed CLI response, and normative query/exit contracts. Prior failed verifier evidence remains at `E:/talby/tbspec-worktrees/mvp20-final-evidence-windows-failed-01.json` and `E:/talby/tbspec-worktrees/mvp20-final-evidence-windows-failed-02.json`.

- Ticket 20 remains open pending the producer artifact's Linux, standard-user Windows, macOS arm64, and Intel workflow results, plus native T3 browser acceptance against that same archive. The local Windows run does not establish cross-platform support or native browser acceptance.
