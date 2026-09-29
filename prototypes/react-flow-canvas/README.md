# React Flow RDF canvas prototype

Throwaway interaction proof for [ticket 06](../../.scratch/mvp-technical-architecture/issues/06-react-flow-canvas-proof.md). It tests whether one generic React Flow canvas can support RDF editing and complete-graph exploration. It is an interaction proof, not a comparison of visual layouts or renderer libraries.

## Run

Requires Node 24 and npm. From this directory:

```sh
npm ci
npm start
```

Open `http://127.0.0.1:5173/`. All dependencies install in this directory. To run the small RDF check and build:

```sh
npm run check
npm run build
```

## Try it

1. Open **Complete graph**. Select the blank node and other resources to inspect literal properties. Change a literal in the right panel.
2. Select a relationship and change its predicate IRI, or drag from one node handle to another and enter a predicate IRI. The Turtle source reflects the edit.
3. Switch between **Customer view** and **Audit view**. The same order resource has different positions. Drag it in one view and switch back to confirm that only that view's presentation RDF changes.
4. In the complete graph, select **Customer** and add it to Customer view. The existing Alice → Customer relationship appears because Alice is already in that view. Adding a relationship directly also adds its endpoints. Blank nodes are visible in the complete graph but cannot be saved as view members.
5. Edit Turtle directly and press **Apply Turtle**. A parse error leaves the current graph intact. Download the source, view, or presentation RDF to inspect the result.

The five Turtle fixtures in `fixtures/` seed the in-memory state. The canvas is projected from parsed RDF quads; it does not own a second graph model. Graph edits reserialize the source RDF. View membership and presentation positions remain separate RDF graphs. Downloads are explicit; edits do not write to disk or survive a reload. The `urn:canvas-proof:` view vocabulary is temporary and does not decide the production schema.

See [VERDICT.md](VERDICT.md) for evidence and limits.
