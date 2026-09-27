# Choose safe project file mutations and edit conflicts

Type: grilling
Status: ready-for-human
State: open
Blocked by: 05

## Question

How should shared project operations stage and commit changes to RDF files, `tbspec.toml`, `tbspec.lock`, and snapshots so recoverable failures leave prior state available? Decide a minimal cross-platform conflict check for CLI and loopback web edits, including the web stale-save rule, path confinement under the selected project root, preservation of unrelated TOML keys/comments, and honest crash-recovery limits. Do not add a persistent RDF database by default.
