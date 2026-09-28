# Test React Flow for the generic canvas

Type: prototype
Status: ready-for-human
State: resolved
Assigned to: Codex

## Question

Can a rough React Flow canvas support editing first and full-graph exploration for spec 0.1? Show generic RDF nodes, relationships, literals, and blank nodes; direct relationship editing; preservation of unrecognized triples through a round trip; a complete graph and two saved views with different presentation positions. Keep RDF files as source of truth. Have the user react to the editing and exploration behavior. Consider another renderer only if a concrete gap appears; do not compare AntV X6 in the initial pass.

## Prototype evidence

The [React Flow canvas prototype](../../../prototypes/react-flow-canvas/README.md) and its [verdict](../../../prototypes/react-flow-canvas/VERDICT.md) on branch `prototype/react-flow-canvas-proof` provide a positive technical proof on a small RDF fixture. Source, view, and presentation graphs are separate Turtle fixtures. The complete graph exposes blank nodes; two views have independent positions; editing a relationship changes the source RDF and selected view; an opaque triple survives the round trip. The provisional view vocabulary is not an architecture decision.

The user found the interaction mostly correct, but reported a visual jump after saving a literal, an omitted Alice → Customer relationship when adding Customer to Customer view, and a growing blank-node identifier after applying Turtle. The prototype now replaces edited statements in place, includes links to existing view members when adding a resource, and parses source Turtle without prefixing blank-node labels. The local check passes, and the user confirmed all three corrections in the browser.

## Answer

Yes for the small integrated fixture. React Flow supports the generic RDF canvas interaction needed to proceed: complete-graph exploration, blank-node visibility, literal editing, direct relationship editing, and two saved views with independent positions. RDF quads remain the source of truth; view membership and presentation positions remain separate RDF graphs. No measured gap calls for another renderer yet. Ticket 07 can now decide the production projection and editing boundary; ticket 15 will address layout and larger-graph exploration.

## Comments

- The user found the first version mostly correct but reported the literal-save visual jump, the missing Alice → Customer edge after adding Customer to the view, and growing blank-node identifiers after applying Turtle.
- After the corrections, the user retested all three behaviors and confirmed they work as expected.
