# Choose dependency snapshot and resolution mechanics

Type: grilling
Status: ready-for-human
State: open
Blocked by: 05, 10

## Question

How should the MVP discover one selected resource and its allowed closure from directories, Git, and single-graph HTTP(S) URLs; snapshot and hash every included file; and resolve ontology and visual-design precedence without merging losing snapshots? Define the smallest cross-platform source acquisition and lockfile boundary consistent with ADR 0001 and spec 0.1, including offline validation and drift checks. Distinguish source fetches triggered by explicit dependency actions from local query or validation.
