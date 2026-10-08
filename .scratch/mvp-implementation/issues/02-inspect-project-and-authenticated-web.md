# Inspect the project from CLI and an authenticated browser

Type: task
Status: ready-for-agent
State: resolved
Blocked by: 01
User stories covered: 5, 6, 8, 24, 25, 26, 110, 111, 112, 113, 114

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can inspect the same project inventory and effective configuration from the CLI and a local browser workspace, with reusable selectors and explicit validity/coverage information. Starting or reconnecting the web interface authenticates one fixed project server; foreground consoles, detached startup, status, and graceful stop remain independent of browser and terminal attachment. This slice delivers a real read-only project workspace, not just server infrastructure.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [x] Status, graph list/show, effective configuration, and model-type listings expose exact portable selectors, graph identities, associations, default/override provenance, and validity/incomplete coverage. Do not label unchecked prerequisites as a complete clean result; later resource kinds extend the same records.
- [x] Managed root declarations determine the most-specific compatible classification. Diagnose conflicting kinds or multiple roots; business individual types are not graph roots. Parseable unclassified content stays listed, and selector-derived graph identities follow the specified SHA-256 contract.
- [x] CLI and authenticated HTTP inspection use the same transport-independent operations and coherent read snapshots. Browser inventory/configuration/error states reflect those records without putting project logic in routes.
- [x] The server binds only the specified loopback host. Reads, controls, streams, and subsequent mutation endpoints enforce bearer authorization, actual Host and exact Origin checks, no proxy trust, and no permissive CORS. Public assets and unauthenticated errors expose no project data, secrets, or canonical paths.
- [x] A single-use fragment bootstrap is removed immediately from the browser URL, expires after 60 seconds, and creates a distinct tab bearer with the specified 12-hour/restart lifetime. Browser and native-control bearers cannot substitute for one another; credentials and opening links are redacted from logs and persisted project state.
- [x] Exclusive per-project runtime registration is protected to the OS user, including Windows ACLs. Before reporting health or controlling a process, verify canonical root, instance, full process identity, and authenticated protocol handshake; fail on unknown ownership, incompatible versions, or explicit-port conflicts.
- [x] Two concurrent starts yield one verified server. Background/JSON startup returns readiness without attaching; ordinary startup/reconnect attaches a bounded log/control console. Start the separate Node process without terminal dependency or a visible background window.
- [x] Detach, browser closure, and unexpected terminal loss preserve the server and sessions. Ctrl+C and authenticated stop request graceful shutdown; stop reports success only after shutdown and owned-registration release are verified. Absent stop is idempotent, and status neither starts nor attaches.
- [x] Browser labels/source text render safely as text; assets are served locally. CLI help/llms guidance describes lifecycle and inspection behavior, including transient opening links and actual launched application/protocol versions.
- [x] Real HTTP/browser and independent-process checks cover bootstrap replay/expiry, credential separation, Host/Origin rejection, protected registration, concurrent starts, independent projects, console detach/reconnect, non-TTY/JSON behavior, version mismatch, unreachable services, and verified stop.

## Blocked by

- [01 - Initialize and discover an offline project](01-initialize-offline-project.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Answer

Delivered read-only `status`, `graph list/show`, `config show`, and `config model-type list` through the shared coherent `inspectProject` operation and an authenticated local React workspace. Owned Turtle/N-Triples/RDF/XML/OWL discovery preserves malformed and unclassified records; managed-root classification, generated identity, exact RDF terms, expanded retained selectors, associations and whole-row configuration provenance are exposed consistently. The browser can inspect arbitrary retained selectors. Complete vocabulary/association/SHACL validation belongs to ticket 04: status explicitly reports incomplete coverage and exits 1 rather than claiming clean validity.

The separate fixed-project Node server binds `127.0.0.1`, loads local assets and its single inspection worker before readiness, and enforces actual Host/Origin, schema negotiation and distinct browser/native bearers. Immediate fragment removal, single-use 60-second bootstrap and 12-hour tab sessions are implemented. Inspection accepts one job at a time with a 256 MiB old-generation worker limit, keeping controls responsive during RDF work. Runtime registration is exclusive, owner-protected and guarded by full OS process identity plus authenticated versioned handshake. The project root must belong to the current OS user and prevent other users' writes; startup never changes that root's permissions. Unknown, incompatible and unresponsive registrations are preserved. Only start cleans a demonstrably ended registration. Console detach/loss preserves the server; stop verifies both shutdown and registration release.

Verification on 2026-10-08 used Windows, Node 24.14.1 and npm 11.17.0:

- Root `npm ci`, `npm run format` and `npm run check` passed; application typecheck/build passed. The full suite passed 47 of 48 tests, with the native macOS test skipped on Windows and no failures.
- Public-operation regressions cover classification conflicts, literal-valued non-root types, generated identity, owned and retained OWL, exact language/datatype/blank terms, ontology bindings, byte-preserving configuration inspection, unsafe selectors and argument/validation distinctions.
- Real HTTP and process checks cover bootstrap replay/expiry, credential separation/restart invalidation, Host/Origin rejection, schema negotiation, owner ACLs, explicit ports, simultaneous fresh/ended-owner starts, independent projects, unknown/incompatible/unreachable registrations, console loss/detach, Node-only non-TTY/JSON execution and verified idempotent stop. Granting Everyone write access to a Windows root made start/status/stop reject ownership while preserving registration bytes; restoring permissions allowed reconnection. Controls responded while an 80,000-triple inspection was busy.
- The collaborative browser verified immediate fragment removal, inventory/configuration inspection and hostile source text displayed as text, with no injected image and no local-storage credential. A native Windows terminal verified `detach` preserves the server and Ctrl+C shuts it down. The preview host became unavailable before a viewport/screenshot check; no screenshot or mobile execution is claimed.
- The compiled CLI ran with PATH empty and matched authenticated HTTP envelopes for graphs, configuration and incomplete status. Package dry-run inspection included 66 files, including four web assets, the compiled server/worker and 18 starter files; authored source/tests were excluded.
- Parallel standards/specification reviews found permission-parent/root, OWL discovery, browser selector, argument-status, binding-field and ended-owner concurrency gaps. These were corrected with focused regressions and review follow-up.

This ticket's native runtime execution is established on Windows. Linux/macOS adapters and the existing four-platform CI matrix are retained, but this feature was not executed natively on those platforms during this session. Ticket 20 retains complete installed-artifact and supported-platform acceptance; no package publication or new CI execution is claimed here.

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

- On 2026-10-08, implementation and Windows verification completed on `feat/inspect-project-authenticated-web`. See Answer for review corrections, execution evidence and remaining platform/validation limits.
