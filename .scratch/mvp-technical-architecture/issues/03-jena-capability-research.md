# Research the embedded Jena contract

Type: research
Status: ready-for-agent
State: resolved
Assigned to: research/jena-contract agent
Research branch: `research/jena-contract`

## Question

From Apache Jena primary documentation and APIs, establish a current embedded Java dependency set and the smallest proof for Turtle plus another standard single-graph format, project named graphs, an ontology/model-only default union, typed read-only SPARQL bindings, SHACL Core plus SHACL-SPARQL, and diagnostics identifying the shapes graph. Determine pre-execution rejection of Update, `SERVICE`, `FROM`, and `FROM NAMED`, network isolation, malformed-file isolation, and optional subclass/subproperty inference. No Fuseki service is assumed. Record limitations and exact source links; do not select the engine.

Primary-source starting points: [Jena documentation](https://jena.apache.org/documentation/), [Jena SHACL](https://jena.apache.org/documentation/shacl/), and [GraphOps API](https://jena.apache.org/documentation/javadoc/arq/org.apache.jena.arq/org/apache/jena/sparql/graph/GraphOps.html).

## Answer

The primary-source findings are in [Embedded Apache Jena contract](../research/jena-contract.md). Embedded Jena supports an in-memory proof with a selected default union and SHACL validation; staged imports, query checks, and network controls need explicit handling. Engine selection remains open until the integrated proof.
