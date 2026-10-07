# Graph layout and exploration verdict

## Executive summary

The user accepted ELK layered layout with React Flow as the architecture baseline after the two approved synthetic trials. It produced finite, non-overlapping positions and kept existing positions intact when adding a resource or editing a literal label. Browser interaction confirmed search/focus, independent view positions, preview cancellation, application confined to the active presentation, and canceling a layout calculation followed by a successful fresh calculation. A 249-neighbor hub remained visually dense, and the user approved a navigable relationship list as a product requirement. This acceptance resolves an architecture decision; it does not establish production readiness.

## Execution record

- Windows, 2026-10-04, Node 24.14.1, npm 11.17.0. `npm install` installed 50 packages inside this directory. Exact package versions and integrity data are in `package-lock.json`.
- `npm run measure`: exit 0. [measurement.json](measurement.json) records the reproducible generator and one Node execution. This is a measurement script, not a product regression suite.
- `npm run build`: exit 0 after the final code change. Vite 8.3.1 reported the same non-fatal React Flow `use client` directive warning as the earlier canvas proof. The classic ELK worker asset is approximately 1.60 MB before compression; its payload is a trade-off, not evidence of a renderer issue.
- Browser: T3 collaborative Chromium preview at `http://localhost:5174/`, desktop. Reported CSS viewport sizes varied between 1280×800 and 2212×1382 as the inline preview changed. These are local development-build observations, not production benchmarks.

| Fixture         | Resource edges | Node layout | Browser worker request | Request to two animation frames |
| --------------- | -------------: | ----------: | ---------------------: | ------------------------------: |
| 100 resources   |             98 |      181 ms |                 234 ms |                          279 ms |
| 1,000 resources |            998 |      417 ms |                 376 ms |                          687 ms |

The browser worker request includes message transfer and may include initialization. The two-frame observation is measured before/around the final fit-view update; it is not a precise first-paint or fully interactive timing. Repeated runs differed (a later 1,000-resource request was 299 ms and its two-frame observation 554 ms). No percentile, frame-rate target, or cross-machine guarantee is inferred.

## Verification when included in the repository

On 2026-10-04, the proof was copied from its local development branch into the architecture decision branch under `prototypes/graph-layout/`. Verification ran from that directory on Windows with Node 24.14.1:

- `npm ci`: exit 0; installed 50 packages from the included lockfile.
- `npm run build`: exit 0; the existing non-fatal React Flow `use client` directive warning remained.
- `npm run measure`: exit 0; 100 resources/98 edges took 220 ms and 1,000 resources/998 edges took 534 ms. Both fixtures retained finite coordinates, zero overlaps (including after adding a resource), deterministic repeated positions, preserved existing positions on additions and literal edits, and unchanged source data. All recorded invariants were checked.

The original `measurement.json` is retained to support the earlier decision's 181/417 ms measurements. These fresh timings are a separate reproduction, not a replacement for the original execution record. Browser interaction was not rerun during inclusion; the earlier browser observations above remain the evidence for those scenarios.

## Observed behavior

- Both sizes: zero node rectangle overlaps, finite coordinates, equal positions on a repeated identical layout, unchanged source statements after layout, no old-position movement after adding a resource, and no movement on literal label edits. The grid baseline also has zero overlaps; its limitation is ignoring relationships, not collision avoidance.
- Search by label and by full IRI centered the requested resource at zoom 1 and highlighted its exact immediate neighbors. Searching the 1,000-resource hub exposed 249 neighbors. Only 32 nodes were drawn on screen at that focus, while the complete 1,000-resource projection remained available. Search does not filter graph membership.
- The move action followed by label editing preserved the complete position fingerprint. Adding a related resource produced 1,001 nodes and kept all prior coordinates equal using a deep-cloned pre-action snapshot.
- Grid preview left committed positions unchanged. Cancel restored the displayed fingerprint exactly. Applying a grid preview to View B changed only View B, leaving View A and complete-graph caches equal to their independently captured snapshots. The two twelve-resource views initially had different positions and only two positioned anchors, exercising missing-position placement.
- A 1,000-resource reorganization canceled after starting terminated its worker and retained the existing canvas. The next reorganization produced a new preview. Initial-load cancellation's grid fallback is present in code but was not separately exercised.
- The first browser attempt imported `elk.bundled.js` inside an additional module worker and failed with `_Worker is not a constructor`; the corrected integration uses `elk-api.js` plus the package's classic `elk-worker.min.js` asset as documented. This integration cost does not invalidate the Node measurements.
- Ordinary React Flow edges coincided for parallel predicates and drew an indistinct self-loop. A small custom edge separates parallel paths and draws self-loops explicitly; selecting an edge exposes its source/predicate/object. Dense hub readability remains limited even after that correction. Renderer replacement has not been justified by the observed gap.

## Human acceptance

On 2026-10-04, after receiving the measured results and live prototype URL, the user approved all remaining recommendations: ELK 0.12.0 layered/RIGHT in a worker, a navigable incoming/outgoing relationship list, and position preservation on cancellation/failure with a temporary grid fallback and diagnostic when there were no positions. Earlier rounds approved initial automatic layout, preservation of existing positions, preview/apply/cancel confined to the active canvas, label/IRI search with neighbor highlighting, and the two fixture sizes.

The authoritative production policy is recorded in [Choose graph layout and exploration behavior](../../.scratch/mvp-technical-architecture/issues/15-layout-and-exploration-policy.md). This included prototype preserves execution evidence rather than duplicating that contract. The relationship list and complete failure policy are accepted requirements, not tested product capabilities.

## Sources

- [React Flow layout options](https://reactflow.dev/learn/layouting/layouting): React Flow accepts external layout coordinates; ELK is configurable and asynchronous, with a higher integration cost than Dagre.
- [elkjs project and API](https://github.com/kieler/elkjs): layered layouts, promise-based execution, worker support, and explicit worker termination.
- [React Flow performance guidance](https://reactflow.dev/learn/advanced-use/performance): memoize custom nodes and avoid unnecessary work during interaction.

## Limits

Synthetic graph shapes and fixed-size generic nodes cannot establish readability of arbitrary RDF graphs, variable-size visual rules, browser responsiveness on other machines, or durable file writes. The measured Node layout time is separate from browser request/frame observations. Human acceptance does not broaden the measured evidence.

## Repository quality revalidation (2026-10-07)

After applying repository formatting and lint rules, `npm ci`, `npm run build`, and `npm run measure` passed from this prototype directory on Windows with Node 24.14.1 and npm 11.17.0. Both 100-node and 1,000-node measurements retained finite coordinates, zero overlaps, deterministic layout, existing positions after insertion, literal-edit positions, and unchanged source data. The earlier `measurement.json` record was restored byte-for-byte after this verification.

Browser checks against the production build confirmed initial worker layout, grid preview/cancel restoring every node position, and worker preview/apply. Worker callbacks now have stable identities and explicit effect dependencies; position rendering preserves current highlights without making selection trigger layout initialization. Buttons have explicit types. The existing non-fatal React Flow `use client` bundler warning remains.
