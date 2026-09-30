# Choose safe project file mutations and edit conflicts

Type: grilling
Status: ready-for-human
State: resolved
Assigned to: Codex
Blocked by: 05

## Question

How should shared project operations stage and commit changes to RDF files, `tbspec.toml`, `tbspec.lock`, and snapshots so recoverable failures leave prior state available? Decide a minimal cross-platform conflict check for CLI and loopback web edits, including the web stale-save rule, path confinement under the selected project root, preservation of unrelated TOML keys/comments, and honest crash-recovery limits. Do not add a persistent RDF database by default.

## Comments

- The user accepted staged multi-file writes with restoration of prior files after recoverable errors. Other programs may observe intermediate files during installation; `tbspec` coordinates its own reads and writes.
- After an interrupted operation, the user chose to block further writes and guide manual recovery from retained originals rather than restore automatically.
- The user chose conflict checks on the operation's read inputs and destinations, not every project file. A web save based on a stale disk version is rejected and requires a reload.
- The user accepted best-effort protection against concurrent local processes: reject escaping paths and recheck immediately before writes, without claiming safety against an adversarial process that swaps paths or files during that final window.

## Answer

CLI and loopback web mutations use the same project-file operation. For an existing project, an exclusive project lock claimed by creating a lock directory coordinates `tbspec` writers and the file reads from which `tbspec` builds an operation. Long source fetches and expensive computation may happen outside the lock; reacquire it and recheck inputs before installing results. Under the lock, prepare each new RDF file, manifest edit, lockfile, and dependency snapshot beside its target before changing live paths. Record the intended creates, replacements, moves, and deletes, plus recoverable copies of the original bytes. Apply the prepared changes only after all required input and output checks pass. On an ordinary I/O or validation failure during installation, restore the originals and remove new files; report success only after the entire operation is installed and cleaned up. If restoration itself fails, retain the originals and transaction details for manual recovery and refuse further writes. Do not add a persistent RDF database or a second revision history.

The operation records byte-content hashes for every file used to derive its result and every existing destination, plus expected absence for new destinations. Immediately before installation, reject any changed input or destination and any newly occupied destination as a conflict; unrelated project files do not block the operation. CLI previews do not reserve files: an apply recomputes or rechecks its inputs. A web editor supplies the disk revision from which it loaded each edited file. If the disk changed, reject the save and require reload, with no force-overwrite path. Separately, if a Turtle draft became stale because of canvas edits in the same web session, show both changes and require the explicit replacement confirmation already specified in [the canvas projection decision](07-rdf-canvas-projection.md). A confirmed draft still cannot override a changed disk revision.

Resolve the selected project root to its real path. Write targets must be project-relative, cannot contain `..`, and cannot traverse a symbolic link or junction below that root; recheck the target and its parent path before installation. Explicit dependency sources may be read outside the project, but snapshots and all other writes remain under the selected root. This protects ordinary local use; a non-cooperating process that swaps a path or file between the final check and filesystem operation remains outside the MVP guarantee.

Edit only the affected setting or table in the original `tbspec.toml` text, preserving unrelated keys, comments, and formatting; parse and verify the result before staging, and fail rather than rewrite the whole manifest if a safe edit is unavailable. `tbspec.lock` is tool-owned and may be regenerated. RDF graph edits preserve unknown statements and RDF terms, but Turtle layout and comments may change; the raw web source editor may save invalid RDF with diagnostics as already specified.

Keep transaction originals and an affected-path record until installation and cleanup succeed. If a process or machine crashes, detect the unfinished transaction on the next invocation, report the affected paths and recovery location, and block new writes until a person restores or accepts the on-disk state and clears it. Read-only recovery inspection remains available and must identify the project as potentially inconsistent. `tbspec` does not automatically roll back after a crash, and external programs may observe intermediate files during installation. This is not a cross-file atomic visibility or power-loss durability guarantee.
