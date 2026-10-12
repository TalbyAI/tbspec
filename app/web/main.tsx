import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Result } from "../src/output.ts";
import type { EditorDraft } from "./drafts.ts";
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
interface QueryParameter {
  name: string;
  kind: "iri" | "literal";
  required: boolean;
  datatype?: string;
  language?: string;
}
interface SavedQuery {
  name: string;
  queryFile: string;
  parametersFile: string;
  parameters: QueryParameter[];
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
    affectedModels?: {
      selector: string;
      ontologyBefore: string | null;
      ontologyAfter: string | null;
      validityBefore: string;
      validityAfter: string;
    }[];
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
  const graphSelector = useRef("");
  // shortcut: drafts live only in this page; add session recovery if reload persistence is required.
  const [drafts] = useState(() => new Map<string, EditorDraft>());
  const [hasDrafts, setHasDrafts] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const draftChanged = useCallback(() => {
    setHasDrafts([...drafts.values()].some((d) => d.sourceDraft || d.pending || d.creationDraft));
  }, [drafts]);
  useEffect(() => {
    if (!hasDrafts) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasDrafts]);
  const [error, setError] = useState("");
  const [reading, setBusy] = useState(true);
  const [editorBusy, setEditorBusy] = useState(false);
  const busy = reading || editorBusy;
  const [tab, setTab] = useState("resources");
  const [selector, setSelector] = useState("");
  const [operation, setOperation] = useState("model.create");
  const [receivingType, setReceivingType] = useState("data");
  const [profile, setProfile] = useState("conceptual");
  const [modelTypeName, setModelTypeName] = useState("");
  const [modelTypeOntology, setModelTypeOntology] = useState("");
  const [designSelectors, setDesignSelectors] = useState<Record<string, string>>({});
  const [acceptedImpact, setAcceptedImpact] = useState(false);
  const [authored, setAuthored] = useState<Envelope | null>(null);
  const [validation, setValidation] = useState<Envelope | null>(null);
  const [validationTarget, setValidationTarget] = useState<string | undefined>();
  const [supportList, setSupportList] = useState<Envelope | null>(null);
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [queryName, setQueryName] = useState("");
  const [queryText, setQueryText] = useState("SELECT * WHERE { ?subject ?predicate ?object }");
  const [parametersText, setParametersText] = useState("");
  const [bindingsText, setBindingsText] = useState("{}");
  const [queryGraph, setQueryGraph] = useState("");
  const [queryDetails, setQueryDetails] = useState<Record<string, unknown> | null>(null);
  const [queryResult, setQueryResult] = useState<Envelope | null>(null);
  const [pendingPreview, setPendingPreview] = useState<{
    schemaVersion: 1;
    handle: string;
    fingerprint: string;
    accept: string[];
  } | null>(null);
  const refresh = useCallback(async (token: string, saved = false) => {
    const selectedSelector = graphSelector.current;
    setBusy(true);
    setError("");
    setStatus(null);
    setValidation(null);
    setValidationTarget(undefined);
    setSupportList(null);
    try {
      const configuration = await request("config", token);
      setConfig(configuration.data);
      const inventory = await request("graphs", token);
      setResources((inventory.data?.items as Resource[]) ?? []);
      const currentStatus = await request("status", token);
      setStatus(currentStatus);
      if (selectedSelector) {
        const selectedGraph = await request(
          `editor?selector=${encodeURIComponent(selectedSelector)}`,
          token,
        );
        if (graphSelector.current === selectedSelector) setGraph(selectedGraph);
      }
    } catch (problem) {
      setError(
        `${saved ? "Saved successfully, but workspace inspection failed. " : ""}${problem instanceof Error ? problem.message : "Workspace is unavailable."}`,
      );
    } finally {
      setRefreshVersion((version) => version + 1);
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
    const previousSelector = graphSelector.current;
    graphSelector.current = selector;
    setBusy(true);
    setError("");
    try {
      const resourceKind =
        kind ?? resources.find((resource) => resource.selector === selector)?.kind;
      const endpoint =
        resourceKind === "model" || resourceKind?.endsWith("-model") ? "model" : "graph";
      const result = await request(`${endpoint}?selector=${encodeURIComponent(selector)}`, session);
      if (graphSelector.current !== selector) return;
      setGraph(result);
      setSupportList(null);
      setTab("resources");
    } catch (problem) {
      if (graphSelector.current === selector) graphSelector.current = previousSelector;
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
      if (result.status === "preview") setAcceptedImpact(false);
      else if (result.status === "ok") {
        await refresh(session);
        const resource = result.data?.resource as Resource | undefined;
        if (resource) await show(resource.selector, resource.kind);
      }
    } catch (problem) {
      if (apply) {
        setPendingPreview(null);
        setAuthored(null);
        setAcceptedImpact(false);
      }
      setError(
        `${problem instanceof Error ? problem.message : "Resource operation failed."} Inspect the project before trying another write.`,
      );
    } finally {
      setBusy(false);
    }
  }
  function configureModelType(command: string, name: string, fields: Record<string, string> = {}) {
    setTab("resources");
    void author(
      { command: `config.model-type.${command}`, name, ...fields },
      false,
      "model-types/configure",
    );
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
  async function refreshQueries() {
    setBusy(true);
    setError("");
    try {
      const result = await request("queries", session);
      const items = (result.data?.items as SavedQuery[]) ?? [];
      setQueries(items);
      if (!items.some((item) => item.name === queryName)) setQueryName(items[0]?.name ?? "");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Saved queries are unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function inspectQuery(name = queryName, keepDraft = false) {
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const result = await request(`query?name=${encodeURIComponent(name)}`, session);
      setQueryDetails(result.data);
      setQueryName(name);
      if (!keepDraft) {
        setQueryText(String(result.data?.queryText ?? ""));
        setParametersText("");
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Saved query is unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function refreshQueryReview() {
    if (!queryName) return;
    await inspectQuery(queryName, true);
  }
  function reviewedQueryRevisions(name: string) {
    if (queryDetails?.name === name && queryDetails.revisions)
      return queryDetails.revisions as {
        query: { state: string; digest?: string };
        parameters: { state: string; digest?: string };
      };
    return { query: { state: "absent" }, parameters: { state: "absent" } };
  }
  async function saveQuery() {
    if (queries.some((query) => query.name === queryName) && queryDetails?.name !== queryName) {
      await refreshQueryReview();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request("query/save", session, {
        name: queryName,
        queryText,
        expectedRevisions: reviewedQueryRevisions(queryName),
        ...(parametersText.trim() ? { parametersText } : {}),
      });
      setQueryResult(result);
      if (result.status === "ok") {
        setParametersText("");
        await refreshQueries();
        await inspectQuery(queryName);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Saved query could not be written.");
    } finally {
      setBusy(false);
    }
  }
  async function runQuery(saved?: string) {
    setBusy(true);
    setError("");
    try {
      setQueryResult(
        await request("query/run", session, {
          ...(saved ? { saved } : { queryText }),
          ...(queryGraph.trim() ? { graph: queryGraph.trim() } : {}),
          ...(bindingsText.trim() ? { bindingsText } : {}),
        }),
      );
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Query execution failed.");
    } finally {
      setBusy(false);
    }
  }
  async function removeQuery() {
    if (!queryName) return;
    if (queryDetails?.name !== queryName) {
      await refreshQueryReview();
      return;
    }
    if (!window.confirm(`Remove saved query “${queryName}” and its declaration?`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await request("query/remove", session, {
        name: queryName,
        confirm: true,
        expectedRevisions: reviewedQueryRevisions(queryName),
      });
      setQueryResult(result);
      if (result.status === "ok") {
        setQueryDetails(null);
        await refreshQueries();
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Saved query could not be removed.");
    } finally {
      setBusy(false);
    }
  }
  async function cancelPreview() {
    if (!pendingPreview) return;
    const handle = pendingPreview.handle;
    setPendingPreview(null);
    setAuthored(null);
    setAcceptedImpact(false);
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
  const editorSaved = useCallback(async () => {
    await refresh(session, true);
  }, [refresh, session]);
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
              : session
                ? "Project status unavailable"
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
              {["resources", "queries", "configuration", "diagnostics"].map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-current={tab === name ? "page" : undefined}
                  disabled={busy}
                  onClick={() => {
                    setTab(name);
                    if (name === "queries") void refreshQueries();
                  }}
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
                        {"modelType" in (authored.data ?? {})
                          ? authored.status === "preview"
                            ? "Model-type configuration preview"
                            : "Model-type configuration result"
                          : authored.status === "preview"
                            ? "Resource preview"
                            : "Resource result"}
                      </h3>
                      <pre>
                        {JSON.stringify(
                          "modelType" in (authored.data ?? {})
                            ? {
                                modelType: authored.data?.modelType,
                                affectedModels: authored.data?.affectedModels,
                                projectValidity: authored.data?.projectValidity,
                                validationComplete: authored.data?.validationComplete,
                              }
                            : authored.data?.resource,
                          null,
                          2,
                        )}
                      </pre>
                      <Diagnostics items={authored.diagnostics} />
                      {pendingPreview && (
                        <p>
                          This server-held preview expires after 15 minutes, at{" "}
                          {String(authored.data?.expiresAt)}.
                        </p>
                      )}
                      {pendingPreview && (
                        <>
                          {pendingPreview.accept.includes("accept-impact") && (
                            <label>
                              <input
                                type="checkbox"
                                checked={acceptedImpact}
                                disabled={busy}
                                onChange={(event) => setAcceptedImpact(event.target.checked)}
                              />
                              I accept the disclosed model validity impact.
                            </label>
                          )}
                          <button
                            type="button"
                            disabled={
                              busy ||
                              (pendingPreview.accept.includes("accept-impact") && !acceptedImpact)
                            }
                            onClick={() => void author(pendingPreview, true)}
                          >
                            {pendingPreview.accept.includes("confirm")
                              ? "Confirm schema removal"
                              : pendingPreview.accept.includes("accept-impact")
                                ? "Apply reviewed configuration"
                                : "modelType" in (authored.data ?? {})
                                  ? "Apply reviewed configuration"
                                  : "Apply reviewed resource"}
                          </button>
                        </>
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
                                {preview.arguments.affectedModels && (
                                  <>
                                    <h4>Affected model bindings</h4>
                                    {preview.arguments.affectedModels.length ? (
                                      <ul>
                                        {preview.arguments.affectedModels.map((model) => (
                                          <li key={model.selector}>
                                            {model.selector}: {model.ontologyBefore ?? "unbound"} →{" "}
                                            {model.ontologyAfter ?? "unbound"}; validity{" "}
                                            {model.validityBefore} → {model.validityAfter}
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
                        key={`${selected.selector}:${refreshVersion}`}
                        selector={selected.selector}
                        call={editorRequest}
                        onSaved={editorSaved}
                        drafts={drafts}
                        onDraftChange={draftChanged}
                        onBusyChange={setEditorBusy}
                        disabled={busy}
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
                          <td>
                            <details>
                              <summary>{type.name}</summary>
                              <pre>{JSON.stringify(type, null, 2)}</pre>
                            </details>
                          </td>
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
                <h3>Add or replace a model-type ontology</h3>
                <p>Choose an owned path or an exact retained selector such as dep:id/file-key.</p>
                <form
                  onChange={() => void cancelPreview()}
                  onSubmit={(event) => {
                    event.preventDefault();
                    configureModelType("set", modelTypeName, { ontology: modelTypeOntology });
                  }}
                >
                  <label htmlFor="model-type-name">Model-type name</label>
                  <input
                    id="model-type-name"
                    value={modelTypeName}
                    onChange={(event) => setModelTypeName(event.target.value)}
                    required
                    disabled={busy}
                  />
                  <label htmlFor="model-type-ontology">Ontology graph selector</label>
                  <input
                    id="model-type-ontology"
                    value={modelTypeOntology}
                    onChange={(event) => setModelTypeOntology(event.target.value)}
                    placeholder="ontologies/custom.ttl or dep:id/source/file.ttl"
                    required
                    disabled={busy}
                  />
                  <button type="submit" disabled={busy || !!pendingPreview}>
                    Preview model-type change
                  </button>
                </form>
                <h3>Model-type actions</h3>
                <ul className="resource-list">
                  {modelTypes.map((type) => (
                    <li key={`${type.name}:configuration`}>
                      <strong>{type.name}</strong>
                      <span>
                        {type.origin === "locked-default" ? "Locked default" : "Manifest row"}
                      </span>
                      <button
                        type="button"
                        disabled={busy || !!pendingPreview}
                        onClick={() =>
                          configureModelType(type.enabled ? "disable" : "enable", type.name)
                        }
                      >
                        {type.enabled ? "Disable creation" : "Enable creation"}
                      </button>
                      {["data", "process", "state-machine"].includes(type.name) && (
                        <button
                          type="button"
                          disabled={busy || !!pendingPreview}
                          onClick={() => configureModelType("reset", type.name)}
                        >
                          Reset to project-locked default
                        </button>
                      )}
                      <form
                        onChange={() => void cancelPreview()}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const design = designSelectors[type.name] ?? "";
                          if (design) configureModelType("design.set", type.name, { design });
                        }}
                      >
                        <label htmlFor={`design-${type.name}`}>Design graph selector</label>
                        <input
                          id={`design-${type.name}`}
                          value={designSelectors[type.name] ?? ""}
                          onChange={(event) =>
                            setDesignSelectors((values) => ({
                              ...values,
                              [type.name]: event.target.value,
                            }))
                          }
                          placeholder="dep:id/file-key or owned/path.ttl"
                          disabled={busy}
                        />
                        <button
                          type="submit"
                          disabled={busy || !!pendingPreview || !designSelectors[type.name]}
                        >
                          Set design independently
                        </button>
                        <button
                          type="button"
                          disabled={busy || !!pendingPreview}
                          onClick={() => {
                            setDesignSelectors((values) => ({ ...values, [type.name]: "" }));
                            configureModelType("design.clear", type.name);
                          }}
                        >
                          Clear design
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
                <h3>All settings</h3>
                <pre>{JSON.stringify(config, null, 2)}</pre>
              </section>
            )}
            {tab === "queries" && (
              <section aria-label="Saved queries and SPARQL">
                <h2>Saved queries</h2>
                <p>
                  Run SELECT, ASK, CONSTRUCT or DESCRIBE against the local project dataset or one
                  exact graph. Bind RDF terms through JSON; query text is never substituted.
                </p>
                <div className="form-row">
                  <label htmlFor="saved-query">Saved query</label>
                  <select
                    id="saved-query"
                    value={queryName}
                    onChange={(event) => setQueryName(event.target.value)}
                    disabled={busy}
                  >
                    <option value="">Choose a saved query</option>
                    {queries.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={busy} onClick={() => void refreshQueries()}>
                    Refresh saved queries
                  </button>
                  <button
                    type="button"
                    disabled={busy || !queryName}
                    onClick={() => void inspectQuery()}
                  >
                    Inspect saved query
                  </button>
                  <button
                    type="button"
                    disabled={busy || !queryName}
                    onClick={() => void refreshQueryReview()}
                  >
                    Refresh revision review; keep current draft
                  </button>
                  <button
                    type="button"
                    disabled={busy || !queryName || queryDetails?.name !== queryName}
                    onClick={() => void removeQuery()}
                  >
                    Remove saved query
                  </button>
                </div>
                {queryDetails && (
                  <details open>
                    <summary>Saved declaration and file revisions</summary>
                    <p>
                      {String(queryDetails.queryFile)} · {String(queryDetails.parametersFile)}
                    </p>
                    <ul>
                      {((queryDetails.parameters as QueryParameter[]) ?? []).map((parameter) => (
                        <li key={parameter.name}>
                          <code>{parameter.name}</code>: {parameter.kind},{" "}
                          {parameter.required ? "required" : "optional"}
                          {parameter.datatype ? `, datatype ${parameter.datatype}` : ""}
                          {parameter.language ? `, language ${parameter.language}` : ""}
                        </li>
                      ))}
                    </ul>
                    {!((queryDetails.parameters as QueryParameter[]) ?? []).length && (
                      <p>No parameters declared.</p>
                    )}
                    <pre>{JSON.stringify(queryDetails.revisions, null, 2)}</pre>
                    <details>
                      <summary>Server query text at this reviewed revision</summary>
                      <pre>{String(queryDetails.queryText ?? "")}</pre>
                    </details>
                  </details>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveQuery();
                  }}
                >
                  <h3>Query text</h3>
                  <label htmlFor="query-name">Saved query name</label>
                  <input
                    id="query-name"
                    value={queryName}
                    onChange={(event) => setQueryName(event.target.value)}
                    placeholder="orders-by-customer"
                    required
                    disabled={busy}
                  />
                  <label htmlFor="query-text">SPARQL query</label>
                  <textarea
                    id="query-text"
                    value={queryText}
                    onChange={(event) => setQueryText(event.target.value)}
                    rows={10}
                    required
                    disabled={busy}
                  />
                  <label htmlFor="query-parameters">Parameter declaration TOML (optional)</label>
                  <textarea
                    id="query-parameters"
                    value={parametersText}
                    onChange={(event) => setParametersText(event.target.value)}
                    rows={5}
                    placeholder="Leave blank to keep existing declaration bytes or use an empty declaration for a new query."
                    disabled={busy}
                  />
                  <button type="submit" disabled={busy}>
                    Save query
                  </button>
                </form>
                <h3>Run query</h3>
                <label htmlFor="query-graph">Exact graph selector (optional)</label>
                <input
                  id="query-graph"
                  value={queryGraph}
                  onChange={(event) => setQueryGraph(event.target.value)}
                  placeholder="models/orders.ttl or dep:id/file-key"
                  disabled={busy}
                />
                <label htmlFor="query-bindings">Typed RDF-term bindings JSON</label>
                <textarea
                  id="query-bindings"
                  value={bindingsText}
                  onChange={(event) => setBindingsText(event.target.value)}
                  rows={4}
                  disabled={busy}
                />
                <div className="form-row">
                  <button type="button" disabled={busy} onClick={() => void runQuery()}>
                    Run ad hoc query
                  </button>
                  <button
                    type="button"
                    disabled={busy || !queryName}
                    onClick={() => void runQuery(queryName)}
                  >
                    Run saved query
                  </button>
                </div>
                {queryResult && (
                  <section aria-label="Query result">
                    <h3>Query result · {queryResult.status}</h3>
                    <Diagnostics items={queryResult.diagnostics} />
                    {queryResult.data && <pre>{JSON.stringify(queryResult.data, null, 2)}</pre>}
                  </section>
                )}
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
