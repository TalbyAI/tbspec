# Compare RDF engines with one integrated proof

Type: prototype
Status: ready-for-human
State: resolved
Assigned to: Codex
Blocked by: 02, 03

## Question

Using identical minimal fixtures for Node/RDF.js and embedded Jena, which candidate actually satisfies spec 0.1's RDF contract and local-query security? Exercise Turtle and another standard input format; named graphs and the selective default union; `SELECT`, `ASK`, `CONSTRUCT`, and `DESCRIBE` with typed bindings; forbidden query forms with network blocked; SHACL Core and SHACL-SPARQL reports naming their shapes graph; and a malformed file that does not block an unrelated graph-specific query. Check optional subclass/subproperty inference separately. Link the throwaway proof and review its observed trade-offs with the user.

## Comments

- 2026-09-28: Proof captured on branch `prototype/rdf-engine-comparison`: [README](../../../prototypes/rdf-engine-comparison/README.md), [verdict](../../../prototypes/rdf-engine-comparison/VERDICT.md). Both candidates passed locally.
- 2026-09-28: The user reviewed the verdict and selected the Node solution because it can share a runtime across CLI and web without losing required MVP features. The user confirmed that each prototype should have a `README.md`.

## Answer

Select Node/RDF.js as the MVP engine baseline. The integrated proof found equal coverage of the required RDF, SPARQL, SHACL, graph-isolation, and local-query checks in Node and embedded Jena; Node also permits a single runtime for CLI and loopback web. This is the user's reviewed decision. [The verdict](../../../prototypes/rdf-engine-comparison/VERDICT.md) records the fixtures, commands, results, and limitations.

The comparison has one qualification: Jena's optional RDFS simple reasoner produced implicit subclass and subproperty facts. Node did not produce implicit triples, but its tested SPARQL property paths recovered both relationships needed for the MVP's optional hierarchy lookup. General RDFS inference is not selected. The proof did not establish a process-wide network ban or full malformed-project dataset handling; later architecture tickets retain those boundaries.
