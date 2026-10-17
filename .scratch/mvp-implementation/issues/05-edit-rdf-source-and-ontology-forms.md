# Edit RDF through the canvas, Turtle, and ontology forms

Type: task
Status: ready-for-agent
State: open
Assigned to: Codex
Blocked by: 04
User stories covered: 56, 57, 58, 59, 60, 61, 62, 78, 79, 80, 81, 85

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A browser author can explore the complete RDF graph without saving a view, edit exact triples and literal values, switch to raw Turtle, and use ontology/conceptual-data forms over the same content. Unknown statements and unsupported structures remain usable and lossless. Stale drafts and malformed source have explicit repair workflows, while locked content stays read-only.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Completion boundary

Close on complete-graph generic/source editing and ontology/conceptual forms, exact RDF-term preservation, invalid-source repair, stale-draft reconciliation, and locked read-only behavior. Saved-view/presentation synchronization is owned by 13; specialized process/state forms by 16/17; element deletion by 18; complete layout/exploration by 15. All currently enabled edits already require revision checks, confinement, and failure preservation.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

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
- [ ] Browser/public-operation checks demonstrate editor switching, lossless unknown/multiple/language/datatype statements, a generic blank-node restriction, multi-type sections, invalid versus parseable-invalid saves, stale draft reconciliation, safe text rendering, and read-only enforcement. Include a parseable unclassified graph that remains listed and generically/source editable without invented classification. Exercise every applicable class, datatype, object/datatype property, and ontology owl:NamedIndividual field in the exact architecture-16 binding table, with its permitted term kinds and generic fallback. Process/state forms and saved-view synchronization are extended in their own slices.

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
- On 2026-10-12, the user approved retaining drafts throughout the open workspace, refreshing project status after saves, and offering all available declared properties during typed creation. Actual reload/closure warns but does not restore drafts; autosave and crash recovery remain excluded.

## Answer

Implemented shared `showEditor`, `prepareEdit` and `editGraph` operations, authenticated worker-backed editor reads/previews, and the complete React Flow graph, exact RDF-term controls, Turtle source editor and ontology/conceptual forms. IRI/blank-node subjects and resource-valued objects remain nodes; resource-valued source triples remain separately selectable directed edges, including parallel predicates and self-loops. Unknown structures, blank-node restrictions, all explicit types and individual literal values remain available. Positions are temporary and create no support files.

Forms use exact OWL/RDFS types in valid ontology/conceptual classifications and expose every applicable section, independently of visual design selection. Ontology individuals use generic exact-term values. Unsupported, concrete/custom and ambiguous graphs retain generic/source access. New resources publish the selected type and initial values together; available vocabulary declarations gate creation types, fields and initial explicit types. Missing vocabulary does not erase recognized existing sections or prevent edits to existing values. No superclass, inverse, domain/range or optional values are invented.

Every edit binds the captured source byte revision and uses the existing staged preview and safe publication boundary. Browser previews remain session/instance owned, expiring and single-use. Comment-only changes conflict. Source, statement and creation drafts retain their original revision; reconciliation shows current source and the relevant draft and requires explicit review before another save. A further change still conflicts. Lexical edits preserve language/datatype, unchanged fields preserve bytes, and graph serialization retains RDF semantics. Turtle saves preserve exact submitted text and allow malformed source with diagnostics; graph/forms remain disabled until repair. Parseable semantic invalidity remains saveable with validation results. Locked snapshots and non-Turtle source formats are read-only; editable import remains the route to an owned Turtle copy. Vetted locked P-Plan RDF/XML still projects correctly.

Public-operation checks cover unknown/multiple/language/datatype values, atomic typed creation, unavailable initial types with unchanged bytes, missing vocabulary, exact removals, parallel predicates/self-loops, new and existing blank nodes, graph/revision scope rejection, unchanged-byte saves, ambiguous classification, malformed repair and repeated conflicts. Real HTTP checks cover large source submissions, original-byte preservation before application, Origin and spoofed-project rejection, session-owned previews, one-use application, stale revisions and read-only dependencies. The collaborative browser demonstrated eight nodes/eight exact resource-valued edges on the integrated fixture, both recognized type sections, language-preserving form edits, retained stale Turtle reconciliation, malformed-source diagnostics and disabled graph editing, safe literal rendering with no injected image element, and atomic resource creation with an initial label and refreshed graph details.

