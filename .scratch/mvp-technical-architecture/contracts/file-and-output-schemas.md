# Project files and machine output, version 1

This is the concrete encoding contract for [issue 14](../issues/14-concrete-file-and-output-schemas.md). It implements the decisions in [the functional spec](../../mvp/spec.md) and architecture tickets [07](../issues/07-rdf-canvas-projection.md), [08](../issues/08-query-dataset-boundary.md), [09](../issues/09-shacl-validation-boundary.md), [10](../issues/10-file-transaction-boundary.md), [11](../issues/11-starter-resource-contract.md), [12](../issues/12-dependency-resolution-architecture.md), and [13](../issues/13-cli-web-runtime-boundary.md). Tables below define fields, types, defaults, and invariants; examples illustrate their serialization. This document specifies future implementation, rather than an executed schema/parser/runtime proof.

## Versions and scalar conventions

- TOML uses TOML 1.0 syntax and UTF-8. Each manifest, lockfile, and saved-query declaration requires integer `schema_version = 1`. JSON envelopes require integer `schemaVersion: 1`. Their version numbers are independent; changing one format does not require changing the others. Bindings remain a bare variable-to-term JSON object, as specified, and inherit the version-1 term contract without a reserved version key.
- Readers explicitly support versions, initially only `1`. Missing, wrong-type, or unsupported versions are errors; no best-effort reinterpretation or implicit migration. File incompatibility blocks operations needing that file, with raw read-only recovery inspection still possible. Explicit future migration must use the transaction boundary and preserve manifest comments. Package upgrades alone never migrate files or locked starters.
- A change to required fields, enum meaning, defaults, or interpretation requires a new schema version. Additional optional output fields and diagnostic codes may be added to version 1 if old readers can ignore them. Output consumers ignore unknown object members/codes while retaining severity. Unknown semantic lock/query input fields are rejected to avoid silently changing interpretation. Unknown manifest keys/tables are preserved and ignored; they cannot supply a core setting. Known settings with unknown enum values or invalid types are errors. Preserve unknown manifest content during every surgical edit.
- TOML field names use `snake_case`; JSON uses `camelCase`. Required means present even when an array is empty. Optional TOML fields are absent, never sentinel strings or magic zeroes. Optional JSON fields are omitted unless explicitly declared nullable. No NaN/infinity or duplicate JSON object keys. Every integer in TOML/JSON wire data, including signature inputs, must lie in the inclusive exact JSON integer range `-9007199254740991` through `9007199254740991` (`-(2^53 - 1)` through `2^53 - 1`, per [RFC 8259 section 6](https://www.rfc-editor.org/rfc/rfc8259.html#section-6)); reject out-of-range values. Field-specific positive/nonnegative constraints still apply; byte limits are positive integers.
- `Digest` is `sha256:` followed by exactly 64 lowercase hexadecimal digits. Hash original bytes. Timestamps are UTC strings `YYYY-MM-DDTHH:mm:ss.sssZ`; expiry is an absolute timestamp, not an implicit duration. Versions identifying packages/releases are strings, not floating-point values.
- An `IRI` is an absolute RDF IRI, preserved without case folding, URL redirects, percent-decoding, or Unicode normalization. Parser bases must also be absolute. Source locators are distinct from RDF identities and must be credential-free under ticket 12.
- A `Path` is a nonempty project-relative or explicitly scoped source-relative path using `/`. Reject empty, `.` and `..` components, drive/UNC/absolute paths, `:` and Windows alternate streams, NUL/control characters, reserved Windows device names (including names with extensions), trailing spaces/dots, and characters invalid on supported filesystems. Do not normalize distinct Unicode filenames into one name. Listings return canonical `/` paths; CLI accepts native separators and converts them before validation. Apply ticket 10's actual-ancestor/link/hardlink and platform-equivalence checks as well.
- An `ID` (dependency, attachment, model-type, query, or view name) matches `[a-z][a-z0-9-]{0,63}` and must pass the device-name check. IDs are case-sensitive and unique within their corresponding namespace. Bundled dependency IDs start with `tbspec-`; reserve that prefix for the tool, and reject user additions using it. Imported source model-type strings are preserved as RDF/source metadata even when they are not valid consuming-project IDs.

## Selectors and generated identities

| Selector | Meaning |
| --- | --- |
| `models/orders.ttl` | Project-owned file, relative to the canonical project root. |
| `dep:orders` | The `primary` file of dependency `orders`. |
| `dep:orders/source/ontologies/sales.ttl` | Exact file key in that dependency's retained inventory, including losing ontologies and support. |

The grammar is `dep:<ID>` or `dep:<ID>/<Path>`; the path is the literal `file.key`, not a URL, original upstream locator, or arbitrary path inside `.tbspec/`. No percent-decoding is applied. A `dep:` prefix always denotes a dependency; ordinary project paths cannot contain `:`. Dependency administration still takes a bare ID. `graph show` and `query run --graph` accept all three selector forms. `graph list` keeps its owned-resource scope; `dependency show` lists every retained file's exact selector. Return the expanded nested selector whenever identifying a specific locked file; also return its physical project-relative `file` path for diagnostics.

Every acquired file receives a logical key independent of the consuming dependency ID: main-source files use `source/<source-inventory-path>`; a standalone URL uses `source/resource.<ttl|nt|rdf>`. Include a source project's nested snapshot address in its source-inventory path to distinguish independently retained versions. Manual attachment files use `manual/<attachment-id>/<source-inventory-path>` (or `resource.<suffix>`). Physical storage is `.tbspec/dependencies/<id>/<key>`. Keys remain stable for the same inventory address across checks/updates, even when a Git commit changes; no traversal-order numbering. A renamed/replaced upstream inventory address changes the key and is reported as removal/addition. Detached manual files retain keys until their dependency owner is removed. No symlinked source address or arbitrary unlisted file is selectable.

Declared managed graph roots keep their original IRIs. An unrooted graph gets `urn:tbspec:graph:` plus the lowercase hex SHA-256 of the UTF-8 canonical expanded selector. Thus an owned-file move or dependency-ID rename can change a generated graph IRI; preview that change. It does not change declared graph IRIs. Generated URNs are project-local: the same selector in another project is not a global semantic identity. Record whether identity is `declared` or `generated`; relocate an unrooted source by generating the consumer identity from its new selector while retaining its original source graph identity in provenance. Never alias a declared losing ontology to another graph IRI.

## Human-edited `tbspec.toml`

`schema_version` is required. All other top-level settings are optional; an empty versioned manifest uses that project's locked starter defaults. A missing required starter lock is diagnostic, never permission to use the installed package's newer defaults.

| Field/table | Type and behavior |
| --- | --- |
| `base_iri` | Optional absolute IRI ending in `/` or `#`. Creation without explicit `--iri` appends the percent-encoded UTF-8 resource stem (final filename without `.ttl`); explicit IRIs take precedence. Reject derived identity collisions. |
| `[model_types.<name>]` | Optional replacement of a whole locked default row, or a new custom row. Required `ontology` selector; optional `enabled` boolean defaults true; optional `design` selector, absent means disconnected. No field-by-field fallback to an old default design. |
| `[ontology_choices]` | Quoted ontology IRI keys to bare dependency IDs. Written by `dependency select/clear`; resolve ambiguity within one ID using its recorded source winner, never the first file. |
| `[design_choices]` | Quoted exact target-concept IRI keys to design graph selectors. These are whole-design winners, separate from per-view RDF `chosenRule`. |
| `[[associations]]` | Required `resource` selector, `role` enum `shacl` or `design`, and `support` selector. For owned-resource associations not inferred by names. Additive to conventions; deduplicate identical associations. Dependency support administration writes the lock attachment records, not this table. |
| `[[views]]` | Required `view` owned-file path, `source` ontology/model selector, `presentation` owned-file path; optional `protocol` graph selector. Records only associations not inferable from filenames. RDF `sourceGraph`/`forView` IRIs must agree; no manifest override of contradictory RDF. |
| `[acquisition]` | Optional settings in the next table. Affect explicit acquisition only, not ordinary local operations or signatures. |

| Acquisition setting | Default | Unit/constraint |
| --- | --- | --- |
| `max_graph_bytes` | `67108864` | Decoded bytes per graph, positive. |
| `max_total_bytes` | `268435456` | Included bytes per complete acquisition, positive. |
| `max_files` | `1000` | Included file count, positive. |
| `max_redirects` | `5` | HTTP redirects, nonnegative. |
| `deadline_ms` | `300000` | Overall acquisition duration, positive. |
| `max_git_workspace_bytes` | `1073741824` | Best-effort temporary Git workspace budget, positive. |

Report effective limits when a limit fails; increasing one is an explicit manifest edit. Initialize explicit rows for all three built-in model types, using selectors from the copied starter lock inventory. `reset` restores its locked default row; custom-type removal removes its row. Built-in types are disabled rather than removed. Changing ontology removes its previous `design` field, preserving all unrelated text. Source model/schema/view/presentation content and model type-name statements stay in RDF, not duplicated as authoritative manifest metadata.

```toml
schema_version = 1
base_iri = "https://example.org/project/"

# This comment and unrelated settings survive tool edits.
[model_types.data]
enabled = true
ontology = "dep:tbspec-metadata"
design = "dep:tbspec-data-design"

[ontology_choices]
"https://example.org/sales" = "sales"

[design_choices]
"https://example.org/sales#Order" = "designs/orders.ttl"

[[associations]]
resource = "models/orders.ttl"
role = "shacl"
support = "constraints/orders.ttl"

[acquisition]
deadline_ms = 300000
```

Parse with source ranges or a concrete syntax tree. Reparse and verify a surgical change before staging; never serialize this whole document to perform a setting edit. The same preservation rule applies to hand-authored query declarations when changing a parameter. Malformed TOML or an unsupported surgical operation fails without rewriting it.

## Tool-written `tbspec.lock`

The lock may be serialized as a whole. Required top-level fields are `schema_version`, `[starters]`, and `[dependencies]`. Empty dependencies are permitted only if the project's required common/default resources remain satisfiable; lack of them is reported, not auto-repaired. No creation timestamp, last-check result, secret, console state, or preview workspace is authoritative lock data.

### Starters and acquisition records

| Record | Required fields and optional fields |
| --- | --- |
| `[starters]` | `common_contract` graph selector and `model_types` table. |
| `[starters.model_types.<name>]` | `enabled` boolean, `ontology` selector; optional `design` selector. Contains locked reset/default associations for `data`, `process`, `state-machine`, independent of current overrides. |
| `[dependencies.<id>]` | `kind` enum `ontology`, `model`, `design`; `primary` file key; `snapshot_path` exactly `.tbspec/dependencies/<id>`; `interpretation_signature` Digest; arrays `sources`, `files`, `edges`, `bindings`, `associations`, `choices`, `attachments`. Empty arrays are explicit. |
| `sources[]` | `id` scoped Path identifying an acquisition/source context, `kind` enum `directory`, `git`, `url`, `bundle`; `locator` credential-free string; `selected_resource` source-relative Path (use `resource.<suffix>` for URL); optional source-specific fields below. |
| Git source extras | Required `revision_kind` enum `default`, `ref`, `commit`; required `resolved_commit` lowercase full Git object ID; `requested_ref` required for `ref`/`commit`, absent for `default`. `commit` must resolve to that commit. Object ID length is 40 or 64 according to the repository object format; no abbreviated hashes. |
| Directory source | `locator` canonical absolute local directory path, native spelling; not an RDF IRI. Source-relative paths still use `/`. |
| URL source extras | Required `effective_locator`, credential-free final response URL after redirects. Original requested URL is `locator`; parser `base_iri` records the actual effective base separately. |
| Bundle source extras | `locator` is `tbspec:bundle/<bundle-name>/<release>`; required `release` string and `inventory_digest` Digest. Exact requested release must be present in the installed package. |

Each dependency includes `sources` for its selected source, retained transitive provenance, and manual attachments. `source.id` represents a source context's inventory address, such as `source` or `source/.tbspec/dependencies/p-plan`, rather than its current commit. The same upstream can occur in several independent source contexts. Preserve original Git commits/locators when copying source snapshots; never replace them with the consumer acquisition's provenance. Transport changes are observable but do not alone constitute interpretation drift.

The packaged `starters/<release>/inventory.toml` uses `schema_version = 1`, `release`, `dependencies`, and `starters` with the same record shapes, except its own bundle source omits `inventory_digest` to avoid a self-reference. Relative `files[].key` paths locate assets beneath that release directory; `snapshot_path` still describes the consumer destination. Compute SHA-256 of the packaged inventory's exact bytes when copying and fill the required consumer `inventory_digest`. Its relative source files carry the byte/parser/signature fields below; it additionally supplies per-source `attribution` and `license` strings. The trusted installed package/release inventory, not a source-provided lock, determines vetted exceptions. Verify every included file before copying. Consumer lock bundle records retain those attribution/license strings (optional for other source kinds). Vetted DTD-bearing P-Plan bytes must match this inventory; an untrusted source lock cannot create a vetted exception.

### File inventory and interpretation context

| `files[]` field | Type/invariant |
| --- | --- |
| `key` | Unique scoped Path; also the relative path below `snapshot_path`. |
| `source` | Matching `sources[].id`. |
| `source_resource` | Original source-relative inventory address. |
| `context` | Scoped Path naming the original resolution context, e.g. `source` or `source/.tbspec/dependencies/p-plan`. |
| `roles` | Nonempty unique array of `primary`, `closure`, `shacl`, `design`, `vocabulary`; a file can have several roles. Detached retained files keep their descriptive role. Activity is determined by association/reachability, not role alone. |
| `kind` | `ontology`, `model`, `conceptual-data-model`, `concrete-data-model`, `process-model`, `state-machine-model`, `design`, `shapes`, or `unclassified`. Locked inventories exclude upstream views/presentations/queries. |
| `classification` | `declared`, `override`, or `unclassified`; optional `kind_override` only for an undeclared graph classified by explicit acquisition choice. Contradictory overrides fail. |
| `graph_iri`, `identity` | Current consumer graph IRI and `declared`/`generated`. |
| `source_graph_iri` | Original source graph IRI, even when generated there. |
| `byte_digest`, `byte_length` | Digest of exact copied bytes, nonnegative integer byte count. |
| `media_type` | Exactly `text/turtle`, `application/n-triples`, or `application/rdf+xml`. |
| `base_iri` | Original effective absolute parser base; never the moved snapshot's file URL. |
| `parser_profile` | `turtle-strict-v1`, `ntriples-strict-v1`, `rdfxml-no-dtd-v1`, or `rdfxml-vetted-bundle-v1`. Profiles fix parsing semantics, not current package versions. |
| `graph_signature` | Digest over byte digest and parser context, defined below. |

Use suffixes `.ttl`, `.nt`, `.rdf`/`.owl` according to the approved format dispatch. Record the final chosen media type, never a generic MIME type as an interpretation mode. All parsed quads must be in the default graph before assigning identity. Retain original bytes, including XML entities in the exact vetted P-Plan release. Profile changes require an explicit update/new interpretation, not an unnoticed installed-parser change.

Exactly the dependency's `primary` entry carries the `primary` role; an upstream dependency's primary becomes `closure` when included transitively. A manual attachment's primary file carries `shacl`/`design`, without becoming a direct consuming dependency. Roles never turn an inherited ontology into a direct candidate or replace recorded edges/bindings.

### Edges, bindings, support, and source choices

All references below are file keys within the same dependency, never consumer dependency IDs. This lets an ID rename preserve content signatures. References to a retained-but-detached file are valid only where expressly inactive. Missing discovered targets are represented by `target_iri`, not an invented file key.

| Array | Fields and invariants |
| --- | --- |
| `edges[]` | Required `context`, `from` file key, `relation` enum `import`, `ontology`, `schema`, `vocabulary`; exactly one of `to` file key or `target_iri` unresolved IRI. Imports keep cycles; distances are computed by shortest paths from consuming additions. |
| `bindings[]` | Required `context`, `resource` model file key, `ontologies` array of file keys, `schemas` array of file keys; optional `model_type` original source string and `unresolved_iris` array (defaults empty). Source-bound models never consult consuming model-type names. An unresolved binding is diagnostic, not automatic acquisition. |
| `associations[]` | Required `context`, `resource` file key, `role` `shacl`/`design`, `support` file key, `origin` `source`/`manual`, `active` boolean; required `attachment` ID only for manual origin. A cleared manual association becomes inactive and keeps its files. |
| `choices[]` | Required `context`, `kind` `ontology`/`design`, `target_iri`, `selected` file key. Retain only choices relevant to included interpretation closure; they operate in their source context. |
| `attachments[]` | Required unique `id`, `role` `shacl`/`design`, `resource` attached-to file key, `source` acquisition record ID, `primary` support file key, `active` boolean. For a new manual attachment allocate `attachment-<n>` using the smallest positive decimal integer not in the captured owner inventory; preserve existing IDs. This is deterministic across equivalent CLI previews, not random. Do not treat it as a winning design choice. |

Bindings, edges, and source choices are distinct: a model can preserve its source-bound losing ontology while a full-project query loads the consumer's winner. Check that referenced keys exist, roles/classifications agree, and each context's ontology choice is unambiguous. A standalone URL may have empty bindings and unresolved RDF associations; report those without silently rebinding it. Source-derived SHACL/design associations remain distinct from manually retained ones when main-source updates occur. Here `manual`/`attachments` describes explicit attachments owned by this consuming addition; an upstream project's manual support is discoverable source support in this inventory, preserving its original file addresses/provenance without importing its attachment IDs into the consumer namespace. Inactive attachments and their unreachable closure are retained for isolated inspection/integrity checks but excluded from source checks, active resolution, and interpretation drift. An active attachment's complete interpretation participates in drift.

### Signatures and canonical bytes

Define `C(value)` recursively for values consisting only of strings, booleans, integers within the inclusive bounds defined in scalar conventions, null, arrays, and string-keyed objects: UTF-8 JSON with no whitespace/BOM/newline; object keys sorted by unsigned UTF-8 byte order; arrays in the specified order; strings escape only `"`, `\`, and U+0000–001F (the latter as lowercase `\u00xx`), leaving other Unicode unchanged; integers use base-10 without leading zeroes; booleans/null use their JSON spellings. Reject unpaired surrogates and out-of-range integers before hashing. No locale sorting, RDF canonicalization, decimal floats, or TOML serialization enters hashes. `H(value)` is `Digest(SHA256(C(value)))`. Sort every set-valued array by the unsigned UTF-8 bytes of each element's `C` representation; reject duplicates before hashing. Ordered arrays explicitly retain order.

- `graph_signature = H(["tbspec.graph", 1, byte_digest, media_type, base_iri, parser_profile])`. It excludes supports, graph relocation, locators, commits, and consumer choices. Byte-identical ontologies with different bases/profiles are different content candidates. Graph roots in declared RDF are already covered by the byte digest.
- `interpretation_signature = H(["tbspec.interpretation", 1, payload])`, where `payload` is an object with exactly `kind`, `primary`, `files`, `edges`, `bindings`, `associations`, `choices`, `attachments`. Include the primary and reachable interpretation/support closure of the dependency plus active attachments. Exclude inactive-only retained files/records. Source locator/commit changes alone do not change this signature.
- In that payload, each file is exactly `{key, context, roles, kind, classification, kind_override, identity, graph_iri, byte_digest, media_type, base_iri, parser_profile}` with absent `kind_override` encoded as null. Encode `graph_iri` as its declared IRI or null for generated identity so consumer-ID relocation does not create drift. Include all active relevant edges/bindings/associations/choices using their table fields, encoding absent optional fields as null and `unresolved_iris` as an empty array. Include each active attachment as `{id, role, resource, primary}`; exclude its transport-only `source` reference. Every unordered outer array, role list, ontology/schema list, and unresolved IRI list is sorted as above.
- Exclude file source/provenance, physical snapshot paths, consumer dependency ID, observation timestamps, limits, unused source choices, and detached support from the interpretation payload. Relevant source context and inventory addresses remain included: a changed association/binding/key is drift even with unchanged graph bytes. An unrelated newer Git commit with the same payload is unchanged; observed commit is returned separately without rewriting the lock.

Verify exact bytes against `byte_digest` before local use; check stored signatures against reconstructed payloads, not trust a self-reported hash. Integrity errors never fetch repairs. This defines graph equality and drift separately and preserves ticket 12's ontology/support distinction.

One encoding golden vector (the zero digest is a synthetic input, not a valid snapshot claim): `C(["tbspec.graph", 1, "sha256:" + 64 zeroes, "text/turtle", "https://example.org/source/", "turtle-strict-v1"])` has the exact bytes below, with no final newline, and hashes to `sha256:808e079d912f790d3b64faed187944e9dd698a358fccd067332fac1d44f22cb2`.

```text
["tbspec.graph",1,"sha256:0000000000000000000000000000000000000000000000000000000000000000","text/turtle","https://example.org/source/","turtle-strict-v1"]
```

## Saved queries and RDF terms

`queries/<name>.rq` contains the exact UTF-8 query text. Its sibling `queries/<name>.query.toml` requires `schema_version` and a `parameters` array (empty is valid). Each `[[parameters]]` requires `name` (SPARQL VARNAME without `?`/`$`), `kind` (`iri` or `literal`), and `required` boolean. Optional `datatype` absolute IRI or `language` language tag is allowed only for literals and never together. Duplicate names, unknown fields, and a declaration naming a variable absent from the parsed query are errors. Undeclared query variables are normal query variables, not bindable saved-query parameters. No defaults or text substitution.

```toml
schema_version = 1

[[parameters]]
name = "customer"
kind = "iri"
required = true

[[parameters]]
name = "label"
kind = "literal"
required = false
language = "en"
```

Bindings use the same term shape in a bare JSON object:

```json
{"customer":{"kind":"iri","value":"https://example.org/customer/42"},"label":{"kind":"literal","value":"Order","language":"en"}}
```

`iri` requires only `kind` and an absolute IRI string `value`. `literal` requires string `value` and may have exactly one of `datatype` or `language`; omission means `xsd:string`. A language-tag literal's datatype is implicitly `rdf:langString`; specifying that datatype without language is invalid. Language tags must be well-formed BCP 47 tags according to [RFC 5646 section 2.2.9](https://www.rfc-editor.org/rfc/rfc5646.html#section-2.2.9), including its ABNF for normal, private-use, and grandfathered tags; reject malformed tags such as `en-123456789`. Tags are compared case-insensitively and lowercased on output. Other datatype IRIs preserve arbitrary lexical strings; bindings do not coerce JSON numbers/booleans or promise datatype-value validation. Required/unknown/mismatched saved bindings fail before execution. Ad hoc bindings may name any variable present in the query. Extra term members, blank-node input, empty names, and unknown query variables fail with exit 2.

Query output terms use these shapes plus `{"kind":"blank","value":"b0","scope":"result"}` for blank nodes. Labels are unique within a result document, preserve graph-scoped blank-node distinctions, and have no persistence across queries. General graph/diagnostic RDF terms use `scope` equal to the expanded graph selector instead. Output literals always include datatype unless language is present; datatype and language remain mutually exclusive. Do not stringify RDF terms into display labels.

`query run` data is one of:

- SELECT: `{type: "select", variables: string[], rows: object[]}`. Variables retain projection order, row bindings map bare names to output terms, unbound cells are absent, and row order is engine order (not promised without ORDER BY).
- ASK: `{type: "ask", value: boolean}`. False is a successful result, not exit 1.
- CONSTRUCT/DESCRIBE: `{type: "construct"|"describe", triples: [{subject: Term, predicate: IriTerm, object: Term}]}`. Subjects are IRI/blank terms; no literal subjects. The result is a graph, not project files or named-graph merges. Triple order is unspecified.

All execution, including saved queries, passes the existing AST/local-dataset gate before engine invocation. Query save validates text/declarations, never executes it. File and parameter revisions participate in preview/conflict plans.

## JSON envelopes, statuses, and diagnostics

Every `--json` command, including help/version and malformed/unknown arguments, emits exactly one UTF-8 JSON object to stdout followed by a newline. Recognize the global `--json` output mode before full argument validation; parsing failures emit `invalid_arguments`, exit 2, `data: null`, and structured diagnostics. No progress/log stream appears on stdout. All four fields are required:

| Field | Type |
| --- | --- |
| `schemaVersion` | Integer `1`. |
| `status` | Enum below, describing command outcome rather than server state or project validity. |
| `data` | Command-specific object, or null when no result can be produced. Partial result objects remain present on errors. |
| `diagnostics` | Array of diagnostic objects, possibly empty. |

| `status` | Exit | Meaning |
| --- | --- | --- |
| `ok` | 0 | Successful operation/inspection, including stopped web status or ASK false. |
| `preview` | 0 | Successful non-mutating preview. |
| `invalid` | 1 | `status` reports invalid/incomplete project, validation errors/skipped blocking checks, or dependency drift detected. |
| `invalid_arguments` | 2 | Invalid CLI input, binding, query policy/syntax, or unsupported wire argument version. |
| `conflict` | 3 | Busy/stale state, identity/resolution conflict preventing an operation, recovery required, or explicit acceptance required. |
| `unavailable` | 4 | Source, filesystem, runtime authentication/availability, or needed data unavailable. |

For multiple problems select exit precedence `4 > 3 > 2 > 1 > 0`, retaining all diagnostics. An invalid manifest/lock/query declaration on disk is a validation error (1) for status/validate; an inability to read it is 4. A query needing malformed RDF reports invalid (1); an unresolved resolution/identity collision preventing dataset assembly is conflict (3). Local locked-byte corruption reports invalid (1) for validation/status and blocks dependent operations. Malformed runtime registration/unverifiable ownership and incompatible control protocol report conflict (3), while a verified-compatible live process whose endpoint/authentication cannot be reached reports unavailable (4). No runtime failure is automatically project invalidity.

A successful accepted mutation has status `ok` and exit 0 even when it intentionally leaves errors in `diagnostics`; put resulting validity in `data.projectValidity`. Do not claim I/O failure or roll back that change. A following `status`/`validate` reports invalid/1. Warnings/information alone never produce exit 1. A failed required check yields an error diagnostic plus explicit skipped coverage, so incomplete validation cannot masquerade as valid. Operational source failures still use 4. A dependency check with any unavailable source uses 4 ahead of changed/1, as ticket 12 requires.

### Diagnostic object

Required fields: `code` string, `severity` enum `error`, `warning`, `info`, `message` string, `file` nullable project-relative Path. Optional fields:

| Field | Meaning |
| --- | --- |
| `selector` | Expanded selector of the affected graph/file, if known. |
| `line`, `column` | Positive one-based location, only when available. No invented RDF-result location. |
| `related` | Array of `{file: Path\|null, selector?: string, message: string}` for collisions/blockers. |
| `shacl` | `{graphIri: IRI, selector: string, focusNode?: Term, sourceShape?: Term, constraintComponent?: IriTerm, path?: Term, value?: Term, messages?: LiteralTerm[]}`. Preserve complex-path blank-node identity instead of pretending it is one predicate. |
| `check` | `{kind: "syntax"\|"classification"\|"vocabulary"\|"association"\|"view"\|"presentation"\|"shacl", state: "failed"\|"skipped", blockedBy: string[]}`. Empty blockers allowed for a failure; skipped checks name blockers. |
| `details` | Typed code-specific object; sensitive credentials/URLs must never appear. |

The stable version-1 code vocabulary is:

| Category | Codes |
| --- | --- |
| Input/schema | `ARGUMENT_INVALID`, `SCHEMA_UNSUPPORTED`, `MANIFEST_INVALID`, `LOCK_INVALID`, `QUERY_DECLARATION_INVALID`, `BINDING_INVALID`, `QUERY_REJECTED`. |
| RDF/identity | `RDF_SYNTAX`, `GRAPH_CLASSIFICATION`, `GRAPH_IRI_COLLISION`, `RESOURCE_MISSING`, `VOCABULARY_UNKNOWN`, `ASSOCIATION_BROKEN`, `VIEW_INVALID`, `PRESENTATION_INVALID`. |
| Validation | `SHACL_GRAPH_INVALID`, `SHACL_FORM_UNSUPPORTED`, `SHACL_QUERY_REJECTED`, `SHACL_RESULT`, `CHECK_SKIPPED`. Map SHACL Violation/Warning/Info to error/warning/info. |
| Dependency | `SOURCE_UNAVAILABLE`, `ACQUISITION_LIMIT`, `SOURCE_FEATURE_UNSUPPORTED`, `RDF_FORMAT_UNSUPPORTED`, `DECLARED_FILE_MISSING`, `SNAPSHOT_INTEGRITY`, `DEPENDENCY_DRIFT`, `ONTOLOGY_CONFLICT`, `DESIGN_CONFLICT`, `SOURCE_SELECTION_AMBIGUOUS`. |
| Transactions | `PROJECT_BUSY`, `REVISION_CONFLICT`, `ACCEPTANCE_REQUIRED`, `PREVIEW_CHANGED`, `PREVIEW_EXPIRED`, `PREVIEW_OWNER_MISMATCH`, `PATH_UNSAFE`, `RECOVERY_REQUIRED`, `IO_FAILURE`, `CLEANUP_RETAINED`. Cleanup after completed publication is a warning. |
| Runtime/canvas | `RUNTIME_UNAVAILABLE`, `RUNTIME_OWNERSHIP_UNKNOWN`, `RUNTIME_PROTOCOL_UNSUPPORTED`, `RUNTIME_AUTH_FAILED`, `WEB_PORT_CONFLICT`, `VISUAL_RULE_MISSING`, `VISUAL_RULE_AMBIGUOUS`. Visual fallback warnings do not invalidate the model. |

Codes identify conditions, not automatic exit codes; the command context above determines status. Diagnostic order is deterministic by file/selector, location, code, then message using UTF-8 ordering. Consumers rely on codes/severity/typed fields rather than parsing prose. Human diagnostics go to stderr and may duplicate structured diagnostics, with redaction.

### Command data records

Use these reusable records rather than embedding an engine's private report:

| Record/commands | Concrete fields |
| --- | --- |
| Resource (`list`, `show`) | `{selector, file, graphIri: IRI\|null, identity: "declared"\|"generated"\|null, kind, classification, ownership: "project"\|"dependency", revision: Revision, associations: [{role, selector}]}`; optional `dependencyId`, `sourceGraphIri`, `kindOverride`. Kind additionally allows `view` and `presentation` for owned resources. Unparseable resources have null unknown identities, with diagnostics. |
| Lists | `{items: Record[]}`. Sort by canonical selector/name/ID. `show` uses `{resource: Record}` plus command-specific terms/content; source text is a UTF-8 `sourceText` string. |
| Dependency show/list | `{id, kind, primarySelector, snapshotPath, interpretationSignature, sources, files, bindings, edges, associations, choices, attachments}` with camelCase equivalents of lock fields and expanded selectors alongside referenced keys. |
| Dependency check | `{items: [{id, state: "unchanged"\|"changed"\|"unavailable", lockedSignature, observedSignature: Digest\|null, comparison: "complete"\|"partial"\|"unavailable", observedSources: SourceRecord[]}]}`. Malformed changed bytes yield changed/partial and parse diagnostics; no unusable replacement is applied. |
| Status | `{project: {root: absolute-path, validity: "valid"\|"invalid", validationComplete: boolean}, counts: {resources, dependencies, errors, warnings, information}, validation: ValidationRecord}`. Validity is derived from errors/blocking skipped checks, never server state. |
| Validate | `{validity: "valid"\|"invalid", validationComplete: boolean, resources: [{selector, state: "passed"\|"failed"\|"partial", checks: [{kind, state: "passed"\|"failed"\|"skipped", shapesSelector?: string, blockedBy: string[]}]}]}` (`ValidationRecord`). |
| Config show/list | Effective `baseIri` (nullable), `modelTypes` rows `{name, enabled, ontology, design: selector\|null, origin: "manifest"\|"locked-default"}`, `ontologyChoices`, `designChoices`, `associations`, `views`, and `acquisition`, using camelCase contract fields. List commands wrap the relevant rows in `items`. |
| Query list/show | `{name, queryFile, parametersFile, parameters: [{name, kind, required, datatype?, language?}]}`; show adds `queryText` and both file `revisions`. |
| References/impact | `{items: [{file, selector?: string, position: "subject"\|"predicate"\|"object"\|"configuration", targetIri, subject?: Term, predicate?: IriTerm, object?: Term}], affectedFiles: Path[]}`. Impact adds `kind`, `selector`, and `preview` when a concrete write plan is prepared. |
| Mutations | `{applied: true, changes: Change[], projectValidity: "valid"\|"invalid"\|"unchecked"}`; never claim valid without checking. Preview data uses `{applied: false, preview: Preview}`. |
| Guidance/help/version | `{text: string, topics: [{invocation, description}]}` for guidance/help (empty topics valid); `{applicationVersion: string}` for version. No project required. |

HTTP project endpoints use the same envelope and term/diagnostic records. JSON-schema version negotiation is explicit; do not conflate it with HTTP status or control protocol. Browser HTTP mapping is 200 for ok/preview, 422 for invalid, 400 for invalid arguments, 409 for conflict, 503 for unavailable; unauthenticated requests use 401/403 and redact project data. Domain operations remain in the shared core.

### Managed-reference scope

Reference inspection and broken-reference validation have different scopes. `references list --target <iri>` and removal impact enumerate every known occurrence of that exact IRI, including ordinary data values and locked files. `references list --dangling` includes only occurrences whose required target is demonstrably missing under the rules below; it does not classify every locally absent IRI as dangling.

A reference is managed when its remaining position establishes a requirement: a manifest/lock resource selector or model-type binding; an ontology import, conceptual-schema, support, design, view-source, view-member/relationship, or presentation association defined by the metadata contract; or a class/property use requiring available vocabulary. Resolve each association against its declared context and required resource kind. A view member must exist in its selected source, even if its IRI occurs elsewhere. Explicit SHACL constraints may independently reject a value; report those as SHACL results rather than an inferred resource-availability error.

An ordinary subject/object IRI referring to an individual does not require a local declaration merely because that IRI occurred locally before a deletion. There is no persisted registry of deleted identities, prefix-based ownership inference, or network dereferencing. After removal, status/validation diagnose only requirements still evidenced by current files and locked metadata. Impact may disclose an ordinary cross-graph occurrence without predicting a persistent error. For example, after deleting local individual `ex:alice`, another model's `ex:team ex:member ex:alice` remains allowed unless an explicit association or applicable constraint requires its target; a saved view selecting `ex:alice` from the edited source is instead invalid if it remains unrepaired. Removing a class used by `rdf:type`, or a conceptual model named by a schema association, remains diagnosable through vocabulary or association checks.

## Revisions and accepted previews

`Revision` is `{state: "absent"}` or `{state: "present", digest: Digest}`. A file revision hashes its exact bytes, including comments. An inventory revision hashes `C(sorted relative inventory entries)` where each entry is `{path, kind: "file"|"directory"}`, covering the operation's disclosed discovery scope; files actually read also have individual byte revisions. Reject links/unsafe paths instead of hashing through them. Do not use timestamps or watcher versions as acceptance evidence.

`Change` is `{action: "create"|"replace"|"delete"|"move", file: Path, before: Revision, after: Revision, to?: Path}`. A move's `file` is the old path, `to` required, `after` is the destination's proposed revision; include both source/destination expected revisions in the plan read set. New file absence and deletion absence are explicit.

`Preview` requires `fingerprint` Digest, `operation` string, `arguments` object of normalized semantic command arguments, `reads` array `{kind: "file"|"inventory", path, revision}`, `changes` array, `acquired` array `{selector, byteDigest, graphSignature}` (empty for local operations), `interpretationSignatures` object keyed by dependency ID, `impact` object `{baselineErrors: Diagnostic[], introducedErrors: Diagnostic[], worsenedErrors: Diagnostic[], skippedChecks: Diagnostic[], affectedFiles: Path[], acceptance: string[]}`. Acceptance names are existing flags `apply`, `confirm`, `accept-impact`; no implicit confirmation. An `inventory` read additionally requires `scope` describing its included/excluded relative prefixes; this is part of the fingerprint. No broad hidden whole-project revision replaces precise read sets.

Fingerprint is `H(["tbspec.preview", 1, plan])`. `plan` consists of exactly the Preview fields above except `fingerprint`, with sorted set arrays/keys, diagnostics projected to code/severity/file/selector/check/SHACL terms and `details.identity`/`details.reason` when present (omit prose messages/locations, including SHACL message literals), and every staged output byte digest/absence included through changes. Diagnostic arrays are sorted multisets: preserve repeated occurrences. Normalize diagnostic blank-node labels by the comparison rule below before hashing. Include acquired digests/parser graph signatures and proposed interpretation signatures; exclude standalone transport-only observations, preview handles, expiry, tokens, logs, temporary paths, and flag spellings used only to accept/apply. If a newer observed commit changes the bytes of a proposed lockfile, its output digest still changes the preview fingerprint even when interpretation drift is unchanged: exact publication bytes remain bound. `arguments` excludes `--json`, display flags, and application/acceptance flags but includes scopes, destinations, selected source/revision policy, and effective acquisition limits. `operation` and canonical project root are bound by adding `projectRoot` to `arguments`. Identical content/impact at a different root is not the same accepted operation.

### Diagnostic identity and impact comparison

Compare complete baseline and proposed diagnostic multisets, including warning/info results, over the same affected targets and validation prerequisites. `baselineErrors` contains baseline error diagnostics only; it is not sufficient input for detecting severity promotion. Never offset a new error with a resolved error elsewhere, or match by prose, source location, output order, or total project error count.

A matching key is the canonical JSON tuple `[target, code, checkKind, condition]`. `target` is the expanded affected selector, falling back to `file` for configuration/file diagnostics; `checkKind` is `check.kind` or null. For `SHACL_RESULT`, `condition` is `[shacl.selector, focusNode, sourceShape, constraintComponent, path, value]`, using typed terms and null for an absent term. Severity and SHACL messages are excluded. For other validation codes, put the following semantic discriminator in the existing typed `details.identity` object and use it as `condition`:

| Condition | `details.identity` fields |
| --- | --- |
| Unknown vocabulary use | `{kind: "term", term: Term, position: "type"\|"predicate"\|"datatype"}`. Group occurrences of the same unavailable term/role within the target; retain their multiplicity. |
| Broken association/missing required resource | `{kind: "association", owner: string, role: string, target: string}`. Owner is the referring RDF IRI or canonical configuration setting path; role is the exact metadata predicate IRI or manifest/lock field name; target is the required IRI or expanded selector. |
| View/presentation statement invariant | `{kind: "statement", subject: Term, predicate: IriTerm, object: Term}` for the offending statement. |
| Configuration/declaration field | `{kind: "setting", path: string}` using its canonical TOML key path. |
| IRI/resolution collision | `{kind: "collision", iri: IriTerm, candidates: string[]}` with sorted unique expanded candidate selectors. A changed candidate set is a different condition. |
| File-level syntax, integrity, classification, or shapes-profile failure | `{kind: "file"}`. These are one condition per code/target; failed prerequisites also affect coverage below. |

Selectors, RDF terms, and field paths retain their contract equality. Include no prose, line/column, severity, byte digest, or observed numeric measurement in `details.identity`. Emit one diagnostic per semantic occurrence, including each unknown vocabulary use and offending statement; repeated SHACL results remain repeated. File/setting/association/collision conditions emit one diagnostic per distinct key. If an affected diagnostic cannot be represented by these identities, or lacks a stable target, treat its check as unassessable rather than guessing that an error is unchanged. These discriminator fields specialize the existing optional `details` output without changing project-file schemas.

Blank nodes have identities only within a graph signature. For repeatable comparison/fingerprints, label source blank nodes `b0`, `b1`, ... by first appearance in the source parser's quad stream (subject, predicate, object order), before validation, rather than by validator-generated labels. Use `(expanded source selector, graph signature, normalized label)` for internal matching. This includes anonymous shapes, complex paths, focus nodes, and values from their respective source graphs. Equal graph signatures allow matching across repeated loads. If any term needed for a match is anonymous and its source graph signature changed, or the validator returns a blank node not traceable to source terms, mark that affected check unassessable. Do not infer identity from repeated labels or perform RDF canonicalization across changed graphs. Source term output keeps the existing graph-scoped term shape; source signatures come from captured read/acquisition metadata. For fingerprint projection only, replace an untraceable blank term's `value` with the fixed string `unassessable`, retaining its `scope` and diagnostic multiplicity; never use that placeholder to match conditions or as a claimed source-node identifier.

For each comparable key, pair equal-severity occurrences first, then pair remaining occurrences from highest to lowest severity (`error > warning > info`) on each side. An unpaired proposed error is introduced when there was no baseline occurrence of that key, and worsened when baseline occurrences existed (increased multiplicity). A paired proposed error whose baseline severity was warning/info is worsened. Put those proposed occurrences, without duplication, into `introducedErrors` or `worsenedErrors`. Persistent paired errors and decreases are baseline impact; warning/info-only increases or promotions do not require impact acceptance. The MVP does not grade the numerical distance from satisfying an already violated constraint.

Compare coverage by `(target selector, check.kind, shapesSelector or null)` from the validation records. `skippedChecks` records proposed skipped checks and synthetic `CHECK_SKIPPED` diagnostics for unassessable comparisons, with blockers and `details.reason: "impact_identity_unassessable"` for the latter. A newly skipped required check is worsened coverage; an affected required check skipped in either state also makes its impact unassessable, even if its blocker is unchanged. Unrelated baseline skipped checks do not gate the update. Checks deliberately deactivated by a removed association are disclosed as association changes, not fabricated as skipped checks. Dependency update requires `accept-impact` when introduced/worsened errors exist or affected required impact is unassessable; this never bypasses acquisition/parse/I/O rejection.

| Baseline to proposal | Classification / extra update acceptance |
| --- | --- |
| Same error, changed message or location only | Unchanged / no. |
| Same key, warning to error | Worsened / yes. |
| Same key, two errors to three | One worsened occurrence / yes. |
| Same key, three errors to two | Improvement / no. |
| One error resolves and a different key becomes an error | Introduced error / yes, despite equal totals. |
| Warning-only increase with complete comparable coverage | No new invalidity / no. |
| Same anonymous shape in unchanged source bytes/parser context | Comparable; apply the severity/multiplicity rules. |
| Anonymous shape/path/focus/value in a changed source graph | Unassessable affected check / yes, even if labels look equal. |
| Affected required check becomes skipped, or remains blocked | Unassessable affected impact / yes. |

The accepted-preview fingerprint remains sensitive to exact staged bytes and disclosed impact independently of whether `accept-impact` is required. All CLI/web adapters use this shared comparison rule.

### Preview application

Add the global option `--accepted-preview <Digest>` to every command that can prepare/apply an impact plan. It does not replace any existing flag. Example:

```text
tbspec dependency update sales --json
tbspec dependency update sales --apply --accept-impact --accepted-preview sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --json
```

The digest above illustrates syntax, not an actual accepted plan. Across CLI invocations, reacquire and regenerate once, compare the supplied fingerprint, and only apply those just-staged bytes if equal and required acceptance flags are present. On mismatch return conflict/3 with `PREVIEW_CHANGED` and the new preview, no writes. Require `--accepted-preview` for CLI application of reacquired external content (update/add/support set), including commands that otherwise directly apply. Without it, return conflict/3 and a concrete preview; acquisition failures still return their proper failure without a fabricated usable preview. First-time add/support set therefore needs review of a fingerprint but gains no unapproved `--accept-impact` flag. Other direct local mutations may still plan and apply in one invocation with their existing acceptance flags; when an accepted fingerprint is supplied, they must verify it. Every commit rechecks expected revisions under the project lock, even after a matching fingerprint.

For browser operations return the same reviewed Preview plus `handle`, `instanceId`, `expiresAt`. Handles are 32 random bytes encoded base64url without padding, bound to the authenticated tab and server instance. Apply request is exactly `{schemaVersion: 1, handle, fingerprint, accept: string[]}`. Server retrieves its own staged plan and verifies owner, fingerprint, accepted flags, revisions, and expiry before applying; request data cannot provide replacement paths/bytes/plans. Expiry is 15 minutes from creation, disclosed by `expiresAt`. Detach preserves it; restart/cancel/relevant change invalidates it. Consume on successful publication; uncertain transport outcomes require inspection rather than automatic retries.

## Ephemeral runtime records and protocol

Exclude `.tbspec/runtime/`, `.tbspec/previews/`, `.tbspec/transactions/`, and `.tbspec/operation.lock` from project versioning, RDF discovery, and dependency acquisition inventories. `init` adds these exact project `.gitignore` patterns surgically while permitting `.tbspec/dependencies/` snapshots to be committed. Git is optional and no repository is initialized. Ephemeral transaction originals are still retained for manual recovery under ticket 10; exclusion never licenses deleting pending state.

- `.tbspec/operation.lock` is the exclusively created coordination file. Its ownership JSON fields are `recordVersion: 1`, `acquisitionId` random identifier, `hostId`, `bootId`, `pid` positive integer, `processStartId`, `createdAt`. Validate OS identity and token-check normal release. Partial/unverifiable records block operations; never auto-clear them.
- `.tbspec/transactions/<transaction-id>/record.json` requires `recordVersion: 1`, `transactionId`, `acquisitionId`, `state: "preparing"|"publishing"|"rolling_back"|"complete"`, and `changes` in publication order. Each entry has exactly the `Change` fields plus required `originalPath: Path|null`, `stagedPath: Path|null`, `destinationBefore: Revision|null`, and `progress: "planned"|"prepared"|"applied"|"restored"`. Artifact paths are relative to this transaction workspace. A present `before` requires an original byte-copy path; an absent `before` requires null. Create/replace/move requires a staged path with bytes matching `after.digest`; delete requires null staged path. Move requires `destinationBefore: {state: "absent"}` (occupied destinations are rejected); other actions require null. Verify originals against `before.digest`; for moves keep the source original and stage destination bytes so source deletion/destination creation can be recovered independently. Paths may be named while artifacts are still incomplete at `planned`; mark `prepared` only after copying and verifying all needed artifacts. A crash can precede a journal progress update, so recovery compares observed revisions rather than trusting progress as proof of live state. Preserve incomplete records/originals and report missing metadata/artifacts; no automatic crash replay. Preview staging uses `.tbspec/previews/<instance-id>/<handle>/`; records here are never restored as valid handles after restart.
- `.tbspec/runtime/web.json` is an exclusive runtime registration independent of the operation lock. Its complete JSON record requires `recordVersion: 1`, `projectRoot` canonical absolute path, `instanceId` random identifier, `hostId`, `bootId`, `pid`, `processStartId`, `applicationVersion`, `controlProtocolVersion: 1`, `jsonSchemaVersion: 1`, `state: "starting"|"running"|"stopping"`, `baseUrl` nullable string, `controlToken`, `createdAt`. `baseUrl` is null until readiness, then exactly `http://127.0.0.1:<port>/`. A partial initializing record is unknown to contenders; exclusive creation still prevents a second start. Guard replacement/removal by instance ownership. Protection to the owning OS user is mandatory, including Windows ACLs; inability to secure the file fails startup.
- `instanceId`, `acquisitionId`, `transactionId`, preview handles, and credentials are random 32-byte base64url strings without padding. Their containing temporary directory segments use this same safe alphabet and are exempt from the lowercase domain-ID grammar. OS identity fields `hostId`, `bootId`, and `processStartId` are not random: each is an opaque string `os:v1:<base64url>` encoding UTF-8 `C({provider: string, value: string})`, with nonempty OS-adapter-specific provider/value. This base64url is also unpadded; reject padded/noncanonical encodings rather than equating different wire strings. Compare only through the matching provider's OS verification; missing/unrecognized/unverifiable providers produce unknown ownership, never a synthesized identity. Provider selection is a platform implementation detail and cannot weaken full process-identity verification. Redact `controlToken` from every diagnostic/log/status/project response. Do not expose runtime ownership secrets through dependency show.

Control requests use bearer authorization at `/api/control/v1/handshake`, `/api/control/v1/status`, `/api/control/v1/stop`, `/api/control/v1/opening-link`, and `/api/control/v1/console` (the authenticated event/control stream). `handshake` POST body is `{protocolVersion: 1, projectRoot, instanceId, process: {hostId, bootId, pid, processStartId}}`; response data repeats the exact verified identity plus `applicationVersion`, `controlProtocolVersion`, `jsonSchemaVersion`, `state`, `baseUrl`. Before reporting healthy or controlling anything, compare root, instance, full process identity and protocol. Console frames are `{protocolVersion: 1, instanceId, sequence: integer, type: "log"|"state"|"detach"|"stop", data: object}`; client may send only detach/stop, with shared authorized lifecycle behavior. Sequence order is per connection, not a persistent log history. No arbitrary operation dispatch.

Record version, control protocol version, and JSON schema version are independent integers; package version is independently a string. Initially attach/control only protocol 1 and JSON schema 1. An unsupported record/protocol is conflict/3, and a caller must not guess a stop protocol. Compatible CLI versions can reconnect and report the actual running package version; browser assets and project API remain tied to that server's launched release. Package upgrades never restart a running server implicitly.

### Browser credential bootstrap

An opening link is `<baseUrl>#tbspec-bootstrap=<opaque-value>` with a random 32-byte base64url value. Lifetime is 60 seconds, single-use, with an explicit `openingLinkExpiresAt` timestamp. Static client immediately removes the fragment, then POSTs `{protocolVersion: 1, bootstrap}` to `/api/auth/v1/bootstrap` with the exact same-origin Origin. Response data is `{instanceId, sessionToken, expiresAt}`; `sessionToken` is a distinct random 32-byte base64url tab bearer, valid for 12 hours from issue or until restart. On expiry obtain a fresh opening link/session; do not infer authorization from the canonical URL. Keep tab credentials in tab memory/session storage, never local storage, cookies, or project files. Browser API requests use bearer headers; native controls use only the protected control bearer. Neither credential substitutes for the other.

Apply ticket 13's actual Host/Origin checks to all endpoints/streams, without proxy trust or permissive CORS. Public assets contain no project data; unauthenticated failures contain no canonical project path or process details. Only the explicit bootstrap response and live CLI opening-link field can contain transient credentials. Do not log, persist, or include an opening link in previews/fingerprints. `--json` web responses necessarily expose an opening link to the invoking user; mark it transient and document that consumers must not archive it as project configuration.

### Web command output

Web data is `{server: ServerRecord}`. Required ServerRecord fields: `state: "running"|"stopped"|"unknown"|"unavailable"|"starting"|"stopping"`, `projectRoot` canonical path, `verified` boolean, `instanceId: string|null`, `pid: integer|null`, `applicationVersion: string|null`, `controlProtocolVersion: integer|null`, `baseUrl: string|null`, `openingLink: string|null`, `openingLinkExpiresAt: timestamp|null`, `openingLinkTransient: true`. Never return a healthy URL/process as verified merely because a registration says so. Null unavailable/unverified health fields; any observed record information belongs in redacted diagnostics. No `projectValidity` is inferred by these commands.

`web --json` and reconnect emit one readiness envelope and return without console attachment, including a fresh opening link. Status never starts/attaches and can issue a fresh link after successful authentication. No registration yields stopped/verified false/nulls with ok/0. Idempotent absent stop is the same successful stopped result. Unknown ownership/incompatible protocol yields conflict/3; verified live but unreachable service yields unavailable/4. Running/starting/stopping observations require authenticated handshake; starting/stopping status inspection itself may succeed, while startup readiness must reach running. Stop returns ok only once graceful shutdown and registration release are verified; a timeout is unavailable rather than a false stopped claim. An otherwise verified status unable to issue an opening link returns unavailable/4 with the verified canonical base URL and null link, preserving partial data.

## Implementation evidence and remaining choices

No further product ambiguity is needed to encode the settled semantics. Concrete, reversible choices made here are schema version integers, the nested selector delimiter, inventory-key namespaces, deterministic hash encodings, `--accepted-preview`, record paths, and disclosed token/preview lifetimes. The lower-level TOML editing library and HTTP client/router are implementation choices; neither may change this contract or skip its acceptance checks.

During production implementation require fixtures for: unsupported/missing versions; comment/unknown-key/line-ending preservation; default/disabled/reset/disconnected model types; selector parsing/path confinement and retained losing-file access; unrooted identity relocation; malformed/contradictory lock records; original bytes/parser bases and vetted RDF/XML; independently scoped versions/cycles/bindings/support choices; manual-support clear/update behavior; graph equality versus aggregate drift; canonical-hash golden vectors across platforms, Unicode and nulls; unrelated Git commits and consumer-ID rename preserving signatures; saved-query declarations, typed/language bindings and unbound/blank/graph query results; every exit/status category, warnings, partial validation and SHACL attribution; intentionally invalid successful mutations; one-envelope web startup, stopped/unknown/unavailable/protocol states; protected runtime registration, bootstrap replay/expiry and bearer separation; identical CLI reacquisition acceptance versus changed bytes/support/revisions rejection; browser preview ownership/expiry/staged-byte application; and existing transaction/manual-recovery evidence. Use pre-agreed public seams for runtime tests. No production typechecker or full test suite exists at the repository root; isolated prototype suites are not evidence for these schemas.
