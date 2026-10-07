# Formatting and validation

Repository quality tooling uses Node 24 and npm. Its development dependencies live at the repository root and do not introduce npm workspaces or dependencies between prototypes. Install and run each prototype from its own directory as described in its README.

## Install and run

From the repository root:

```sh
npm ci
npm run format
npm run check
```

`npm ci` installs the pinned dependency graph and configures Husky's local pre-commit hook. `npm run format` formats code, organizes imports, applies safe Biome fixes, formats Markdown and YAML, and applies supported Markdown fixes. Some lint findings require manual edits; the command fails until they are resolved. Run `npm run check` after fixing them.

| Command               | Purpose                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| `npm run format`      | Apply code and document formatting and safe fixes                                 |
| `npm run format:code` | Apply Biome formatting, import organization, and safe lint fixes                  |
| `npm run format:docs` | Format Markdown/YAML and apply supported Markdown fixes                           |
| `npm run lint`        | Validate code and Markdown without changing files                                 |
| `npm run check`       | Validate formatting, imports, code lint, and Markdown lint without changing files |
| `npm run check:code`  | Run Biome's read-only CI checks                                                   |
| `npm run check:docs`  | Check Markdown/YAML formatting and Markdown lint                                  |

Commands use repository-local binaries and quoted patterns so they work in Windows, macOS, and Linux shells. Run them from the root so every tool uses the shared configuration. Do not run another formatter over Biome-owned files.

## Tool responsibilities

- Biome formats and lints JavaScript, TypeScript, JSX/TSX, JSON/JSONC, CSS, and GraphQL. Recommended lint rules are enabled and warnings fail checks. Informational suggestions are hidden in normal command output and do not fail checks. Formatting uses two spaces, LF endings, and a 100-column code width. Existing prototype JSX uses the classic React runtime, so a scoped override keeps its required React imports.
- Prettier formats Markdown and YAML. It preserves existing prose wrapping and does not reformat embedded code examples.
- markdownlint-cli2 checks Markdown structure and style. Long prose lines are allowed, duplicate headings are permitted in different sections, and tables use aligned columns. `AGENTS.md` may begin with a second-level heading to retain its existing structure. Other recommended rules remain enabled.
- `.editorconfig` supplies compatible editor defaults; `.gitattributes` keeps supported authored text files on LF across operating systems.

Biome does not check TypeScript types or format Markdown/YAML. Markdown lint does not validate external links or the meaning of examples. Add compiler, application tests, and additional language tools when implementation introduces their requirements.

## Agent workflow

After creating or modifying a supported file, run `npm run format`, resolve remaining errors, then run `npm run check`. Review the diff before handing off work. Formatting can touch existing authored files throughout the repository, so resolve only relevant lint findings and avoid unrelated behavioral changes.

For a focused edit, these commands accept individual file paths from the repository root:

```sh
npx --no-install biome check --write --error-on-warnings path/to/file.ts
npx --no-install prettier --write path/to/document.md
npx --no-install markdownlint-cli2 --fix --no-globs path/to/document.md
```

Use Prettier only for Markdown and YAML. Always finish with the full `npm run check`; targeted commands are not a substitute for CI coverage.

## Editor and commit integration

VS Code recommends the Biome, Prettier, markdownlint, and EditorConfig extensions. Workspace settings enable formatting on save using Biome for code and Prettier for Markdown/YAML; Biome also applies safe fixes and organizes imports on explicit saves. Markdown lint runs on save and reports remaining findings. Install the recommended extensions to enable this behavior.

The Husky pre-commit hook runs lint-staged using locally installed tools. It formats and validates only staged supported files, stages successful fixes, and blocks the commit if errors remain. lint-staged protects unstaged changes in partially staged files. Markdown validation uses `--no-globs` so the hook does not lint every document. Hooks can be bypassed and do not run after edits made directly by an agent; the agent commands and CI remain required.

## Scope and exclusions

All authored supported files are checked, including dot directories such as `.scratch/` and independent prototypes. Root quality scripts do not install, import, build, or execute prototype code.

Exclude dependency directories, `dist`, `coverage`, Maven `target`, local `.m2`/`.tools`, `.worktrees`, `.firecrawl`, fixtures, npm lockfiles, and prototype `measurement.json` records. Preserve fixture and measurement bytes: they can contain deliberate invalid syntax or evidence from an earlier execution. Biome and Markdown lint also respect Git ignore rules. Prettier exclusions are listed explicitly in `.prettierignore`.

When introducing another generated directory or an ignore rule affecting authored documents, review all three tool configurations. Unsupported languages such as Turtle, Java, and HTML are outside these checks. Do not claim they are formatted or validated by this setup.

## Continuous integration

The `Repository quality` GitHub Actions workflow runs on pull requests, pushes to `main`, and manual dispatch. It installs root tooling with `npm ci` on Node 24, disables hook installation in CI, and runs `npm run check` without writing fixes. Any formatting difference or lint error fails the `Format and lint` job; no path filter skips document-only changes.

Repository administrators can make `Format and lint` a required status check in GitHub branch protection or rulesets. This setup does not change repository protections. CI reports failures; GitHub requires that additional policy to block merging a failed check.

## Dependency maintenance

Direct tooling versions and transitive dependencies are pinned. The `smol-toml` override selects 1.9.0 to address the parser's quadratic-time denial-of-service issue; review the override when markdownlint-cli2 updates its dependency.

As of 2026-10-07, `npm audit` still reports transitive advisories through markdownlint-cli2. [Braces has no patched release](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); the affected path processes glob expressions, which this setup defines in trusted repository configuration. The [KaTeX advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7) requires rendering HTML into a page, which these CLI checks do not do. Keep these advisories visible and reassess on dependency updates; do not apply `npm audit fix --force` or silently change the pinned tool versions.

## Setup verification (2026-10-07)

`npm ci`, `npm run format`, `npm run check`, and `npm run lint` were verified on Windows with Node 24.14.1 and npm 11.17.0. A second formatting pass and the read-only checks preserved file hashes. All 63 authored Markdown files, including `.scratch/`, passed validation.

Nine scenarios in an isolated temporary Git repository exercised reproducible installation, automatic formatting/staging of Markdown and TypeScript, rejection of Markdown structure errors and code lint errors, warning failures, staged-file-only validation, preservation of partial staging, exclusions, and idempotent formatting/read-only checking. Invalid fixture, generated, lockfile, and measurement files were deliberately included to confirm they remained untouched.

The prototypes' existing Node checks, both Vite builds, and graph-layout measurements also passed from their own directories; their `VERDICT.md` files record the results. The GitHub Actions workflow uses the same checked command. A hosted workflow run remains pending until these changes are pushed in a pull request.
