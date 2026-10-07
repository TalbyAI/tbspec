# MVP breakdown semantic audit

Audit date: 2026-10-07

## Result and limits

This is a documentary semantic review of the 117 implementation stories and the normative sources listed below against the 20 implementation tickets. The story matrices identify obligations, responsible acceptance criteria, and required evidence. Acceptance criterion numbers are the sequential checkbox bullets under each ticket's Acceptance criteria heading; they are audit references, not additional requirements.

The number-reference inventory alone does not establish semantic coverage. The review found specific acceptance/evidence ambiguities and a cross-ticket integration/ordering gap. The documentary clarifications listed below have been applied, and the user resolved the integration decision by adding 11/12 as prerequisites of 13. All 117 stories now have explicit documentary acceptance owners; no known finding from this review remains open. This is a reviewed plan, not proof of delivered behavior or an assertion that future implementation checks have passed.

No production implementation or production test execution is claimed. An explicit criterion is a specified future obligation, not a passed test. Exact fields, RDF terms, flags, and detailed policies remain governed by the linked normative contracts; the audit is not a replacement specification or an independent product decision.

## Agreed decisions

1. Approval to write/review the breakdown is not authorization to implement. Explicit user instructions can authorize one ticket, a set, or the complete plan, and remain effective throughout that authorized work.
2. Specification readiness, implemented/verified dependencies, and execution authorization are distinct conditions.
3. A ticket can close at a stated incremental resource boundary only after all applicable criteria and shared guarantees are implemented and verified. Later extensions need owners and evidence; shared stories remain incomplete until every mapped obligation is delivered.
4. Retain the 20-ticket breakdown and issue 01 as a substantial foundation. Its scope includes immutable bundled-resource authoring and the complete safe-publication contract applicable to initialization. Later tickets own safety integration/evidence for their operations; platform certification belongs to issue 20.
5. Audit semantic obligations, including normative architecture/file/output contracts, before claiming complete coverage. Counting story references establishes an inventory only.

## Detailed traces

- [Stories 1-42 and initialization/acquisition/resource contracts](stories-001-042.md).
- [Stories 43-84 and query/canvas/views/design/forms/layout contracts](stories-043-084.md).
- [Stories 85-117 and validation/runtime/machine-output/scenario contracts](stories-085-117.md).

Read cross-cutting findings together with each story row. A story can have explicit behavioral criteria while its combined acceptance ordering or integration evidence remains unresolved.

## Clarifications applied

| Finding | Documentary change and evidence owner |
| --- | --- |
| Breakdown approval was converted into implementation permission. | Issue README separates execution authorization from readiness/blockers; issue 01 no longer says it can start immediately. |
| Issue 01's title concealed foundation size; its tests could be mistaken for all future safety evidence. | Renamed title, disclosed starter/safety responsibilities, and assigned feature-specific safety evidence to every later operation. |
| Early-ticket completion and future resource-kind coverage were blurred. | Added a completion boundary to all 20 tickets; narrowed 04's current validation promise and identified 08-10/13/14 extensions. |
| Support-kind classification and diagnostic evidence was only inherited generally. | 04 AC11 owns shapes classification; 13 AC10 owns view/presentation classification and diagnostic categories; 14 AC9 owns design classification and applicable presentation diagnostics. |
| Invalid-source generic access and exact ontology-form fields lacked named fixtures. | 05 AC10 explicitly covers an unclassified editable graph and the architecture-16 class/datatype/property/ontology-individual binding table. |
| SHACL-SPARQL restrictions were summarized without concrete rejection evidence. | 04 AC5 now names PATH/projection/query-policy/prebinding/unsupported-form negative cases and independent-shape continuation. |
| Origin wording could reject legitimate same-origin reads without the header. | 02 AC4 states the exact presence/requirement exceptions for reads, bootstrap/browser mutations, and authenticated native controls. |
| Acceptance scenario 1 could imply every concrete model requires a schema. | 04 AC2 distinguishes valid absence of an association from an explicit reference to a missing/wrong-kind schema. The original functional spec is unchanged. |
| Manual support fixtures/policy omitted absent-source and later-same-role transitions. | 10 AC7/10 make initial eligibility, later coexistence/deduplication/design precedence, support-source checking, impact, and retained inactive files explicit. |
| Machine conformance could be reduced to generic envelope success. | Shared evidence requires field/nullability/status/exit/term/coverage conformance per delivered record. 20 AC8 includes partial results, ServerRecord states, and transient-link exclusions. |
| Acquired query integration assumed independent ticket 06 preceded 08. | 08's completion boundary assigns acquired full/selected query assembly to 09, which already depends on both 06 and 08. |
| Editable import of an acquired snapshot was a prose handoff without specific evidence. | 08 AC12 extends 03's import workflow with actual acquired inputs, new owned roots/provenance, exact term preservation, diagnostics, and untouched locked originals. |

