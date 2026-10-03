# Define concrete project file and machine-output schemas

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: Codex
Blocked by: 07, 08, 09, 11, 12, 13

## Question

What exact versioned fields and compatibility rules will `tbspec.toml`, `tbspec.lock`, saved-query `.query.toml` files, and `--json` responses/bindings use? Derive them from the settled resource, dependency, query, and diagnostic architecture. Preserve the spec's CLI exit/status semantics and human-editable manifest comments; identify any schema ambiguity that truly needs a user decision before implementation.

## Decision inputs

Apply [Choose dependency snapshot and resolution mechanics](12-dependency-resolution-architecture.md) when defining lock inventory fields, per-file byte digests and parser contexts, graph-content versus aggregate interpretation signatures, provenance/edges/source bindings/support choices, acquisition-limit settings, and stable dependency-ID-plus-file selectors for retained closure/support graphs. Preserve credential-free locators and original graph IRIs. This ticket owns the concrete encodings and selector syntax; the dependency ticket owns their approved semantics.

Apply [Choose the shared CLI and loopback web architecture](13-cli-web-runtime-boundary.md) when defining web runtime registration and authenticated control-protocol compatibility, server status/URL fields and exit categories, single-envelope JSON startup behavior, transient opening-link treatment, browser preview handles, and the CLI accepted-preview fingerprint/binding representation. Preserve separation between runtime state and project validity, between package/protocol and project/JSON schema versions, and between canonical base URLs and short-lived credential-bearing opening links. Runtime records, credentials, and uncommitted preview workspaces are ephemeral and excluded from project versioning/dependency inventories. The runtime ticket owns lifecycle, authorization, and exact-byte/revision semantics; this ticket owns concrete paths, wire fields, compatibility encodings, and the explicit CLI binding syntax needed to reject a changed reacquired preview.

## Comments

- On 2026-10-03, the user invoked `implement` for this ticket, authorizing completion of the schema decision and a commit. Codex created `decision/concrete-file-output-schemas` from `main` before modifying repository files.
- This is an architecture deliverable under the map's production-implementation exclusion. The resolution derives encodings from settled behavior; it does not claim that the future CLI, schema validators, or runtime have been implemented.

## Answer

Use the version-1 [file and machine-output contract](../contracts/file-and-output-schemas.md). It defines manifest and lock fields, saved-query declarations, typed RDF bindings/results, diagnostic and exit/status encodings, retained-file selectors, deterministic signatures, runtime registration/control records, and revision-bound preview application.

The contract preserves the functional specification and tickets 07–13. The nested selector is `dep:<id>/<file-key>`; an accepted CLI preview is bound with `--accepted-preview sha256:<digest>` in addition to the command's existing application/acceptance flags. Runtime and project validity remain independent, as do project schemas, JSON schemas, package versions, and runtime protocols. No unresolved product ambiguity requires another human decision; parser/editor package selection and the HTTP adapters remain implementation choices with explicit acceptance evidence.

Index this resolution in the map and link the concrete syntax from the functional spec. No new domain vocabulary, ADR, production code, prototype, dependency, or publication is introduced. Syntax/link checks and review of this document are evidence about the architecture artifact only; the contract lists the behavior checks required during production implementation.

## Validation

- Parsed the three fenced TOML/JSON examples using Python's `tomllib`/`json`; checked 44 local links/anchors, the canonical SHA-256 golden vector, and all six resolved blocking tickets.
- Ran separate standards and specification reviews. No standards breaches were found. Corrected specification findings about JSON argument-error output, canonical OS identity encoding, and transaction recovery records; follow-up review found no remaining blocking inconsistency.
- Checked the final diff for whitespace errors. No root production typecheck or test suite exists; no runtime/schema implementation or cross-platform behavior is claimed by these documentation checks.
