# MVP Technical Architecture Wayfinder

Label: wayfinder:map

## Destination

An implementation-ready technical architecture for the closed [MVP functional specification 0.1](../mvp/spec.md): selected technologies, exact contracts, and evidence sufficient to plan the MVP build. Production CLI and web implementation begins after this map.

## Notes

- Follow [AGENTS.md](../../AGENTS.md), [CONTEXT.md](../../CONTEXT.md), [the domain convention](../../docs/agents/domain.md), and the existing [ADRs](../../docs/adr/). Use `grilling` and `domain-modeling` for human decisions, `research` for external facts, and `prototype` for concrete interaction or integrated proof. Repository documents are in English.
- Preserve the functional specification and its acceptance scenarios. RDF/TOML files are canonical. Fidelity to RDF/SPARQL/SHACL and local-query security outrank convenience. Target Windows, macOS, and Linux; one installed runtime is acceptable. Prefer one runtime for CLI and loopback web when the contract is equally satisfied.
- Compare Node/RDF.js with embedded Apache Jena using the same small integrated fixtures. Prefer Node if both satisfy the contract and security equally. Keep dotNetRDF, RDFLib/pySHACL, and RDF4J in the trade-off record, without adding them to the first proof. Start with in-memory datasets assembled from files per operation.
- Editing leads the canvas proof while full-graph exploration remains required. Try React Flow first. Revisit Cytoscape.js or Sigma.js only if a measured gap appears; layout is a later decision. TanStack Start is a possibility only if Node wins. CLI and web share project operations outside route handlers.
- The earlier functional interview is closed; do not reopen it. Primary-source pointers for the engine and canvas candidates are recorded in the relevant research and proof tickets.
- Ticket `Status:` uses the five repo triage names; `State:` and `Assigned to:` track Wayfinder resolution and claims. Work at most one non-research ticket per session.

## Decisions so far

- [Choose the permanent domain and ontology IRI policy](issues/01-permanent-iri-policy.md): `talby.ai` hosts three vocabularies with stable `#` term IRIs and immutable versions starting at `0.1.0`.
- [Research the Node/RDF.js contract and compatible packages](issues/02-node-rdf-capability-research.md): Viable candidate for the integrated proof, with application-level dataset and security work.
- [Research the embedded Jena contract](issues/03-jena-capability-research.md): Viable embedded candidate for the same proof, with explicit staging and network controls.
- [Compare RDF engines with one integrated proof](issues/04-integrated-rdf-engine-proof.md): Both passed required checks; the user selected Node/RDF.js for a shared runtime, with optional hierarchy lookup via SPARQL paths.

## Not yet specified

- A failed canvas proof may reveal alternative technical routes that cannot be specified until the failure is observed.

## Out of scope

- Production implementation, package publication, and deployment of the MVP.
- Features excluded by [spec 0.1](../mvp/spec.md#outside-the-mvp), including SPARQL Update, remote `SERVICE`, full OWL reasoning, executable visual plugins, and a persistent RDF database without evidence.
