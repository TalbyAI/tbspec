# Move and remove owned resources with impact review

Type: task
Status: ready-for-agent
State: open
Blocked by: 03, 04, 07
User stories covered: 20, 21, 32, 101, 105

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A maintainer can inspect removal impact, confirm deletion of an owned ontology, model, shapes graph, or custom model type, and preview/apply movement of an owned graph with its convention-linked support. The workflow keeps filesystem organization separate from semantic identity and permits explicitly accepted structural changes that need later repair.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement impact, ontology/model/shapes remove, custom model-type remove, and resource move with matching browser workflows, exact selectors, explicit apply/confirm flags, and selective CLI guidance.
- [ ] Impact is read-only and discloses direct/downstream affected files and all known IRI occurrences, including ordinary individual-valued occurrences and locked references. Do not restrict disclosed impact to persistent validation errors.
- [ ] Confirmed resource/type deletion removes only the selected ownership scope. Keep incoming references and unrelated resources intact; built-in model types cannot be removed. Semantic invalidity is reported as the result of a successful deliberate mutation.
- [ ] Move previews the source, convention-linked support, and owned recorded path changes, refuses destination/identity collisions, and preserves declared RDF IRIs. Disclose changed generated identities for unrooted selectors.
- [ ] Moves and related path-reference updates publish together. Parse every graph being rewritten, bind destination absence and relevant inventories, and reject stale plans or malformed required files without partial changes.
- [ ] Retain orphaned owned support after source deletion for the separate GC workflow. Removing a shapes association/resource never silently removes a design, dependency, or another source's support.
- [ ] Use the current managed-reference contract for post-removal diagnostics: unavailable vocabulary, explicit associations, and applicable constraints can fail; an ordinary individual IRI does not require a local target merely because its definition was deleted.
- [ ] Public-operation and CLI/browser tests cover reviewed/confirmed removal, built-in rejection, intentional invalidity, declared versus generated identity moves, coupled support, occupied/linked destinations, stale plans, external edits during rollback, and retained recovery evidence. Later view/design slices extend impact and move handling for their new resource kinds.

## Blocked by

- [03 - Create and import editable ontologies and domain models](03-create-and-import-owned-resources.md).
- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).
- [07 - Configure model types and accept vocabulary changes](07-configure-model-types-and-vocabulary-changes.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 10](../../mvp-technical-architecture/issues/10-file-transaction-boundary.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
