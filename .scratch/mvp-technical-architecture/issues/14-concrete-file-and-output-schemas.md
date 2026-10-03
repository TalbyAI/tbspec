# Define concrete project file and machine-output schemas

Type: grilling
Status: ready-for-human
State: open
Blocked by: 07, 08, 09, 11, 12, 13

## Question

What exact versioned fields and compatibility rules will `tbspec.toml`, `tbspec.lock`, saved-query `.query.toml` files, and `--json` responses/bindings use? Derive them from the settled resource, dependency, query, and diagnostic architecture. Preserve the spec's CLI exit/status semantics and human-editable manifest comments; identify any schema ambiguity that truly needs a user decision before implementation.

## Decision inputs

Apply [Choose dependency snapshot and resolution mechanics](12-dependency-resolution-architecture.md) when defining lock inventory fields, per-file byte digests and parser contexts, graph-content versus aggregate interpretation signatures, provenance/edges/source bindings/support choices, acquisition-limit settings, and stable dependency-ID-plus-file selectors for retained closure/support graphs. Preserve credential-free locators and original graph IRIs. This ticket owns the concrete encodings and selector syntax; the dependency ticket owns their approved semantics.
