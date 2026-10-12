# Edit RDF through the canvas, Turtle, and ontology forms

Type: task
Status: ready-for-agent
State: resolved
Assigned to: Codex
Blocked by: 04
User stories covered: 56, 57, 58, 59, 60, 61, 62, 78, 79, 80, 81, 85

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A browser author can explore the complete RDF graph without saving a view, edit exact triples and literal values, switch to raw Turtle, and use ontology/conceptual-data forms over the same content. Unknown statements and unsupported structures remain usable and lossless. Stale drafts and malformed source have explicit repair workflows, while locked content stays read-only.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] The complete canvas projects IRI/blank-node subjects and resource-valued objects as nodes and each resource-valued source triple as an individually addressable exact edge. Literals appear in an RDF-term properties panel; unfamiliar predicates and blank-node structures remain visible.
- [x] Generic add/remove/replace operations preserve exact term identity, unknown statements, language/datatype, parallel predicates, and self-loops. Blank-node identity is scoped to its source graph/revision; graph serialization preserves RDF semantics rather than promising Turtle formatting/comments.
- [x] Raw Turtle saves preserve the submitted text and may be syntactically invalid. Report syntax diagnostics and disable graph/form mutations until parsing succeeds; parseable semantic invalidity remains editable and saveable.
- [x] Source, file, and form saves compare captured revisions, including comment-only changes. On conflict retain the draft and require explicit reconciliation against the current revision; a second concurrent change can conflict again, and replacement never bypasses checks.
- [x] Recognize ontology/conceptual families only from valid graph classification and exact explicit OWL/RDFS types. Share class/datatype/property bindings and ontology-individual fields; concrete/custom/unclassified or ambiguously classified graphs use generic/source editing.
- [x] Expose every applicable type section and every existing value, including incompatible types, cardinality excess, unusual term kinds, and advanced blank-node OWL expressions. Route unsupported values to generic access without flattening them or disabling unrelated editable fields.
- [x] Form recognition is independent of design selection, labels, prefixes, filenames, and inferred hierarchy. A local vocabulary copy retains forms for unchanged terms; arbitrary replacements are not mapped. Existing recognized values remain editable with diagnostics, but creation offers only available exact terms.
- [x] Unchanged fields cause no mutation. Lexical-only literal edits preserve language/datatype; resource-valued edits replace only the selected value. Creation writes selected exact types/values without superclass, inverse, or optional materialization.
- [x] Locked snapshots cannot be modified through any editor; expose the separate editable-import workflow. No view or presentation is required for complete-graph editing, and temporary canvas positions do not create persisted support silently.
- [x] Browser/public-operation checks demonstrate editor switching, lossless unknown/multiple/language/datatype statements, a generic blank-node restriction, multi-type sections, invalid versus parseable-invalid saves, stale draft reconciliation, safe text rendering, and read-only enforcement. Process/state forms and saved-view synchronization are extended in their own slices.

## Blocked by

- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 07](../../mvp-technical-architecture/issues/07-rdf-canvas-projection.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 16](../../mvp-technical-architecture/issues/16-specialized-form-boundary.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
- On 2026-10-12, implementation and Windows verification completed on `feat/05-rdf-editors`; see Answer for behavior, review corrections and evidence limits.

## Answer

Implemented shared `showEditor`, `prepareEdit` and `editGraph` operations, authenticated worker-backed editor reads/previews, and the complete React Flow graph, exact RDF-term controls, Turtle source editor and ontology/conceptual forms. IRI/blank-node subjects and resource-valued objects remain nodes; resource-valued source triples remain separately selectable directed edges, including parallel predicates and self-loops. Unknown structures, blank-node restrictions, all explicit types and individual literal values remain available. Positions are temporary and create no support files.

Forms use exact OWL/RDFS types in valid ontology/conceptual classifications and expose every applicable section, independently of visual design selection. Ontology individuals use generic exact-term values. Unsupported, concrete/custom and ambiguous graphs retain generic/source access. New resources publish the selected type and initial values together; available vocabulary declarations gate creation types, fields and initial explicit types. Missing vocabulary does not erase recognized existing sections or prevent edits to existing values. No superclass, inverse, domain/range or optional values are invented.

Every edit binds the captured source byte revision and uses the existing staged preview and safe publication boundary. Browser previews remain session/instance owned, expiring and single-use. Comment-only changes conflict. Source, statement and creation drafts retain their original revision; reconciliation shows current source and the relevant draft and requires explicit review before another save. A further change still conflicts. Lexical edits preserve language/datatype, unchanged fields preserve bytes, and graph serialization retains RDF semantics. Turtle saves preserve exact submitted text and allow malformed source with diagnostics; graph/forms remain disabled until repair. Parseable semantic invalidity remains saveable with validation results. Locked snapshots and non-Turtle source formats are read-only; editable import remains the route to an owned Turtle copy. Vetted locked P-Plan RDF/XML still projects correctly.

Public-operation checks cover unknown/multiple/language/datatype values, atomic typed creation, unavailable initial types with unchanged bytes, missing vocabulary, exact removals, parallel predicates/self-loops, new and existing blank nodes, graph/revision scope rejection, unchanged-byte saves, ambiguous classification, malformed repair and repeated conflicts. Real HTTP checks cover large source submissions, original-byte preservation before application, Origin and spoofed-project rejection, session-owned previews, one-use application, stale revisions and read-only dependencies. The collaborative browser demonstrated eight nodes/eight exact resource-valued edges on the integrated fixture, both recognized type sections, language-preserving form edits, retained stale Turtle reconciliation, malformed-source diagnostics and disabled graph editing, safe literal rendering with no injected image element, and atomic resource creation with an initial label and refreshed graph details.

Standards review found no hard violations; its duplicate-loader observation was retained because initial loading guards unmounts while post-save inspection updates the containing graph details. Spec review identified initial-value creation and unavailable initial type gaps; both were corrected and the creation regression rerun. Full Windows/Node 24 execution passed 153 of 155 application tests, with no failures and two native macOS skips. Final creation checks, application typechecks/build, root formatting and read-only quality checks passed after the review corrections. The temporary browser server was stopped after verification.

Process/state forms and saved-view synchronization remain in their subsequent tickets. No native Linux/macOS execution, mobile browser test, representative large-graph responsiveness/memory measurement, installed-artifact acceptance, hosted CI run or publication is claimed. The existing provisional worker memory limit and preview-capacity limit remain unchanged; ticket 20 retains complete supported-platform acceptance.
