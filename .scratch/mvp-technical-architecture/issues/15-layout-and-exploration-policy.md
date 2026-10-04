# Choose graph layout and exploration behavior

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: Codex
Blocked by: 06, 07

## Question

How should the canvas initially lay out a complete graph, preserve positions in each presentation graph, and navigate graphs beyond the small proof fixture? Decide whether the MVP needs automatic layout such as ELK from observed React Flow behavior and representative fixtures. Keep editable saved-view layout separate from the source RDF graph; add an index or second renderer only if measured evidence warrants one.

## Comments

- The user approved automatic relationship-based initial layout with an explicit re-layout action; search by label or IRI with centering and immediate-neighbor highlighting; and representative 100-resource and 1,000-resource trials covering chains, cycles, disconnected components, and highly connected resources. These are agreed trial goals, not measured capabilities or a resolved algorithm choice.
- Read-only inspection of the existing React Flow proof found a deterministic three-column fallback grid, separate per-view presentation coordinates, and temporary complete-graph positions. The recorded proof covers six resources and five relationships, with no missing-position, search, or large-graph trial. The starter presentation contract permits missing coordinates and requires absolute per-view positions; layout settings and camera state currently have no persisted RDF contract.
- The user approved preserving existing positions on source edits and additions, placing only new resources near their neighbors without overlap, preview/apply/cancel for reorganizing every position in the active canvas, and a left-to-right initial trial with separate disconnected components. Direction is presentation only and adds no RDF semantics. Algorithm selection remains subject to the representative proof and user reaction.
- An isolated proof is captured on branch `prototype/graph-layout-and-exploration`, under `prototypes/graph-layout/`. Its local [README](../../../.worktrees/graph-layout/prototypes/graph-layout/README.md), [verdict](../../../.worktrees/graph-layout/prototypes/graph-layout/VERDICT.md), and [measurements](../../../.worktrees/graph-layout/prototypes/graph-layout/measurement.json) are available in the ignored worktree. For a portable source pointer, use `git show prototype/graph-layout-and-exploration:prototypes/graph-layout/VERDICT.md`; the proof does not depend on any other prototype or the main repository.
- Node measurements: ELK 0.12.0 laid out 100 resources/98 edges in 181 ms and 1,000 resources/998 edges in 417 ms, with finite coordinates and no node overlaps. Browser trials observed 234/376 ms worker requests and 279/687 ms request-to-two-frame observations respectively; these are development-build observations, not production performance guarantees. Search/focus, incremental position preservation, distinct sparse view positions, preview cancel/apply isolation, and cancel/retry of worker computation were exercised. No second renderer or separate persistent index is justified by this evidence.
- The 249-neighbor hub remained visually dense. After reviewing the reported proof, the user approved ELK layered layout in a worker, a navigable incoming/outgoing relationship list, and preservation of existing positions on cancellation or failure with a temporary grid fallback and a diagnostic when positions do not yet exist. The user confirmed all three remaining recommendations on 2026-10-04, completing the live decision exchange.

## Answer

### Layout and position ownership

Keep React Flow as the single MVP canvas renderer. Use `elkjs` **0.12.0**, with ELK's layered algorithm and `RIGHT` direction, for automatic initial layout when the active canvas has no positions and for an explicit **Reorganize** action. Sort input resources and exact relationships by stable RDF-term identity and use a fixed layout seed; literal labels and Turtle statement order do not determine node placement. The left-to-right direction organizes the drawing without adding domain semantics, changing RDF triples, or requiring the source to be acyclic. Lay out disconnected components separately. Feed measured node dimensions to the product layout; the proof used fixed 180×58 nodes.

Run layout in a dedicated browser worker through `elk-api.js` and the packaged `elk-worker.min.js` asset. Keep the main thread available for navigation and cancellation, terminate canceled computations, and ignore results whose source/view/presentation revision or active canvas no longer matches the request. An asynchronous promise alone is not evidence that computation is off the main thread.

Honor every existing valid absolute position in the active presentation, including negative coordinates. For a partially positioned graph, or a newly projected resource, place only missing resources near already positioned neighbors and avoid occupied node rectangles; use free space for disconnected resources. Preserve the existing coordinates when source properties, labels, relationships, or view membership change. This does not promise to repair user-created overlaps or overlaps caused by a node becoming larger. Source-to-view membership and deletion behavior remains governed by [Choose the RDF-to-canvas projection and editing boundary](07-rdf-canvas-projection.md).

Complete-graph positions stay temporary until a selected IRI subset and its layout are saved as a view and presentation graph. Each saved view uses its own presentation coordinates, so placing the same resource in another view never moves this one. Generated missing positions are temporary until an explicit presentation edit or accepted layout is saved; opening a graph alone does not write files. Save accepted absolute `tbspec:x`/`tbspec:y` values through the existing [presentation contract](11-starter-resource-contract.md), with the existing file-mutation checks. This decision introduces no additional persisted camera or algorithm-option schema. Flat visual grouping retains the already-agreed presentation meaning.

### Explicit reorganization and recovery

