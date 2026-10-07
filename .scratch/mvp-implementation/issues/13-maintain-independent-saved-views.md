# Maintain independent views and synchronize their selections

Type: AFK
Status: ready-for-agent
Blocked by: 05, 08
User stories covered: 63, 64, 65, 66, 67, 68

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

An author can create and maintain several saved perspectives of one owned or locked ontology/model, each with independent member/relationship selection and presentation. View-only changes stay local, while explicit source-graph edits synchronize affected saved selections. Direct Turtle edits expose broken selections diagnostically without silently rewriting views.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement view list/show/create/remove and browser membership editing with one source association and a separately linked paired presentation per view. Creation accepts the optional project-supplied protocol selector without introducing built-in C4/4+1 semantics.
- [ ] View members are IRIs, and selected relationships are exact source/subject/predicate/object tuples with IRI endpoints. Descriptors select relationships without asserting source triples; source blank nodes remain explorable but cannot be persisted as stable membership.
- [ ] Selecting a relationship includes both endpoints. Adding a member includes existing source relationships to already selected members; no unrelated source resource becomes selected automatically.
- [ ] View-only member removal clears its incident local relationship selections and related presentation without changing source content, other views, unrelated members, positions, or appearance.
- [ ] Graph-based source relationship replacement/deletion, including generic/form editing, synchronizes all affected view selections and relationship presentation. Direct Turtle saves leave view/presentation files unchanged and diagnose broken source selections.
- [ ] Views of locked snapshots remain project-owned and editable while their source bytes stay read-only. Independently created views do not share presentation positions or persist complete-graph temporary placement implicitly.
- [ ] Confirmed view removal deletes only the view and paired presentation with disclosed impact. Extend existing inventory, validation, resource moves/removal impact, dependency rename, and schema/output handling for view/presentation references when this resource kind becomes available.
- [ ] Validate exact tuple uniqueness, source membership/endpoints, paired finite coordinates, and presentation references; malformed/stale graphs that a coupled operation must rewrite prevent all publication.
- [ ] Shared-operation and real browser workflows demonstrate two independent views, exact parallel/self-loop selection, endpoint inclusion, view-only removal, source synchronization versus raw-source diagnostics, read-only-source views, move/ID-rename integration, and revision-bound multi-file rollback.

## Blocked by

- [05 - Edit RDF through the canvas, Turtle, and ontology forms](05-edit-rdf-source-and-ontology-forms.md).
- [08 - Acquire dependencies from directories, HTTP, and Git](08-acquire-directory-http-and-git-dependencies.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 07](../../mvp-technical-architecture/issues/07-rdf-canvas-projection.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

