import { useCallback, useEffect, useMemo, useState } from "react";

interface Term {
  kind: string;
  value: string;
  scope?: string;
  language?: string;
  datatype?: string;
}
interface Triple {
  subject: Term;
  predicate: Term;
  object: Term;
}
interface Revision {
  state: "present";
  digest: string;
}
interface ViewTuple {
  subject: string;
  predicate: string;
  object: string;
}
interface ViewData {
  resource: { selector: string; graphIri: string | null; revision: Revision };
  source: string;
  members: string[];
  relationships: ViewTuple[];
  presentation: {
    resource: { selector: string; graphIri: string | null; revision: Revision };
    triples: Triple[];
  };
  protocol?: string;
}
interface Envelope {
  schemaVersion: number;
  status: string;
  data: Record<string, unknown> | null;
  diagnostics: { code: string; severity: string; message: string; file: string | null }[];
}
interface Pending {
  handle: string;
  fingerprint: string;
  accept: string[];
  preview: { changes: { file: string; action: string }[] };
}
const metadata = "https://talby.ai/ontology/tbspec#";
const tupleKey = (tuple: ViewTuple) =>
  JSON.stringify([tuple.subject, tuple.predicate, tuple.object]);
const tupleLabel = (tuple: ViewTuple) => `${tuple.subject} ${tuple.predicate} ${tuple.object}`;

