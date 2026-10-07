# Organize and explore the canvas without losing positions

Type: AFK
Status: ready-for-agent
Blocked by: 14
User stories covered: 73, 74, 75, 76, 77, 115, 116

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A browser user can open a graph with usable relationship-based placement, add resources without moving existing positions, preview an explicit active-canvas reorganization, and navigate large neighborhoods by label/IRI search and exact relationships. Layout remains responsive and confined to the active perspective; failure and cancellation preserve prior work.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Use the approved ELK layered/RIGHT layout in a dedicated browser worker with stable RDF-term ordering, fixed seed, and real node dimensions. Initial layout applies when no usable positions exist; incremental placement fills only missing resources near neighbors.
- [ ] Existing valid positions survive ordinary source/member edits, including sparse and negative coordinates. Generated complete-graph/missing positions are temporary until an explicit presentation save.
- [ ] Reorganize previews all positions of the active canvas and supports explicit apply/cancel. Apply changes only that presentation, not source data, membership, other views, appearance, or groups.
- [ ] Cancel/failure retains prior coordinates. Initial failure offers a deterministic temporary grid, diagnostics, and retry; stale worker results and stale/revised previews cannot replace current layout.
- [ ] Use revision-checked presentation persistence and session-owned browser apply where applicable. Keep status/cancellation/navigation responsive during layout, and do not persist camera or algorithm-option settings.
- [ ] Search covers labels/full IRIs and off-screen resources, centers the selected node, and highlights neighbors without changing membership. Viewport culling never changes searchable/navigable graph content.
- [ ] Incoming/outgoing panels navigate exact triples, individually distinguish parallel predicates and self-loops, and keep dense hub neighborhoods inspectable. Flow/Transition resources remain nodes with direct RDF edges.
- [ ] Browser workflows use representative 100- and 1,000-resource graphs with disconnected components, cycles, dense hubs, self-loops, parallel edges, and real dimensions; assert preservation/cancel/apply/fallback/stale-result invariants and record responsiveness without inventing performance limits from prototype timings.

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

