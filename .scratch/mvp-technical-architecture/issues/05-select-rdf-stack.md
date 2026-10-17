# Choose the Node runtime and package baseline

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: Codex
Blocked by: 04

## Question

With Node/RDF.js selected by [the integrated proof](04-integrated-rdf-engine-proof.md), which supported Node version and pinned RDF package set should the MVP adopt for CLI and loopback web? Preserve the proof's query-security and dataset boundaries, and decide whether the optional subclass/subproperty lookup should use SPARQL property paths. Record why dotNetRDF, RDFLib/pySHACL, and RDF4J were not in the first proof, and use an ADR if the choice meets the repo's ADR threshold. The CLI/web module boundary is a later ticket.

## Answer

Use **Node 24 LTS** for both CLI and loopback web. Keep to supported 24.x patch releases rather than freezing a security patch; the integrated proof ran on 24.14.1. Node 24 is an [LTS release line](https://nodejs.org/en/about/previous-releases). The application lockfile must pin the transitive dependency graph. Start with these exact direct versions from the [passing proof](../../../prototypes/rdf-engine-comparison/node/package.json):

| Package                             | Version  | Purpose                                                          |
| ----------------------------------- | -------- | ---------------------------------------------------------------- |
| `n3`                                | `2.7.12` | Strict Turtle and N-Triples parsing; RDF/JS in-memory store      |
| `@comunica/query-sparql-rdfjs-lite` | `5.4.1`  | Local SPARQL execution without the full engine's `SERVICE` actor |
| `@comunica/utils-bindings-factory`  | `5.4.0`  | Typed RDF-term query bindings                                    |
| `@traqula/parser-sparql-1-1`        | `1.4.0`  | Pre-execution query policy check                                 |
| `shacl-engine`                      | `1.1.2`  | SHACL Core and opt-in SHACL-SPARQL validation                    |

The proof covered Turtle and N-Triples; add `rdf-parse` only when a required import format cannot be handled safely by this set. Keep the proof's boundaries: stage complete parses before replacing a named graph; construct a query-only default union from ontology and domain-model graphs; pass only in-memory RDF/JS sources and typed bindings; reject Update, `SERVICE`, `FROM`, and `FROM NAMED` before every user query and SHACL-SPARQL query reaches an engine. The proof did not establish a process-wide network ban or the complete malformed-project policy. [Choose dataset assembly and query isolation](08-query-dataset-boundary.md) and [Choose SHACL validation and diagnostic integration](09-shacl-validation-boundary.md) will settle those details.

For optional subclass and subproperty lookup, use the [tested SPARQL property paths](../../../prototypes/rdf-engine-comparison/VERDICT.md). They return the needed hierarchy relationships without adding implicit triples to ordinary query results. Do not implement general RDFS or OWL inference for the MVP.

The first proof compared one Node stack with one embedded Java stack using the same fixtures. dotNetRDF and RDFLib/pySHACL would add separate .NET or Python runtime routes, while RDF4J would duplicate the Java route represented by Jena. They remain viable alternatives; their omission was a scope choice, not a finding that they fail the contract. The engine choice and its trade-off are recorded in [ADR 0004](../../../docs/adr/0004-use-node-rdfjs-for-mvp.md). [AGENTS.md](../../../AGENTS.md) now requires a branch before modifying files on `main` and integration through pull requests.
