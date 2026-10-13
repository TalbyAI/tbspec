import { useCallback, useEffect, useState } from "react";

interface Envelope {
  schemaVersion: number;
  status: string;
  data: Record<string, unknown> | null;
  diagnostics: { code: string; severity: string; message: string; file: string | null }[];
}
interface Term {
  kind: string;
  value: string;
  language?: string;
  datatype?: string;
  scope?: string;
}
interface Occurrence {
  file: string;
  selector?: string;
  configurationPath?: string;
  position: string;
  targetIri: string;
  subject?: Term;
  predicate?: Term;
  object?: Term;
}
interface Candidate {
  resource: string;
  file: string;
  files: string[];
  role: string;
  sources: string[];
  reasons: string[];
}
interface StagedPreview {
  handle: string;
  fingerprint: string;
  accept: string[];
  arguments: Record<string, unknown>;
  changes: { file: string; action: string }[];
  impact: {
    acceptance: string[];
    affectedFiles: string[];
    baselineErrors: unknown[];
    introducedErrors: unknown[];
    worsenedErrors: unknown[];
    skippedChecks: unknown[];
  };
  candidates?: Candidate[];
}

function termText(term: Term) {
  if (term.kind === "iri") return `<${term.value}>`;
  if (term.kind === "blank") return `_:${term.value} (${term.scope})`;
  return `${JSON.stringify(term.value)}${term.language ? `@${term.language}` : `^^<${term.datatype}>`}`;
}

