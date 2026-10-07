# Acquire dependencies from directories, HTTP, and Git

Type: task
Status: ready-for-agent
State: open
Blocked by: 07
User stories covered: 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 53, 54, 55, 115, 116

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can inspect discoverable source inventories and add one selected ontology, model, or design from a directory, Git repository, or HTTP(S) URL. Acquisition stages original content and its discoverable interpretation closure, then locks exactly the reviewed snapshot through CLI or browser. Failures, cancellation, unsupported source features, and corrupted snapshots do not damage existing project state.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Implement dependency inspect/add/list/show with explicit selection where inventory requires it, stable administration IDs, and reusable dep: primary/retained-file selectors. Browser actions expose sources, file inventory, signatures, bindings, support, and staged impact.
- [ ] Acquire only the selected interpretation closure, directly associated support, and relevant source choices; follow declared imports/schema/vocabulary edges with cycle detection. Exclude unrelated models, views/presentations, queries, and ephemeral state.
- [ ] Copy source-project locked snapshots without upstream refetch and retain source model bindings rather than resolving source type names through the consumer. Capture cooperating source bytes under their read lock without simultaneously holding the consumer lock.
- [ ] Missing/corrupt/unsupported/unparseable declared included files reject publication. Standalone URLs supply one graph without recursive crawling; unresolved IRIs remain semantic diagnostics instead of authorizing implicit network loading.
- [ ] Lock original bytes, media type, effective parser base/profile, provenance, file keys/roles, byte and graph signatures, resolution contexts, edges, bindings, and source choices using the version-1 canonical hashing contract. Independent additions have independent inventories.
- [ ] Accept strict single-graph Turtle, N-Triples, and the conservative RDF/XML profile. Use XML-aware rejection of arbitrary DTD/entities, external resolution, datasets, and remote contexts; the internal-entity exception applies only to exact vetted bundled P-Plan bytes.
- [ ] Confine directory discovery and reject internal links/escaping metadata. Resolve Git once to an immutable commit and read raw tree/blob bytes privately through argument-array invocations without hooks, filters, submodules, or LFS execution; require Git only for explicit Git actions.
- [ ] Persist credential-free locators and redact secrets. Enforce configurable defaults of 64 MiB/graph, 256 MiB included bytes, 1,000 files, five redirects, five minutes overall, and best-effort 1 GiB Git workspace. Cancellation/source failure publishes nothing.
- [ ] CLI add requires the accepted-preview fingerprint, returning a concrete preview/conflict when absent, then reacquiring once and rejecting any changed fingerprint before publication. It gains no extra accept-impact flag. Browser apply uses only authenticated server-staged bytes with no refetch.
- [ ] Verify local snapshot digests/signatures before use and report corruption without automatic repair. Snapshots are read-only; ordinary query/validation/rendering uses them offline and remains responsive to status/cancel/navigation during bounded acquisition.
- [ ] Controlled directory/Git/HTTP fixtures and public-operation/CLI/browser checks cover selected closure, cycles, inherited snapshots, relative bases, source-bound models, malformed declared files, standalone unresolved references, vetted/modified XML, unsafe Git features, redirect/limit/cancellation failures, redaction, changed fingerprints, and integrity failure with no canonical writes.

## Blocked by

- [07 - Configure model types and accept vocabulary changes](07-configure-model-types-and-vocabulary-changes.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 12](../../mvp-technical-architecture/issues/12-dependency-resolution-architecture.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.
