# Compare RDF engines with one integrated proof

Type: prototype
Status: ready-for-human
State: open
Assigned to: Codex
Blocked by: 02, 03

## Question

Using identical minimal fixtures for Node/RDF.js and embedded Jena, which candidate actually satisfies spec 0.1's RDF contract and local-query security? Exercise Turtle and another standard input format; named graphs and the selective default union; `SELECT`, `ASK`, `CONSTRUCT`, and `DESCRIBE` with typed bindings; forbidden query forms with network blocked; SHACL Core and SHACL-SPARQL reports naming their shapes graph; and a malformed file that does not block an unrelated graph-specific query. Check optional subclass/subproperty inference separately. Link the throwaway proof and review its observed trade-offs with the user.

## Comments

- 2026-09-28: Proof captured on branch `prototype/rdf-engine-comparison`: [README](../../../prototypes/rdf-engine-comparison/README.md), [verdict](../../../prototypes/rdf-engine-comparison/VERDICT.md). Both candidates passed locally; awaiting the human review required by this prototype ticket.
