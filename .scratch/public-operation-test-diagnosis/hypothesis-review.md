# Performance hypothesis review

Reviewed the operation and test contracts against the measured run in [README.md](README.md). No application, test, or workflow changes were made, and no benchmarks were run for this review. The recommendations below preserve the existing public-operation guarantees.

## CLI startup and argument validation

[cli.ts](../../app/src/cli.ts#L4) statically imports every operation family, including query, repair, and web modules, before dispatch starts. The argument parser and global validation then run inside `dispatch()` before command execution ([cli.ts](../../app/src/cli.ts#L43), [cli.ts](../../app/src/cli.ts#L209)). A lightweight entry point with family imports after route selection is a plausible startup experiment. A pure parse/validation seam can move the exhaustive malformed-argument matrix out of subprocesses, but its contract must retain current precedence: for example, `--unknown --help` is invalid, while valid help and version return without a project ([cli.test.ts](../../app/tests/cli.test.ts#L976)). Keep real-process checks for envelope shape, stderr/stdout, exit codes, and representative command routes; direct calls cannot cover those boundaries ([cli.ts](../../app/src/cli.ts#L1244)).

## Fixture setup

The conservative diagnostic experiment replacing only two `model create` setup subprocesses with direct authoring calls reduced the case median by 10.0%. The CLI model-creation family already has positive route coverage in [cli.test.ts](../../app/tests/cli.test.ts#L905). This is the best-supported test change. Keep the `schema add` and `shapes create` setup calls in the measured case because they are unique positive route checks there; the faster four-call variant removed them.

## Repair starter loading

[parseCapturedGraph](../../app/src/repair.ts#L144) calls `loadStarters()` for each locked graph merely to get `vettedDigest`. That loader rereads the inventory and parses/verifies every packaged starter graph ([starters.ts](../../app/src/starters.ts#L8)). The repair profile recorded 150 loader calls and 8.5 seconds in the HTTP case. Load the verified bundle or digest once per `CapturedRepair` operation and pass it to parsing. Keep `parseGraph` vetting and the captured-byte revision check ([repair.ts](../../app/src/repair.ts#L129), [repair.ts](../../app/src/repair.ts#L628)); a process-global cache would extend state beyond the coherent operation and complicate invalidation.

## Comunica engine lifetime

[runShapes](../../app/src/shacl-execution.ts#L78) constructs one `QueryEngine` per call, then uses `queryBindings` for both SHACL SPARQL constraints and Core comparison fallback ([shacl-execution.ts](../../app/src/shacl-execution.ts#L160), [shacl-execution.ts](../../app/src/shacl-execution.ts#L183), [shacl-execution.ts](../../app/src/shacl-execution.ts#L212)). Core range and `lessThan` checks can reach that fallback even when a shapes graph has no `sh:sparql`; typed values take that route ([shacl-execution.ts](../../app/src/shacl-execution.ts#L256), [shacl-core.test.ts](../../app/tests/shacl-core.test.ts#L668)). Test lazy construction first, then compare it with one engine scoped to a single validation operation and reused across its shape graphs. Include SPARQL constraints, typed Core comparisons, two independent project datasets, and concurrent operations. Avoid a module singleton until engine state, retained source references, and cross-call isolation are demonstrated safe.

## Parsed graph caching and incremental validation

Validation deliberately releases graph state after each target: it clears `stores`, `active`, and `shapeGraphs` in a `finally` block ([validation.ts](../../app/src/validation.ts#L1649)). Tests assert both that no parsed stores remain after an operation and that only the current owned target is retained between prerequisite closures ([inspection-retention.test.ts](../../app/tests/inspection-retention.test.ts#L44), [inspection-retention.test.ts](../../app/tests/inspection-retention.test.ts#L106)). They also require deferred reads to reject changed revisions and proposed bytes to override disk content ([inspection-retention.test.ts](../../app/tests/inspection-retention.test.ts#L94), [inspection-retention.test.ts](../../app/tests/inspection-retention.test.ts#L135)). A cache of parsed `Store` objects across targets or operations conflicts with those lifetimes. Treat bounded caching or incremental validation as a separate experiment: key work to captured bytes and parser/vetting context, preserve the full read/revision checks and effective-vocabulary resolution, and prove the retention tests still hold. ADR 0001's locked snapshots reinforce that validation must continue to use the captured, reproducible content ([ADR 0001](../../docs/adr/0001-lock-external-resources.md)).

## Physical test organization

Both npm test commands discover only top-level `tests/*.test.ts` files ([package.json](../../app/package.json#L21)). The Intel partition script independently selects sorted top-level files by `index % partitionCount` ([test-source.mjs](../../app/scripts/test-source.mjs#L35)); nested files would silently leave the standard commands, while adding or renaming a top-level file shifts partition membership. Before splitting large test files, list all three partitions with `node scripts/test-source.mjs <index> 3 --list-only`, then recheck test coverage and duration balance. A stable explicit partition manifest would avoid membership changing as filenames change.

No reviewed hypothesis conflicts with the existing RDF.js or locked-dependency ADRs, provided query behavior, byte-revision checks, and operation-scoped state remain intact.
