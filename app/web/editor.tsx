import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  type EdgeProps,
  MarkerType,
  type Node,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import { type CSSProperties, type SetStateAction, useEffect, useMemo, useState } from "react";
import type { EditingOptions, EditorData, EditorTerm, Triple } from "../src/editing.ts";
import type { Diagnostic, Result } from "../src/output.ts";
import { pPlan, proc } from "../src/process.ts";
import { type EditorDraft, emptyDraft, updateDraft } from "./drafts.ts";
import { ProcessForm } from "./process-form.tsx";
import { StateMachineForm } from "./state-machine-form.tsx";
import "@xyflow/react/dist/style.css";

const xsdString = "http://www.w3.org/2001/XMLSchema#string";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const processAssociationFields = new Set([
  `${pPlan}hasInputVar`,
  `${pPlan}hasOutputVar`,
  `${pPlan}isInputVarOf`,
  `${pPlan}isOutputVarOf`,
]);
const processCondition = `${proc}condition`;
const rdfsLabel = "http://www.w3.org/2000/01/rdf-schema#label";
const key = (term: EditorTerm) => JSON.stringify(term);
export interface CanvasDesignChoices {
  nodes: Record<string, string>;
  relationships: Record<string, string>;
}
interface CanvasDesignRule {
  iri: string;
  targetConcept?: string;
  appearance: Record<string, { kind?: string; value?: string }>;
}
interface CanvasDesignData {
  effectivePresentation?: {
    nodes: Record<string, CanvasDesignRule>;
    relationships: Record<string, CanvasDesignRule>;
  };
  designRuleOptions?: {
    nodes: Record<string, CanvasDesignRule[]>;
    relationships: Record<string, CanvasDesignRule[]>;
  };
}
function displayRuleValue(value: unknown) {
  return value && typeof value === "object" && "value" in value
    ? String(value.value)
    : typeof value === "string"
      ? value
      : "";
}
function safeColor(value: unknown, fallback: string) {
  const candidate = displayRuleValue(value);
  return /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(candidate) ? candidate : fallback;
}
function safeEnum(value: unknown, values: string[]) {
  const candidate = displayRuleValue(value);
  return values.includes(candidate) ? candidate : undefined;
}
function safeNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const number = Number(displayRuleValue(value));
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}
function canvasRule(
  rule: CanvasDesignRule | undefined,
  choices: CanvasDesignRule[] | undefined,
  selected: string | undefined,
) {
  if (selected) return choices?.find((candidate) => candidate.iri === selected);
  if (choices?.length === 1) return choices[0];
  return rule;
}
function canvasTupleKey(triple: Triple) {
  const endpoint = (term: EditorTerm) => (term.kind === "iri" ? term.value : term);
  return JSON.stringify([
    endpoint(triple.subject),
    triple.predicate.value,
    endpoint(triple.object),
  ]);
}
function localName(iri: string) {
  const tail = iri.slice(
    Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"), iri.lastIndexOf(":")) + 1,
  );
  return tail || iri;
}
function canvasLabel(term: EditorTerm, rule: CanvasDesignRule | undefined, triples: Triple[]) {
  if (term.kind !== "iri") return text(term);
  const appearance = rule?.appearance ?? {};
  const mode = safeEnum(appearance.labelMode, ["property", "local-name", "iri", "text", "none"]);
  if (mode === "none") return "";
  if (mode === "iri") return term.value;
  if (mode === "local-name") return localName(term.value);
  if (mode === "text") return displayRuleValue(appearance.labelText);
  const predicate = displayRuleValue(appearance.labelProperty) || rdfsLabel;
  const labels = triples
    .filter(
      (triple) =>
        triple.subject.value === term.value &&
        triple.predicate.value === predicate &&
        triple.object.kind === "literal",
    )
    .map((triple) => triple.object.value)
    .sort();
  return labels[0] ?? text(term);
}
type ElementDeletionReview = {
  handle: string;
  projectValidity: string;
  validation?: { validity: string };
  preview: {
    fingerprint: string;
    arguments: {
      element: EditorTerm;
      statements: Triple[];
      references: {
        file: string;
        selector: string;
        position: string;
        disposition: "unchanged" | "synchronized";
        targetIri: string;
        configurationRole?: "key" | "value";
        subject?: EditorTerm;
        predicate?: EditorTerm;
        object?: EditorTerm;
      }[];
    };
    impact: { affectedFiles: string[]; acceptance: string[] };
  };
};
function text(term: EditorTerm) {
  return term.kind === "iri"
    ? `<${term.value}>`
    : term.kind === "blank"
      ? `_:${term.value}`
      : `${JSON.stringify(term.value)}${term.language ? `@${term.language}` : `^^<${term.datatype}>`}`;
}
function ExactEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
  markerEnd,
  selected,
  labelStyle,
}: EdgeProps) {
  const offset = 50 + Number(data?.offset ?? 0) * 24;
  const loop = data?.loop;
  const visual = data?.visualStyle as CSSProperties | undefined;
  const visualLabel = data?.visualLabelStyle as CSSProperties | undefined;
  const path = loop
    ? `M ${sourceX} ${sourceY} C ${sourceX + offset} ${sourceY - 90}, ${targetX + offset} ${targetY + 90}, ${targetX} ${targetY}`
    : `M ${sourceX} ${sourceY} C ${sourceX + offset} ${sourceY}, ${targetX - offset} ${targetY}, ${targetX} ${targetY}`;
  return (
    <BaseEdge
      path={path}
      label={label}
      labelStyle={{ ...labelStyle, ...visualLabel }}
      markerEnd={markerEnd}
      style={{
        stroke: selected ? "#9f4c1a" : "#5e766b",
        strokeWidth: selected ? 3 : 1.5,
        ...visual,
      }}
      interactionWidth={24}
    />
  );
}
const edgeTypes = { exact: ExactEdge };
function TermInput({
  label,
  value,
  onChange,
  scope,
  resourceOnly = false,
  iriOnly = false,
}: {
  label: string;
  value: EditorTerm;
  onChange: (term: EditorTerm) => void;
  scope: string;
  resourceOnly?: boolean;
  iriOnly?: boolean;
}) {
  return (
    <fieldset className="term-input">
      <legend>{label}</legend>
      {!iriOnly && (
        <label>
          Term kind
          <select
            aria-label={`${label} kind`}
            value={value.kind}
            onChange={(e) =>
              onChange(
                e.target.value === "literal"
                  ? { kind: "literal", value: "", datatype: xsdString }
                  : e.target.value === "blank"
                    ? { kind: "blank", value: "", scope }
                    : { kind: "iri", value: "" },
              )
            }
          >
            <option value="iri">IRI</option>
            <option value="blank">Blank node</option>
            {!resourceOnly && <option value="literal">Literal</option>}
          </select>
        </label>
      )}
      <label>
        {value.kind === "literal"
          ? "Lexical value"
          : value.kind === "blank"
            ? "Blank node identifier"
            : "Absolute IRI"}
        <input
          aria-label={`${label} value`}
          value={value.value}
          required={value.kind !== "literal"}
          onChange={(e) => onChange({ ...value, value: e.target.value })}
        />
      </label>
      {value.kind === "blank" && (
        <small>Scoped to this graph revision. A new identifier creates a new blank node.</small>
      )}
      {value.kind === "literal" && (
        <>
          <label>
            Language
            <input
              aria-label={`${label} language`}
              value={value.language ?? ""}
              onChange={(e) =>
                onChange(
                  e.target.value
                    ? { kind: "literal", value: value.value, language: e.target.value }
                    : { kind: "literal", value: value.value, datatype: xsdString },
                )
              }
            />
          </label>
          {!value.language && (
            <label>
              Datatype IRI
              <input
                aria-label={`${label} datatype`}
                value={value.datatype ?? xsdString}
                onChange={(e) => onChange({ ...value, datatype: e.target.value })}
                required
              />
            </label>
          )}
        </>
      )}
    </fieldset>
  );
}

