# Graph layout and exploration proof

Throwaway behavioral proof for [Choose graph layout and exploration behavior](../../.scratch/mvp-technical-architecture/issues/15-layout-and-exploration-policy.md). It compares the earlier grid fallback with left-to-right ELK layered positions in React Flow. It is not a product UI design or production implementation.

## Exact run commands

Requires Node 24 and npm. From this prototype directory:

```sh
npm ci
npm start
```

Open `http://127.0.0.1:5174/`. Build or repeat the measurements from the same directory:

```sh
npm run build
npm run measure
```

Dependencies are installed and pinned here. This prototype imports nothing from the repository or any other prototype. All edits and view coordinates are in memory; reload resets them. The committed `measurement.json` records the original Node execution cited in the architecture decision. Running `npm run measure` replaces it with the new execution; it does not measure browser interaction or rendering.

## Fixture and scenarios

The generator produces exactly 100 or 1,000 RDF resources, with disconnected chains, cycles, hubs, and branching trees; parallel predicates, a self-loop, and an isolated blank node are included. Literal labels are not nodes. ELK sees the same directed resource-valued triples as React Flow. Layout never changes the RDF source.

1. Search a label or full IRI, then choose a result. It centers the resource and highlights its immediate neighbors without removing other graph members. Return with **Show complete canvas**.
2. Move a resource by dragging or **Move selected +100,+100**, then **Edit label**. Its coordinates stay fixed.
3. **Add related resource** in the complete graph places only the new resource. Existing coordinates remain fixed. Saved views keep explicit membership; adding source content does not silently add it to a saved view.
4. Switch between **View A** and **View B**. Both select the same first twelve IRI resources, with two different pre-positioned anchors and missing positions filled independently. Blank nodes cannot enter these saved-view subsets.
5. **Preview grid baseline** or **Reorganize** changes only the displayed preview. **Cancel preview** restores committed positions; **Apply layout** changes only the active canvas's position cache.
6. Repeat with 1,000 resources. At whole-graph zoom the long chain and hub make labels unreadable; use search and zoom to inspect them. Viewport culling avoids drawing off-screen elements while keeping the complete graph projected.

Layout runs in a dedicated browser worker with stale-result guards. **Cancel calculation** terminates the worker; the next request creates work on a fresh worker. Coordinates are fixed-size (180×58); configurable product node dimensions, other operating systems, keyboard drag access, dense real ontologies, and file transactions are not proven here. ELK routes are not used: React Flow draws Bézier paths, with a small custom edge for parallel predicates and self-loops. The move button exercises position state; it does not establish manual drag accessibility or usability.

See [VERDICT.md](VERDICT.md) for the execution record, sources, human acceptance, and remaining limits.
