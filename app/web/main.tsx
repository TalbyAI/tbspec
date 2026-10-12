import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { EditorData } from "../src/editing.ts";
import type { Result } from "../src/output.ts";
import { GraphEditor } from "./editor.tsx";
import "./style.css";

declare global {
  var tbspecOpeningBootstrap: string | null | undefined;
}
interface Diagnostic {
  code: string;
  severity: string;
  message: string;
  file: string | null;
  shacl?: {
    selector: string;
    graphIri: string;
    focusNode?: Term;
    sourceShape?: Term;
    path?: Term;
    value?: Term;
  };
  check?: { kind: string; state: string; blockedBy: string[] };
}
interface Envelope {
  schemaVersion: number;
  status: string;
  data: Record<string, unknown> | null;
  diagnostics: Diagnostic[];
}
interface Resource {
  selector: string;
  graphIri: string | null;
  kind: string;
  ownership: string;
  associations: { role: string; selector: string }[];
  modelType?: string;
  provenance?: { sourceGraphIri: string; sourceSelector?: string }[];
  schemaIris?: string[];
}
interface ModelType {
  name: string;
  enabled: boolean;
  ontology: string;
  design: string | null;
  origin: string;
}
interface Term {
  kind: string;
  value: string;
  language?: string;
  datatype?: string;
  scope?: string;
}
interface Triple {
  subject: Term;
  predicate: Term;
  object: Term;
}
interface Preview {
  changes: { file: string; action: string }[];
  arguments: {
    removedVocabulary?: Term[];
    removedVocabularyRoles?: { term: Term; roles: string[] }[];
    affectedReferences?: Triple[];
    deactivatedChecks?: { target: string; kind: string; shapesSelector: string }[];
  };
  impact: {
    affectedFiles: string[];
    acceptance: string[];
    baselineErrors: Diagnostic[];
    introducedErrors: Diagnostic[];
    worsenedErrors: Diagnostic[];
    skippedChecks: Diagnostic[];
  };
}
interface Validation {
  validity: string;
  validationComplete: boolean;
  resources: {
    selector: string;
    checks: { kind: string; state: string; shapesSelector?: string; blockedBy: string[] }[];
  }[];
}

