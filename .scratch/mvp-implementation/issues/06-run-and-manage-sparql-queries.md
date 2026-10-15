# Run and manage reproducible SPARQL queries

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 04
User stories covered: 11, 95, 96, 97, 98, 99, 100

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can run an ad hoc or saved read-only query against the resolved project or one exact graph, pass typed parameters, inspect results, and maintain versioned saved queries from CLI and browser. Query scope and policy are explicit, so unrelated invalid resources do not prevent isolated exploration and no query acquires remote data or mutates the project.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Implement query list/show/save/run/remove with matching browser actions, exact functional signatures, confirmed removal, typed initial bindings, declaration inspection, and selective help/llms guidance.
- [x] Accept SELECT, ASK, CONSTRUCT, and DESCRIBE only after parsed-AST validation. Reject Update, SERVICE at any depth, FROM, and FROM NAMED before engine/network execution; use local in-memory RDF/JS sources only.
- [x] Full-project assembly registers effective resources under their exact named identities and copies only effective ontology/model triples into the default union. Support/unclassified graphs remain named-only; disable the engine's union-default option and fail explicitly on required malformed files, unresolved choices, or loaded graph collisions.
- [x] A selected graph is the sole default and named graph. Load only that selector's resource, ignoring unrelated malformed files or project resolution conflicts; retained closure/losing selectors are added by issues 08-09 without changing this isolation contract.
- [x] Preserve exact typed/language RDF terms, omitted unbound SELECT cells, result-scoped blank nodes, false ASK success, and graph-result term records in the version-1 output.
- [x] Saved query declarations reject unsupported versions, unknown semantic fields, malformed parameters, and invalid bindings. Apply typed bindings without string interpolation; surgical declaration updates preserve unrelated bytes/comments/line endings as specified.
- [x] Optional hierarchy exploration uses explicit property paths, without general entailment, inferred source writes, or expanded default data. Ordinary query execution makes zero acquisition/dereferencing requests.
- [x] Public operations and CLI/browser examples cover all query forms, saved lifecycle, parameter errors, exact default/named scope, isolation in a malformed project, blank-node result scopes, ASK false, and policy rejection with no canonical mutation.

## Blocked by

- [04 - Validate models, schema associations, and constraints offline](04-validate-models-schemas-and-shacl.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 08](../../mvp-technical-architecture/issues/08-query-dataset-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

## Answer

Implemented shared read-only query operations with CLI and authenticated browser workflows for listing, inspecting, saving, running, and confirmed removal. Queries pass parsed-AST policy checks and run against isolated local RDF datasets; saved declarations and typed bindings are validated, and browser save/remove mutations bind both saved-file revisions. Documentation and selective query help describe the query forms, parameter shapes, graph scope, policy, and result behavior.

Validation passed for root `npm run format` and `npm run check`, app `npm run typecheck` and `npm run build`, the focused query and editor/state-machine tests (26/26), and the authenticated HTTP query lifecycle test (1/1). A live browser smoke covered saved and ad hoc execution, typed literal bindings, ASK false, stale-save conflict with draft retention, explicit refreshed review, retry, and confirmed removal. The full app suite first reported 171 passes, two platform skips, and one failure in the digit-leading SPARQL variable case; after correcting that rule, the focused query test passed. The full app suite was not rerun after this isolated fix.
