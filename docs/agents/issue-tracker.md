# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`.
- The spec is `.scratch/<feature-slug>/spec.md`.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`.
- Triage state is a `Status:` line near the top of each issue file. Use the names in `triage-labels.md`.
- Append conversation history under `## Comments` in the issue file.

## When a skill says "publish to the issue tracker"

Create a file under `.scratch/<feature-slug>/`, creating the directory if needed.

## When a skill says "fetch the relevant ticket"

Read the referenced file. The user will normally supply its path or issue number.

## Wayfinding operations

Used by `/wayfinder`. A map file has one child file per ticket.

- Map: `.scratch/<effort>/map.md`, containing Notes, Decisions-so-far, and Fog.
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in its body. A `Type:` line records `research`, `prototype`, `grilling`, or `task`; a `Status:` line records `claimed` or `resolved`.
- Blocking: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every listed file is `resolved`.
- Frontier: scan `.scratch/<effort>/issues/` for open, unblocked, unclaimed files; first by number wins.
- Claim: set `Status: claimed` and save before starting work.
- Resolve: append the answer under `## Answer`, set `Status: resolved`, then add a gist and link to the map's Decisions-so-far.
