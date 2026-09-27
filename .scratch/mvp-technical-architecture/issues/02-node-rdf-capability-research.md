# Research the Node/RDF.js contract and compatible packages

Type: research
Status: ready-for-agent
State: resolved
Assigned to: research/node-rdf-contract agent
Research branch: `research/node-rdf-contract`

## Question

From primary documentation and source, establish the current compatible Node/RDF.js package versions and APIs for Turtle plus another standard single-graph format, local named-graph SPARQL with typed bindings, a default union limited to ontology/model graphs, and SHACL Core plus SHACL-SPARQL. Identify how to reject Update, `SERVICE`, `FROM`, and `FROM NAMED` before execution; whether any path can fetch remotely; and the smallest executable integrated proof. Start with N3.js, rdf-parse.js, Comunica, shacl-engine, and a maintained SPARQL parser candidate. Record limitations and exact source links; do not select the engine.

Primary-source starting points: [N3.js](https://github.com/rdfjs/N3.js/), [rdf-parse.js](https://github.com/rubensworks/rdf-parse.js/), [Comunica RDF/JS querying](https://comunica.dev/docs/query/advanced/rdfjs_querying/), [Comunica context](https://comunica.dev/docs/query/advanced/context/), [shacl-engine](https://github.com/rdf-ext/shacl-engine), and [Traqula](https://github.com/comunica/traqula). Check whether Comunica's `unionDefaultGraph` includes all named graphs; the proof needs a selected subset.

## Answer

The primary-source findings are in [Node/RDF.js contract research](../research/node-rdf-contract.md). The packages support an in-memory proof; a selected default union, staged imports, and the query security gate need application logic. Engine selection remains open until the integrated proof.
