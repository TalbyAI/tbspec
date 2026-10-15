# Third-iteration coverage review

Baseline: `c59f78c8ab8ffc088177d39ab1ab869931dd1f1b`. All changes are local. This maps the completed reductions; [execution evidence](session-3-results.md) records the verified outcomes.

## Dependency update consolidation

Remove the standalone `CLI dependency update previews the reacquired source before changing its snapshot` case from `app/tests/cli.test.ts`. Its setup repeats source acquisition and its update route is also exercised by the manual-support case. Keep that case's unique assertions in the latter:

- Real CLI preview returns `preview`, operation `dependency.update`, and the exact acquired selectors: its primary resource plus both retained manual support files. The removed fixture had only the primary file; the merged fixture must include the attachments too.
- Preview leaves both the lock and primary snapshot bytes unchanged.
- A second external source edit invalidates the first accepted fingerprint. Apply includes `--accept-impact` so refusal proves source drift rather than missing impact acceptance; require `PREVIEW_CHANGED` and unchanged lock/snapshot bytes.
- The refreshed fingerprint still refuses apply without `--accept-impact`, then succeeds with it and publishes the exact newly acquired bytes.
- Manual SHACL/design attachments survive update; clearing one role preserves the other role and retained files.

The merged case uses a model with an intentional new SHACL violation. The removed case used an ontology update without impact acceptance. The direct dependency tests continue to check source/update semantics, while `verifyScenarioTwo` in `app/scripts/verify-packed-application.mjs` continues to execute directory ontology preview/apply/check through the installed CLI. The complete installed verifier is a required gate for this consolidation.

## Canonical source and rename cases

Retain both complete cases. Canonical positional versus option syntax, explicit versus uniquely omitted support selectors, and ambiguous selection are separate behaviors. Rename's ID/collision/destination failures, stale manifest, selector rewrites, unrelated dependency bytes and removal references are also distinct. No additional whole-case deletion is justified by their cost alone.

## SHACL matrices

Keep every pattern, value, flag and malformed shape in the eight existing pattern/preflight matrix cases. Pattern evaluation now calls the real `prepareShapes` and `runShapes` seam with N3 datasets. Malformed graph cases require `ProjectError`, status `invalid` and `SHACL_GRAPH_INVALID` from the actual preflight function. Do not synthesize public result envelopes in the helper.

Add one public project regression with successful pattern evaluation, a violation with `validationComplete: true`, and malformed-shape rejection with `validationComplete: false`. Assert the violation's model file, resource selector, shapes selector, focus node and constraint component; malformed diagnostics identify the shapes file. Existing public warning, Unicode length, typed comparison, SPARQL/path, qualification and multi-constraint tests remain.

This removes repeated project reads and validation around pure lexical/preflight decisions; it deliberately stops repeating the public diagnostic mapper for every lexical input. It does not remove the lexical inputs or change the production validation path.

## Design consolidation

Fold `design show preserves foreign namespace triples without projecting them as appearance` into `design CLI lists reusable designs and creates an inspectable owned design` in `app/tests/views-cli.test.ts`. Preserve its initial empty-rules assertion before editing, then use a second real `design show` to check foreign triple retention and absence of projected `fillColor`. Remove only the second initialized project and repeated design creation.

## Import regressions and discovery

Add guarded fresh-process checks in existing CLI/query test files. Inventory/config operations must not load support, SHACL, SPARQL or regex validation modules. Saved-query save/list/show/remove must still validate stored queries without Comunica. A rejected deferred execution import must return the existing `unavailable`/`IO_FAILURE` result. Existing tests must still execute real bound queries and shapes/schema listing.

All existing top-level test filenames remain. Keep process/worker, ownership/permissions, security, rollback, stale-revision and representative large-payload tests. Neither test scripts nor workflow selectors change.

## Independent review

A read-only rubber-duck review found no blocking design issue and identified the unique update, design and public SHACL assertions listed above. It recommended retaining canonical-source and rename cases. Subsequent read-only reviews of the actual tests and production diff found no blocking issue with coverage, deferred imports or captured-query semantics. The source-only loader guards are complemented by fresh compiled command measurements and the complete passing installed-artifact verifier.