## Resolved integration decision

**F01 - Query coverage for later resource kinds (resolved).** The functional query contract and architecture-08 require effective SHACL, view, presentation, design, and unclassified graphs to be available by name while remaining outside the ontology/model default union. Exact selected-graph access must stay isolated from unrelated malformed files and consumer resolution conflicts. The review found no explicit successor evidence owner for views/presentations/authored designs. Issue 13 AC11 now owns view/presentation query integration; 14 AC10 owns authored/active-support/retained-design query behavior. Stories 97/98 are explicitly indexed to those owners. The criteria require public-operation and CLI/browser evidence, including default-union exclusion and isolated access amid unrelated malformed/conflicting resources.

**F02 - Acceptance dependencies did not establish promised integration prerequisites (resolved).** Before this review, 13 depended only on 05/08, yet promised integration with renaming (11) and movement/removal (12); 14 promised manual-design support without ensuring 10 was implemented. Numeric order hid the mismatch, while independent unblocked execution was permitted. The user chose explicit prerequisites: 13 now depends on 05/08/11/12. Through 11 -> 10 -> 09, this establishes query 06 and manual support 10 before 13 closes; 14 already depends on 13. Its existing blocker list therefore needs no additional edge.

The reviewed alternatives were:

- **Explicit prerequisites (recommended):** add 11 and 12 to 13's blockers. Issue 11 already depends transitively on 10/09/06, so query and manual-support prerequisites are established without extra redundant edges. Issue 14's existing dependency on 13 then establishes manual-support readiness too. Add query/integration criteria and evidence to 13/14. Their closure proves integration against implemented predecessors; the trade-off is that views must wait for dependency administration and resource movement.
- **Symmetric integration ownership:** retain the existing dependency graph and name each interaction on both participating tickets. The ticket delivered second must implement and verify the combination before closing, with a shared pending-obligation record and resource-specific tests. The first ticket cannot claim the combined story complete. This preserves more independent scheduling but makes closure bookkeeping conditional on the actual delivered set.

The user selected the explicit-prerequisite option on 2026-10-07. Only 13's blocker list changed; all other blocker lists and the 20-ticket structure remain intact. The graph remains acyclic. Issue 20 verifies the assembled integrations rather than absorbing missing feature implementation. This approval is documentary and does not authorize implementation.

## Reviewed source inventory

- [Implementation specification](../spec.md): all 117 stories, implementation/testing decisions, boundaries, and normative-source hierarchy.
- [Functional specification](../../mvp/spec.md): command inventory/signatures/conventions/guidance, web/shared behavior, resource/file/inference boundaries, seven acceptance scenarios, recorded decisions and exclusions.
- [Resolved architecture map](../../mvp-technical-architecture/map.md) and child answers 01-16: active contracts are mapped in the detailed traces. Research/proof answers 02-04 and the proof portion of 06 are historical selection/evidence inputs; they do not certify production behavior. Their retained requirements are owned by the later stack/query/validation/safety/canvas contracts.
- [Version-1 file/output/preview/runtime contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md): all sections, partitioned across the detailed traces.
- [Domain glossary](../../../CONTEXT.md), [project intent](../../../INTENT.md), and all four [ADRs](../../../docs/adr/): terminology and settled scope/architecture. No ADR conflict is introduced by these clarifications.
- [Issue tracker convention](../../../docs/agents/issue-tracker.md), [triage labels](../../../docs/agents/triage-labels.md), [domain convention](../../../docs/agents/domain.md), and repository AGENTS.md.
- All 20 implementation issue files and their README. Prototype outcomes are treated as historical observations; this task does not rerun them or use them as production evidence.

## Verification

Structural verification checks the 117 distinct story rows, valid ticket/criterion references, local document links, the sole approved blocker change (13 adds 11/12), graph acyclicity and transitive prerequisites, index/header consistency, completion boundaries for all 20 tickets, removal of implicit execution permission, and whitespace errors. These checks verify the documentary artifact only; semantic judgments come from the source-to-obligation review above. No root production test suite exists or was introduced for this documentary change.

The final PowerShell structural check passed on 2026-10-07: 25 documents, 20 tickets with one completion boundary each, three story traces containing 117 distinct rows exactly once, no invalid ticket/criterion references or missing local file targets, matching index/header story and blocker lists, and only issue 13's approved blocker change. Numeric topological order remains valid; 13 has verified transitive prerequisites 06/09/10/11/12. The check reported zero errors. `git diff --check` is the final whitespace gate. These results do not constitute semantic or runtime test execution.