export function ViewsPanel({ session, onApplied }: { session: string; onApplied: () => void }) {
  const [items, setItems] = useState<{ selector: string; source: string; presentation: string }[]>(
    [],
  );
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<ViewData>();
  const [sourceTriples, setSourceTriples] = useState<Triple[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [relationships, setRelationships] = useState<ViewTuple[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: string; y: string }>>({});
  const [path, setPath] = useState("views/overview.ttl");
  const [source, setSource] = useState("");
  const [protocol, setProtocol] = useState("");
  const [pending, setPending] = useState<Pending>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (route: string, body?: Record<string, unknown>) => {
      const response = await fetch(`/api/project/v1/${route}`, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${session}`,
          "X-Tbspec-Schema-Version": "1",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = (await response.json()) as Envelope;
      if (result.schemaVersion !== 1) throw new Error("Incompatible project API.");
      if (!response.ok)
        throw new Error(
          result.diagnostics.map((item) => item.message).join(" ") || "View operation failed.",
        );
      return result;
    },
    [session],
  );

  const refresh = useCallback(async () => {
    const result = await call("views");
    setItems((result.data?.items as typeof items) ?? []);
  }, [call]);

  const show = useCallback(
    async (selector: string) => {
      const result = await call(`view?selector=${encodeURIComponent(selector)}`);
      const selectedView = result.data as unknown as ViewData;
      setSelected(selector);
      setView(selectedView);
      setMembers(selectedView.members);
      setRelationships(selectedView.relationships);
      const sourceResult = await call(`graph?selector=${encodeURIComponent(selectedView.source)}`);
      setSourceTriples((sourceResult.data?.triples as Triple[]) ?? []);
      const coordinates: Record<string, { x: string; y: string }> = {};
      const records = new Map<string, { element?: string; x?: string; y?: string }>();
      for (const triple of selectedView.presentation.triples) {
        const subject = triple.subject.value;
        const predicate = triple.predicate.value;
        let record = records.get(subject);
        if (!record) {
          record = {};
          records.set(subject, record);
        }
        if (predicate === `${metadata}element` && triple.object.kind === "iri")
          record.element = triple.object.value;
        if (predicate === `${metadata}x`) record.x = triple.object.value;
        if (predicate === `${metadata}y`) record.y = triple.object.value;
      }
      for (const record of records.values())
        if (record.element) coordinates[record.element] = { x: record.x ?? "", y: record.y ?? "" };
      setPositions(coordinates);
    },
    [call],
  );

  useEffect(() => {
    void refresh().catch((problem: Error) => setMessage(problem.message));
  }, [refresh]);

  const sourceMembers = useMemo(() => {
    const values = new Set<string>();
    for (const triple of sourceTriples) {
      if (triple.subject.kind === "iri") values.add(triple.subject.value);
      if (triple.object.kind === "iri") values.add(triple.object.value);
    }
    for (const member of members) values.add(member);
    return [...values].sort();
  }, [sourceTriples, members]);
  const sourceRelationships = useMemo(
    () =>
      sourceTriples.flatMap((triple) => {
        if (
          triple.subject.kind !== "iri" ||
          triple.predicate.kind !== "iri" ||
          triple.object.kind !== "iri"
        )
          return [];
        return [
          {
            subject: triple.subject.value,
            predicate: triple.predicate.value,
            object: triple.object.value,
          },
        ];
      }),
    [sourceTriples],
  );

  async function preview(route: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const result = await call(route, body);
      if (result.status !== "preview" || !result.data) {
        setMessage(
          result.diagnostics.map((item) => `${item.code}: ${item.message}`).join(" ") ||
            "View preview was not prepared.",
        );
        return;
      }
      const plan = result.data.preview as Pending["preview"] & {
        fingerprint: string;
        impact?: { acceptance?: string[] };
      };
      setPending({
        handle: String(result.data.handle),
        fingerprint: plan.fingerprint,
        accept: plan.impact?.acceptance ?? [],
        preview: plan,
      });
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : "View preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!pending) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await call("resource/apply", {
        schemaVersion: 1,
        handle: pending.handle,
        fingerprint: pending.fingerprint,
        accept: pending.accept,
      });
      if (result.status !== "ok") {
        setMessage(
          result.diagnostics.map((item) => `${item.code}: ${item.message}`).join(" ") ||
            "View changes were not applied.",
        );
        if (result.diagnostics.some((item) => item.code === "REVISION_CONFLICT"))
          setPending(undefined);
        return;
      }
      setPending(undefined);
      await refresh();
      if (selected && !pending.accept.includes("confirm")) await show(selected);
      else {
        setView(undefined);
        setSelected("");
      }
      setMessage("View files were updated.");
      onApplied();
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : "View changes could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!pending) return;
    setBusy(true);
    try {
      await call("resource/cancel", { schemaVersion: 1, handle: pending.handle });
      setPending(undefined);
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : "Preview could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }

  function toggleMember(member: string, checked: boolean) {
    setMembers((current) =>
      checked ? [...new Set([...current, member])] : current.filter((item) => item !== member),
    );
    if (!checked) {
      setRelationships((current) =>
        current.filter((tuple) => tuple.subject !== member && tuple.object !== member),
      );
      setPositions((current) => {
        const next = { ...current };
        delete next[member];
        return next;
      });
    }
  }

  function toggleRelationship(tuple: ViewTuple, checked: boolean) {
    setRelationships((current) =>
      checked
        ? [...current.filter((item) => tupleKey(item) !== tupleKey(tuple)), tuple]
        : current.filter((item) => tupleKey(item) !== tupleKey(tuple)),
    );
    if (checked) setMembers((current) => [...new Set([...current, tuple.subject, tuple.object])]);
  }

  return (
    <section aria-label="Project views">
      <h2>Views</h2>
      <p>
        Each view has its own exact member and relationship selections. Presentation coordinates
        belong to that view.
      </p>
      <form
        aria-label="Create view"
        onSubmit={(event) => {
          event.preventDefault();
          void preview("views/create", {
            path,
            source,
            ...(protocol.trim() ? { protocol: protocol.trim() } : {}),
          });
        }}
      >
        <label>
          View file
          <input value={path} onChange={(event) => setPath(event.target.value)} required />
        </label>
        <label>
          Source selector
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="models/example.ttl or dep:id/file.ttl"
            required
          />
        </label>
        <label>
          Optional project protocol selector
          <input value={protocol} onChange={(event) => setProtocol(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !!pending}>
          Preview view creation
        </button>
      </form>
      <h3>Independent views</h3>
      {items.length ? (
        <ul className="resource-list">
          {items.map((item) => (
            <li key={item.selector}>
              <button
                type="button"
                disabled={busy || !!pending}
                onClick={() => void show(item.selector)}
              >
                <strong>{item.selector}</strong>
                <span>source: {item.source}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No views yet.</p>
      )}
      {view && (
        <section aria-label={`View ${view.resource.selector}`}>
          <h3>{view.resource.selector}</h3>
          <p>
            Source graph: <code>{view.source}</code>
          </p>
          <p>
            Presentation graph: <code>{view.presentation.resource.selector}</code>
          </p>
          {view.protocol && (
            <p>
              Project protocol selector: <code>{view.protocol}</code>
            </p>
          )}
          <fieldset>
            <legend>View members</legend>
            {sourceMembers.map((member) => (
              <label key={member}>
                <input
                  type="checkbox"
                  checked={members.includes(member)}
                  disabled={busy || !!pending}
                  onChange={(event) => toggleMember(member, event.target.checked)}
                />{" "}
                {member}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Exact source relationships</legend>
            <p>
              Parallel predicates and self-loops remain separate tuples. Selecting a relationship
              includes both endpoint members.
            </p>
            {sourceRelationships.map((tuple) => (
              <label key={tupleKey(tuple)}>
                <input
                  type="checkbox"
                  checked={relationships.some((item) => tupleKey(item) === tupleKey(tuple))}
                  disabled={busy || !!pending}
                  onChange={(event) => toggleRelationship(tuple, event.target.checked)}
                />
                <code>{tupleLabel(tuple)}</code>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Node presentation coordinates</legend>
            {members.map((member) => (
              <div key={member} className="coordinate-row">
                <code>{member}</code>
                <label>
                  x
                  <input
                    aria-label={`${member} x coordinate`}
                    value={positions[member]?.x ?? ""}
                    disabled={busy || !!pending}
                    onChange={(event) =>
                      setPositions((current) => ({
                        ...current,
                        [member]: { x: event.target.value, y: current[member]?.y ?? "" },
                      }))
                    }
                  />
                </label>
                <label>
                  y
                  <input
                    aria-label={`${member} y coordinate`}
                    value={positions[member]?.y ?? ""}
                    disabled={busy || !!pending}
                    onChange={(event) =>
                      setPositions((current) => ({
                        ...current,
                        [member]: { x: current[member]?.x ?? "", y: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={busy || !!pending}
            onClick={() =>
              void preview("view/edit", {
                selector: view.resource.selector,
                viewRevision: view.resource.revision,
                presentationRevision: view.presentation.resource.revision,
                members,
                relationships,
                positions: members.map((element) => ({
                  element,
                  x: positions[element]?.x ?? "",
                  y: positions[element]?.y ?? "",
                })),
              })
            }
          >
            Preview selection and layout
          </button>
          <button
            type="button"
            disabled={busy || !!pending}
            onClick={() => void preview("views/remove", { selector: view.resource.selector })}
          >
            Preview removal
          </button>
        </section>
      )}
      {pending && (
        <section className="notice" aria-label="View transaction preview">
          <h3>Review view transaction</h3>
          <ul>
            {pending.preview.changes.map((change) => (
              <li key={change.file}>
                {change.action}: <code>{change.file}</code>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void apply()} disabled={busy}>
            {pending.accept.includes("confirm") ? "Confirm view removal" : "Apply view changes"}
          </button>
          <button type="button" onClick={() => void cancel()} disabled={busy}>
            Cancel preview
          </button>
        </section>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