export function RepairPanel({ session, onApplied }: { session: string; onApplied: () => void }) {
  const [mode, setMode] = useState("all");
  const [target, setTarget] = useState("");
  const [newIri, setNewIri] = useState("");
  const [oldIri, setOldIri] = useState("");
  const [filesText, setFilesText] = useState("");
  const [allScope, setAllScope] = useState(false);
  const [repairAction, setRepairAction] = useState("redirect");
  const [gcAll, setGcAll] = useState(false);
  const [gcPaths, setGcPaths] = useState<string[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [referencePage, setReferencePage] = useState(0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [preview, setPreview] = useState<StagedPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<Envelope["diagnostics"]>([]);

  const call = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      const response = await fetch(`/api/project/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${session}`,
          "X-Tbspec-Schema-Version": "1",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const envelope = (await response.json()) as Envelope;
      if (envelope.schemaVersion !== 1) throw new Error("Incompatible project API.");
      return envelope;
    },
    [session],
  );

  async function listReferences() {
    setBusy(true);
    setError("");
    setDiagnostics([]);
    try {
      const query =
        mode === "target" && target
          ? `?target=${encodeURIComponent(target)}`
          : mode === "dangling"
            ? "?dangling=true"
            : "";
      const result = await call(`references${query}`);
      setOccurrences((result.data?.items as Occurrence[]) ?? []);
      setReferencePage(0);
      setDiagnostics(result.diagnostics);
      if (result.status !== "ok")
        setError(result.diagnostics.map((item) => item.message).join(" "));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Reference listing failed.");
    } finally {
      setBusy(false);
    }
  }

  const loadCandidates = useCallback(async () => {
    setBusy(true);
    setError("");
    setDiagnostics([]);
    try {
      const result = await call("repair/gc");
      setCandidates((result.data?.candidates as Candidate[]) ?? []);
      setGcPaths([]);
      setGcAll(false);
      setDiagnostics(result.diagnostics);
      if (result.status !== "ok")
        setError(result.diagnostics.map((item) => item.message).join(" "));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "GC candidate listing failed.");
    } finally {
      setBusy(false);
    }
  }, [call]);

  async function stage(route: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setPreview(null);
    setDiagnostics([]);
    try {
      const result = await call(route, body);
      setDiagnostics(result.diagnostics);
      if (result.status !== "preview" || !result.data) {
        setError(
          result.diagnostics.map((item) => `${item.code}: ${item.message}`).join(" ") ||
            "No preview was prepared.",
        );
        return;
      }
      const plan = result.data.preview as StagedPreview;
      setPreview({
        ...plan,
        handle: String(result.data.handle),
        fingerprint: plan.fingerprint,
        accept: plan.impact?.acceptance ?? [],
        candidates: result.data.candidates as Candidate[] | undefined,
      });
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Repair preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await call("repair/apply", {
        schemaVersion: 1,
        handle: preview.handle,
        fingerprint: preview.fingerprint,
        accept: preview.accept,
      });
      setDiagnostics(result.diagnostics);
      if (result.status === "ok") {
        setPreview(null);
        onApplied();
      } else setError(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join(" "));
    } catch (problem) {
      setPreview(null);
      setError(
        problem instanceof Error
          ? problem.message
          : "Repair application failed. Inspect project state before another write.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelPreview() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await call("repair/cancel", { schemaVersion: 1, handle: preview.handle });
      if (result.status !== "ok")
        setError(result.diagnostics.map((item) => item.message).join(" "));
      setPreview(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Preview cancellation failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const selectedFiles = filesText
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
  const referencePageSize = 100;
  const referencePageCount = Math.max(1, Math.ceil(occurrences.length / referencePageSize));
  const visibleOccurrences = occurrences.slice(
    referencePage * referencePageSize,
    (referencePage + 1) * referencePageSize,
  );
  return (
    <section aria-label="Repair project references">
      <h2>Repair</h2>
      <p>Inspect exact IRI occurrences, then stage revision-bound changes to owned files.</p>
      <section aria-label="Reference inventory">
        <h3>Reference inventory</h3>
        <label htmlFor="reference-mode">List occurrences</label>
        <select
          id="reference-mode"
          value={mode}
          disabled={busy}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="all">All known occurrences</option>
          <option value="target">One exact IRI</option>
          <option value="dangling">Demonstrably dangling managed references</option>
        </select>
        {mode === "target" && (
          <>
            <label htmlFor="reference-target">Target IRI</label>
            <input
              id="reference-target"
              value={target}
              disabled={busy}
              onChange={(event) => setTarget(event.target.value)}
            />
          </>
        )}
        <button
          type="button"
          disabled={busy || (mode === "target" && !target)}
          onClick={() => void listReferences()}
        >
          List references
        </button>
        {occurrences.length > 0 && (
          <nav aria-label="Reference inventory pagination">
            <p>
              Showing {referencePage * referencePageSize + 1}–
              {Math.min((referencePage + 1) * referencePageSize, occurrences.length)} of{" "}
              {occurrences.length} occurrences
            </p>
            <button
              type="button"
              disabled={busy || referencePage === 0}
              onClick={() => setReferencePage(0)}
            >
              First page
            </button>
            <button
              type="button"
              disabled={busy || referencePage === 0}
              onClick={() => setReferencePage((page) => page - 1)}
            >
              Previous page
            </button>
            <button
              type="button"
              disabled={busy || referencePage + 1 >= referencePageCount}
              onClick={() => setReferencePage((page) => page + 1)}
            >
              Next page
            </button>
            <button
              type="button"
              disabled={busy || referencePage + 1 >= referencePageCount}
              onClick={() => setReferencePage(referencePageCount - 1)}
            >
              Last page
            </button>
          </nav>
        )}
        <ul>
          {visibleOccurrences.map((item) => (
            <li key={JSON.stringify(item)}>
              <code>{item.file}</code>
              {item.selector && (
                <>
                  {" "}
                  · <code>{item.selector}</code>
                </>
              )}
              {item.configurationPath && (
                <>
                  {" "}
                  · <code>{item.configurationPath}</code>
                </>
              )}
              {` · ${item.position} · `}
              <code>{item.targetIri}</code>
              {item.subject && item.predicate && item.object && (
                <pre>{`${termText(item.subject)} ${termText(item.predicate)} ${termText(item.object)}`}</pre>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Refactor IRI">
        <h3>Refactor an IRI</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void stage("repair/refactor/iri", { oldIri, newIri });
          }}
        >
          <label htmlFor="refactor-old">Old IRI</label>
          <input
            id="refactor-old"
            required
            value={oldIri}
            disabled={busy || !!preview}
            onChange={(event) => setOldIri(event.target.value)}
          />
          <label htmlFor="refactor-new">New IRI</label>
          <input
            id="refactor-new"
            required
            value={newIri}
            disabled={busy || !!preview}
            onChange={(event) => setNewIri(event.target.value)}
          />
          <button type="submit" disabled={busy || !!preview}>
            Preview IRI refactor
          </button>
        </form>
      </section>
      <section aria-label="Redirect or remove dangling references">
        <h3>Repair dangling references</h3>
        <label htmlFor="repair-action">Operation</label>
        <select
          id="repair-action"
          value={repairAction}
          disabled={busy || !!preview}
          onChange={(event) => setRepairAction(event.target.value)}
        >
          <option value="redirect">Redirect</option>
          <option value="remove">Remove statements</option>
        </select>
        <label htmlFor="repair-target">Dangling target IRI</label>
        <input
          id="repair-target"
          required
          value={target}
          disabled={busy || !!preview}
          onChange={(event) => setTarget(event.target.value)}
        />
        {repairAction === "redirect" && (
          <>
            <label htmlFor="repair-new">Available target IRI</label>
            <input
              id="repair-new"
              required
              value={newIri}
              disabled={busy || !!preview}
              onChange={(event) => setNewIri(event.target.value)}
            />
          </>
        )}
        <label htmlFor="repair-files">Owned files (one exact path per line)</label>
        <textarea
          id="repair-files"
          value={filesText}
          disabled={busy || !!preview || allScope}
          onChange={(event) => setFilesText(event.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={allScope}
            disabled={busy || !!preview}
            onChange={(event) => setAllScope(event.target.checked)}
          />
          All owned reference files
        </label>
        <button
          type="button"
          disabled={busy || !!preview || (!allScope && selectedFiles.length === 0)}
          onClick={() => {
            const body = {
              targetIri: target,
              ...(repairAction === "redirect" ? { newIri } : {}),
              ...(allScope ? { all: true } : { files: selectedFiles }),
            };
            void stage(`repair/references/${repairAction}`, body);
          }}
        >
          Preview reference repair
        </button>
      </section>
      <section aria-label="Collect orphaned support">
        <h3>Collect orphaned support</h3>
        <p>Independent designs and cleared manual support remain outside collection candidates.</p>
        <button type="button" disabled={busy || !!preview} onClick={() => void loadCandidates()}>
          Refresh eligible candidates
        </button>
        <ul>
          {candidates.map((candidate) => (
            <li key={candidate.resource}>
              <label>
                <input
                  type="checkbox"
                  checked={gcAll || gcPaths.includes(candidate.file)}
                  disabled={busy || !!preview || gcAll}
                  onChange={(event) =>
                    setGcPaths((current) =>
                      event.target.checked
                        ? [...current, candidate.file]
                        : current.filter((path) => path !== candidate.file),
                    )
                  }
                />
                {candidate.role}: <code>{candidate.files.join(", ")}</code> from{" "}
                {candidate.sources.join(", ")}
              </label>
            </li>
          ))}
        </ul>
        <label>
          <input
            type="checkbox"
            checked={gcAll}
            disabled={busy || !!preview}
            onChange={(event) => {
              setGcAll(event.target.checked);
              setGcPaths([]);
            }}
          />
          Select all eligible candidates
        </label>
        <button
          type="button"
          disabled={busy || !!preview || (!gcAll && gcPaths.length === 0)}
          onClick={() => void stage("repair/gc", gcAll ? { all: true } : { resources: gcPaths })}
        >
          Preview collection
        </button>
      </section>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <Diagnostics diagnostics={diagnostics} />
      {preview && (
        <section aria-label="Staged repair preview">
          <h3>Staged preview</h3>
          <p>
            Fingerprint: <code>{preview.fingerprint}</code>
          </p>
          <p>Review each changed path, exact occurrence and validation result before applying.</p>
          <h4>Files to change</h4>
          <ul>
            {preview.changes.map((change) => (
              <li key={change.file}>
                {change.action}: <code>{change.file}</code>
              </li>
            ))}
          </ul>
          {preview.candidates && (
            <>
              <h4>GC candidates</h4>
              <ul>
                {preview.candidates.map((candidate) => (
                  <li key={candidate.file}>
                    <code>{candidate.files.join(", ")}</code> · {candidate.reasons.join(", ")}
                  </li>
                ))}
              </ul>
            </>
          )}
          <pre>{JSON.stringify(preview.arguments, null, 2)}</pre>
          <pre>{JSON.stringify(preview.impact, null, 2)}</pre>
          <button type="button" disabled={busy} onClick={() => void applyPreview()}>
            {preview.accept.includes("confirm") ? "Confirm collection" : "Apply reviewed repair"}
          </button>
          <button type="button" disabled={busy} onClick={() => void cancelPreview()}>
            Cancel preview
          </button>
        </section>
      )}
    </section>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: Envelope["diagnostics"] }) {
  return diagnostics.length ? (
    <ul className="diagnostics">
      {diagnostics.map((item) => (
        <li key={JSON.stringify(item)}>
          <strong>
            {item.severity} · {item.code}
          </strong>
          {item.file && <code>{item.file}</code>}
          <span>{item.message}</span>
        </li>
      ))}
    </ul>
  ) : null;
}
