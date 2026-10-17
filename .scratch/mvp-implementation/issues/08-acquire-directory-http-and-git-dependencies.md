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

## Completion boundary

Close on directory/HTTP/Git acquisition, original-byte locked closure, format/security/limit enforcement, snapshot integrity, and acquired-resource integration with existing inspection, import, and validation workflows. Issue 09, which depends on both 06 and 08, owns acquired full/selected query assembly, winner/losing resolution, and drift; 08 must not assume that independent query ticket 06 is already implemented. Updates/manual support belong to 10; rename/removal to 11; owned views of locked sources to 13; complete design resolution/editing to 14. Acquisition itself must already preserve all existing canonical content on failure or cancellation.

Follow the [shared closure and safety rules](README.md#ticket-closure-and-later-extensions); specification readiness is not execution authorization.

## Acceptance criteria

- [x] Implement dependency inspect/add/list/show with explicit selection where inventory requires it, stable administration IDs, and reusable dep: primary/retained-file selectors. Browser actions expose sources, file inventory, signatures, bindings, support, and staged impact.
- [x] Acquire only the selected interpretation closure, directly associated support, and relevant source choices; follow declared imports/schema/vocabulary edges with cycle detection. Exclude unrelated models, views/presentations, queries, and ephemeral state.
- [x] Copy source-project locked snapshots without upstream refetch and retain source model bindings rather than resolving source type names through the consumer. Capture cooperating source bytes under their read lock without simultaneously holding the consumer lock.
- [x] Missing/corrupt/unsupported/unparseable declared included files reject publication. Standalone URLs supply one graph without recursive crawling; unresolved IRIs remain semantic diagnostics instead of authorizing implicit network loading.
- [x] Lock original bytes, media type, effective parser base/profile, provenance, file keys/roles, byte and graph signatures, resolution contexts, edges, bindings, and source choices using the version-1 canonical hashing contract. Independent additions have independent inventories.
- [x] Accept strict single-graph Turtle, N-Triples, and the conservative RDF/XML profile. Use XML-aware rejection of arbitrary DTD/entities, external resolution, datasets, and remote contexts; the internal-entity exception applies only to exact vetted bundled P-Plan bytes.
- [x] Confine directory discovery and reject internal links/escaping metadata. Resolve Git once to an immutable commit and read raw tree/blob bytes privately through argument-array invocations without hooks, filters, submodules, or LFS execution; require Git only for explicit Git actions.
- [x] Persist credential-free locators and redact secrets. Enforce configurable defaults of 64 MiB/graph, 256 MiB included bytes, 1,000 files, five redirects, five minutes overall, and best-effort 1 GiB Git workspace. Cancellation/source failure publishes nothing.
- [x] CLI add requires the accepted-preview fingerprint, returning a concrete preview/conflict when absent, then reacquiring once and rejecting any changed fingerprint before publication. It gains no extra accept-impact flag. Browser apply uses only authenticated server-staged bytes with no refetch.
- [x] Verify local snapshot digests/signatures before use and report corruption without automatic repair. Snapshots are read-only; ordinary query/validation/rendering uses them offline and remains responsive to status/cancel/navigation during bounded acquisition.
- [x] Controlled directory/Git/HTTP fixtures and public-operation/CLI/browser checks cover selected closure, cycles, inherited snapshots, relative bases, source-bound models, malformed declared files, standalone unresolved references, vetted/modified XML, unsafe Git features, redirect/limit/cancellation failures, redaction, changed fingerprints, and integrity failure with no canonical writes.
- [ ] Extend issue 03's editable import to an actually acquired locked ontology/model, verifying a new owned graph-root identity and provenance, preserved class/property/individual terms and unknown statements, explicit receiving model type, missing-vocabulary diagnostics without hidden rebinding, and byte-for-byte unchanged locked originals through public operations and CLI/browser workflows.
- [x] Apply the approved MVP URL policy before publication: requested/effective HTTP(S) locators, HTTPS Git provenance, inherited provenance and HTTP(S) parser bases contain no userinfo, query strings or fragments. Refuse signed/query-bearing redirects without stripping their URL or changing the parser base; keep credential values out of diagnostics, logs and previews. Use transient or external authentication instead of persisted credentials. Capability secrets in paths/hosts are unsupported and cannot be universally detected from syntax. RDF term identities remain unchanged.

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

## Answer

Implemented directory, HTTP(S), and Git dependency inspection and staged acquisition across the core API, CLI, authenticated browser, and HTTP server. Acquisition preserves the selected source bytes and interpretation closure, validates the accepted preview fingerprint before publication, and keeps source-project and Git provenance bound to captured revisions. Directory and Git inventories use compact metadata and cancellable, bounded lazy reads so unrelated inventory does not consume included-closure limits or remain retained in memory; source changes conflict before canonical publication.

Validation passed on the synchronized branch: app typecheck and production build; focused dependency, source, and RDF/XML tests (11/11); CLI dependency and lifecycle-impact tests (2/2); and built-asset HTTP acquisition/cancellation and lifecycle tests (3/3). The integration tip `49a105d` is included in merge commit `771369c`.

- On 2026-10-17, merge reconciliation retained the implementation answers and verification history from `main`. The ticket is reopened only for expanded semantic-audit criteria whose complete evidence has not been reconciled; unchecked criteria do not establish a production failure or authorize new implementation.
