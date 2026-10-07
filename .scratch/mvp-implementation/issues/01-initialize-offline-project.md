# Initialize and discover an offline project

Type: AFK
Status: ready-for-agent
Blocked by: None
User stories covered: 1, 2, 3, 4, 7, 9, 10, 11, 12, 105, 106, 107, 108, 109

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can initialize a reproducible local project with ready-to-use data, process, and state-machine resources, then run commands from a subdirectory or against an explicitly selected project. Initialization creates versioned configuration and locked bundled snapshots without requiring network access or initializing Git. Deliver the production CLI entry point and shared project-operation boundary through this real workflow, including safe coordinated publication rather than a scaffolding-only milestone.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Initialization accepts the specified directory/base-IRI options, upward discovery finds the intended manifest, and explicit project selection takes precedence. Existing destinations or incompatible project versions produce actionable failures without replacing content.
- [ ] Author and bundle the approved immutable metadata, process, and state-machine 0.1.0 releases, standard vocabulary resources, attributed P-Plan 1.3, shapes, and designs. Preserve exact permanent identities, parser contexts, digests, license/source inventory, and the independent common metadata binding.
- [ ] Initialization copies and locks all required defaults offline. Ordinary initialization works with Node alone, starts no Git repository, and leaves snapshots versionable while surgically excluding only the specified ephemeral runtime, preview, operation-lock, and recovery paths.
- [ ] Implement the version-1 manifest and starter lock schemas and canonical signature golden vectors. Missing/unsupported required versions and invalid semantic lock fields are explicit failures; human-authored unrelated manifest keys, comments, and line endings survive tool edits.
- [ ] Public operations capture coherent bytes/inventories under a short-lived exclusive project lock, verify full token/process ownership, fail immediately on contention, and release the lock during computation or review. Unknown/abandoned ownership and pending recovery evidence block normal operations without automatic clearing.
- [ ] Plans bind exact file revisions, destination absence, and relevant inventories; publish only after all staged bytes, before-images, and progress records are prepared and verified on the local filesystem. Recheck revisions before commit and filesystem actions.
- [ ] Owned writes reject traversal, drive/UNC/alternate-stream escapes, internal links/junctions, multiply linked writable files, aliases, and platform-equivalent collisions. Different canonical projects coordinate independently.
- [ ] Normal publication failures restore prior bytes; rollback never overwrites intervening external edits. Interruption/incomplete rollback retains evidence and blocks operations; cleanup failure after successful publication is success with warning.
- [ ] Every implemented CLI invocation follows the exact signatures, single version-1 JSON envelope, stderr separation, and exit categories, including argument errors/help/version. Help and recursive documentation-only llms guidance work without a project and point to live inspection commands.
- [ ] Use the approved Node 24/TypeScript and pinned RDF baseline with isolated production dependencies. Public-operation, CLI-process, real filesystem-failure, and independent-process contention checks demonstrate offline initialization and the specified recovery/confinement behavior; production imports no prototype code.

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

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

