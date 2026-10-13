import { useCallback, useEffect, useRef, useState } from "react";

interface Envelope {
  schemaVersion: number;
  status: string;
  data: Record<string, unknown> | null;
  diagnostics: { code: string; severity: string; message: string; file?: string | null }[];
}
interface InventoryItem {
  resource: string;
  sourceResource: string;
  kind: string;
  classification: string;
  identity: string;
  graphIri: string | null;
  byteDigest: string | null;
  graphSignature: string | null;
  byteLength: number | null;
  parseable: boolean;
  diagnostic?: { code: string; severity: string; message: string; file?: string | null };
}
interface DependencyItem {
  id: string;
  kind: string;
  primarySelector: string;
  interpretationSignature: string;
  files: { selector: string; file: string; role: string[] }[];
  sources: Record<string, unknown>[];
  support: {
    kind: string;
    resourceSelector?: string;
    supportSelector?: string;
    role?: "shacl" | "design";
    origin?: string | null;
    active?: boolean;
  }[];
  ontologies: {
    graphIri: string;
    selector: string;
    signature: string;
    effective: boolean;
    choice: string | null;
    resolution: string;
    candidates: string[];
  }[];
}
interface CheckItem {
  id: string;
  state: "unchanged" | "changed" | "unavailable";
  comparison: "complete" | "partial" | "unavailable";
}
interface Props {
  session: string;
  onApplied: () => void;
}

function operationId() {
  return (
    globalThis.crypto?.randomUUID?.().replaceAll("-", "") ??
    `${Date.now()}${Math.random().toString(16).slice(2)}`
  );
}

