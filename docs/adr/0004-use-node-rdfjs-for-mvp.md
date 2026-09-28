# Use Node and RDF.js for the MVP engine

The integrated proof found that Node/RDF.js and embedded Jena both satisfy the tested RDF, SPARQL, SHACL, and local-query contract. Use Node/RDF.js so the CLI and loopback web can share one runtime, accepting an application-built selected default union and explicit SPARQL property paths for optional hierarchy lookup instead of Jena's broader inference. The [runtime and package baseline](../../.scratch/mvp-technical-architecture/issues/05-select-rdf-stack.md) records exact versions and the query-security boundaries.
