# Stories 1–42 semantic audit

Reviewed 2026-10-07. This is a documentary trace of the first 42 implementation stories against the current 20-ticket breakdown and assigned normative sources. It does not assert implementation or test execution. “Explicit” means an acceptance criterion states a behavioral obligation and evidence; “delegated-only” means a later ticket owns an extension; “ambiguous” means the criterion relies on a broad reference or does not identify a concrete check; “missing” means no acceptance owner was found. Acceptance ordinals below count checkbox bullets under that ticket’s Acceptance criteria heading.

## Findings

The README now separates breakdown approval from implementation authorization and makes readiness, blockers, and authorization distinct. It also requires a bounded closure per ticket, later integration evidence, shared safety evidence for each operation, and treats the 117-story number inventory as inventory only. Issue 01 is explicitly a substantial foundation; it does not certify later operations.

For stories 1–42, initialization, inspection, creation/import, early validation/editing, and acquisition have named acceptance owners. The documentary clarifications resolved several formerly weak seams: support-kind classification is assigned to 04 AC11, 13 AC10, and 14 AC9; an unclassified editable fixture is assigned to 05 AC10; acquired locked-resource import is assigned to 08 AC12; and acquired query assembly is handed from 08 to 09. The user resolved later-resource query ownership and sequencing: 13 now depends on 11/12; 13 AC11 and 14 AC10 own named-registry/isolated-query evidence. The audit summary records the resolution of F01/F02.

The final review rechecked issue 12 criteria for stories 20/21/32 and corrected the criterion mappings below. All 42 rows have explicit documentary acceptance owners; this does not mean any implementation is complete.

## Story-by-story trace

