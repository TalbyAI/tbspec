# RDF engine comparison verdict

## Executive summary

Both candidates passed the same integrated RDF contract fixture on 2026-09-28. Both parsed Turtle and N-Triples into project named graphs; exposed only ontology and model graphs through the default union; ran typed `SELECT`, `ASK`, `CONSTRUCT`, and `DESCRIBE`; rejected Update, `SERVICE`, `FROM`, and `FROM NAMED` before execution; emitted one SHACL Core and one SHACL-SPARQL violation with `https://example.org/shapes` attached; and kept an unrelated named-graph query available after a malformed file was rejected. After reviewing the proof, the user selected **Node/RDF.js**: it meets the required MVP contract and allows CLI and loopback web code to share a runtime. Jena additionally produces implicit RDFS facts; Node can recover the MVP's narrow subclass and subproperty relationships with SPARQL property paths, without exposing inferred triples to arbitrary queries.

## Execution record

| Candidate | Environment and command | Outcome |
| --- | --- | --- |
| Node/RDF.js | Windows; Node 24.14.1, npm 11.17.0; `node/`: `npm ci`, `npm test` | Exit 0; 14 `PASS` checks; 2 SHACL diagnostics |
| Embedded Jena | Windows; Temurin JDK 21.0.12.1+1, Maven 3.9.16, Jena 6.2.0; `jena/`: `mvn -q compile exec:java '-Dexec.mainClass=Smoke'` | Exit 0; 14 `PASS` checks; 2 SHACL diagnostics |

The same files under `fixtures/` supplied both runs: `ontology.ttl`, `model.nt`, `decoy.ttl`, `shapes.ttl`, and `malformed.ttl`. The last file has a valid prefix followed by invalid Turtle. The proof checks a failed replacement of the decoy graph, verifies its previous contents remain, then queries the separate model graph.

| Behavior | Node/RDF.js | Embedded Jena |
| --- | --- | --- |
| Local parsing and graph isolation | Strict N3 parser with complete parse before `N3.Store` replacement | RIOT parser into a staging graph before `DatasetGraph` replacement |
| Selected default union | Query-only store copies ontology/model quads into the default graph; decoy remains named | `DynamicDatasets` selects ontology/model defaults and retains named graph access without copying triples |
| Typed binding | RDF/JS integer literal in Comunica `initialBindings` | Jena integer `Node` in `QueryExecBuilder.substitution` |
| Read-only query forms | All four forms passed | All four forms passed |
| Forbidden forms | Traqula AST gate rejected Update, top-level and nested `SERVICE`, `FROM`, `FROM NAMED` | Query parser, dataset check, and algebra walk rejected the same cases; `ARQ.httpServiceAllowed=false` was also set |
| SHACL | `shacl-engine` Core and opt-in SPARQL plugin; 2 violations | `jena-shacl` Core and SPARQL; 2 violations |
| Diagnostic attribution | Validation runs per shapes graph and attaches its IRI to each result | Validation runs per shapes graph and attaches its IRI to each entry |
| Optional hierarchy relations | No implicit triples; SPARQL property paths found subclass and subproperty relationships | RDFS simple reasoner inferred both as triples; it also entails more than those two relations |

The query engines received only local in-memory sources. The fixtures use `127.0.0.1:1` in forbidden `SERVICE` and `LOAD` examples; they were rejected before execution. SHACL query literals were preflighted through the same gate. This run did not impose an operating-system egress firewall, so it proves the tested application and engine paths, not a process-wide network ban. Hard egress isolation remains an implementation boundary.

## Trade-offs and limits

- Node can use one runtime for the CLI and web app. The selected default union needs a separate query view and copies triples; the minimal package set installed 486 npm packages. Its tested hierarchy lookup requires explicit property-path queries and does not add inferred triples to general query results.
- Jena's selected union uses a dataset view, and RDFS simple inference works directly. It requires Java 21; Maven downloaded 99 jars into this prototype's local `.m2/` for dependencies and build plugins. Its inference mode is broader than the MVP's narrow subclass/subproperty interest.
- The proof covers two single-graph formats. It does not establish support or safe dispatch for every standard external RDF format, large datasets, concurrent file edits, or the production OS network boundary. The malformed-file test proves staged import and independent graph querying; full project-wide query failure on a malformed required file remains an application-level behavior to design.

Node is the selected MVP engine baseline. [Choose the Node runtime and package baseline](../../.scratch/mvp-technical-architecture/issues/05-select-rdf-stack.md) will settle exact runtime and package boundaries, document the unprototyped alternatives, and determine whether an ADR is needed. The remaining security and dataset details belong to their later architecture tickets.
