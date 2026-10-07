# Resolve ontology versions and detect source drift

Type: AFK
Status: ready-for-agent
Blocked by: 06, 08
User stories covered: 43, 44, 48, 49, 97, 98

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can select or clear an ontology version winner, inspect every retained alternative, and check whether recorded sources have changed without adopting those changes. Project queries and validation use one effective interpretation, while exact retained files remain independently queryable under their original identities. Drift measures the selected resource's interpretation rather than unrelated upstream activity.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement dependency select/clear and check for one/all additions in CLI and browser. Listings disclose the chosen/effective candidate, relevant provenance/support, retained selectors, and changed/unchanged/unavailable outcomes.
- [ ] Resolve ontology candidates by IRI/signature using explicit consuming choice, owned ontology, direct dependency, then nearest transitive dependency. Equal content is one effective candidate with retained contexts; different-content winning ties and broken choices are explicit errors.
- [ ] Register only effective winners/support for consumer queries and validation; never merge losing ontology triples. Preserve locked models' recorded source resolution context even when the consumer chooses a different ontology version.
- [ ] Exact retained closure/support/losing selectors load only that file as both default and sole named graph under its recorded identity. Consumer resolution conflicts or unrelated malformed files do not block isolated queries.
- [ ] Diagnose genuine loaded graph collisions and divergent non-ontology identities rather than assigning arbitrary winners. Retain all losing bytes and original associations for inspection.
- [ ] Read-only drift checks compare included original bytes, parser context, support, closure/bindings, and relevant choices. Included formatting changes count; unrelated commits/settings and consumer dependency-ID relocation alone do not.
- [ ] Distinguish comparison changes/partial availability from unavailable sources using the specified records and exit categories. Checking, clearing a choice, and inspection never silently update snapshots or refetch during subsequent local operations.
- [ ] Verify canonical signature golden vectors, Unicode/null/set ordering, cycle closure, signature stability under ID renames, source-bound validation, retained losing graph queries, explicit winner/clear behavior, and irrelevant-versus-interpretation drift through public operations and focused CLI/browser checks.

## Blocked by

- [06 - Run and manage reproducible SPARQL queries](06-run-and-manage-sparql-queries.md).
- [08 - Acquire dependencies from directories, HTTP, and Git](08-acquire-directory-http-and-git-dependencies.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 08](../../mvp-technical-architecture/issues/08-query-dataset-boundary.md).
- [Architecture decision 09](../../mvp-technical-architecture/issues/09-shacl-validation-boundary.md).
- [Architecture decision 12](../../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

