# Validate models, schema associations, and constraints offline

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 03
User stories covered: 2, 5, 25, 26, 29, 30, 89, 90, 91, 92, 93, 94, 101

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can associate a concrete model with zero or more conceptual schemas, author associated shapes, and validate selected resources or the whole project offline. Both interfaces report syntax, classification, vocabulary, association, view, presentation, and SHACL diagnostics separately, including what could not be checked. The validation workflow uses only declared local or locked interpretation context and never treats arbitrary individual-valued IRIs as fetch instructions.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Implement model schema list/add/remove, shapes list/create, and selected/whole-project validate with matching browser operations. Schema removal previews the vocabulary and affected references it removes and requires confirmation; shapes deletion is delivered in issue 12.
- [x] Concrete models need not have a schema. Selected conceptual schemas add available declarations without replacing the model's own ontology; missing, nonconceptual, or wrongly classified references receive association diagnostics.
- [x] Each SHACL run contains only target triples plus the explicit effective vocabulary/schema subclass/subproperty hierarchy in the agreed validator context. Never add unrelated model data, inferred persisted statements, or a consumer manifest rebinding for locked models.
- [x] Apply target-owned, effective ontology-associated, and conceptual-schema-associated shapes separately, deduplicate equal shapes, and attribute every result to its target and source shapes graph. Dependency contexts extend this workflow in issues 08-10.
- [x] Support the settled Core and sh:sparql SELECT profile with validated prefix/PATH expansion, this projection, and pre-binding restrictions. Gate expanded queries before execution; skip unsupported/unsafe shapes as whole shapes with actionable coverage records.
- [x] Malformed RDF/shapes or missing required prerequisites block only dependent checks. Independent resources and valid shapes continue; skipped checks and blockers are explicit, no source locations are invented, and warnings/info alone remain successful.
- [x] Use the exact managed-reference positions to distinguish unavailable vocabulary/associations from ordinary external individual values. Validation, status, and rendering make no network or implicit acquisition requests.
- [x] Exercise every bundled valid/invalid vocabulary, shapes, and design fixture, including empty starters, compatible versus ambiguous roots, process inverse inputs/outputs/shared-plan/distinct-producer constraints, and state ownership/endpoints/initial/final/cycle constraints.
- [x] Allowed confirmed schema removal may leave semantic errors: the completed mutation succeeds with resulting validity, while later validation/status reports them. Revision conflicts and malformed required rewritten graphs still prevent publication.
- [x] Public-operation tests assert returned diagnostic identities, severity, target/source attribution, coverage, and RDF/file outcomes; focused CLI/browser checks verify command routing, selected prerequisite scope, schema confirmation, offline behavior, and partial validation. Later view/presentation slices extend their invariant checks here.

## Blocked by