export function GraphEditor({
  selector,
  call,
  onSaved,
  drafts,
  onDraftChange,
  onBusyChange,
  disabled,
  designChoices,
  onTemporaryDesignChoice,
}: {
  selector: string;
  call: (path: string, body?: Record<string, unknown>) => Promise<Result>;
  onSaved: () => Promise<void>;
  drafts: Map<string, EditorDraft>;
  onDraftChange: () => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
  designChoices: CanvasDesignChoices;
  onTemporaryDesignChoice: (kind: "node" | "relationship", element: string, rule: string) => void;
}) {
  const [data, setData] = useState<EditorData>();
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edge, setEdge] = useState<Triple>();
  const [deletionReview, setDeletionReview] = useState<ElementDeletionReview>();
  const [draft, setLocalDraft] = useState(() => drafts.get(selector) ?? emptyDraft);
  const {
    mode,
    selected,
    section,
    sourceDraft,
    pending,
    creationDraft,
    processDraft,
    initialValues,
    stateMachineDraft,
    conflict,
    conflictKind,
  } = draft;
  function setter<K extends keyof EditorDraft>(field: K) {
    return (change: SetStateAction<EditorDraft[K]>) => {
      const current = drafts.get(selector) ?? emptyDraft;
      const value = typeof change === "function" ? change(current[field]) : change;
      setLocalDraft(updateDraft(drafts, selector, { [field]: value }));
      onDraftChange();
    };
  }
  const setMode = setter("mode"),
    setSelected = setter("selected"),
    setSection = setter("section"),
    setSourceDraft = setter("sourceDraft"),
    setPending = setter("pending"),
    setCreationDraft = setter("creationDraft"),
    setProcessDraft = setter("processDraft"),
    setInitialValues = setter("initialValues"),
    setStateMachineDraft = setter("stateMachineDraft"),
    setConflict = setter("conflict"),
    setConflictKind = setter("conflictKind");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  async function read() {
    const result = await call(`editor?selector=${encodeURIComponent(selector)}`);
    if (!result.data) throw new Error(result.diagnostics.map((d) => d.message).join(" "));
    const current = result.data as EditorData;
    setData(current);
    setDiagnostics(result.diagnostics);
    return current;
  }
  // Inspection never replaces workspace-owned drafts or their captured revisions.
  useEffect(() => {
    let active = true;
    onBusyChange(true);
    void call(`editor?selector=${encodeURIComponent(selector)}`)
      .then((result) => {
        if (!active) return;
        if (!result.data) throw new Error(result.diagnostics.map((d) => d.message).join(" "));
        setData(result.data as EditorData);
        setDiagnostics(result.diagnostics);
      })
      .catch((problem: Error) => {
        if (active) setError(problem.message);
      })
      .finally(() => onBusyChange(false));
    return () => {
      active = false;
    };
  }, [selector, call, onBusyChange]);
  const designData = data?.designResolution as CanvasDesignData | undefined;
  const designDiagnostics = diagnostics.filter(
    (diagnostic) =>
      diagnostic.code.startsWith("DESIGN_RULE_") || diagnostic.code === "DESIGN_CONFLICT",
  );
  const projection = useMemo(() => {
    const terms = new Map<string, EditorTerm>();
    const edges: Edge[] = [];
    const parallel = new Map<string, number>();
    for (const triple of data?.triples ?? []) {
      terms.set(key(triple.subject), triple.subject);
      if (triple.object.kind !== "literal") {
        terms.set(key(triple.object), triple.object);
        const pair = `${key(triple.subject)}:${key(triple.object)}`;
        const offset = parallel.get(pair) ?? 0;
        parallel.set(pair, offset + 1);
        edges.push({
          id: JSON.stringify(triple),
          source: key(triple.subject),
          target: key(triple.object),
          label: triple.predicate.value,
          type: "exact",
          markerEnd: { type: MarkerType.ArrowClosed },
          data: { offset, loop: key(triple.subject) === key(triple.object) },
          ariaLabel: `${text(triple.subject)} ${text(triple.predicate)} ${text(triple.object)}`,
        });
      }
    }
    return {
      nodes: [...terms].map(([id, term], i) => ({
        id,
        data: { label: text(term) },
        position: { x: (i % 3) * 300, y: Math.floor(i / 3) * 130 },
        style: { width: 220, overflowWrap: "anywhere" as const },
      })),
      edges,
    };
  }, [data]);
  const canvasNodes = useMemo(
    () =>
      nodes.map((node) => {
        const term = JSON.parse(node.id) as EditorTerm;
        if (term.kind !== "iri") return node;
        const candidates = designData?.designRuleOptions?.nodes[term.value];
        const rule = canvasRule(
          designData?.effectivePresentation?.nodes[term.value],
          candidates,
          designChoices.nodes[term.value],
        );
        const appearance = rule?.appearance ?? {};
        const shape = safeEnum(appearance.nodeShape, [
          "rectangle",
          "rounded-rectangle",
          "ellipse",
          "diamond",
        ]);
        const line = safeEnum(appearance.lineStyle, ["solid", "dashed", "dotted"]);
        const weight = safeNumber(appearance.fontWeight, 400, 100, 900);
        const style: Node["style"] = {
          ...node.style,
          backgroundColor: safeColor(appearance.fillColor, "#ffffff"),
          color: safeColor(appearance.textColor, "#172536"),
          borderColor: safeColor(appearance.strokeColor, "#526477"),
          borderWidth: safeNumber(appearance.strokeWidth, 1, 0, 100),
          borderStyle: line ?? "solid",
          borderRadius: shape === "ellipse" ? "50%" : shape === "rounded-rectangle" ? 12 : 3,
          ...(shape === "diamond" ? { clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" } : {}),
          fontFamily:
            safeEnum(appearance.fontFamily, ["system-ui", "sans-serif", "serif", "monospace"]) ??
            "system-ui",
          fontSize: safeNumber(appearance.fontSize, 14, 1, 200),
          fontWeight: [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(weight) ? weight : 400,
          fontStyle: safeEnum(appearance.fontStyle, ["normal", "italic"]) ?? "normal",
        };
        return {
          ...node,
          data: { label: canvasLabel(term, rule, data?.triples ?? []) },
          style,
        };
      }),
    [data, designChoices.nodes, designData, nodes],
  );
  const canvasEdges = useMemo(
    () =>
      projection.edges.map((edge) => {
        const triple = JSON.parse(edge.id) as Triple;
        const ruleKey = canvasTupleKey(triple);
        const candidates = designData?.designRuleOptions?.relationships[ruleKey];
        const rule = canvasRule(
          designData?.effectivePresentation?.relationships[ruleKey],
          candidates,
          designChoices.relationships[ruleKey],
        );
        const appearance = rule?.appearance ?? {};
        const line = safeEnum(appearance.lineStyle, ["solid", "dashed", "dotted"]);
        const stroke = safeColor(appearance.strokeColor, "#5e766b");
        const weight = safeNumber(appearance.fontWeight, 400, 100, 900);
        const arrow = safeEnum(appearance.arrowHead, ["none", "arrow"]);
        return {
          ...edge,
          label: canvasLabel(triple.predicate, rule, data?.triples ?? []),
          markerEnd: arrow === "none" ? undefined : { type: MarkerType.ArrowClosed, color: stroke },
          data: {
            ...edge.data,
            visualStyle: {
              stroke,
              strokeWidth: safeNumber(appearance.strokeWidth, 1.5, 0, 100),
              strokeDasharray: line === "dashed" ? "6 4" : line === "dotted" ? "2 4" : undefined,
            },
            visualLabelStyle: {
              fill: safeColor(appearance.textColor, "#172536"),
              fontFamily:
                safeEnum(appearance.fontFamily, [
                  "system-ui",
                  "sans-serif",
                  "serif",
                  "monospace",
                ]) ?? "system-ui",
              fontSize: safeNumber(appearance.fontSize, 12, 1, 200),
              fontWeight: [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(weight)
                ? weight
                : 400,
              fontStyle: safeEnum(appearance.fontStyle, ["normal", "italic"]) ?? "normal",
            },
          },
        };
      }),
    [data, designChoices.relationships, designData, projection.edges],
  );
  const selectableResources = useMemo(() => {
    const terms = new Map<string, EditorTerm>();
    for (const triple of data?.triples ?? [])
      for (const term of [triple.subject, triple.predicate, triple.object])
        if (term.kind !== "literal") terms.set(key(term), term);
    return [...terms];
  }, [data]);
  useEffect(() => {
    setNodes((old) =>
      projection.nodes.map((n) => ({
        ...n,
        position: old.find((p) => p.id === n.id)?.position ?? n.position,
      })),
    );
  }, [projection, setNodes]);
  const writable = data?.resource.ownership === "project" && data.resource.file.endsWith(".ttl");
  const scope = `${data?.resource.selector}@${data?.resource.revision.state === "present" ? data.resource.revision.digest : ""}`;
  const sections =
    data?.sections.filter((s) =>
      s.subjects.some((t) => key(t) === key(selected ?? { kind: "iri", value: "" })),
    ) ?? [];
  const binding = sections.find((s) => s.type === section) ?? sections[0];
  const statements =
    data?.triples.filter((q) => selected && key(q.subject) === key(selected)) ?? [];
  async function save(
    options: Omit<EditingOptions, "selector">,
    source = false,
    draftKind?: "process" | "state-machine",
  ) {
    if (busy || disabled) return;
    let published = false;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setConflict(undefined);
    try {
      const preview = await call("editor/save", { selector, ...options });
      let result = preview;
      if (preview.status === "preview" && preview.data) {
        result = await call("resource/apply", {
          schemaVersion: 1,
          handle: preview.data.handle,
          fingerprint: (preview.data.preview as { fingerprint: string }).fingerprint,
          accept: [],
        });
      }
      if (result.status !== "ok") {
        setDiagnostics(result.diagnostics);
        setError(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" "));
        if (result.diagnostics.some((d) => d.code === "REVISION_CONFLICT")) {
          setConflictKind(
            source ? "source" : (draftKind ?? (options.creation ? "creation" : "statement")),
          );
          setConflict(await read());
        }
        return;
      }
      published = true;
      if (!source && !options.creation) setPending(undefined);
      setEdge(undefined);
      if (source) setSourceDraft(undefined);
      if (options.creation) {
        setCreationDraft(undefined);
        setInitialValues([]);
      }
      if (draftKind === "state-machine") setStateMachineDraft(undefined);
      if (draftKind === "process") setProcessDraft(undefined);
      await onSaved();
    } catch (problem) {
      setError(
        published
          ? `Saved successfully, but editor inspection failed: ${problem instanceof Error ? problem.message : "Reload failed."} Inspect current source before another write.`
          : `${problem instanceof Error ? problem.message : "Save failed."} Inspect current source before any further write; the outcome may be uncertain.`,
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function previewElementDeletion() {
    if (!data || !selected || busy || disabled || !writable || pending || sourceDraft) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setConflict(undefined);
    try {
      const result = await call("editor/delete", {
        selector,
        revision: data.resource.revision,
        element: selected,
      });
      if (result.status !== "preview" || !result.data) {
        setDiagnostics(result.diagnostics);
        setError(
          result.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join(" "),
        );
        return;
      }
      setDiagnostics(result.diagnostics);
      setDeletionReview(result.data as unknown as ElementDeletionReview);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Deletion preview failed.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function cancelElementDeletion() {
    if (!deletionReview || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await call("resource/cancel", {
        schemaVersion: 1,
        handle: deletionReview.handle,
      });
      if (result.status !== "ok") {
        setDiagnostics(result.diagnostics);
        setError(
          result.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join(" "),
        );
        return;
      }
      setDeletionReview(undefined);
    } catch (problem) {
      setError(
        problem instanceof Error ? problem.message : "Deletion preview could not be cancelled.",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function confirmElementDeletion() {
    if (!deletionReview || busy || disabled) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await call("resource/apply", {
        schemaVersion: 1,
        handle: deletionReview.handle,
        fingerprint: deletionReview.preview.fingerprint,
        accept: ["confirm"],
      });
      if (result.status !== "ok") {
        setDiagnostics(result.diagnostics);
        setError(
          result.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join(" "),
        );
        setDeletionReview(undefined);
        if (result.diagnostics.some((diagnostic) => diagnostic.code === "REVISION_CONFLICT"))
          await read();
        return;
      }
      setDiagnostics(result.diagnostics);
      setDeletionReview(undefined);
      setSelected(undefined);
      setEdge(undefined);
      await read();
      await onSaved();
    } catch (problem) {
      setDeletionReview(undefined);
      setError(problem instanceof Error ? problem.message : "Element deletion failed.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  function edit(triple: Triple) {
    if (!data) return;
    setPending({
      revision: data.resource.revision,
      edit: { action: "replace", before: triple, after: triple },
    });
  }
  function add(
    predicate = "",
    object: EditorTerm = { kind: "literal", value: "", datatype: xsdString },
  ) {
    if (!data) return;
    setPending({
      revision: data.resource.revision,
      edit: {
        action: "add",
        after: {
          subject: selected ?? { kind: "iri", value: "" },
          predicate: { kind: "iri", value: predicate },
          object,
        },
      },
    });
  }
  function row(triple: Triple) {
    return (
      <li key={JSON.stringify(triple)}>
        <code>
          {text(triple.predicate)} {text(triple.object)}
        </code>
        {triple.object.kind === "blank" && (
          <button
            type="button"
            onClick={() => {
              setSelected(triple.object);
              setMode("canvas");
            }}
          >
            Explore blank node
          </button>
        )}
        <button
          type="button"
          disabled={!writable || busy || !!pending}
          onClick={() => edit(triple)}
        >
          Edit value
        </button>
        <button
          type="button"
          disabled={!writable || busy || !!pending}
          onClick={() =>
            data &&
            setPending({
              revision: data.resource.revision,
              edit: { action: "remove", before: triple },
            })
          }
        >
          Remove exact triple
        </button>
      </li>
    );
  }
  if (!data)
    return (
      <section aria-label="RDF editor">
        <p>{error || "Loading editor…"}</p>
      </section>
    );
  return (
    <section aria-label="RDF editor" className="rdf-editor">
      <h3>RDF editor</h3>
      <fieldset disabled={busy || disabled || !!deletionReview} className="editor-controls">
        {!writable && <p>Read only. Use editable import to change a locked snapshot.</p>}
        <fieldset aria-label="Editor mode">
          {["canvas", "Turtle", "forms"].map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "canvas" ? "Complete graph" : m === "forms" ? "Forms" : "Turtle source"}
            </button>
          ))}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <ul className="diagnostics">
          {diagnostics.map((d) => (
            <li key={JSON.stringify(d)}>
              <strong>
                {d.severity} · {d.code}
              </strong>{" "}
              {d.message}
            </li>
          ))}
        </ul>
        {conflict && (
          <section aria-label="Draft reconciliation">
            <h4>Source changed — draft retained</h4>
            <h5>Current source</h5>
            <pre>{conflict.sourceText}</pre>
            <h5>Your draft</h5>
            <pre>
              {conflictKind === "source"
                ? sourceDraft?.text
                : JSON.stringify(
                    conflictKind === "creation"
                      ? { ...creationDraft, initialValues }
                      : conflictKind === "state-machine"
                        ? stateMachineDraft
                        : conflictKind === "process"
                          ? processDraft
                          : pending?.edit,
                    null,
                    2,
                  )}
            </pre>
            <button
              type="button"
              onClick={() => {
                if (conflictKind === "source") setSourceDraft(undefined);
                if (conflictKind === "statement") setPending(undefined);
                if (conflictKind === "creation") {
                  setCreationDraft(undefined);
                  setInitialValues([]);
                }
                if (conflictKind === "state-machine") setStateMachineDraft(undefined);
                if (conflictKind === "process") setProcessDraft(undefined);
                setConflict(undefined);
                setError("");
              }}
            >
              Use current source
            </button>
            <button
              type="button"
              onClick={() => {
                if (sourceDraft && conflictKind === "source")
                  setSourceDraft({ ...sourceDraft, revision: conflict.resource.revision });
                if (pending && conflictKind === "statement")
                  setPending({ ...pending, revision: conflict.resource.revision });
                if (creationDraft && conflictKind === "creation")
                  setCreationDraft({ ...creationDraft, revision: conflict.resource.revision });
                if (stateMachineDraft && conflictKind === "state-machine")
                  setStateMachineDraft({
                    ...stateMachineDraft,
                    revision: conflict.resource.revision,
                  });
                if (processDraft && conflictKind === "process")
                  setProcessDraft({ ...processDraft, revision: conflict.resource.revision });
                setConflict(undefined);
                setError(
                  "Reviewed current revision. Save explicitly; another concurrent change can still conflict. Re-select changed blank nodes or removed statements.",
                );
              }}
            >
              Review and use current revision
            </button>
          </section>
        )}
        {mode === "Turtle" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                {
                  revision: sourceDraft?.revision ?? data.resource.revision,
                  sourceText: sourceDraft?.text ?? data.sourceText,
                },
                true,
              );
            }}
          >
            <label htmlFor="turtle-source">Turtle source</label>
            <textarea
              id="turtle-source"
              rows={18}
              spellCheck={false}
              readOnly={!writable}
              value={sourceDraft?.text ?? data.sourceText}
              onChange={(e) =>
                setSourceDraft({
                  text: e.target.value,
                  revision: sourceDraft?.revision ?? data.resource.revision,
                })
              }
            />
            <p>
              Source saves retain your exact text, including invalid Turtle. Graph and form editing
              resume after syntax is repaired.
            </p>
            <button type="submit" disabled={!writable || busy || !!conflict}>
              Save Turtle source
            </button>
            {sourceDraft && (
              <button
                type="button"
                onClick={() => {
                  setSourceDraft(undefined);
                  if (conflictKind === "source") setConflict(undefined);
                }}
              >
                Discard source draft
              </button>
            )}
          </form>
        ) : !data.parseable ? (
          <p>Repair Turtle syntax in the source editor before using graph or form edits.</p>
        ) : (
          <>
            {mode === "canvas" && (
              <>
                <p>
                  Complete source graph · Positions and design-rule choices are temporary until
                  saved in a view · Pan and zoom to explore
                </p>
                {designDiagnostics.length > 0 && (
                  <ul className="canvas-warnings" aria-label="Complete graph design warnings">
                    {designDiagnostics.map((diagnostic) => (
                      <li key={JSON.stringify(diagnostic)}>
                        <strong>{diagnostic.code}</strong> {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                )}
                {!!Object.values(designData?.designRuleOptions?.nodes ?? {}).some(
                  (rules) => rules.length > 1,
                ) && (
                  <fieldset aria-label="Temporary node design rule choices">
                    <legend>Temporary node design-rule choices</legend>
                    {Object.entries(designData?.designRuleOptions?.nodes ?? {})
                      .filter(([, rules]) => rules.length > 1)
                      .map(([element, rules]) => (
                        <label key={element}>
                          {element}
                          <select
                            aria-label={`Complete graph node design rule ${element}`}
                            value={
                              rules.some((rule) => rule.iri === designChoices.nodes[element])
                                ? designChoices.nodes[element]
                                : ""
                            }
                            onChange={(event) =>
                              onTemporaryDesignChoice("node", element, event.target.value)
                            }
                          >
                            <option value="">Generic appearance</option>
                            {rules.map((rule) => (
                              <option key={rule.iri} value={rule.iri}>
                                {rule.targetConcept ?? "Exact target"} · {rule.iri}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                  </fieldset>
                )}
                {!!Object.values(designData?.designRuleOptions?.relationships ?? {}).some(
                  (rules) => rules.length > 1,
                ) && (
                  <fieldset aria-label="Temporary relationship design rule choices">
                    <legend>Temporary relationship design-rule choices</legend>
                    {Object.entries(designData?.designRuleOptions?.relationships ?? {})
                      .filter(([, rules]) => rules.length > 1)
                      .map(([element, rules]) => (
                        <label key={element}>
                          {element}
                          <select
                            aria-label={`Complete graph relationship design rule ${element}`}
                            value={
                              rules.some(
                                (rule) => rule.iri === designChoices.relationships[element],
                              )
                                ? designChoices.relationships[element]
                                : ""
                            }
                            onChange={(event) =>
                              onTemporaryDesignChoice("relationship", element, event.target.value)
                            }
                          >
                            <option value="">Generic appearance</option>
                            {rules.map((rule) => (
                              <option key={rule.iri} value={rule.iri}>
                                {rule.targetConcept ?? "Exact predicate"} · {rule.iri}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                  </fieldset>
                )}
                <div className="rdf-canvas">
                  <ReactFlow
                    nodes={canvasNodes}
                    edges={canvasEdges}
                    edgeTypes={edgeTypes}
                    onNodesChange={onNodesChange}
                    onNodeClick={(_, node) => {
                      setSelected(JSON.parse(node.id) as EditorTerm);
                      setEdge(undefined);
                    }}
                    onEdgeClick={(_, clicked) => {
                      const triple = JSON.parse(clicked.id) as Triple;
                      setEdge(triple);
                      setSelected(triple.subject);
                    }}
                    nodesConnectable={false}
                    deleteKeyCode={null}
                    fitView
                  >
                    <Background />
                    <Controls />
                  </ReactFlow>
                </div>
              </>
            )}
            <label>
              Selected resource
              <select
                aria-label="Selected resource"
                value={selected ? key(selected) : ""}
                onChange={(e) => {
                  setSelected(
                    e.target.value ? (JSON.parse(e.target.value) as EditorTerm) : undefined,
                  );
                  setEdge(undefined);
                  setSection("");
                }}
              >
                <option value="">Select a resource</option>
                {selectableResources.map(([id, term]) => (
                  <option key={id} value={id}>
                    {text(term)}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <section aria-label="Source-element deletion">
                <h4>Delete source element</h4>
                {data.resource.identity === "declared" &&
                data.resource.graphIri === selected.value ? (
                  <p>Managed graph roots are removed through resource lifecycle controls.</p>
                ) : (
                  <>
                    <p>
                      Review every statement in this source graph that uses the selected resource as
                      subject, predicate, or object. Other graphs remain unchanged.
                    </p>
                    {selectableResources.some(
                      ([, term]) =>
                        term.kind === "iri" &&
                        term.value === selected.value &&
                        !projection.nodes.some((node) => node.id === key(term)),
                    ) && (
                      <p>
                        This resource may be used as a predicate without appearing as a canvas node.
                      </p>
                    )}
                    {selected.kind === "blank" && (
                      <p>Blank-node identity is bound to this source graph revision.</p>
                    )}
                    <button
                      type="button"
                      disabled={!writable || busy || disabled || !!pending || !!sourceDraft}
                      onClick={() => void previewElementDeletion()}
                    >
                      Preview source-element deletion
                    </button>
                  </>
                )}
              </section>
            )}
            {edge && (
              <section aria-label="Selected exact edge">
                <h4>Selected exact edge</h4>
                <code>
                  {text(edge.subject)} {text(edge.predicate)} {text(edge.object)}
                </code>
                <button
                  type="button"
                  disabled={!writable || busy || !!pending}
                  onClick={() => edit(edge)}
                >
                  Edit selected edge
                </button>
                <button
                  type="button"
                  disabled={!writable || busy || !!pending}
                  onClick={() =>
                    setPending({
                      revision: data.resource.revision,
                      edit: { action: "remove", before: edge },
                    })
                  }
                >
                  Remove selected edge
                </button>
              </section>
            )}
            {mode === "forms" &&
              (binding ? (
                <>
                  <label>
                    Applicable type section
                    <select
                      aria-label="Applicable type section"
                      value={binding.type}
                      onChange={(e) => setSection(e.target.value)}
                    >
                      {sections.map((s) => (
                        <option key={s.type} value={s.type}>
                          {s.label} · {s.type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Every explicit type remains intact. Unsupported values stay available through
                    generic editing.
                  </p>
                  {binding.fields
                    .filter(
                      (field) =>
                        data.resource.kind !== "process-model" ||
                        !processAssociationFields.has(field),
                    )
                    .map((field) => (
                      <section key={field}>
                        <h4>{field}</h4>
                        <ul>{statements.filter((q) => q.predicate.value === field).map(row)}</ul>
                        <button
                          type="button"
                          disabled={
                            !writable || busy || !!pending || !data.creationFields.includes(field)
                          }
                          onClick={() =>
                            add(
                              field,
                              field.endsWith("label") || field.endsWith("comment")
                                ? undefined
                                : field === processCondition
                                  ? { kind: "literal", value: "", datatype: xsdString }
                                  : { kind: "iri", value: "" },
                            )
                          }
                        >
                          Add field value
                        </button>
                      </section>
                    ))}
                </>
              ) : (
                <p>
                  No specialized section applies. Use the complete graph or generic RDF terms below.
                </p>
              ))}
            {mode === "forms" && data.resource.kind === "process-model" && (
              <ProcessForm
                data={data}
                selected={selected}
                writable={!!writable}
                busy={busy || disabled}
                pending={!!pending}
                draft={processDraft}
                setDraft={setProcessDraft}
                onSave={(options, draftKind) => save(options, false, draftKind)}
              />
            )}
            {selected && (
              <>
                <h4>
                  {mode === "canvas"
                    ? "RDF-term properties"
                    : "All existing statements / generic access"}
                </h4>
                <ul>{statements.map(row)}</ul>
              </>
            )}
            <button type="button" disabled={!writable || busy || !!pending} onClick={() => add()}>
              Add exact triple
            </button>
            {mode === "forms" && data.resource.kind === "state-machine-model" && (
              <StateMachineForm
                data={data}
                selected={selected}
                onSelect={(term) => {
                  setSelected(term);
                  setSection("");
                }}
                writable={writable}
                busy={busy || disabled}
                draft={stateMachineDraft}
                setDraft={setStateMachineDraft}
                onEdit={(edit) => setPending({ revision: data.resource.revision, edit })}
                onSave={(options, kind) => save(options, false, kind)}
              />
            )}
            {mode === "forms" &&
              writable &&
              data.resource.kind !== "state-machine-model" &&
              data.resource.kind !== "process-model" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const iri = creationDraft?.iri ?? "";
                    void save({
                      revision: creationDraft?.revision ?? data.resource.revision,
                      edits: initialValues.map((v) => ({
                        action: "add",
                        after: {
                          subject: { kind: "iri", value: iri },
                          predicate: { kind: "iri", value: v.predicate },
                          object: v.object,
                        },
                      })),
                      creation: {
                        iri,
                        type: creationDraft?.type ?? data.creationTypes[0]?.type ?? "",
                      },
                    });
                  }}
                >
                  <h4>Create typed resource</h4>
                  <label>
                    Resource IRI
                    <input
                      name="iri"
                      aria-label="New resource IRI"
                      value={creationDraft?.iri ?? ""}
                      required
                      onChange={(e) =>
                        setCreationDraft({
                          iri: e.target.value,
                          type: creationDraft?.type ?? data.creationTypes[0]?.type ?? "",
                          revision: creationDraft?.revision ?? data.resource.revision,
                        })
                      }
                    />
                  </label>
                  <label>
                    Exact type
                    <select
                      name="type"
                      aria-label="New resource type"
                      required
                      value={creationDraft?.type ?? data.creationTypes[0]?.type ?? ""}
                      onChange={(e) =>
                        setCreationDraft({
                          iri: creationDraft?.iri ?? "",
                          type: e.target.value,
                          revision: creationDraft?.revision ?? data.resource.revision,
                        })
                      }
                    >
                      {data.creationTypes.map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.label} · {t.type}
                        </option>
                      ))}
                    </select>
                  </label>
                  {initialValues.map((value) => (
                    <fieldset key={value.id}>
                      <legend>Initial field value</legend>
                      <label>
                        Exact field
                        <select
                          aria-label="Initial field predicate"
                          value={value.predicate}
                          onChange={(e) =>
                            setInitialValues((values) =>
                              values.map((v) =>
                                v.id === value.id
                                  ? {
                                      ...v,
                                      predicate: e.target.value,
                                      ...(e.target.value === rdfType
                                        ? {
                                            object: {
                                              kind: "iri" as const,
                                              value: data.creationClasses[0] ?? "",
                                            },
                                          }
                                        : {}),
                                    }
                                  : v,
                              ),
                            )
                          }
                        >
                          {data.creationFields.map((field) => (
                            <option key={field} value={field}>
                              {field}
                            </option>
                          ))}
                        </select>
                      </label>
                      {value.predicate === rdfType ? (
                        <label>
                          Initial exact class
                          <select
                            aria-label="Initial exact class"
                            value={value.object.value}
                            onChange={(e) =>
                              setInitialValues((values) =>
                                values.map((v) =>
                                  v.id === value.id
                                    ? { ...v, object: { kind: "iri", value: e.target.value } }
                                    : v,
                                ),
                              )
                            }
                          >
                            {data.creationClasses.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <TermInput
                          label="Initial object"
                          value={value.object}
                          scope={scope}
                          onChange={(object) =>
                            setInitialValues((values) =>
                              values.map((v) => (v.id === value.id ? { ...v, object } : v)),
                            )
                          }
                        />
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setInitialValues((values) => values.filter((v) => v.id !== value.id))
                        }
                      >
                        Discard initial value
                      </button>
                    </fieldset>
                  ))}
                  <button
                    type="button"
                    disabled={busy || !data.creationFields.length}
                    onClick={() => {
                      setCreationDraft(
                        creationDraft ?? {
                          iri: "",
                          type: data.creationTypes[0]?.type ?? "",
                          revision: data.resource.revision,
                        },
                      );
                      setInitialValues([
                        ...initialValues,
                        {
                          id: crypto.randomUUID(),
                          predicate: data.creationFields[0],
                          object:
                            data.creationFields[0] === rdfType
                              ? { kind: "iri", value: data.creationClasses[0] ?? "" }
                              : { kind: "literal", value: "", datatype: xsdString },
                        },
                      ]);
                    }}
                  >
                    Add initial value
                  </button>
                  {!data.creationTypes.length && (
                    <p>
                      No supported exact creation terms are available in this graph's vocabulary.
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={busy || !data.creationTypes.length || !!pending || !!conflict}
                  >
                    Create resource
                  </button>
                  {creationDraft && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreationDraft(undefined);
                        setInitialValues([]);
                        if (conflictKind === "creation") setConflict(undefined);
                      }}
                    >
                      Discard creation draft
                    </button>
                  )}
                </form>
              )}
          </>
        )}
        {pending && (
          <form
            aria-label="Exact statement draft"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ revision: pending.revision, edits: [pending.edit] });
            }}
          >
            <h4>
              {pending.edit.action === "remove"
                ? "Review exact triple removal"
                : "Exact statement draft"}
            </h4>
            {pending.edit.action === "remove" ? (
              <pre>{JSON.stringify(pending.edit.before, null, 2)}</pre>
            ) : (
              ["subject", "predicate", "object"].map((part) => {
                const position = part as keyof Triple;
                return (
                  <TermInput
                    key={part}
                    label={part}
                    value={
                      pending.edit.action === "remove"
                        ? pending.edit.before[position]
                        : pending.edit.after[position]
                    }
                    scope={scope}
                    resourceOnly={part === "subject"}
                    iriOnly={part === "predicate"}
                    onChange={(value) =>
                      setPending((p) =>
                        p && p.edit.action !== "remove"
                          ? { ...p, edit: { ...p.edit, after: { ...p.edit.after, [part]: value } } }
                          : p,
                      )
                    }
                  />
                );
              })
            )}
            <button type="submit" disabled={busy || !!conflict || !data.parseable}>
              {pending.edit.action === "remove" ? "Remove reviewed triple" : "Save exact statement"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPending(undefined);
                setConflict(undefined);
              }}
            >
              Discard statement draft
            </button>
          </form>
        )}
      </fieldset>
      {deletionReview && (
        <section aria-label="Source-element deletion review">
          <h4>Confirm source-element deletion</h4>
          <p>
            This removes only the reviewed statements from <code>{selector}</code> and synchronizes
            affected saved views. Other graph and configuration references remain unchanged.
          </p>
          <p>
            Selected resource: <code>{text(deletionReview.preview.arguments.element)}</code>
          </p>
          {deletionReview.projectValidity === "invalid" && (
            <p role="alert">
              The reviewed result remains invalid. Confirm only if you accept the listed
              diagnostics.
            </p>
          )}
          <h5>Exact source statements to remove</h5>
          <ol>
            {deletionReview.preview.arguments.statements.map((triple) => (
              <li key={JSON.stringify(triple)}>
                <code>
                  {text(triple.subject)} {text(triple.predicate)} {text(triple.object)}
                </code>
              </li>
            ))}
          </ol>
          <h5>Exact view references to remove during synchronization</h5>
          {deletionReview.preview.arguments.references.some(
            (reference) => reference.disposition === "synchronized",
          ) ? (
            <ul>
              {deletionReview.preview.arguments.references
                .filter((reference) => reference.disposition === "synchronized")
                .map((reference) => (
                  <li key={JSON.stringify(reference)}>
                    <code>{reference.selector}</code> · {reference.position}
                    {reference.configurationRole && ` · ${reference.configurationRole}`}
                    {reference.subject && reference.predicate && reference.object && (
                      <>
                        {" "}
                        ·{" "}
                        <code>
                          {text(reference.subject)} {text(reference.predicate)}{" "}
                          {text(reference.object)}
                        </code>
                      </>
                    )}
                  </li>
                ))}
            </ul>
          ) : (
            <p>No exact view references are scheduled for synchronization.</p>
          )}
          <h5>Other known references — unchanged</h5>
          {deletionReview.preview.arguments.references.some(
            (reference) => reference.disposition === "unchanged",
          ) ? (
            <ul>
              {deletionReview.preview.arguments.references
                .filter((reference) => reference.disposition === "unchanged")
                .map((reference) => (
                  <li key={JSON.stringify(reference)}>
                    <code>{reference.selector}</code> · {reference.position}
                    {reference.configurationRole && ` · ${reference.configurationRole}`}
                    {reference.subject && reference.predicate && reference.object && (
                      <>
                        {" "}
                        ·{" "}
                        <code>
                          {text(reference.subject)} {text(reference.predicate)}{" "}
                          {text(reference.object)}
                        </code>
                      </>
                    )}
                  </li>
                ))}
            </ul>
          ) : (
            <p>No other source, configuration, or locked dependency references were found.</p>
          )}
          <h5>Affected files</h5>
          <ul>
            {deletionReview.preview.impact.affectedFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => void confirmElementDeletion()}
          >
            Confirm source-element deletion
          </button>
          <button type="button" disabled={busy} onClick={() => void cancelElementDeletion()}>
            Cancel deletion preview
          </button>
        </section>
      )}
    </section>
  );
}