| Story | Normative obligation | Responsible ticket acceptance criteria | Assessment and clarification |
| --- | --- | --- | --- |
| 1 | Initialize a local project without creating Git state. | 01 AC1, AC3 | Explicit. AC1 owns options/destination behavior; AC3 owns the no-Git initialization path. |
| 2 | Provide usable data, process, and state-machine defaults. | 01 AC2 | Explicit for authoring/bundling the approved starter families and standard resources. |
| 3 | Copy and lock starter resources offline. | 01 AC2–3 | Explicit; required starter copying and offline operation are named. |
| 4 | Discover the project upward from a subdirectory or use an explicit selection. | 01 AC1 | Explicit; precedence is stated. |
| 5 | Report resources, dependencies, validity, and incomplete validation. | 02 AC1; 04 AC6, AC10; 13 AC10; 14 AC9 | Explicit for early inventory and validation; later resource-specific coverage is extended by 08–10/13/14 and cannot be represented as clean before checked. |
| 6 | Show effective configuration, defaults, overrides, and associations. | 02 AC1; 07 AC1 | Explicit; provenance and effective model-type configuration are named. |
| 7 | Allow deliberate base-IRI or explicit graph-IRI identity. | 01 AC1; 03 AC2 | Explicit; initialization/configuration and resource creation cover the two identity inputs. |
| 8 | Make listings return exact reusable selectors and graph identities. | 02 AC1–2 | Explicit for available resources; acquired and retained selectors extend in 08–09. |
| 9 | Keep project schemas and locked resources unchanged across application upgrades. | 01 AC2, AC4; 07 AC5, AC9; 20 AC4 | Explicit in the starter lock/version and locked-default reset checks; assembled installed-package verification remains ticket 20’s scope. |
| 10 | Report missing or unsupported schema versions without reinterpretation. | 01 AC4; 06 AC6 | Explicit for required manifest/lock versions and semantic lock fields. |
| 11 | Preserve unrelated human-authored configuration during edits. | 01 AC4; 06 AC6; 07 AC3 | Explicit across versioned manifest, saved-query, and model-type configuration edits. |
| 12 | Keep ephemeral runtime/recovery state out of versioning while locked snapshots remain versionable. | 01 AC3, AC5, AC8 | Explicit for initialization’s ignore/path contract and lock/recovery paths. |
| 13 | Create additional model types using local or locked ontologies. | 07 AC1 | Explicit for model-type configuration and exact local/locked selectors. |
| 14 | Preview replacing a used ontology’s effect. | 07 AC4, AC7 | Explicit; affected associations/validity, bound plans, and browser preview ownership are named. |
| 15 | Do not mutate model statements during ontology replacement. | 07 AC3–4, AC9 | Explicit; graph bytes/statements remain unchanged and no migration/mapping occurs. |
| 16 | Disconnect the previous design on ontology replacement while retaining generic editing. | 07 AC3, AC5–6 | Explicit; design disconnection and generic/source fallback are covered. |
| 17 | Explicitly select or clear a model type’s design. | 07 AC1, AC5, AC9 | Explicit; selection/clearing is independent of ontology and specialized-form recognition. |
| 18 | Disable/re-enable creation without invalidating existing models. | 07 AC2 | Explicit. |
| 19 | Reset built-in types to their project-locked defaults. | 07 AC5, AC9 | Explicit, including the simulated package-upgrade check. |
| 20 | Preview and confirm removal of a custom model type while exposing affected models. | 12 AC1-3, AC8 | Explicit. Read-only impact exposes affected models/references; confirmed removal is limited to custom types, retains references, and reports intentional invalidity. AC8 requires reviewed/confirmed removal and built-in refusal evidence. |
| 21 | List, inspect, create, import, move, and remove project-owned ontologies. | 03 AC1, AC5, AC8; 12 AC1-5, AC8 | Explicit across owners. Issue 03 owns ontology list/show/create/import; 12 owns confirmed removal, reviewed move, related path updates, and public-operation/CLI/browser evidence. Story closure requires both workflows. |
| 22 | Editable import creates a new graph identity/provenance and preserves term IRIs. | 03 AC4–5, AC8; 08 AC12 for acquired locked inputs | Explicit, with acquired-input extension now specifically evidenced in 08 AC12. |
| 23 | Create and inspect models under an enabled configured type. | 03 AC1–4 | Explicit for list/show/create, associations, enabled types, and model families. |
| 24 | Distinguish ontology, conceptual, concrete, and support graph declarations. | 02 AC2; 03 AC6; 04 AC11; 13 AC10; 14 AC9 | Explicit by incremental kind ownership. Later support-kind owners 13/14 are now included in their ticket headers and the README index; their criteria supply classification evidence. |
| 25 | Diagnose incompatible graph kinds or multiple candidate roots instead of guessing. | 02 AC2; 03 AC6; 04 AC11; 13 AC10; 14 AC9 | Explicit for base kinds and later support kinds, with diagnostics/coverage assigned by kind owner. |
| 26 | Keep parseable unclassified graphs listed and generically editable. | 02 AC2; 03 AC6; 05 AC10 | Explicit, including the named unclassified editable fixture in 05 AC10. |
| 27 | Let conceptual models describe classes and properties independently of instances. | 03 AC3; 05 AC5–7 | Explicit across distinct creation and ontology/conceptual editing forms. |
| 28 | Let concrete models hold individuals/values and remain generically editable. | 03 AC3; 05 AC1–2, AC5 | Explicit for graph creation and exact generic RDF editing. |
| 29 | List, add, and remove conceptual-schema associations on a concrete model. | 04 AC1–3 | Explicit; association operations and their validation context are stated. |
| 30 | Diagnose missing/wrong-kind declared schemas without requiring every concrete model to have one. | 04 AC2-3, AC9-10 | Explicit after clarification: valid absence is separate from an explicit broken association; confirmed removal may intentionally leave invalidity. |
| 31 | Import a model under a new graph identity and report missing vocabulary. | 03 AC4–5, AC8; 08 AC12 for acquired snapshots | Explicit; receiving type, new root/provenance, preserved terms, missing-vocabulary diagnostics, and locked-original immutability are named. |
| 32 | Move resources without changing declared IRIs and move convention-linked support with them. | 12 AC4-5, AC8; 13 AC7, AC9; 14 AC7-8 | Explicit across resource owners. Move previews source/support/path changes and preserves declared IRIs; coupled updates bind revisions/destinations/inventories. AC8 tests generated versus declared identity, support moves, stale/linked destinations, and guarded rollback. Issues 13/14 own later view/design integration after their prerequisites. |
| 33 | Inspect directory/Git inventories when available. | 08 AC1, AC7 | Explicit; inventory/selection and Git-only requirements are stated. |
| 34 | Add one explicitly selected ontology, model, or design from directory, Git, or HTTP(S). | 08 AC1, AC7–8 | Explicit for selected-resource acquisition, source boundaries, and bounded/credential-safe acquisition. |
| 35 | Acquire only discoverable interpretation closure and directly associated support. | 08 AC2 | Explicit; unrelated models, views/presentations, queries, and ephemeral state are excluded. |
| 36 | Reuse source-project locked snapshots without upstream refetching. | 08 AC3 | Explicit, including retaining source-model bindings and source/consumer lock coordination. |
| 37 | Reject unavailable declared closure; keep unresolved standalone-URL references diagnostic. | 08 AC4 | Explicit; publication rejection and no recursive standalone-URL crawling are distinguished. |
| 38 | Retain original bytes, parser bases, source bindings, signatures, and provenance. | 08 AC5 | Explicit; the canonical lock fields and independent inventory are listed. |
| 39 | Preserve source ontology bindings on locked external models. | 08 AC3, AC5 | Explicit; consuming-project type-name rebinding is prohibited. |
| 40 | Parse supported Turtle, N-Triples, and conservative RDF/XML locally. | 08 AC6 | Explicit; parser profile and no external resolution are specified. |
| 41 | Reject unsafe/unsupported inputs with actionable diagnostics. | 08 AC6, AC11 | Explicit. AC6 defines accepted/rejected profiles and AC11 requires unsafe-input fixtures without canonical writes; the shared field-level diagnostic evidence rule requires exact contract records for delivered rejection outcomes. No new diagnostic policy is inferred. |
| 42 | Report local snapshot corruption without automatic refetch or repair. | 08 AC10-11 | Explicit. AC10 requires digest/signature verification before use, corruption diagnostics, and no automatic repair; AC11 exercises integrity failure without canonical writes. |

