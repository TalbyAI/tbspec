# Inspect the project from CLI and an authenticated browser

Type: AFK
Status: ready-for-agent
Blocked by: 01
User stories covered: 5, 6, 8, 24, 25, 26, 110, 111, 112, 113, 114

## Parent

[MVP implementation specification](../spec.md#user-stories).

## What to build

A user can inspect the same project inventory and effective configuration from the CLI and a local browser workspace, with reusable selectors and explicit validity/coverage information. Starting or reconnecting the web interface authenticates one fixed project server; foreground consoles, detached startup, status, and graceful stop remain independent of browser and terminal attachment. This slice delivers a real read-only project workspace, not just server infrastructure.

Follow the [shared delivery requirements](README.md#shared-delivery-requirements) and the normative contracts below.

## Acceptance criteria

- [ ] Status, graph list/show, effective configuration, and model-type listings expose exact portable selectors, graph identities, associations, default/override provenance, and validity/incomplete coverage. Do not label unchecked prerequisites as a complete clean result; later resource kinds extend the same records.
- [ ] Managed root declarations determine the most-specific compatible classification. Diagnose conflicting kinds or multiple roots; business individual types are not graph roots. Parseable unclassified content stays listed, and selector-derived graph identities follow the specified SHA-256 contract.
- [ ] CLI and authenticated HTTP inspection use the same transport-independent operations and coherent read snapshots. Browser inventory/configuration/error states reflect those records without putting project logic in routes.
- [ ] The server binds only the specified loopback host. Reads, controls, streams, and subsequent mutation endpoints enforce bearer authorization, actual Host and exact Origin checks, no proxy trust, and no permissive CORS. Public assets and unauthenticated errors expose no project data, secrets, or canonical paths.
- [ ] A single-use fragment bootstrap is removed immediately from the browser URL, expires after 60 seconds, and creates a distinct tab bearer with the specified 12-hour/restart lifetime. Browser and native-control bearers cannot substitute for one another; credentials and opening links are redacted from logs and persisted project state.
- [ ] Exclusive per-project runtime registration is protected to the OS user, including Windows ACLs. Before reporting health or controlling a process, verify canonical root, instance, full process identity, and authenticated protocol handshake; fail on unknown ownership, incompatible versions, or explicit-port conflicts.
- [ ] Two concurrent starts yield one verified server. Background/JSON startup returns readiness without attaching; ordinary startup/reconnect attaches a bounded log/control console. Start the separate Node process without terminal dependency or a visible background window.
- [ ] Detach, browser closure, and unexpected terminal loss preserve the server and sessions. Ctrl+C and authenticated stop request graceful shutdown; stop reports success only after shutdown and owned-registration release are verified. Absent stop is idempotent, and status neither starts nor attaches.
- [ ] Browser labels/source text render safely as text; assets are served locally. CLI help/llms guidance describes lifecycle and inspection behavior, including transient opening links and actual launched application/protocol versions.
- [ ] Real HTTP/browser and independent-process checks cover bootstrap replay/expiry, credential separation, Host/Origin rejection, protected registration, concurrent starts, independent projects, console detach/reconnect, non-TTY/JSON behavior, version mismatch, unreachable services, and verified stop.

## Blocked by

- [01 - Initialize and discover an offline project](01-initialize-offline-project.md).

## References

- [Implementation and testing decisions](../spec.md#implementation-decisions).
- [Version-1 file, output, and preview contract](../../mvp-technical-architecture/contracts/file-and-output-schemas.md).
- [Architecture decision 11](../../mvp-technical-architecture/issues/11-starter-resource-contract.md).
- [Architecture decision 13](../../mvp-technical-architecture/issues/13-cli-web-runtime-boundary.md).
- [Architecture decision 14](../../mvp-technical-architecture/issues/14-concrete-file-and-output-schemas.md).

## Comments

- On 2026-10-04, the user approved the grouped breakdown of 20 AFK implementation tickets, including this scope, dependencies, and story coverage.