async function request(
  path: string,
  session: string,
  body?: Record<string, unknown>,
): Promise<Envelope> {
  const response = await fetch(`/api/project/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${session}`,
      "X-Tbspec-Schema-Version": "1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401)
    throw new Error(
      "This tab's session has expired. Obtain a fresh opening link with tbspec web status.",
    );
  const envelope = (await response.json()) as Envelope;
  if (envelope.schemaVersion !== 1)
    throw new Error(
      "Incompatible project API. Stop and restart the server with a matching release.",
    );
  if (!envelope.data && !body)
    throw new Error(envelope.diagnostics.map((d) => d.message).join(" ") || "Inspection failed.");
  return envelope;
}
async function authenticate(): Promise<string> {
  const bootstrap = globalThis.tbspecOpeningBootstrap;
  delete globalThis.tbspecOpeningBootstrap;
  if (bootstrap) {
    sessionStorage.removeItem("tbspec-session");
    const response = await fetch("/api/auth/v1/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocolVersion: 1, bootstrap }),
    });
    const envelope = (await response.json()) as Envelope;
    if (!response.ok || !envelope.data)
      throw new Error(
        "This opening link has expired or was already used. Obtain a fresh link with tbspec web status.",
      );
    const session = String(envelope.data.sessionToken);
    sessionStorage.setItem("tbspec-session", session);
    return session;
  }
  const session = sessionStorage.getItem("tbspec-session");
  if (!session)
    throw new Error(
      "Open this workspace using the transient opening link from tbspec web or tbspec web status.",
    );
  return session;
}
function termText(term: Term) {
  if (term.kind === "iri") return `<${term.value}>`;
  if (term.kind === "blank") return `_:${term.value} (${term.scope})`;
  return `${JSON.stringify(term.value)}${term.language ? `@${term.language}` : `^^<${term.datatype}>`}`;
}
function Diagnostics({ items }: { items: Diagnostic[] }) {
  return items.length ? (
    <ul className="diagnostics">
      {items.map((d) => (
        <li key={JSON.stringify(d)}>
          <strong>
            {d.severity} · {d.code}
          </strong>
          {d.file && <code>{d.file}</code>}
          <span>{d.message}</span>
          {d.shacl && (
            <code>
              Shapes: {d.shacl.selector} · {d.shacl.graphIri}
            </code>
          )}
          {d.shacl?.focusNode && <code>Focus: {termText(d.shacl.focusNode)}</code>}
          {d.check?.blockedBy.length ? (
            <span>Blocked by: {d.check.blockedBy.join(", ")}</span>
          ) : null}
        </li>
      ))}
    </ul>
  ) : null;
}
function App() {
  const [session, setSession] = useState("");
  const [resources, setResources] = useState<Resource[]>([]);
  const [family, setFamily] = useState("all");
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<Envelope | null>(null);
  const [graph, setGraph] = useState<Envelope | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState("resources");
  const [selector, setSelector] = useState("");
  const [operation, setOperation] = useState("model.create");
  const [receivingType, setReceivingType] = useState("data");
  const [profile, setProfile] = useState("conceptual");
  const [authored, setAuthored] = useState<Envelope | null>(null);
  const [validation, setValidation] = useState<Envelope | null>(null);
  const [validationTarget, setValidationTarget] = useState<string | undefined>();
  const [supportList, setSupportList] = useState<Envelope | null>(null);
  const [pendingPreview, setPendingPreview] = useState<{
    schemaVersion: 1;
    handle: string;
    fingerprint: string;
    accept: string[];
  } | null>(null);
  const refresh = useCallback(async (token: string) => {
    setBusy(true);
    setError("");
    try {
      const configuration = await request("config", token);
      setConfig(configuration.data);
      const inventory = await request("graphs", token);
      setResources((inventory.data?.items as Resource[]) ?? []);
      const currentStatus = await request("status", token);
      setStatus(currentStatus);
      setValidation(null);
      setValidationTarget(undefined);
      setGraph(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Workspace is unavailable.");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void authenticate()
      .then((token) => {
        setSession(token);
        return refresh(token);
      })
      .catch((problem: Error) => {
        setError(problem.message);
        setBusy(false);
      });
  }, [refresh]);
  async function show(selector: string, kind?: string) {
    setBusy(true);
    setError("");
    try {
      const resourceKind =
        kind ?? resources.find((resource) => resource.selector === selector)?.kind;
      const endpoint =
        resourceKind === "model" || resourceKind?.endsWith("-model") ? "model" : "graph";
      setGraph(await request(`${endpoint}?selector=${encodeURIComponent(selector)}`, session));
      setSupportList(null);
      setTab("resources");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Graph is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function author(
    body: Record<string, unknown>,
    apply = false,
    route = operation.replaceAll(".", "/"),
  ) {
    setBusy(true);
    setError("");
    if (!apply) setPendingPreview(null);
    try {
      const result = await request(apply ? "resource/apply" : route, session, body);
      setAuthored(result);
      if (
        apply &&
        (result.status === "ok" ||
          result.diagnostics.some((diagnostic) => diagnostic.code === "REVISION_CONFLICT"))
      )
        setPendingPreview(null);
      if (result.status === "preview" && result.data)
        setPendingPreview({
          schemaVersion: 1,
          handle: String(result.data.handle),
          fingerprint: (result.data.preview as { fingerprint: string }).fingerprint,
          accept:
            (result.data.preview as { impact?: { acceptance?: string[] } }).impact?.acceptance ??
            [],
        });
      else if (result.status === "ok") {
        await refresh(session);
        const resource = result.data?.resource as Resource;
        await show(resource.selector, resource.kind);
      }
    } catch (problem) {
      setError(
        `${problem instanceof Error ? problem.message : "Resource operation failed."} Inspect the project before trying another write.`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function validate(selector?: string) {
    setBusy(true);
    setError("");
    try {
      setValidation(
        await request(
          `validate${selector ? `?selector=${encodeURIComponent(selector)}` : ""}`,
          session,
        ),
      );
      setValidationTarget(selector);
      setTab("diagnostics");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Validation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function listSupport(endpoint: string, selector?: string) {
    setBusy(true);
    setError("");
    try {
      setSupportList(
        await request(
          `${endpoint}${selector ? `?selector=${encodeURIComponent(selector)}` : ""}`,
          session,
        ),
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Support listing failed.");
    } finally {
      setBusy(false);
    }
  }
  async function cancelPreview() {
    if (!pendingPreview) return;
    const handle = pendingPreview.handle;
    setPendingPreview(null);
    setAuthored(null);
    setBusy(true);
    try {
      const result = await request("resource/cancel", session, { schemaVersion: 1, handle });
      if (result.status !== "ok")
        throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" "));
    } catch (problem) {
      setError(
        `${problem instanceof Error ? problem.message : "Cancellation failed."} Inspect the project before another write.`,
      );
    } finally {
      setBusy(false);
    }
  }
  const project = status?.data?.project as
    | { root: string; validity: string; validationComplete: boolean }
    | undefined;
  const counts = status?.data?.counts as { resources: number; dependencies: number } | undefined;
  const modelTypes = (config?.modelTypes as ModelType[]) ?? [];
  const editorRequest = useCallback(
    async (path: string, body?: Record<string, unknown>) =>
      (await request(path, session, body)) as Result,
    [session],
  );
  const editorSaved = useCallback(
    (result: Result<EditorData>) => setGraph(result as unknown as Envelope),
    [],
  );
  const selected = graph?.data?.resource as Resource | undefined;
  const associations = selected
    ? [
        ...new Map(
          [
            ...selected.associations,
            ...resources
              .filter(
                (resource) =>
                  resource.kind === "conceptual-data-model" &&
                  selected.schemaIris?.includes(resource.graphIri ?? ""),
              )
              .map((resource) => ({ role: "schema", selector: resource.selector })),
          ].map((association) => [`${association.role}:${association.selector}`, association]),
        ).values(),
      ]
    : [];
  const visibleResources = resources.filter(
    (resource) =>
      family === "all" ||
      (family === "ontology"
        ? resource.kind === "ontology"
        : resource.kind === "model" || resource.kind.endsWith("-model")),
  );
  const triples = (graph?.data?.triples as Triple[]) ?? [];
  const coverage = (validation?.data ?? status?.data?.validation) as Validation | undefined;
  return (
    <div className="workspace">
      <header>
        <div>
          <span className="wordmark">tbspec</span>
          <span className="subtitle">Local project workspace</span>
        </div>
        <button type="button" onClick={() => void refresh(session)} disabled={!session || busy}>
          Refresh
        </button>
      </header>
      <main>
        <div className="intro">
          <p className="eyebrow">PROJECT WORKSPACE</p>
          <h1>Your knowledge, on disk.</h1>
          <p>
            Create and import owned resources. Inspect graphs, locked snapshots and configuration.
          </p>
          {project && <code className="project-root">{project.root}</code>}
        </div>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        <div role="status" aria-live="polite">
          {busy
            ? "Reading project…"
            : project
              ? `${project.validity} · ${counts?.resources ?? 0} owned graphs · ${counts?.dependencies ?? 0} locked dependencies`
              : "Authentication required"}
        </div>
        {project && !project.validationComplete && (
          <div className="notice">
            <strong>Validation incomplete</strong>
            <p>Some required checks could not run. Review the diagnostics and blocking files.</p>
          </div>
        )}
        {session && (
          <>
            <nav aria-label="Workspace sections">
              {["resources", "configuration", "diagnostics"].map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-current={tab === name ? "page" : undefined}
                  onClick={() => setTab(name)}
                >
                  {name[0]?.toUpperCase()}
                  {name.slice(1)}
                </button>
              ))}
            </nav>
            {tab === "resources" && (
              <div className="resource-layout">
                <section aria-label="Project graphs">
                  <h2>
                    Owned graphs <span>{visibleResources.length}</span>
                  </h2>
                  <label htmlFor="resource-family">List resource family</label>
                  <select
                    id="resource-family"
                    value={family}
                    onChange={(event) => setFamily(event.target.value)}
                  >
                    <option value="all">All graphs</option>
                    <option value="ontology">Ontologies</option>
                    <option value="model">Models</option>
                  </select>
                  {visibleResources.length === 0 && <p>No matching owned RDF graphs yet.</p>}
                  <ul className="resource-list">
                    {visibleResources.map((resource) => (
                      <li key={resource.selector}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void show(resource.selector)}
                        >
                          <strong>{resource.selector}</strong>
                          <span>{resource.kind}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void show(selector);
                    }}
                  >
                    <label htmlFor="graph-selector">Graph selector</label>
                    <input
                      id="graph-selector"
                      value={selector}
                      onChange={(event) => setSelector(event.target.value)}
                      placeholder="dep:id/source/support.ttl"
                      required
                    />
                    <button type="submit" disabled={busy || !selector}>
                      Inspect graph
                    </button>
                  </form>
                  <p>
                    Inspect any owned path or retained dependency file using its exact selector.
                  </p>
                  <button type="button" disabled={busy} onClick={() => void listSupport("shapes")}>
                    List all shapes
                  </button>
                  {supportList && (
                    <section aria-label="Support resources">
                      <h3>Support resources</h3>
                      <ul>
                        {((supportList.data?.items as Resource[]) ?? []).map((r) => (
                          <li key={r.selector}>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void show(r.selector)}
                            >
                              {r.selector}
                            </button>
                          </li>
                        ))}
                      </ul>
                      <Diagnostics items={supportList.diagnostics} />
                    </section>
                  )}
                  <h2>Model-type resources</h2>
                  <p>Locked resources are read-only snapshots.</p>
                  {modelTypes.map((type) => (
                    <div className="model-type" key={type.name}>
                      <strong>{type.name}</strong>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void show(type.ontology)}
                      >
                        Inspect ontology
                      </button>
                      {type.design && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void show(type.design ?? "")}
                        >
                          Inspect design
                        </button>
                      )}
                    </div>
                  ))}
                  <h2>Create or import</h2>
                  <form
                    onChange={() => void cancelPreview()}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const values = new FormData(event.currentTarget);
                      const model = operation.startsWith("model.");
                      const importing = operation.endsWith(".import");
                      const schemas = String(values.get("schemas") ?? "")
                        .split(/\r?\n/)
                        .map((value) => value.trim())
                        .filter(Boolean);
                      void author({
                        path: String(values.get("path")),
                        ...(values.get("iri") ? { iri: String(values.get("iri")) } : {}),
                        ...(model ? { type: receivingType } : {}),
                        ...(importing ? { source: String(values.get("source")) } : {}),
                        ...(!importing && model && receivingType === "data"
                          ? { profile, schemas }
                          : {}),
                      });
                    }}
                  >
                    <label htmlFor="author-operation">Resource operation</label>
                    <select
                      id="author-operation"
                      value={operation}
                      onChange={(event) => setOperation(event.target.value)}
                      disabled={busy}
                    >
                      <option value="model.create">Create model</option>
                      <option value="ontology.create">Create ontology</option>
                      <option value="model.import">Import editable model</option>
                      <option value="ontology.import">Import editable ontology</option>
                    </select>
                    <label htmlFor="author-path">Destination path</label>
                    <input
                      id="author-path"
                      name="path"
                      placeholder="models/orders.ttl"
                      required
                      disabled={busy}
                    />
                    <label htmlFor="author-iri">New graph IRI</label>
                    <input
                      id="author-iri"
                      name="iri"
                      placeholder="Optional with configured base IRI"
                      disabled={busy}
                    />
                    {operation.endsWith(".import") && (
                      <>
                        <label htmlFor="author-source">Import source</label>
                        <input
                          id="author-source"
                          name="source"
                          placeholder="Local file or dep:tbspec-state-machine"
                          required
                          disabled={busy}
                        />
                        <p>
                          The editable copy gets a new graph identity. Original terms and snapshots
                          are preserved.
                        </p>
                      </>
                    )}
                    {operation.startsWith("model.") && (
                      <>
                        <label htmlFor="author-type">Receiving model type</label>
                        <select
                          id="author-type"
                          value={receivingType}
                          onChange={(event) => setReceivingType(event.target.value)}
                          disabled={busy}
                        >
                          {modelTypes.map((type) => (
                            <option key={type.name} value={type.name} disabled={!type.enabled}>
                              {type.name}
                              {type.enabled ? "" : " (disabled)"}
                            </option>
                          ))}
                        </select>
                        {operation === "model.create" && receivingType === "data" && (
                          <>
                            <label htmlFor="author-profile">Data profile</label>
                            <select
                              id="author-profile"
                              value={profile}
                              onChange={(event) => setProfile(event.target.value)}
                              disabled={busy}
                            >
                              <option value="conceptual">
                                Conceptual — classes and properties
                              </option>
                              <option value="concrete">Concrete — individuals and values</option>
                            </select>
                            {profile === "concrete" && (
                              <>
                                <label htmlFor="author-schemas">
                                  Conceptual schema selectors (one per line)
                                </label>
                                <textarea id="author-schemas" name="schemas" disabled={busy} />
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}
                    <button type="submit" disabled={busy || pendingPreview !== null}>
                      {operation.endsWith(".import")
                        ? "Preview editable import"
                        : "Preview resource"}
                    </button>
                  </form>
                  {authored && (
                    <section aria-label="Authoring result">
                      <h3>
                        {authored.status === "preview" ? "Resource preview" : "Resource result"}
                      </h3>
                      <pre>{JSON.stringify(authored.data?.resource, null, 2)}</pre>
                      <Diagnostics items={authored.diagnostics} />
                      {pendingPreview && (
                        <p>Preview expires at {String(authored.data?.expiresAt)}.</p>
                      )}
                      {pendingPreview && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void author(pendingPreview, true)}
                        >
                          {pendingPreview.accept.includes("confirm")
                            ? "Confirm schema removal"
                            : "Apply reviewed resource"}
                        </button>
                      )}
                      {pendingPreview && (
                        <button type="button" disabled={busy} onClick={() => void cancelPreview()}>
                          Cancel preview
                        </button>
                      )}
                      <p>
                        Review the impact and diagnostics before applying. Term IRIs are preserved.
                      </p>
                      {authored.data?.preview
                        ? (() => {
                            const preview = authored.data.preview as Preview;
                            return (
                              <section aria-label="Preview impact">
                                <h4>Files to change</h4>
                                <ul>
                                  {preview.changes.map((change) => (
                                    <li key={change.file}>
                                      {change.action}: {change.file}
                                    </li>
                                  ))}
                                </ul>
                                {preview.arguments.removedVocabulary && (
                                  <>
                                    <h4>Lost vocabulary roles</h4>
                                    <ul>
                                      {preview.arguments.removedVocabulary.map((term) => {
                                        const roles =
                                          preview.arguments.removedVocabularyRoles?.find(
                                            (entry) => entry.term.value === term.value,
                                          )?.roles;
                                        return (
                                          <li key={termText(term)}>
                                            <code>{termText(term)}</code>
                                            {roles?.length ? ` (${roles.join(", ")})` : ""}
                                          </li>
                                        );
                                      })}
                                    </ul>
                                    {!preview.arguments.removedVocabulary.length && <p>None</p>}
                                  </>
                                )}
                                {preview.arguments.affectedReferences && (
                                  <>
                                    <h4>Affected references</h4>
                                    <pre>
                                      {preview.arguments.affectedReferences
                                        .map(
                                          (q) =>
                                            `${termText(q.subject)} ${termText(q.predicate)} ${termText(q.object)}`,
                                        )
                                        .join("\n") || "None"}
                                    </pre>
                                  </>
                                )}
                                {preview.arguments.deactivatedChecks && (
                                  <>
                                    <h4>Affected resources</h4>
                                    <ul>
                                      {preview.impact.affectedFiles.map((file) => (
                                        <li key={file}>{file}</li>
                                      ))}
                                    </ul>
                                    <h4>Deactivated checks</h4>
                                    {preview.arguments.deactivatedChecks.length ? (
                                      <ul>
                                        {preview.arguments.deactivatedChecks.map((check) => (
                                          <li
                                            key={`${check.target}:${check.kind}:${check.shapesSelector}`}
                                          >
                                            {check.target}: {check.kind} from {check.shapesSelector}
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p>None</p>
                                    )}
                                  </>
                                )}
                                <h4>Existing errors</h4>
                                <Diagnostics items={preview.impact.baselineErrors} />
                                <h4>Introduced or worsened errors</h4>
                                <Diagnostics
                                  items={[
                                    ...preview.impact.introducedErrors,
                                    ...preview.impact.worsenedErrors,
                                  ]}
                                />
                                <h4>Skipped or unassessable checks</h4>
                                <Diagnostics items={preview.impact.skippedChecks} />
                                {preview.impact.acceptance.includes("confirm") && (
                                  <p>Confirm removal even if the resulting model is invalid.</p>
                                )}
                              </section>
                            );
                          })()
                        : null}
                    </section>
                  )}
                </section>
                <section aria-label="Graph details" className="detail">
                  {selected ? (
                    <>
                      <p className="eyebrow">
                        {selected.ownership === "dependency"
                          ? "LOCKED · READ ONLY"
                          : "PROJECT OWNED"}
                      </p>
                      <h2>{selected.selector}</h2>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void validate(selected.selector)}
                      >
                        Validate selected resource
                      </button>
                      {selected.ownership === "project" &&
                        (selected.kind === "ontology" || selected.kind.endsWith("model")) && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void listSupport("shapes", selected.selector)}
                          >
                            List associated shapes
                          </button>
                        )}
                      {selected.ownership === "project" &&
                        selected.kind === "concrete-data-model" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void listSupport("model-schemas", selected.selector)}
                          >
                            List conceptual schemas
                          </button>
                        )}
                      {selected.ownership === "project" &&
                        (selected.kind === "ontology" || selected.kind.endsWith("model")) && (
                          <button
                            type="button"
                            disabled={busy || !!pendingPreview}
                            onClick={() =>
                              void author({ path: selected.selector }, false, "shapes/create")
                            }
                          >
                            Preview associated shapes
                          </button>
                        )}
                      {selected.ownership === "project" &&
                        selected.kind === "concrete-data-model" && (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const values = new FormData(event.currentTarget);
                              void author(
                                { path: selected.selector, source: String(values.get("schema")) },
                                false,
                                `model/schema/${values.get("action")}`,
                              );
                            }}
                          >
                            <label htmlFor="schema-selector">Conceptual schema selector</label>
                            <input
                              id="schema-selector"
                              name="schema"
                              required
                              disabled={busy || !!pendingPreview}
                            />
                            <label htmlFor="schema-action">Association operation</label>
                            <select
                              id="schema-action"
                              name="action"
                              disabled={busy || !!pendingPreview}
                            >
                              <option value="add">Add schema</option>
                              <option value="remove">Remove schema</option>
                            </select>
                            <button type="submit" disabled={busy || !!pendingPreview}>
                              Preview schema association
                            </button>
                          </form>
                        )}
                      <dl>
                        <dt>Graph IRI</dt>
                        <dd>
                          <code>{selected.graphIri ?? "Unknown — repair source"}</code>
                        </dd>
                        <dt>Kind</dt>
                        <dd>{selected.kind}</dd>
                        {selected.modelType && (
                          <>
                            <dt>Configured model type</dt>
                            <dd>{selected.modelType}</dd>
                          </>
                        )}
                        {!!selected.schemaIris?.length && (
                          <>
                            <dt>Conceptual schema IRIs</dt>
                            <dd>
                              {selected.schemaIris.map((iri) => (
                                <code key={iri}>{iri} </code>
                              ))}
                            </dd>
                          </>
                        )}
                      </dl>
                      {selected.provenance?.length ? (
                        <>
                          <h3>Provenance</h3>
                          <pre>{JSON.stringify(selected.provenance, null, 2)}</pre>
                        </>
                      ) : null}
                      <Diagnostics items={graph?.diagnostics ?? []} />
                      <h3>Associations</h3>
                      {associations.length ? (
                        <ul>
                          {associations.map((a) => (
                            <li key={`${a.role}-${a.selector}`}>
                              {a.role}:{" "}
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void show(a.selector)}
                              >
                                {a.selector}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No recorded associations.</p>
                      )}
                      <GraphEditor
                        key={selected.selector}
                        selector={selected.selector}
                        call={editorRequest}
                        onSaved={editorSaved}
                      />
                      <details>
                        <summary>Exact RDF terms ({triples.length} statements)</summary>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Subject</th>
                                <th>Predicate</th>
                                <th>Object</th>
                              </tr>
                            </thead>
                            <tbody>
                              {triples.map((triple) => (
                                <tr key={JSON.stringify(triple)}>
                                  <td>
                                    <code>{termText(triple.subject)}</code>
                                  </td>
                                  <td>
                                    <code>{termText(triple.predicate)}</code>
                                  </td>
                                  <td>
                                    <code>{termText(triple.object)}</code>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </>
                  ) : (
                    <div className="empty">
                      <h2>Select a graph</h2>
                      <p>Explore its identity, source, exact RDF terms and associated files.</p>
                    </div>
                  )}
                </section>
              </div>
            )}
            {tab === "configuration" && (
              <section>
                <h2>Effective configuration</h2>
                <p>
                  Manifest rows replace whole locked defaults. A missing design stays disconnected.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Model type</th>
                        <th>Creation</th>
                        <th>Ontology</th>
                        <th>Design</th>
                        <th>Origin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelTypes.map((type) => (
                        <tr key={type.name}>
                          <td>{type.name}</td>
                          <td>{type.enabled ? "Enabled" : "Disabled"}</td>
                          <td>
                            <code>{type.ontology}</code>
                          </td>
                          <td>
                            <code>{type.design ?? "Disconnected"}</code>
                          </td>
                          <td>{type.origin}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3>All settings</h3>
                <pre>{JSON.stringify(config, null, 2)}</pre>
              </section>
            )}
            {tab === "diagnostics" && (
              <section>
                <h2>
                  {validationTarget ? `Validation: ${validationTarget}` : "Project diagnostics"}
                </h2>
                <button type="button" disabled={busy} onClick={() => void validate()}>
                  Validate whole project
                </button>
                <p>Skipped checks are explicit and prevent a complete clean validation claim.</p>
                <Diagnostics items={(validation ?? status)?.diagnostics ?? []} />
                {coverage && (
                  <>
                    <p>
                      {coverage.validity} ·{" "}
                      {coverage.validationComplete
                        ? "All required checks completed"
                        : "Required checks were skipped"}
                    </p>
                    <div className="table-scroll">
                      <table>
                        <caption>Validation coverage</caption>
                        <thead>
                          <tr>
                            <th scope="col">Resource</th>
                            <th scope="col">Check</th>
                            <th scope="col">Source shapes</th>
                            <th scope="col">Result</th>
                            <th scope="col">Blocked by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {coverage.resources.flatMap((r) =>
                            r.checks.map((c) => (
                              <tr key={`${r.selector}-${c.kind}-${c.shapesSelector ?? ""}`}>
                                <td>{r.selector}</td>
                                <td>{c.kind}</td>
                                <td>{c.shapesSelector ?? "—"}</td>
                                <td>{c.state}</td>
                                <td>{c.blockedBy.join(", ") || "—"}</td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>
      <footer>Local assets · Explicit inspection · No remote acquisition</footer>
    </div>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
