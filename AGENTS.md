## Language

Conversations may be in English or Spanish. Write all repository documents and documentation in English.

## Git workflow

- Before modifying repository files, create a new branch if the current branch is `main`.
- Never commit directly to `main`; bring changes into `main` through a pull request.

## Agent skills

### Issue tracker

Issues live as Markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five triage status names. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout. See `docs/agents/domain.md`.

## Prototypes

- Put each prototype in its own subdirectory of `prototypes/`.
- Keep its dependencies inside that subdirectory. Prototypes must not depend on each other or on the main repository, and their dependencies must not affect either.
- Do not add prototype-specific commands or scripts at the repository root. Run and test a prototype from its own directory.
- Give each prototype a `README.md` stating its purpose and exact run commands.
- Give each prototype a `VERDICT.md` recording execution details and an executive summary of the test conclusions.
