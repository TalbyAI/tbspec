## Language

Conversations may be in English or Spanish. Write all repository documents and documentation in English.

## Git workflow

- Before modifying repository files, create a new branch if the current branch is `main`.
- Never commit directly to `main`; bring changes into `main` through a pull request.

## Formatting and validation

- Run `npm ci` at the repository root before using the quality tools. This also installs the local pre-commit hook.
- After creating or changing Markdown, JavaScript, TypeScript, JSX/TSX, JSON/JSONC, CSS, GraphQL, or YAML files, run `npm run format` and then `npm run check` from the repository root before handing off the work. Resolve remaining lint errors manually; do not use unsafe fixes or weaken rules to make checks pass.
- Biome owns code formatting, linting, and import organization. Prettier formats Markdown and YAML only; markdownlint-cli2 validates Markdown. See [formatting and validation](docs/agents/formatting.md) for commands, exclusions, and targeted formatting.
- The pre-commit hook formats and validates staged files. CI runs the full read-only checks, including Markdown under `.scratch/`. Hooks and editor integrations supplement the required agent commands.
- Do not format dependency directories, generated output, lockfiles, measurement records, or fixtures. Keep prototype dependencies and execution commands inside each prototype; root quality tooling inspects their authored files without importing or building them.

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
