# Choose dataset assembly and query isolation

Type: grilling
Status: ready-for-human
State: open
Blocked by: 05

## Question

How will the selected engine assemble project RDF files and locked snapshots per operation so every resource has its correct named-graph IRI, the default union contains only ontology and domain-model graphs, and a graph-specific query can ignore malformed unrelated files? Specify where typed bindings enter the engine and where Update, `SERVICE`, `FROM`, and `FROM NAMED` are rejected before execution, with no implicit remote fetch. Retain in-memory assembly unless the proof shows a need for more.