**Reorganize** proposes new positions for all projected nodes in the active canvas. Show those positions as a preview while retaining the prior accepted state. **Apply** accepts only that active canvas's positions; **Cancel** restores its prior positions. A saved-view application changes its presentation graph only, using the revision-bound preview and file-mutation boundaries in [Choose the shared CLI and loopback web architecture](13-cli-web-runtime-boundary.md) and [Choose safe project file mutations and edit conflicts](10-file-transaction-boundary.md). The complete graph remains temporary. Layout changes neither source content nor view membership nor other presentations.

Canceling or failing a calculation preserves existing positions and leaves the graph available. If an initial opening has no positions, show a deterministic temporary grid and a diagnostic, with an explicit retry action. Reject a stale preview rather than applying coordinates over a changed graph or presentation. Do not silently reorganize a canvas after a normal source edit.

### Exploration and dense resources

Support search by displayed label or full resource IRI in the active canvas, selection of a result, centering at a readable zoom, and highlighting its immediate incoming/outgoing neighbors and incident relationships. Search and highlighting do not change graph membership. Preserve pan, zoom, and whole-canvas framing so users can return from a focused resource to the full active canvas. The complete source graph remains available without a saved view, including projected blank nodes and unfamiliar resource-valued predicates. Any later temporary filter must disclose what it hides and be removable; this decision does not require filters for the MVP.

For the selected resource, provide a navigable list of its exact incoming and outgoing RDF triples, identifying direction, predicate, and the opposite endpoint by RDF term rather than label alone. Selecting an endpoint centers it without losing access to the rest of the graph. Keep different predicates between the same endpoints separately addressable and expose self-loops. This list complements the canvas when many incident edges form a dense fan; highlighting all 249 neighbors in the proof did not make that fan readable.

Use viewport culling only as a rendering optimization: off-screen resources and relationships stay in the complete projection and remain searchable and navigable. Ordinary in-memory lookup structures are implementation details; the evidence does not justify a separate persistent exploration index, a second renderer, or a persistent RDF database. Reconsider them only after measuring a concrete gap on representative project data.

### Evidence, trade-offs, and implementation acceptance

The isolated proof lives on branch `prototype/graph-layout-and-exploration`, initially captured at commit `c5432150c3be1c046f324caf619442382b6e91e6`, under `prototypes/graph-layout/`. Its README gives exact prototype-local commands; its verdict and `measurement.json` separate measured Node layout from browser observations. Retrieve it with `git show prototype/graph-layout-and-exploration:prototypes/graph-layout/VERDICT.md`. The local evidence links in Comments are convenience links into the ignored worktree, not a requirement for another checkout.

The 100-resource/98-edge and 1,000-resource/998-edge fixtures include chains, cycles, hubs, disconnected components, an isolated blank node, a self-loop, and parallel predicates. ELK generated finite coordinates without node rectangle overlaps in 181 ms and 417 ms respectively in the recorded Node execution. Browser interaction exercised search/focus, position preservation, independent sparse presentations, preview/apply/cancel isolation, and cancellation followed by a successful fresh worker calculation. The 1,000-resource worker request took 376 ms in one observed development run; its two-frame observation was 687 ms and is not a first-paint, frame-rate, or interaction guarantee.

Compared with the grid, ELK reflects relationships and is supported by this integrated proof. Dagre and force-directed layout were documented alternatives, not experimentally compared candidates. ELK adds worker integration and an approximately 1.60 MB uncompressed worker asset; the proof also required custom edge paths for parallel predicates and self-loops. The measured trade-off is acceptable for the approved initial/reorganization behavior, without continuous automatic movement.

During production implementation, verify the two approved sizes with real node dimensions and representative ontologies/models, including rendering and interaction responsiveness; sparse saved positions and negative coordinates; independent presentations; exact source/view preservation; incremental placement; separately addressable parallel edges and self-loops; label/IRI search and navigation to off-screen neighbors; cancellation, initial failure fallback, retry, and stale-result rejection; and revision-checked persistence of an accepted layout. The relationship list, complete failure handling, durable saves, variable-size rules, and cross-platform behavior are requirements, not capabilities established by this synthetic proof. The 1,000-resource trial is an evidence target rather than a maximum supported size or a performance guarantee.

No additional architectural fog or child decision is identified. [Choose specialized form bindings and generic fallback](16-specialized-form-boundary.md) remains the map's only unresolved decision. The functional interview stays closed; no new glossary term or hard-to-reverse ADR is needed for this renderer/layout policy.

## Validation

- Checked 32 local Markdown links across this ticket, the map, and the prototype verdict; confirmed both blockers are resolved and the map contains exactly one pointer to this answer. The remaining unclaimed, unblocked frontier is **Choose specialized form bindings and generic fallback**.
- Reviewed the answer against the user's three approval rounds, the resolved projection/presentation/runtime contracts, and the prototype execution record. Accepted requirements are distinguished from measured capabilities, and layout mutates presentation only.
- `git diff --check` found no whitespace errors in either worktree. This close-out changes documentation only; the recorded prototype build and measurements belong to the preceding execution, and no production behavior or new runtime test result is claimed.
