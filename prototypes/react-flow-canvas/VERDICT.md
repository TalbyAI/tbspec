# React Flow RDF canvas verdict

## Executive summary

The result is positive for the small MVP fixture: React Flow displayed the complete RDF graph (including a blank node), two independently positioned saved views, literal properties, and directly editable relationships. Source edits were applied back to Turtle, and an unrecognized triple survived an RDF edit and serialize/parse round trip. Editing from a saved view also updated that view's relationship membership. The user found the interaction mostly correct, identified three confusing behaviors, and confirmed the corrections after retesting. React Flow is sufficient to continue to the RDF-to-canvas projection decision; no alternative renderer is indicated by this proof.

## Execution record

- Run on Windows on 2026-09-28 with Node 24.14.1 and npm 11.17.0. `npm install` installed 49 packages in this prototype directory.
- `npm run check`: exit 0. It checked full-graph projection, blank-node visibility, literal presence, two view subsets, distinct positions, relationship editing, automatic endpoint membership, blank-node view exclusion, and preservation of an opaque triple after serialization.
- `npm run build`: exit 0 with Vite 8.3.1. Vite reported a non-fatal bundler warning about React Flow's `use client` directive.
- Browser run at `http://127.0.0.1:5173/`: the complete graph showed 6 resources and 5 resource relationships; each saved view showed 2 resources and 1 relationship. The order rendered at `(100, 140)` in Customer view and `(440, 80)` in Audit view. Selecting a resource exposed its literals. Changing `ex:customer` to `ex:fulfills` through the relationship panel changed the visible edge label, source Turtle, and Customer view RDF. The UI was rendered and inspected in Chromium at a desktop viewport.
- After user feedback, `npm ci`, `npm run check`, and `npm run build` passed again. The check now verifies that editing a literal keeps statement and canvas order, adding Customer to Customer view includes Alice → Customer, and repeated source parsing keeps the blank-node identifier stable. The user then retested all three behaviors in the browser and confirmed they work as expected.

## User feedback and corrections

| Observation                                               | Cause                                                                                                            | Change                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Saving a literal moved or reordered labels                | The edited quad was removed and appended, and complete-graph fallback positions depended on quad iteration order | Replace the quad in place and sort resource IDs before assigning fallback positions                          |
| Adding Customer to Customer view omitted Alice → Customer | Node addition selected only the node, although Alice was already selected                                        | Include existing relationships from the new node to resources already in the view                            |
| Applying Turtle lengthened the blank-node ID              | N3 prefixes explicit blank-node labels on each parse to avoid cross-document collisions                          | Disable that prefix for this isolated single-source prototype; view blank nodes remain in separate RDF files |

## What this establishes

- One generic node renderer and React Flow handles were enough to try resource and blank-node selection, drag connections, pan/zoom, and edge selection. The [React Flow quick start](https://reactflow.dev/learn) documents the underlying controlled-node and edge pattern; [custom nodes](https://reactflow.dev/learn/customization/custom-nodes) supply the connection handles.
- The canvas can be a projection of RDF quads. Literal objects stay in a properties panel; resource objects become edges. A saved view selects IRI members and relationships, and its presentation graph supplies positions. This is evidence for the ticket 07 design discussion, not a final schema decision.
- Unrecognized statements can remain in the RDF source when a known relationship changes. Serialization preserves RDF statements, language tags, and datatypes; it rewrites Turtle layout and comments.

## Limits and pending reaction

- The fixture is small. This run does not establish performance or usable layout for a large graph, nor keyboard accessibility for every canvas action.
- Browser interaction confirmed switching views, selecting a resource and an edge, and editing a predicate. Dragging a node, drawing a new connection, downloaded file contents, and source parse-error recovery are backed by the runnable check or code paths but were not manually exercised in the browser run.
- The provisional `urn:canvas-proof:` membership vocabulary and in-memory download flow do not settle production file schemas, file conflicts, or persistence. Those belong to later architecture tickets.
- The user considered the interaction mostly correct and confirmed the three corrections. Large-graph behavior and layout still need their own evidence under ticket 15. If a concrete React Flow gap appears later, investigate another renderer then.

## Repository quality revalidation (2026-10-07)

After applying repository formatting and lint rules, `npm ci`, `npm run check`, and `npm run build` passed from this prototype directory on Windows with Node 24.14.1 and npm 11.17.0. The existing RDF projection, view, relationship-edit, blank-node, and round-trip assertions passed. Fixtures and the dependency lockfile were preserved.

Browser checks against the production build confirmed view switching and resource selection. Literal labels now reference their inputs with stable React IDs, graph mode uses a named navigation element, and buttons have explicit types. The intentional control-character exclusion in RDF IRI validation has a documented local lint suppression. The existing non-fatal React Flow `use client` bundler warning remains.