## Normative source mapping

| Source section reviewed | Obligations relevant to stories 1–42 | Ticket/acceptance ownership and audit note |
| --- | --- | --- |
| Functional specification, product boundary and identity/classification, lines 12–50 | Local project boundary; roots and graph kinds; config and selectors. | 01 AC1–4; 02 AC1–2; 03 AC2, AC6; 04 AC2/11. |
| Functional specification, command inventory and signatures, lines 52–224 | Initialization, status/list/show/config, create/import, schema/validation, model-type, and early dependency commands. | 01–08 acceptance criteria; exact syntax remains normative rather than repeated in every criterion. |
| Functional specification, guidance, web and shared behavior, lines 226–288 | Help/guidance; authenticated local web; shared safety, revisions and publication rules. | 01 AC5–9 and 02 AC3–9; feature tickets own operation-specific safety evidence per issue README. |
| Functional specification, visual extensibility and starter vocabularies, lines 290–304 | Later view/design extension points and bundled vocabulary assumptions. | Starter bundle: 01 AC2; later resource kinds: 13/14 boundaries and criteria. |
| Functional specification, files/state/inference, lines 306–323 | Canonical files, runtime/recovery state, offline and no-inference behavior. | 01 AC3–4; 04 AC3/6; 06 AC2/7; 08 AC4–6. |
| Functional specification, seven scenarios and recorded decisions/exclusions, lines 325–413 | Scenario workflows and explicit scope limits. | Scenario 1 schema absence/reference split: 04 AC2; relevant initialization/import/acquisition workflows: 01/03/08. |
| Architecture issue 01, permanent IRI policy, lines 1–26 | Stable domain IRIs and versioned vocabulary identities. | 01 AC2 and 03 AC2/5; preserves identities through copy/import. |
| Architecture issue 05, RDF stack, lines 1–29 | Supported runtime/dependencies and query/parser boundaries. | 01 AC10; query policy in 06 AC2; acquisition parser profile in 08 AC6. |
| Architecture issue 10, file transaction boundary, lines 1–75 | Coherent reads, project lock ownership, revisions, staging, rechecks, rollback/recovery, path confinement, evidence and limits. | 01 AC5–8 fully exercises initialization; README shared safety rule requires each later operation to provide its own applicable evidence. |
| Architecture issue 11, starter resource contract, lines 1–191 | Starter identities, graph kinds, support resources and built-in resources. | 01 AC2; 02 AC2; 03 AC3/6; 04 AC8/11; 13 AC10 and 14 AC9, with exact form/layout owners in the other traces. |
| Architecture issue 12, dependency resolution architecture, lines 1–103 | Acquisition closure, format, parser bases, signatures, bindings, source resolution, support, and limits. | 08 AC1–11; acquired editable import extension in 08 AC12. |
| File/output schema contract, lines 1–156 | Version/scalar rules, selectors, manifest, lock, inventory/edge/binding records, signature vectors. | 01 AC4, 06 AC6, 08 AC5 and relevant 02/03/07 record criteria; exact field conformance is required by shared evidence. This assigned review stops at line 156; later output/preview/runtime sections are traced in the other audit partitions. |
| ADRs 0001–0004, each full three-line record | Settled architecture/scope decisions and vocabulary. | Read as scope constraints; no conflict with the current 1–42 owners found. |

## Reviewed source inventory and limits

- Repository AGENTS.md and issue-tracker README were read; English documentation and Markdown issue conventions apply.
- .scratch/mvp-implementation/issues/README.md: execution authorization, index, incremental closure, foundation/feature safety, shared delivery/evidence, story inventory and audit link (lines 1–76).
- .scratch/mvp-implementation/spec.md: all 117 stories and implementation/testing decisions (stories 1–117 at lines 20–138; decisions continue after the story list).
- .scratch/mvp/spec.md: lines 1–413, grouped by the sections listed above.
- .scratch/mvp-technical-architecture/issues/01-permanent-iri-policy.md: lines 1–26.
- .scratch/mvp-technical-architecture/issues/05-select-rdf-stack.md: lines 1–29.
- .scratch/mvp-technical-architecture/issues/10-file-transaction-boundary.md: lines 1–75.
- .scratch/mvp-technical-architecture/issues/11-starter-resource-contract.md: lines 1–191.
- .scratch/mvp-technical-architecture/issues/12-dependency-resolution-architecture.md: lines 1–103.
- .scratch/mvp-technical-architecture/contracts/file-and-output-schemas.md: assigned lines 1–156 only.
- docs/adr/0001–0004: all four records, three lines each.
- All 20 implementation tickets were reviewed for boundaries and acceptance criteria earlier in the audit. For the final story 1–42 mapping, tickets 01–08 were checked at their current acceptance criteria. The primary reviewer revalidated issue 12 AC1-8 and the final story 20/21/32 ordinal mappings; the earlier draft limitation is resolved.
- No production implementation or production test result was inspected or claimed by this report.
