# Define concrete project file and machine-output schemas

Type: grilling
Status: ready-for-human
State: open
Blocked by: 07, 08, 09, 11, 12, 13

## Question

What exact versioned fields and compatibility rules will `tbspec.toml`, `tbspec.lock`, saved-query `.query.toml` files, and `--json` responses/bindings use? Derive them from the settled resource, dependency, query, and diagnostic architecture. Preserve the spec's CLI exit/status semantics and human-editable manifest comments; identify any schema ambiguity that truly needs a user decision before implementation.

## Decision inputs

Apply [Choose dependency snapshot and resolution mechanics](12-dependency-resolution-architecture.md) when defining lock inventory fields, per-file byte digests and parser contexts, graph-content versus aggregate interpretation signatures, provenance/edges/source bindings/support choices, acquisition-limit settings, and stable dependency-ID-plus-file selectors for retained closure/support graphs. Preserve credential-free locators and original graph IRIs. This ticket owns the concrete encodings and selector syntax; the dependency ticket owns their approved semantics.

Apply [Choose the shared CLI and loopback web architecture](13-cli-web-runtime-boundary.md) when defining web runtime registration and authenticated control-protocol compatibility, server status/URL fields and exit categories, single-envelope JSON startup behavior, transient opening-link treatment, browser preview handles, and the CLI accepted-preview fingerprint/binding representation. Preserve separation between runtime state and project validity, between package/protocol and project/JSON schema versions, and between canonical base URLs and short-lived credential-bearing opening links. Runtime records, credentials, and uncommitted preview workspaces are ephemeral and excluded from project versioning/dependency inventories. The runtime ticket owns lifecycle, authorization, and exact-byte/revision semantics; this ticket owns concrete paths, wire fields, compatibility encodings, and the explicit CLI binding syntax needed to reject a changed reacquired preview.