Standards review found no hard violations; its duplicate-loader observation was retained because initial loading guards unmounts while post-save inspection updates the containing graph details. Spec review identified initial-value creation and unavailable initial type gaps; both were corrected and the creation regression rerun. Full Windows/Node 24 execution passed 153 of 155 application tests, with no failures and two native macOS skips. Final creation checks, application typechecks/build, root formatting and read-only quality checks passed after the review corrections. The temporary browser server was stopped after verification.

Process/state forms and saved-view synchronization remain in their subsequent tickets. No native Linux/macOS execution, mobile browser test, representative large-graph responsiveness/memory measurement, installed-artifact acceptance, hosted CI run or publication is claimed. The existing provisional worker memory limit and preview-capacity limit remain unchanged; ticket 20 retains complete supported-platform acceptance.

The approved follow-up keeps per-graph source, statement and creation drafts in workspace memory, including their original revisions, initial values and reconciliation context, across sections, graph selection and workspace Refresh. Refresh preserves selection; save/discard clears only its own draft. Unsaved work registers a browser departure warning, without persistent browser storage or restoration after reload/restart. Save controls and navigation prevent overlapping edits during publication. Successful saves refresh status, inventory and graph details, invalidate previous validation results, and distinguish a completed write from failed post-save inspection. Typed creation now offers declared custom properties from the same resolved vocabulary and rejects unavailable initial predicates without changing bytes; generic existing-statement editing remains unrestricted by that creation gate.

Follow-up Windows/Node 24 verification passed 155 of 157 application tests, with no failures and the same two native macOS skips. The final eight editor/public-operation regressions, application typechecks/build and root formatting/read-only checks passed. Collaborative-browser checks demonstrated all three draft kinds and initial values surviving sections, graph selection and Refresh; custom initial-property creation retaining an unrelated source draft; that draft still conflicting against its original revision; departure-warning registration and removal after explicit discard; frozen inputs/navigation during saving; immediate invalid project status and changed inventory classification after malformed-source publication; and a simulated post-save status-read failure reporting a successful repair with unavailable project status, recoverable by Refresh. Native departure dialogs, mobile/crash recovery and other platforms were not verified.

Merge validation on 2026-10-12 reran the full Windows suite (155 passed, two native macOS skips), then typechecks/build and all eight editor regressions after correcting a post-save inspection race. Workspace refresh remounts the editor, so the old editor's redundant successful-save read could overlap the new editor's initial read and hit the server's single-inspection capacity. The refreshed editor now owns that reload, including when workspace inspection fails. A browser assertion reproduced three post-save editor reads before the correction and passed with two sequential reads afterward. Playwright checks also verified draft retention and stale revisions, publication controls, custom initial properties, immediate invalid status/inventory, and recovery after a simulated status-read failure. The shared browser connection became unavailable during verification; the installed Playwright CLI completed these checks.

Hosted review on PR 22 identified two further corrections: initial editor inspection now reports workspace busy state until settlement, and the HTTP documentation includes the editor routes without deferring statement editing. A gated browser assertion failed before the busy-state correction with Refresh and validation enabled during loading, then passed after it; a simulated initial-read failure released controls and recovered through Refresh. All draft, publication and status browser assertions passed again, as did the eight editor regressions, typechecks/build and root quality checks. The preceding commit's hosted application matrix passed on Windows, Linux and both macOS runners; the final correction requires its own hosted checks before merging.

The final correction passed hosted quality checks and the Windows, Linux and Apple Silicon application suites. Intel macOS passed typechecks/build and native process checks, but two attempts were cancelled at the application job's ten-minute limit while the full suite continued producing passing assertions. Neither log contained an assertion failure. The existing job allowance was increased to twenty minutes to permit full execution on slower runners; test commands, assertions and per-test timeouts were unchanged. CodeRabbit's follow-up review was rate-limited; its two completed-review findings were independently verified and corrected, and the inline thread was automatically resolved.

- On 2026-10-17, merge reconciliation retained the implementation answers and verification history from `main`. The ticket is reopened only for expanded semantic-audit criteria whose complete evidence has not been reconciled; unchecked criteria do not establish a production failure or authorize new implementation.
