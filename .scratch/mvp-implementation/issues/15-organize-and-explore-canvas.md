# Organize and explore the canvas without losing positions

Type: task
Status: ready-for-agent
Assigned to: Codex
State: resolved
Blocked by: 14
User stories covered: 73, 74, 75, 76, 77, 115, 116

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A browser user can open a graph with usable relationship-based placement, add resources without moving existing positions, preview an explicit active-canvas reorganization, and navigate large neighborhoods by label/IRI search and exact relationships. Layout remains responsive and confined to the active perspective; failure and cancellation preserve prior work.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Use the approved ELK layered/RIGHT layout in a dedicated browser worker with stable RDF-term ordering, fixed seed, and real node dimensions. Initial layout applies when no usable positions exist; incremental placement fills only missing resources near neighbors.
- [x] Existing valid positions survive ordinary source/member edits, including sparse and negative coordinates. Generated complete-graph/missing positions are temporary until an explicit presentation save.
- [x] Reorganize previews all positions of the active canvas and supports explicit apply/cancel. Apply changes only that presentation, not source data, membership, other views, appearance, or groups.
- [x] Cancel/failure retains prior coordinates. Initial failure offers a deterministic temporary grid, diagnostics, and retry; stale worker results and stale/revised previews cannot replace current layout.
- [x] Use revision-checked presentation persistence and session-owned browser apply where applicable. Keep status/cancellation/navigation responsive during layout, and do not persist camera or algorithm-option settings.
- [x] Search covers labels/full IRIs and off-screen resources, centers the selected node, and highlights neighbors without changing membership. Viewport culling never changes searchable/navigable graph content.
- [x] Incoming/outgoing panels navigate exact triples, individually distinguish parallel predicates and self-loops, and keep dense hub neighborhoods inspectable. Flow/Transition resources remain nodes with direct RDF edges.
- [x] Browser workflows use representative 100- and 1,000-resource graphs with disconnected components, cycles, dense hubs, self-loops, parallel edges, and real dimensions; assert preservation/cancel/apply/fallback/stale-result invariants and record responsiveness without inventing performance limits from prototype timings.

## Blocked by

- [14 - Create reusable designs and customize each view](14-author-designs-and-view-appearance.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 07](../../mvp-technical-architecture/issues/07-rdf-canvas-projection.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 15](../../mvp-technical-architecture/issues/15-layout-and-exploration-policy.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

## Answer

Delivered worker-backed layout and exploration for complete graphs and independent saved views. ELK 0.12.0 runs in a bundled dedicated worker with layered RIGHT placement, stable RDF-term ordering and a fixed seed. Canvas layout waits for real measured node dimensions, including the controlled saved-view canvas. Initial placement uses those dimensions; incremental placement keeps every usable saved position and places only missing nodes without overlapping occupied rectangles. Complete graph projection retains Flow/Transition resources as nodes and their direct RDF edges. Decimal coordinate lexical strings remain intact in RDF, and preview identity uses staged byte digests rather than floating-point values.

Reorganization applies only after an explicit preview and changes only the active view presentation. Position-only plans preserve the original view RDF bytes. Apply checks the captured source, view and presentation revisions; stale input refuses the staged write. Cancel and worker failure retain prior saved coordinates. A one-shot native Worker startup failure showed the temporary grid and diagnostics; restoring Worker and retrying ran ELK successfully. The UI keeps search available for every member regardless of viewport culling, matches labels and full IRIs, centers off-screen results, and shows exact incoming/outgoing tuples with parallel predicates and self-loops individually distinguishable. Dense hub results remain scrollable.

The authored canvas adds no persisted camera or algorithm settings. Browser trials covered a 100-member model view (100 nodes/139 edges), a 1,000-member ontology view (1,000/1,034), complete 100- and 1,000-resource graphs, and a valid edgeless saved view (3 nodes/0 edges). Intrinsic node boxes were measured at 150×37 CSS px in the saved view and 220×39 px in the complete graph; zoomed DOM rectangles were recorded separately. Native search found and centered an off-screen 1,000th node, and exact-triple inspection exposed its self-loop, parallel predicates and scrollable hub. Reorganization cancellation restored the saved decimal anchors `-1200.125, 400.75` and `0.125, -0.5`. The 100-member layout completed in 258–377 ms; 1,000-member saved-view reorganizations completed in 1,263–1,430 ms, and the complete 1,000-resource graph in 1,255 ms. These are recorded observations, not product performance thresholds.

A 1,000-member edit plus whole-project validation exceeded the existing 512 MiB inspection-worker old-generation cap: measured completion required about 728 MiB with the original locked checks. The per-inspection-worker cap is now 1,024 MiB; request-size and timeout limits remain. This is an old-generation limit per worker, not a total-process memory bound or a declared maximum graph size. A deliberately stale native preview was refused after a harmless source comment changed the captured revision; the source was restored byte-for-byte and the preview canceled without publishing.

Verification on the final implementation:

- `node --test --test-concurrency=1 tests/views-layout-web.test.ts`: 2/2 passed. The public HTTP cases cover large saved-view selection/persistence, presentation-only reorganization, lexical decimal preservation, stale revisions and oversized-body refusal.
- `node --test --test-concurrency=1 --test-name-pattern="a failed inspection worker recovers" tests/web.test.ts`: 1/1 passed. The first focused combined run had 37/38 passing because its one-shot failure hit the dependency worker; the test now targets the actual inspection-worker URL and verifies subsequent recovery.
- Root `npm run format` then `npm run check`, plus application `npm run typecheck` and `npm run build`, pass after the implementation and worker-recovery test correction.
- Native T3 browser verification used the actual bundled worker and measured node dimensions. The initial accepted 1,000-view apply changed only `views/canvas1000.presentation.ttl` across the original project files; source, membership, other view/presentation, appearance and locked resources retained their hashes. The separate edgeless QA fixture was added through its own view and manifest entry. A parent read-only check confirmed the final native tab had 1,000 ReactFlow nodes/1,034 edges, no staged preview, and the served main bundle matched the final build. The owned server was stopped through `web stop` and exited normally.

Ticket 20 retains installed-artifact and complete supported-platform acceptance.