- [03 - Create and import editable ontologies and domain models](03-create-and-import-owned-resources.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 09](../../mvp-technical-architecture/issues/09-shacl-validation-boundary.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Answer

Delivered selected and whole-project offline validation, model schema list/add/remove, and shapes list/create through shared operations, exact CLI routes and the authenticated browser. Concrete models can have no schemas. Conceptual schemas supplement the model-type ontology; missing, ambiguous and wrongly classified references receive separate association diagnostics. Both interfaces expose diagnostic severity, target/source shapes attribution, typed SHACL terms, and check coverage with explicit blockers. Browser coverage is a readable table and refresh clears stale validation results.

Validation uses coherent captured project inputs and integrity-checked locked bytes. Selected validation scans owned identities individually, retains their metadata and revisions, and loads target data and required prerequisites for evaluation. Whole validation releases parsed stores between target closures, including locked snapshots, without merging independent source-bound ontology versions or applying consumer bindings to locked models. Deferred reads must match their captured revisions; proposed bytes override those reads without changing the baseline. Ordinary external individual IRIs remain RDF values, never acquisition requests. Syntax, classification, vocabulary, associations, view/presentation invariants, shape graph errors and SHACL results stay distinct. Malformed prerequisites block dependent checks; independent resources and valid shapes continue. Warnings and information alone remain successful.

Each target/shapes run contains target data and only explicit effective ontology/schema subclass/subproperty hierarchy, also supplied to the shapes dataset for the pinned engine's class resolution. Owned, ontology-associated and schema-associated shapes run separately with equal-source deduplication. Core and local SELECT execution share whole-graph preflight: declared prefixes and predicate PATH expand before a second AST gate; required this projection and pre-binding restrictions apply to nested queries. Unsupported targets/components/rules, unsafe queries and malformed shape parameters produce actionable skipped coverage. Source blank nodes remain scoped and diagnostic identities are stable. The execution adapter corrects the pinned engine's nested Core path traversal and combined Core/SELECT property traversal without persisting inferred data.

Schema changes and shapes creation reuse confined writes, captured revisions and staged transactions. Shapes creation derives an associated empty shapes graph and refuses occupied destinations. Schema removal previews vocabulary roles lost from the effective before/after context and their exact managed references. Declarations still available from the target, another schema or an ontology remain available. The comparison covers transitively dependent owned resources, views and presentations, while ordinary selected validation keeps its prerequisite scope. It reports baseline/introduced/worsened errors with multiplicity, deactivated shapes, and skipped or unassessable checks. Confirmation remains required independently of an accepted fingerprint. Confirmed semantic invalidation publishes successfully and reports resulting affected-resource validity; it does not claim complete project validity. Stale inputs, identity ambiguity and malformed required rewritten graphs prevent publication. Unknown RDF statements and unrelated manifest bytes remain intact. Preview fingerprints bind semantic diagnostic identities and multiplicity while excluding prose and source-location variations; anonymous result identities that cannot be compared safely are reported as unassessable and their generated labels do not destabilize the fingerprint.

Initial verification on 2026-10-11 used Windows and Node 24. The later assumption review below supersedes its completeness conclusion:

- Root and application installation completed. Root `npm run format` and `npm run check`, application typechecks and the production build passed. The full application suite passed 102 of 104 tests, with no failures and two native macOS skips. After the final regex adaptations, all 22 focused validation, HTTP and bundled-resource tests passed.
- Public-operation tests cover empty starters, every bundled metadata/design invalid category, process inverse variables/shared plans/distinct producers, state ownership/endpoints/initial/final/cycles, vocabulary ambiguity, independent locked contexts, warning severity, partial validation, all Core path forms, and local SELECT prefix/PATH/pre-binding gates. Schema removal checks retained RDF, vocabulary/reference impact, exact preview bytes, confirmation, stale revisions and successful invalidation.
- Offline CLI child processes run with networking blocked and Git absent. Authenticated HTTP tests cover scope, shared diagnostic identities, schema/shapes previews, confirmation, session ownership, cancellation, revisions and single consumption. The collaborative browser exercised shapes/schema lists, reviewed shapes creation, confirmed schema removal, selected/whole validation, and the coverage table. The temporary server was stopped after verification.
- Standards review found one glossary omission, corrected by defining Schema in `CONTEXT.md`. A possible Divergent Change smell in the shared validation module remains a judgment call: this ticket keeps one captured interpretation pass instead of adding new layers. Specification review found regex flag/Unicode character-class handling and a global comparison of independent locked contexts; public regressions reproduced the failures before correction. Regex checks include repeated flags, extended whitespace, character-class spaces, literal hash, backslash-separated whitespace escapes and Unicode digits/categories, word-class complements and XML versus nonbreaking whitespace. Both review axes reported no remaining hard defects after the corrections. Whitespace normalization follows the [XPath flag definition](https://www.w3.org/TR/xpath-functions-31/#flags); Unicode decimal digits follow the [XSD escape definition](https://www.w3.org/TR/xmlschema11-2/#charClassEsc).

### Approved assumption review (2026-10-11)

The initial partial adaptations of JavaScript `RegExp` did not justify the claim of complete Core implementation: a valid XML name escape (`\i+`) was rejected as `SHACL_GRAPH_INVALID`. The approved correction uses XPath 2.0 syntax preflight plus a capture-aware matcher for XML name classes, subtraction, Unicode blocks/categories, flags, anchors and backreferences. Tests cover case variants outside JavaScript's folding behavior, case-sensitive property escapes under `i`, code-point lengths, free-spacing preprocessing, line terminators, large counted quantifiers and rejection of unsupported extensions. Unicode categories, blocks and case mappings are pinned to version 15.0. This is a focused compatibility review with public-operation regressions, not exhaustive conformance certification.

The focused Core review also corrected language matching, qualified counts and sibling shapes, independently declared constraints, closed-shape value-node/path reporting, string ordering, mixed-timezone comparisons, deactivated SELECT constraints, Unicode prefix declarations and token-aware PATH expansion. Preflight preserves sequence-path list semantics and orphan qualified parameters while rejecting malformed lists, parameter types, singleton repetitions and prefix injection. A review of 98 approved local Core cases shipped with the pinned engine matched conformance and the multiset of source shape, focus node, value and component in 97 cases. The remaining fixture expects `sh:uniqueLang "1"^^xsd:boolean` to be inactive; the application deliberately treats the boolean value as true. Node-shape `equals`/`disjoint` follow the approved test cases and Appendix B, despite the introductory property-only sentence in [SHACL §4.5](https://www.w3.org/TR/shacl/#property-pair-constraints). These discrepancies remain explicit rather than supporting a blanket conformance claim.

Selected validation no longer retains all owned graph bytes or stores. Tests inspect retained snapshots and stores directly, verify whole-project release between target closures, and preserve support-list scope, proposed-byte precedence and captured-revision conflicts. Memory still depends on the largest active prerequisite closure, metadata and diagnostics; representative memory measurements and worker-capacity calibration were not performed.

Schema-removal regressions verify overlapping vocabulary providers, class/property roles, deactivated associated shapes, transitive view/presentation impact, increased diagnostic multiplicity and stable unassessable anonymous-result fingerprints. An authenticated HTTP check covers dependent-resource impact. The collaborative browser displayed retained vocabulary, affected resources, deactivated checks and introduced view errors; confirmation preserved the other schema association and business triples. The temporary server was stopped after verification.

Final Windows/Node 24 verification passed 144 of 146 application tests with no failures and two native macOS skips. Root formatting and read-only quality checks, application typechecks and the production build passed. The final regressions include escaped dollar/hash QName tokens and astral variable tails during PATH expansion. Positive infinity remains a valid Core range value; the bundled invalid appearance test now exercises the separate finite-renderer guard in a concrete visual design.

Dependency acquisition and extended contexts remain in tickets 07-10; shapes deletion remains in ticket 12; later view/presentation slices extend their invariant checks. No native Linux/macOS execution, mobile browser check, hosted CI run, package publication or new capacity guarantee is claimed. Complete installed-artifact and platform acceptance remains in ticket 20.

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
- On 2026-10-11, implementation and Windows verification completed on `feat/04-offline-validation`; see Answer for behavior, review corrections and retained limits.