export function DependenciesPanel({ session, onApplied }: Props) {
  const [source, setSource] = useState("");
  const [ref, setRef] = useState("");
  const [resource, setResource] = useState("");
  const [dependencyId, setDependencyId] = useState("");
  const [renameIds, setRenameIds] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<"ontology" | "model" | "design">("ontology");
  const [supportRole, setSupportRole] = useState<"shacl" | "design">("shacl");
  const [supportTargets, setSupportTargets] = useState<Record<string, string>>({});
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [dependencies, setDependencies] = useState<DependencyItem[]>([]);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [diagnostics, setDiagnostics] = useState<Envelope["diagnostics"]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptImpact, setAcceptImpact] = useState(false);
  const activeOperation = useRef("");
  const activeController = useRef<AbortController | null>(null);

  const send = useCallback(
    async (
      path: string,
      body?: Record<string, unknown>,
      signal?: AbortSignal,
      allowDomainFailure = false,
    ): Promise<Envelope> => {
      const response = await fetch(`/api/project/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${session}`,
          "X-Tbspec-Schema-Version": "1",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
      const envelope = (await response.json()) as Envelope;
      if (envelope.schemaVersion !== 1)
        throw new Error("Incompatible project API. Restart the server with a matching release.");
      if (!response.ok && !allowDomainFailure)
        throw new Error(
          envelope.diagnostics.map((diagnostic) => diagnostic.message).join(" ") ||
            "Dependency operation failed.",
        );
      return envelope;
    },
    [session],
  );

  const loadDependencies = useCallback(async () => {
    try {
      const result = await send("dependencies");
      setDependencies((result.data?.items as DependencyItem[]) ?? []);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not list dependencies.");
    }
  }, [send]);

  useEffect(() => {
    void loadDependencies();
    return () => {
      const operation = activeOperation.current;
      if (operation) {
        void fetch("/api/project/v1/dependencies/cancel", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session}`,
            "X-Tbspec-Schema-Version": "1",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ operationId: operation }),
          keepalive: true,
        });
      }
      activeController.current?.abort();
    };
  }, [loadDependencies, session]);

  async function runAcquisition(
    path: "inspect" | "add" | "update" | "rename" | "remove" | "support/set" | "support/clear",
    body: Record<string, unknown>,
  ) {
    const operation = operationId();
    const controller = new AbortController();
    activeOperation.current = operation;
    activeController.current = controller;
    setBusy(true);
    setError("");
    setDiagnostics([]);
    setPreview(null);
    setAcceptImpact(false);
    try {
      const result = await send(
        `dependencies/${path}`,
        { ...body, operationId: operation },
        controller.signal,
      );
      setDiagnostics(result.diagnostics ?? []);
      if (path === "inspect") {
        const found = (result.data?.items as InventoryItem[]) ?? [];
        setItems(found);
        setSelected(null);
      } else {
        setPreview(result.data);
      }
    } catch (problem) {
      if (!controller.signal.aborted)
        setError(problem instanceof Error ? problem.message : "Dependency operation failed.");
    } finally {
      if (activeOperation.current === operation) {
        activeOperation.current = "";
        activeController.current = null;
      }
      setBusy(false);
    }
  }

  async function cancelCurrent() {
    const operation = activeOperation.current;
    if (!operation) return;
    try {
      await send("dependencies/cancel", { operationId: operation });
    } catch {
      // The in-flight request may finish or disconnect while cancellation is being delivered.
    }
    activeController.current?.abort();
    activeOperation.current = "";
    setBusy(false);
  }

  async function applyPreview() {
    if (
      !preview ||
      typeof preview.handle !== "string" ||
      typeof preview.preview !== "object" ||
      !preview.preview
    )
      return;
    const previewDetails = preview.preview as {
      fingerprint?: unknown;
      impact?: { acceptance?: string[] };
    };
    const fingerprint = previewDetails.fingerprint;
    if (typeof fingerprint !== "string") return;
    const acceptance = previewDetails.impact?.acceptance ?? [];
    if (acceptance.includes("accept-impact") && !acceptImpact) return;
    const accepted: string[] = acceptance.filter((flag) => flag === "apply" || flag === "confirm");
    if (acceptance.includes("accept-impact")) accepted.push("accept-impact");
    setBusy(true);
    setError("");
    try {
      const result = await send("dependencies/apply", {
        schemaVersion: 1,
        handle: preview.handle,
        fingerprint,
        accept: accepted,
      });
      setDiagnostics(result.diagnostics ?? []);
      setPreview(null);
      setItems([]);
      await loadDependencies();
      onApplied();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not apply the reviewed dependency.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function discardPreview() {
    if (!preview || typeof preview.handle !== "string") return;
    try {
      await send("dependencies/cancel", { handle: preview.handle });
      setPreview(null);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not discard the dependency preview.",
      );
    }
  }

  async function showDependency(id: string) {
    setError("");
    try {
      const result = await send(`dependency?id=${encodeURIComponent(id)}`);
      setSelected(result.data);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not show the dependency.");
    }
  }

  async function checkDependencies(id?: string) {
    const operation = operationId();
    const controller = new AbortController();
    activeOperation.current = operation;
    activeController.current = controller;
    setBusy(true);
    setError("");
    setDiagnostics([]);
    try {
      const result = await send(
        "dependencies/check",
        { ...(id ? { id } : {}), operationId: operation },
        controller.signal,
        true,
      );
      setChecks((result.data?.items as CheckItem[]) ?? []);
      setDiagnostics(result.diagnostics ?? []);
    } catch (problem) {
      if (!controller.signal.aborted)
        setError(problem instanceof Error ? problem.message : "Could not check dependencies.");
    } finally {
      if (activeOperation.current === operation) {
        activeOperation.current = "";
        activeController.current = null;
      }
      setBusy(false);
    }
  }

  async function chooseOntology(ontologyIri: string, id: string | null) {
    setBusy(true);
    setError("");
    setDiagnostics([]);
    try {
      const result = await send(`dependencies/${id ? "select" : "clear"}`, {
        ontologyIri,
        ...(id ? { id } : {}),
      });
      setDiagnostics(result.diagnostics ?? []);
      await loadDependencies();
      onApplied();
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Could not update the ontology choice.",
      );
    } finally {
      setBusy(false);
    }
  }

  const inspect = (event: React.FormEvent) => {
    event.preventDefault();
    if (!source.trim()) return;
    void runAcquisition("inspect", {
      source: source.trim(),
      ...(ref.trim() ? { ref: ref.trim() } : {}),
      ...(resource.trim() ? { resource: resource.trim() } : {}),
    });
  };
  const prepare = (event: React.FormEvent) => {
    event.preventDefault();
    if (!source.trim() || !dependencyId.trim()) return;
    void runAcquisition("add", {
      source: source.trim(),
      id: dependencyId.trim(),
      kind,
      ...(ref.trim() ? { ref: ref.trim() } : {}),
      ...(resource.trim() ? { resource: resource.trim() } : {}),
    });
  };

  const diagnosticOccurrences = new Map<string, number>();
  return (
    <section aria-label="Dependencies">
      <h2>Acquire dependencies</h2>
      <p>
        Inspect a local directory, credential-free HTTP(S) source, or Git repository. Review the
        complete dependency closure before adding its locked snapshot.
      </p>
      <div className="resource-layout">
        <form onSubmit={inspect}>
          <label htmlFor="dependency-source">Source locator</label>
          <input
            id="dependency-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="./vocabularies or https://example.org/ontology.ttl"
            autoComplete="off"
          />
          <label htmlFor="dependency-ref">Git ref (optional)</label>
          <input
            id="dependency-ref"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            placeholder="branch, tag, or commit"
            autoComplete="off"
          />
          <label htmlFor="dependency-resource">Select resource (optional)</label>
          <input
            id="dependency-resource"
            value={resource}
            onChange={(event) => setResource(event.target.value)}
            placeholder="choose after inspection"
            autoComplete="off"
          />
          <button type="submit" disabled={busy || !source.trim()}>
            Inspect source
          </button>
        </form>
        <form onSubmit={prepare}>
          <label htmlFor="dependency-id">Dependency ID</label>
          <input
            id="dependency-id"
            value={dependencyId}
            onChange={(event) => setDependencyId(event.target.value)}
            placeholder="shared-vocabulary"
            autoComplete="off"
          />
          <label htmlFor="dependency-kind">Primary resource kind</label>
          <select
            id="dependency-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="ontology">Ontology</option>
            <option value="model">Model</option>
            <option value="design">Design</option>
          </select>
          <label htmlFor="dependency-support-role">Manual support role</label>
          <select
            id="dependency-support-role"
            value={supportRole}
            onChange={(event) => setSupportRole(event.target.value as typeof supportRole)}
          >
            <option value="shacl">SHACL shapes</option>
            <option value="design">Visual design</option>
          </select>
          <button type="submit" disabled={busy || !source.trim() || !dependencyId.trim()}>
            Prepare add preview
          </button>
          {busy && (
            <button type="button" onClick={() => void cancelCurrent()}>
              Cancel current dependency operation
            </button>
          )}
        </form>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {busy && (
        <p role="status">
          A dependency operation is in progress… Other workspace sections remain available.
        </p>
      )}
      {items.length > 0 && (
        <>
          <h3>Source inventory</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Resource</th>
                  <th>Kind</th>
                  <th>Graph IRI</th>
                  <th>Bytes</th>
                  <th>Parse</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.resource}>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setResource(item.resource);
                          setSelected(item as unknown as Record<string, unknown>);
                        }}
                      >
                        {item.resource}
                      </button>
                    </td>
                    <td>{item.kind}</td>
                    <td>{item.graphIri ?? "(no explicit graph IRI)"}</td>
                    <td>{item.byteLength ?? "unavailable"}</td>
                    <td>
                      {item.parseable ? "ready" : (item.diagnostic?.message ?? "unavailable")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {preview && (
        <section aria-label="Dependency preview">
          <h3>
            Review staged{" "}
            {String(
              (preview.preview as { operation?: unknown } | undefined)?.operation ?? "dependency",
            )}
          </h3>
          <p>
            {String((preview.preview as { operation?: unknown } | undefined)?.operation ?? "") ===
            "dependency.rename"
              ? "Review every selector, choice, lock path, and selector-derived graph identity change. Snapshot RDF bytes and declared graph identities stay unchanged."
              : String(
                    (preview.preview as { operation?: unknown } | undefined)?.operation ?? "",
                  ) === "dependency.remove"
                ? "Review direct and downstream owned or locked references and the resulting project validity. Confirmation removes this addition only and preserves retained source references."
                : "The preview contains exact acquired bytes, closure signatures, source bindings, and diagnostic impact. Applying uses these staged bytes without fetching again."}
          </p>
          <pre>{JSON.stringify(preview, null, 2)}</pre>
          {(
            preview.preview as { impact?: { acceptance?: string[] } } | undefined
          )?.impact?.acceptance?.includes("accept-impact") && (
            <label>
              <input
                type="checkbox"
                checked={acceptImpact}
                onChange={(event) => setAcceptImpact(event.target.checked)}
              />
              Accept the introduced or worsened dependency impact
            </label>
          )}
          <button
            type="button"
            disabled={
              busy ||
              ((
                preview.preview as { impact?: { acceptance?: string[] } } | undefined
              )?.impact?.acceptance?.includes("accept-impact") === true &&
                !acceptImpact)
            }
            onClick={() => void applyPreview()}
          >
            {(
              preview.preview as { impact?: { acceptance?: string[] } } | undefined
            )?.impact?.acceptance?.includes("confirm")
              ? "Confirm dependency removal"
              : "Apply reviewed change"}
          </button>
          <button type="button" disabled={busy} onClick={() => void discardPreview()}>
            Discard preview
          </button>
        </section>
      )}
      {diagnostics.length > 0 && (
        <ul className="diagnostics">
          {diagnostics.map((diagnostic) => {
            const baseKey = JSON.stringify(diagnostic);
            const occurrence = diagnosticOccurrences.get(baseKey) ?? 0;
            diagnosticOccurrences.set(baseKey, occurrence + 1);
            return (
              <li key={`${baseKey}:${occurrence}`}>
                <strong>
                  {diagnostic.severity} · {diagnostic.code}
                </strong>
                <span>{diagnostic.message}</span>
                {diagnostic.file && <code>{diagnostic.file}</code>}
              </li>
            );
          })}
        </ul>
      )}
      <h3>Locked dependencies</h3>
      <button type="button" disabled={busy} onClick={() => void checkDependencies()}>
        Check all dependencies
      </button>
      {checks.length > 0 && (
        <ul aria-label="Dependency check results">
          {checks.map((result) => (
            <li key={result.id}>
              {result.id}: {result.state} ({result.comparison} comparison)
            </li>
          ))}
        </ul>
      )}
      {dependencies.length === 0 ? (
        <p>No dependencies are locked in this project.</p>
      ) : (
        <ul className="resource-list">
          {dependencies.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => void showDependency(item.id)}>
                <strong>{item.id}</strong>
                <span>
                  {item.kind} · {item.files.length} files · {item.primarySelector}
                </span>
              </button>
              <button type="button" disabled={busy} onClick={() => void checkDependencies(item.id)}>
                Check {item.id}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAcquisition("update", { id: item.id })}
              >
                Preview update
              </button>
              {!item.sources.some((source) => source.kind === "bundle") && (
                <>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const to = renameIds[item.id]?.trim();
                      if (to)
                        void runAcquisition("rename", {
                          from: item.id,
                          to,
                        });
                    }}
                  >
                    <label htmlFor={`dependency-rename-${item.id}`}>Rename dependency ID</label>
                    <input
                      id={`dependency-rename-${item.id}`}
                      value={renameIds[item.id] ?? ""}
                      onChange={(event) =>
                        setRenameIds((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                      placeholder="new-dependency-id"
                      autoComplete="off"
                    />
                    <button type="submit" disabled={busy || !renameIds[item.id]?.trim()}>
                      Preview rename
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runAcquisition("remove", { id: item.id })}
                  >
                    Preview remove {item.id}
                  </button>
                </>
              )}
              <label>
                Support target
                <select
                  aria-label={`Support target for ${item.id}`}
                  value={supportTargets[item.id] ?? item.primarySelector}
                  onChange={(event) =>
                    setSupportTargets((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                >
                  {item.files.map((file) => (
                    <option key={file.selector} value={file.selector}>
                      {file.selector}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={busy || !source.trim() || !resource.trim()}
                onClick={() =>
                  void runAcquisition("support/set", {
                    id: item.id,
                    target: supportTargets[item.id] ?? item.primarySelector,
                    role: supportRole,
                    source: source.trim(),
                    resource: resource.trim(),
                    ...(ref.trim() ? { ref: ref.trim() } : {}),
                  })
                }
              >
                Preview manual support
              </button>
              {item.support
                .filter(
                  (association) =>
                    association.kind === "association" &&
                    association.origin === "manual" &&
                    association.active === true &&
                    association.resourceSelector !== undefined &&
                    association.supportSelector !== undefined &&
                    association.role !== undefined,
                )
                .map((association) => (
                  <button
                    key={`${association.resourceSelector}:${association.role}:${association.supportSelector}`}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void runAcquisition("support/clear", {
                        id: item.id,
                        target: association.resourceSelector,
                        role: association.role,
                        resource: association.supportSelector,
                      })
                    }
                  >
                    Preview clear {association.role} support
                  </button>
                ))}
              {item.ontologies.map((ontology) => (
                <div key={`${ontology.graphIri}:${ontology.selector}`}>
                  <span>
                    {ontology.graphIri} · {ontology.effective ? "effective" : ontology.resolution}
                    {ontology.choice ? ` · choice ${ontology.choice}` : ""}
                  </span>
                  {ontology.choice === item.id ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void chooseOntology(ontology.graphIri, null)}
                    >
                      Clear choice for {ontology.graphIri}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void chooseOntology(ontology.graphIri, item.id)}
                    >
                      Select {item.id} for {ontology.graphIri}
                    </button>
                  )}
                </div>
              ))}
              <details>
                <summary>Retained selectors, provenance and support</summary>
                <pre>
                  {JSON.stringify(
                    {
                      files: item.files.map((file) => file.selector),
                      sources: item.sources,
                      support: item.support,
                      ontologies: item.ontologies,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <details open>
          <summary>Selected source or dependency details</summary>
          <pre>{JSON.stringify(selected, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
