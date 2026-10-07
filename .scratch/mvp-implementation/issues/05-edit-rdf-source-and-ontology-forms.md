# Edit RDF through the canvas, Turtle, and ontology forms

Type: task
Status: ready-for-agent
State: open
Blocked by: 04
User stories covered: 56, 57, 58, 59, 60, 61, 62, 78, 79, 80, 81, 85

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A browser author can explore the complete RDF graph without saving a view, edit exact triples and literal values, switch to raw Turtle, and use ontology/conceptual-data forms over the same content. Unknown statements and unsupported structures remain usable and lossless. Stale drafts and malformed source have explicit repair workflows, while locked content stays read-only.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] The complete canvas projects IRI/blank-node subjects and resource-valued objects as nodes and each resource-valued source triple as an individually addressable exact edge. Literals appear in an RDF-term properties panel; unfamiliar predicates and blank-node structures remain visible.
- [ ] Generic add/remove/replace operations preserve exact term identity, unknown statements, language/datatype, parallel predicates, and self-loops. Blank-node identity is scoped to its source graph/revision; graph serialization preserves RDF semantics rather than promising Turtle formatting/comments.
- [ ] Raw Turtle saves preserve the submitted text and may be syntactically invalid. Report syntax diagnostics and disable graph/form mutations until parsing succeeds; parseable semantic invalidity remains editable and saveable.
- [ ] Source, file, and form saves compare captured revisions, including comment-only changes. On conflict retain the draft and require explicit reconciliation against the current revision; a second concurrent change can conflict again, and replacement never bypasses checks.
- [ ] Recognize ontology/conceptual families only from valid graph classification and exact explicit OWL/RDFS types. Share class/datatype/property bindings and ontology-individual fields; concrete/custom/unclassified or ambiguously classified graphs use generic/source editing.
- [ ] Expose every applicable type section and every existing value, including incompatible types, cardinality excess, unusual term kinds, and advanced blank-node OWL expressions. Route unsupported values to generic access without flattening them or disabling unrelated editable fields.
- [ ] Form recognition is independent of design selection, labels, prefixes, filenames, and inferred hierarchy. A local vocabulary copy retains forms for unchanged terms; arbitrary replacements are not mapped. Existing recognized values remain editable with diagnostics, but creation offers only available exact terms.
- [ ] Unchanged fields cause no mutation. Lexical-only literal edits preserve language/datatype; resource-valued edits replace only the selected value. Creation writes selected exact types/values without superclass, inverse, or optional materialization.
- [ ] Locked snapshots cannot be modified through any editor; expose the separate editable-import workflow. No view or presentation is required for complete-graph editing, and temporary canvas positions do not create persisted support silently.
- [ ] Browser/public-operation checks demonstrate editor switching, lossless unknown/multiple/language/datatype statements, a generic blank-node restriction, multi-type sections, invalid versus parseable-invalid saves, stale draft reconciliation, safe text rendering, and read-only enforcement. Process/state forms and saved-view synchronization are extended in their own slices.

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
