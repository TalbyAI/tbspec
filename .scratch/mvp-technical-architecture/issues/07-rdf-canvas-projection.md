# Choose the RDF-to-canvas projection and editing boundary

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: Codex
Blocked by: 05, 06

## Question

How will the chosen canvas project a source graph, saved view, presentation graph, and visual design into editable elements while preserving triples it does not understand? Decide how generic and specialized editing share the same RDF source, how literal and blank-node cases are represented, how unknown terms fall back, and where source-versus-canvas conflicts are detected. Use the canvas proof and chosen RDF stack as evidence.

## Comments

- The React Flow proof projects resource-valued triples as edges, shows literals in a properties panel, exposes blank nodes in the complete graph, and keeps source, view, and presentation RDF separate. It preserved an unrecognized triple through editing. The functional spec limits saved view membership to IRI resources and their relationships; blank nodes remain available in the complete graph.
- The user chose separate actions for removing a relationship from the current view and deleting its source triple, with source deletion affecting all views. Applying a stale Turtle draft must stop, show both changes, and require explicit confirmation before replacing current canvas edits. Generic and specialized editors use shared RDF triple operations so unrecognized statements remain intact. A resource with multiple applicable `rdf:type` visual rules uses generic appearance with a warning until a rule is explicitly chosen.
- The user chose to synchronize saved-view relationship membership when canvas operations change source triples; direct Turtle edits leave views intact and produce diagnostics for broken references. Blank nodes are editable in the complete graph but cannot be saved as view members, and their identifiers need not survive Turtle rewrites. The generic literal panel adds, changes, and removes individual RDF terms, including datatype or language, preserving those when only lexical text changes. A resource's explicit visual-rule choice is per saved view in its presentation graph; a choice in the complete graph is temporary until saved in a view.
- The user chose to remove an IRI resource's incident view relationships and saved presentation position when removing it from a saved view. The source graph and other views remain unchanged.
- The user confirmed the complete projection and editing contract below.

## Answer

Use the parsed RDF source graph as the sole content model. Project each IRI or blank-node subject or resource-valued object as one React Flow node, and each source triple with a resource-valued object as an edge. Include unfamiliar predicates and structural RDF relationships in the complete graph. Show literal-valued triples for the selected resource in a properties panel; identify editable statements by RDF terms rather than display labels. Projection and editing do not infer or persist additional triples.

A saved view selects IRI resources and exact source relationships between selected IRI endpoints. Its presentation graph stores positions and local appearance choices; reusable visual design models supply declarative rules, not content or positions. The complete graph requires no saved view, and its positions and appearance choices remain temporary until saved to one. Selecting a relationship for a view selects both endpoints. Adding a resource also includes existing relationships to resources already selected, as confirmed in the canvas proof. Removing a resource from one view removes its incident view relationships and saved position, without changing the source or other views. Separate actions remove a relationship from the current view or delete its source triple. Canvas source edits that replace or delete a relationship update its membership in all affected saved views. Direct Turtle edits leave view files unchanged; validation reports any references they break rather than silently repairing them.

Render resources with the applicable winning visual design rule for their concept type. Keep rule selection separate from specialized form recognition. An uncovered term uses the generic renderer with a warning. If a resource has multiple `rdf:type` values with different applicable rules, use the generic renderer with a warning until the user explicitly chooses a rule for that resource and saved view; record that choice in its presentation graph. A choice made in the complete graph is temporary until saved in a view. Exact RDF terms and constraints for view, presentation, and visual-rule data belong to [Define metadata and starter resource identities and shapes](11-starter-resource-contract.md).

Generic canvas and specialized forms apply the same RDF-term-level add, remove, and replace operations to the same source graph. They preserve statements they do not recognize. The generic literal panel can add, replace, and remove individual literal terms, including language and datatype; changing only the lexical value retains those attributes. Blank nodes and their properties or relationships are editable in the complete graph, but blank nodes cannot be saved as view members because their identifiers are not stable across source rewrites. RDF serialization must preserve unknown statements, language tags, and datatypes; Turtle formatting and comments need not survive reserialization.

Track the parsed source revision from which a Turtle draft began. If canvas edits make the draft stale, stop application, show both changes, and require explicit confirmation before the draft replaces them. The source editor may save invalid RDF with diagnostics, but graph-based editing of that source remains unavailable until it parses. File-level conflict checks and multi-file commit mechanics belong to [Choose safe project file mutations and edit conflicts](10-file-transaction-boundary.md).

The [React Flow canvas proof](../../../prototypes/react-flow-canvas/VERDICT.md) demonstrated the complete graph, blank-node visibility, literal editing, separate view positions, relationship editing, and preservation of an unknown triple on a small fixture. It did not establish a production RDF vocabulary, file transaction mechanism, or large-graph layout; those remain in their existing downstream tickets.
