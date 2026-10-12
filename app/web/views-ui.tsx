import { Background, Controls, type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvasDesignChoices } from "./editor.tsx";

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
interface DesignData {
  resource: {
    selector: string;
    graphIri: string | null;
    ownership: "project" | "dependency";
    revision: Revision;
  };
  rules: {
    iri: string;
    kind: "node" | "edge" | "invalid";
    targetConcept: string | null;
    appearance: Record<string, Term>;
  }[];
  triples: Triple[];
}
type AppearanceValue = string | { value: string; language?: string };
interface Envelope {
  schemaVersion: number;
  status: string;
  data: Record<string, unknown> | null;
  diagnostics: { code: string; severity: string; message: string; file: string | null }[];
}
interface EffectiveRule {
  iri: string;
  targetConcept?: string;
  appearance: Record<string, Term>;
}
interface Pending {
  handle: string;
  fingerprint: string;
  accept: string[];
  route: string;
  preview: { changes: { file: string; action: string }[] };
}
const metadata = "https://talby.ai/ontology/tbspec#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const tupleKey = (tuple: ViewTuple) =>
  JSON.stringify([tuple.subject, tuple.predicate, tuple.object]);
const tupleLabel = (tuple: ViewTuple) => `${tuple.subject} ${tuple.predicate} ${tuple.object}`;
const nodeAppearanceFields = [
  "nodeShape",
  "fillColor",
  "strokeColor",
  "textColor",
  "strokeWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineStyle",
  "labelMode",
  "labelProperty",
  "labelText",
  "chosenRule",
  "group",
];
const edgeAppearanceFields = [
  "strokeColor",
  "textColor",
  "strokeWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineStyle",
  "edgeRouting",
  "arrowHead",
  "labelMode",
  "labelProperty",
  "labelText",
  "chosenRule",
];
const appearanceOptions: Record<string, string[]> = {
  nodeShape: ["rectangle", "rounded-rectangle", "ellipse", "diamond"],
  fontFamily: ["system-ui", "sans-serif", "serif", "monospace"],
  fontStyle: ["normal", "italic"],
  lineStyle: ["solid", "dashed", "dotted"],
  edgeRouting: ["straight", "bezier", "step"],
  arrowHead: ["none", "arrow"],
  labelMode: ["property", "local-name", "iri", "text", "none"],
};
const displayAppearance = (value: AppearanceValue | Term | null | undefined) =>
  typeof value === "string" ? value : (value?.value ?? "");
const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
function languageRank(language: string | undefined, preferences: readonly string[]) {
  if (!language) return preferences.length * 3;
  const candidate = language.toLowerCase();
  const index = preferences.findIndex((preference) => {
    const preferred = preference.toLowerCase();
    return (
      candidate === preferred ||
      candidate.startsWith(`${preferred}-`) ||
      preferred.startsWith(`${candidate}-`)
    );
  });
  if (index < 0) return preferences.length * 3 + 1;
  const preferred = preferences[index]?.toLowerCase() ?? "";
  return index * 3 + (candidate === preferred ? 0 : candidate.startsWith(`${preferred}-`) ? 1 : 2);
}
function compareLiteralTerms(left: Term, right: Term) {
  return (
    compareText(left.language ?? "", right.language ?? "") ||
    compareText(left.datatype ?? "", right.datatype ?? "") ||
    compareText(left.value, right.value)
  );
}
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const xsd = "http://www.w3.org/2001/XMLSchema#";
const rdfsLabel = "http://www.w3.org/2000/01/rdf-schema#label";
const colorValue = (value: AppearanceValue | Term | undefined, fallback: string) => {
  const color = displayAppearance(value);
  return /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(color) ? color : fallback;
};
const enumValue = (value: AppearanceValue | Term | undefined, values: string[]) => {
  const candidate = displayAppearance(value);
  return values.includes(candidate) ? candidate : undefined;
};
function appearanceFields(
  rule: EffectiveRule | undefined,
  local: Record<string, AppearanceValue | Term> = {},
) {
  return { ...(rule?.appearance ?? {}), ...local };
}
function termAppearance(
  values: Record<string, Term | AppearanceValue>,
  field: string,
): string | undefined {
  const value = values[field];
  if (!value) return undefined;
  return displayAppearance(value);
}
function localName(iri: string) {
  const tail = iri.slice(
    Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"), iri.lastIndexOf(":")) + 1,
  );
  return tail || iri;
}
function finiteAppearance(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numeric = Number(
    typeof value === "string"
      ? value
      : value && typeof value === "object" && "value" in value
        ? value.value
        : NaN,
  );
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? numeric : fallback;
}
function fontWeightAppearance(value: unknown) {
  const numeric = finiteAppearance(value, 400, 100, 900);
  return [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(numeric) ? numeric : 400;
}
function applyLocalEdits(
  base: Record<string, AppearanceValue> | undefined,
  edits: Record<string, AppearanceValue | null> | undefined,
) {
  const result = { ...(base ?? {}) };
  for (const [field, value] of Object.entries(edits ?? {})) {
    if (value === null) delete result[field];
    else result[field] = value;
  }
  return result;
}

export function ViewsPanel({
  session,
  onApplied,
  temporaryChoicesBySource,
  onTemporaryChoicesConsumed,
}: {
  session: string;
  onApplied: () => void;
  temporaryChoicesBySource: Record<string, CanvasDesignChoices>;
  onTemporaryChoicesConsumed: (source: string) => void;
}) {
  const [items, setItems] = useState<{ selector: string; source: string; presentation: string }[]>(
    [],
  );
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<ViewData>();
  const [sourceTriples, setSourceTriples] = useState<Triple[]>([]);
  const [vocabularyTriples, setVocabularyTriples] = useState<Triple[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [relationships, setRelationships] = useState<ViewTuple[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: string; y: string }>>({});
  const [nodeAppearanceEdits, setNodeAppearanceEdits] = useState<
    Record<string, Record<string, AppearanceValue | null>>
  >({});
  const [relationshipAppearanceEdits, setRelationshipAppearanceEdits] = useState<
    Record<string, Record<string, AppearanceValue | null>>
  >({});
  const [nodeAppearances, setNodeAppearances] = useState<
    Record<string, Record<string, AppearanceValue>>
  >({});
  const [relationshipAppearances, setRelationshipAppearances] = useState<
    Record<string, Record<string, AppearanceValue>>
  >({});
  const [effectiveNodeRules, setEffectiveNodeRules] = useState<Record<string, EffectiveRule>>({});
  const [effectiveRelationshipRules, setEffectiveRelationshipRules] = useState<
    Record<string, EffectiveRule>
  >({});
  const [nodeRuleOptions, setNodeRuleOptions] = useState<Record<string, EffectiveRule[]>>({});
  const [relationshipRuleOptions, setRelationshipRuleOptions] = useState<
    Record<string, EffectiveRule[]>
  >({});
  const [designWarnings, setDesignWarnings] = useState<string[]>([]);
  const [designItems, setDesignItems] = useState<
    { selector: string; graphIri: string | null; ownership: "project" | "dependency" }[]
  >([]);
  const [design, setDesign] = useState<DesignData>();
  const [designPath, setDesignPath] = useState("designs/custom.ttl");
  const [designIri, setDesignIri] = useState("");
  const [designImportMode, setDesignImportMode] = useState(false);
  const [importSource, setImportSource] = useState("");
  const [ruleIri, setRuleIri] = useState("");
  const [ruleKind, setRuleKind] = useState<"node" | "edge">("node");
  const [ruleTarget, setRuleTarget] = useState("");
  const [ruleFieldValues, setRuleFieldValues] = useState<Record<string, string>>({});
  const [ruleOriginalValues, setRuleOriginalValues] = useState<Record<string, string>>({});
  const [designChoiceTarget, setDesignChoiceTarget] = useState("");
  const [designChoiceSelector, setDesignChoiceSelector] = useState("");
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
          result.diagnostics.map((item) => item.message).join(" ") || "Project operation failed.",
        );
      return result;
    },
    [session],
  );

  const refresh = useCallback(async () => {
    const [result, designs] = await Promise.all([call("views"), call("designs")]);
    setItems((result.data?.items as typeof items) ?? []);
    setDesignItems((designs.data?.items as typeof designItems) ?? []);
  }, [call]);

  const show = useCallback(
    async (selector: string) => {
      const result = await call(`view?selector=${encodeURIComponent(selector)}`);
      const selectedView = result.data as unknown as ViewData;
      setSelected(selector);
      setView(selectedView);
      setMembers(selectedView.members);
      setRelationships(selectedView.relationships);
      const temporaryChoices = temporaryChoicesBySource[selectedView.source];
      const savedChosenRecords = new Set(
        selectedView.presentation.triples
          .filter((triple) => triple.predicate.value === `${metadata}chosenRule`)
          .map((triple) => triple.subject.value),
      );
      const savedChosenNodes = new Set(
        selectedView.presentation.triples
          .filter(
            (triple) =>
              savedChosenRecords.has(triple.subject.value) &&
              triple.predicate.value === `${metadata}element` &&
              triple.object.kind === "iri",
          )
          .map((triple) => triple.object.value),
      );
      const savedChosenRelationships = new Set(
        selectedView.presentation.triples.flatMap((triple) => {
          if (
            !savedChosenRecords.has(triple.subject.value) ||
            !triple.predicate.value.startsWith(rdf)
          )
            return [];
          const descriptor = selectedView.presentation.triples.filter(
            (item) => item.subject.value === triple.subject.value,
          );
          const tuple: Partial<ViewTuple> = {};
          for (const item of descriptor) {
            const field = item.predicate.value.slice(rdf.length);
            if (["subject", "predicate", "object"].includes(field) && item.object.kind === "iri")
              tuple[field as "subject" | "predicate" | "object"] = item.object.value;
          }
          return tuple.subject && tuple.predicate && tuple.object
            ? [tupleKey(tuple as ViewTuple)]
            : [];
        }),
      );
      setNodeAppearanceEdits(
        Object.fromEntries(
          Object.entries(temporaryChoices?.nodes ?? {})
            .filter(
              ([element]) =>
                selectedView.members.includes(element) && !savedChosenNodes.has(element),
            )
            .map(([element, rule]) => [element, { chosenRule: rule }]),
        ),
      );
      const selectedRelationships = new Set(selectedView.relationships.map(tupleKey));
      setRelationshipAppearanceEdits(
        Object.fromEntries(
          Object.entries(temporaryChoices?.relationships ?? {})
            .filter(
              ([tuple]) => selectedRelationships.has(tuple) && !savedChosenRelationships.has(tuple),
            )
            .map(([tuple, rule]) => [tuple, { chosenRule: rule }]),
        ),
      );
      const sourceResult = await call(`graph?selector=${encodeURIComponent(selectedView.source)}`);
      setSourceTriples((sourceResult.data?.triples as Triple[]) ?? []);
      const sourceResource = sourceResult.data?.resource as
        | {
            associations?: { role: string; selector: string }[];
          }
        | undefined;
      const vocabularySelectors = [
        ...new Set(
          (sourceResource?.associations ?? [])
            .filter((association) => ["ontology", "schema"].includes(association.role))
            .map((association) => association.selector),
        ),
      ];
      const vocabularyResults = await Promise.all(
        vocabularySelectors.map((selector) =>
          call(`graph?selector=${encodeURIComponent(selector)}`).catch(() => undefined),
        ),
      );
      setVocabularyTriples(
        vocabularyResults.flatMap(
          (result) => (result?.data?.triples as Triple[] | undefined) ?? [],
        ),
      );
      const nodeFields = new Set([
        "nodeShape",
        "fillColor",
        "strokeColor",
        "textColor",
        "strokeWidth",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "lineStyle",
        "labelMode",
        "labelProperty",
        "labelText",
        "chosenRule",
        "group",
      ]);
      const edgeFields = new Set([
        "strokeColor",
        "textColor",
        "strokeWidth",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "lineStyle",
        "edgeRouting",
        "arrowHead",
        "labelMode",
        "labelProperty",
        "labelText",
        "chosenRule",
      ]);
      const nodeRecordIds = new Set(
        selectedView.presentation.triples
          .filter(
            (triple) =>
              triple.subject.value === selectedView.presentation.resource.graphIri &&
              triple.predicate.value === `${metadata}nodePresentation` &&
              triple.object.kind !== "literal",
          )
          .map((triple) => triple.object.value),
      );
      const edgeRecordIds = new Set(
        selectedView.presentation.triples
          .filter(
            (triple) =>
              triple.subject.value === selectedView.presentation.resource.graphIri &&
              triple.predicate.value === `${metadata}relationshipPresentation` &&
              triple.object.kind !== "literal",
          )
          .map((triple) => triple.object.value),
      );
      const coordinates: Record<string, { x: string; y: string }> = {};
      const records = new Map<string, { element?: string; x?: string; y?: string }>();
      const nodeStyles = new Map<string, Record<string, AppearanceValue>>();
      const edgeStyles = new Map<string, Record<string, AppearanceValue>>();
      const edgeRecords = new Map<
        string,
        { subject?: string; predicate?: string; object?: string }
      >();
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
        if (nodeRecordIds.has(subject)) {
          const field = predicate.startsWith(metadata) ? predicate.slice(metadata.length) : "";
          if (nodeFields.has(field)) {
            const appearance = nodeStyles.get(subject) ?? {};
            appearance[field] = triple.object.language
              ? { value: triple.object.value, language: triple.object.language }
              : triple.object.value;
            nodeStyles.set(subject, appearance);
          }
        }
        if (edgeRecordIds.has(subject)) {
          const tupleField = predicate.startsWith("http://www.w3.org/1999/02/22-rdf-syntax-ns#")
            ? predicate.slice("http://www.w3.org/1999/02/22-rdf-syntax-ns#".length)
            : "";
          const tuple = edgeRecords.get(subject) ?? {};
          if (
            ["subject", "predicate", "object"].includes(tupleField) &&
            triple.object.kind === "iri"
          )
            tuple[tupleField as "subject" | "predicate" | "object"] = triple.object.value;
          edgeRecords.set(subject, tuple);
          const field = predicate.startsWith(metadata) ? predicate.slice(metadata.length) : "";
          if (edgeFields.has(field)) {
            const appearance = edgeStyles.get(subject) ?? {};
            appearance[field] = triple.object.language
              ? { value: triple.object.value, language: triple.object.language }
              : triple.object.value;
            edgeStyles.set(subject, appearance);
          }
        }
      }
      for (const record of records.values())
        if (record.element) coordinates[record.element] = { x: record.x ?? "", y: record.y ?? "" };
      setPositions(coordinates);
      const stylesByElement: Record<string, Record<string, AppearanceValue>> = {};
      for (const [recordId, appearance] of nodeStyles) {
        const element = records.get(recordId)?.element;
        if (element) stylesByElement[element] = appearance;
      }
      const stylesByTuple: Record<string, Record<string, AppearanceValue>> = {};
      for (const [recordId, tuple] of edgeRecords)
        if (tuple.subject && tuple.predicate && tuple.object)
          stylesByTuple[tupleKey(tuple as ViewTuple)] = edgeStyles.get(recordId) ?? {};
      setNodeAppearances(stylesByElement);
      setRelationshipAppearances(stylesByTuple);
      try {
        const validation = await call(
          `validate?selector=${encodeURIComponent(selectedView.presentation.resource.selector)}`,
        );
        const effective = validation.data as
          | {
              effectivePresentation?: {
                nodes: Record<string, EffectiveRule>;
                relationships: Record<string, EffectiveRule>;
              };
              designRuleOptions?: {
                nodes: Record<string, EffectiveRule[]>;
                relationships: Record<string, EffectiveRule[]>;
              };
            }
          | undefined;
        setEffectiveNodeRules(effective?.effectivePresentation?.nodes ?? {});
        setEffectiveRelationshipRules(effective?.effectivePresentation?.relationships ?? {});
        setNodeRuleOptions(effective?.designRuleOptions?.nodes ?? {});
        setRelationshipRuleOptions(effective?.designRuleOptions?.relationships ?? {});
        setDesignWarnings([
          ...new Set(
            validation.diagnostics
              .filter(
                (diagnostic) =>
                  diagnostic.code.startsWith("DESIGN_RULE_") ||
                  diagnostic.code === "DESIGN_CONFLICT" ||
                  diagnostic.code === "PRESENTATION_INVALID",
              )
              .map((diagnostic) => diagnostic.message),
          ),
        ]);
      } catch (problem) {
        setEffectiveNodeRules({});
        setEffectiveRelationshipRules({});
        setNodeRuleOptions({});
        setRelationshipRuleOptions({});
        setDesignWarnings([
          problem instanceof Error ? problem.message : "Design rules could not be resolved.",
        ]);
      }
    },
    [call, temporaryChoicesBySource],
  );

  const showDesign = useCallback(
    async (selector: string) => {
      const result = await call(`design?selector=${encodeURIComponent(selector)}`);
      setDesign(result.data as unknown as DesignData);
      setRuleIri("");
      setRuleTarget("");
      setRuleFieldValues({});
      setRuleOriginalValues({});
      setMessage("");
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
  const canvasNodes = useMemo<Node[]>(
    () =>
      members.map((member, index) => {
        const local = applyLocalEdits(nodeAppearances[member], nodeAppearanceEdits[member]);
        const selectedRule = displayAppearance(local.chosenRule);
        const rule = selectedRule
          ? (nodeRuleOptions[member]?.find((candidate) => candidate.iri === selectedRule) ??
            effectiveNodeRules[member])
          : effectiveNodeRules[member];
        const fields = appearanceFields(rule, local);
        const rawPosition = positions[member];
        const x = Number(rawPosition?.x);
        const y = Number(rawPosition?.y);
        const position =
          rawPosition && Number.isFinite(x) && Number.isFinite(y)
            ? { x, y }
            : { x: (index % 4) * 220, y: Math.floor(index / 4) * 145 };
        const fill = colorValue(fields.fillColor, "#ffffff");
        const stroke = colorValue(fields.strokeColor, "#526477");
        const color = colorValue(fields.textColor, "#172536");
        const shape =
          enumValue(fields.nodeShape, appearanceOptions.nodeShape ?? []) ?? "rounded-rectangle";
        const mode = enumValue(fields.labelMode, appearanceOptions.labelMode ?? []) ?? "property";
        const ruleMode = termAppearance(rule?.appearance ?? {}, "labelMode");
        const localMode = local.labelMode;
        const modeChanged =
          localMode !== undefined &&
          displayAppearance(localMode) !== String(ruleMode ?? "property");
        const explicitText = local.labelText ?? (modeChanged ? undefined : fields.labelText);
        const labelProperty =
          local.labelProperty ?? (modeChanged ? undefined : fields.labelProperty);
        const text =
          mode === "none"
            ? ""
            : mode === "iri"
              ? member
              : mode === "local-name"
                ? localName(member)
                : mode === "text"
                  ? displayAppearance(explicitText)
                  : (sourceTriples
                      .filter(
                        (triple) =>
                          triple.subject.value === member &&
                          triple.predicate.value ===
                            (displayAppearance(labelProperty) || rdfsLabel) &&
                          triple.object.kind === "literal",
                      )
                      .sort((left, right) => {
                        const leftLang = left.object.language;
                        const rightLang = right.object.language;
                        const preferred = navigator.languages ?? [navigator.language];
                        const leftRank = languageRank(leftLang, preferred);
                        const rightRank = languageRank(rightLang, preferred);
                        return (
                          leftRank - rightRank || compareLiteralTerms(left.object, right.object)
                        );
                      })[0]?.object.value ?? localName(member));
        const group = displayAppearance(local.group);
        const style: Node["style"] = {
          backgroundColor: fill,
          color,
          borderColor: stroke,
          borderWidth: finiteAppearance(fields.strokeWidth, 1, 0, 100),
          borderStyle: enumValue(fields.lineStyle, appearanceOptions.lineStyle ?? []) ?? "solid",
          borderRadius: shape === "ellipse" ? "50%" : shape === "rounded-rectangle" ? 12 : 3,
          ...(shape === "diamond" ? { clipPath: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" } : {}),
          fontFamily:
            enumValue(fields.fontFamily, appearanceOptions.fontFamily ?? []) ?? "system-ui",
          fontSize: finiteAppearance(fields.fontSize, 14, 1, 200),
          fontWeight: fontWeightAppearance(fields.fontWeight),
          fontStyle: enumValue(fields.fontStyle, appearanceOptions.fontStyle ?? []) ?? "normal",
          minWidth: 120,
          padding: 8,
        };
        return {
          id: member,
          position,
          data: {
            label: (
              <span className="view-node-label">
                {text}
                {group && <small>{group}</small>}
              </span>
            ),
          },
          style,
        };
      }),
    [
      members,
      nodeAppearances,
      nodeAppearanceEdits,
      effectiveNodeRules,
      nodeRuleOptions,
      positions,
      sourceTriples,
    ],
  );
  const canvasEdges = useMemo<Edge[]>(
    () =>
      relationships.map((tuple) => {
        const key = tupleKey(tuple);
        const local = applyLocalEdits(
          relationshipAppearances[key],
          relationshipAppearanceEdits[key],
        );
        const selectedRule = displayAppearance(local.chosenRule);
        const rule = selectedRule
          ? (relationshipRuleOptions[key]?.find((candidate) => candidate.iri === selectedRule) ??
            effectiveRelationshipRules[key])
          : effectiveRelationshipRules[key];
        const fields = appearanceFields(rule, local);
        const stroke = colorValue(fields.strokeColor, "#526477");
        const mode = enumValue(fields.labelMode, appearanceOptions.labelMode ?? []) ?? "property";
        const ruleMode = termAppearance(rule?.appearance ?? {}, "labelMode");
        const localMode = local.labelMode;
        const modeChanged =
          localMode !== undefined &&
          displayAppearance(localMode) !== String(ruleMode ?? "property");
        const explicitText = local.labelText ?? (modeChanged ? undefined : fields.labelText);
        const labelProperty =
          local.labelProperty ?? (modeChanged ? undefined : fields.labelProperty);
        const label =
          mode === "none"
            ? ""
            : mode === "iri"
              ? tuple.predicate
              : mode === "local-name"
                ? localName(tuple.predicate)
                : mode === "text"
                  ? displayAppearance(explicitText)
                  : ([...sourceTriples, ...vocabularyTriples]
                      .filter(
                        (triple) =>
                          triple.subject.value === tuple.predicate &&
                          triple.predicate.value ===
                            (displayAppearance(labelProperty) || rdfsLabel) &&
                          triple.object.kind === "literal",
                      )
                      .sort((left, right) => {
                        const leftLang = left.object.language;
                        const rightLang = right.object.language;
                        const preferred = navigator.languages ?? [navigator.language];
                        const leftRank = languageRank(leftLang, preferred);
                        const rightRank = languageRank(rightLang, preferred);
                        return (
                          leftRank - rightRank || compareLiteralTerms(left.object, right.object)
                        );
                      })[0]?.object.value ?? localName(tuple.predicate));
        const routing = enumValue(fields.edgeRouting, appearanceOptions.edgeRouting ?? []);
        const type = routing === "straight" ? "straight" : routing === "step" ? "step" : "default";
        return {
          id: tupleKey(tuple),
          source: tuple.subject,
          target: tuple.object,
          label,
          type,
          markerEnd:
            enumValue(fields.arrowHead, appearanceOptions.arrowHead ?? []) === "none"
              ? undefined
              : { type: MarkerType.Arrow, color: stroke },
          style: {
            stroke,
            strokeWidth: finiteAppearance(fields.strokeWidth, 1.5, 0, 100),
            strokeDasharray:
              enumValue(fields.lineStyle, appearanceOptions.lineStyle ?? []) === "dashed"
                ? "6 4"
                : enumValue(fields.lineStyle, appearanceOptions.lineStyle ?? []) === "dotted"
                  ? "2 4"
                  : undefined,
          },
          labelStyle: {
            fill: colorValue(fields.textColor, "#172536"),
            fontFamily:
              enumValue(fields.fontFamily, appearanceOptions.fontFamily ?? []) ?? "system-ui",
            fontSize: finiteAppearance(fields.fontSize, 12, 1, 200),
            fontWeight: fontWeightAppearance(fields.fontWeight),
            fontStyle: enumValue(fields.fontStyle, appearanceOptions.fontStyle ?? []) ?? "normal",
          },
        };
      }),
    [
      relationships,
      relationshipAppearances,
      relationshipAppearanceEdits,
      effectiveRelationshipRules,
      relationshipRuleOptions,
      sourceTriples,
      vocabularyTriples,
    ],
  );

  async function preview(route: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const result = await call(route, body);
      if (result.status !== "preview" || !result.data) {
        setMessage(
          result.diagnostics.map((item) => `${item.code}: ${item.message}`).join(" ") ||
            "Project preview was not prepared.",
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
        route,
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
      if (design) await showDesign(design.resource.selector);
      if (selected && !pending.accept.includes("confirm")) {
        await show(selected);
        if (pending.route === "view/edit" && view?.source) onTemporaryChoicesConsumed(view.source);
      } else {
        setView(undefined);
        setSelected("");
      }
      setMessage("Project files were updated.");
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

  function editAppearance(kind: "node" | "edge", key: string, field: string, value: string) {
    const current =
      kind === "node" ? nodeAppearances[key]?.[field] : relationshipAppearances[key]?.[field];
    const edited: AppearanceValue | null =
      value === ""
        ? null
        : field === "labelText" && current && typeof current !== "string" && current.language
          ? { value, language: current.language }
          : value;
    if (kind === "node")
      setNodeAppearanceEdits((items) => ({
        ...items,
        [key]: { ...items[key], [field]: edited },
      }));
    else
      setRelationshipAppearanceEdits((items) => ({
        ...items,
        [key]: { ...items[key], [field]: edited },
      }));
  }

  function selectRule(iri: string) {
    const selectedRule = design?.rules.find((item) => item.iri === iri);
    setRuleIri(iri);
    setRuleKind(selectedRule?.kind === "edge" ? "edge" : "node");
    setRuleTarget(selectedRule?.targetConcept ?? "");
    const values = Object.fromEntries(
      Object.entries(selectedRule?.appearance ?? {}).map(([field, term]) => [field, term.value]),
    );
    setRuleFieldValues(values);
    setRuleOriginalValues({ ...values, targetConcept: selectedRule?.targetConcept ?? "" });
  }

  async function previewRuleSave() {
    if (!design || !ruleIri.trim() || !ruleTarget.trim()) {
      setMessage("Choose an editable design, an absolute rule IRI and an exact target IRI.");
      return;
    }
    const selectedRule = design.rules.find((item) => item.iri === ruleIri);
    const edits: { action: "add" | "remove"; after?: Triple; before?: Triple }[] = [];
    const removePredicate = (predicate: string) => {
      for (const triple of design.triples) {
        if (
          triple.subject.kind === "iri" &&
          triple.subject.value === ruleIri &&
          triple.predicate.value === predicate
        )
          edits.push({ action: "remove", before: triple });
      }
    };
    const add = (predicate: string, object: Term) =>
      edits.push({
        action: "add",
        after: {
          subject: { kind: "iri", value: ruleIri },
          predicate: { kind: "iri", value: predicate },
          object,
        },
      });
    const visualKind = ruleKind === "node" ? "NodeVisualRule" : "EdgeVisualRule";
    if (!selectedRule || selectedRule.kind !== ruleKind) {
      removePredicate(rdfType);
      add(rdfType, { kind: "iri", value: `${metadata}${visualKind}` });
    }
    if (!selectedRule || selectedRule.targetConcept !== ruleTarget) {
      removePredicate(`${metadata}targetConcept`);
      add(`${metadata}targetConcept`, { kind: "iri", value: ruleTarget });
    }
    const fields =
      ruleKind === "node"
        ? nodeAppearanceFields.filter((field) => field !== "chosenRule" && field !== "group")
        : edgeAppearanceFields;
    for (const field of fields) {
      const value = ruleFieldValues[field] ?? "";
      const oldValue = ruleOriginalValues[field] ?? "";
      if (selectedRule && value === oldValue) continue;
      removePredicate(`${metadata}${field}`);
      if (!value) continue;
      const isIri = field === "labelProperty";
      const datatype =
        field === "fontWeight"
          ? `${xsd}integer`
          : ["fontSize", "strokeWidth"].includes(field)
            ? `${xsd}double`
            : `${xsd}string`;
      add(
        `${metadata}${field}`,
        isIri ? { kind: "iri", value } : { kind: "literal", value, datatype },
      );
    }
    await preview("editor/save", {
      selector: design.resource.selector,
      revision: design.resource.revision,
      edits,
    });
  }

  function appearanceControl(kind: "node" | "edge", key: string, field: string) {
    const edits = kind === "node" ? nodeAppearanceEdits[key] : relationshipAppearanceEdits[key];
    const current = kind === "node" ? nodeAppearances[key] : relationshipAppearances[key];
    const controlId = `view-${kind}-${encodeURIComponent(key)}-${field}`;
    const value = Object.hasOwn(edits ?? {}, field)
      ? displayAppearance(edits?.[field])
      : displayAppearance(current?.[field]);
    return (
      <div key={`${key}:${field}`}>
        <label htmlFor={controlId}>{field}</label>
        {field === "chosenRule" ? (
          <select
            id={controlId}
            aria-label={`${kind} chosenRule ${key}`}
            value={value}
            disabled={busy || !!pending}
            onChange={(event) => editAppearance(kind, key, field, event.target.value)}
          >
            <option value="">Use winning design rule</option>
            {(kind === "node"
              ? (nodeRuleOptions[key] ?? [])
              : (relationshipRuleOptions[key] ?? [])
            ).map((rule) => (
              <option key={rule.iri} value={rule.iri}>
                {rule.targetConcept ?? "Exact target"} · {rule.iri}
              </option>
            ))}
          </select>
        ) : appearanceOptions[field] ? (
          <select
            id={controlId}
            aria-label={`${kind} ${field} ${key}`}
            value={value}
            disabled={busy || !!pending}
            onChange={(event) => editAppearance(kind, key, field, event.target.value)}
          >
            <option value="">Use design or default</option>
            {appearanceOptions[field]?.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={controlId}
            aria-label={`${kind} ${field} ${key}`}
            value={value}
            disabled={busy || !!pending}
            onChange={(event) => editAppearance(kind, key, field, event.target.value)}
          />
        )}
      </div>
    );
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
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            required
            disabled={busy || !!pending}
          />
        </label>
        <label>
          Source selector
          <input
            value={source}
            disabled={busy || !!pending}
            onChange={(event) => setSource(event.target.value)}
            placeholder="models/example.ttl or dep:id/file.ttl"
            required
          />
        </label>
        <label>
          Optional project protocol selector
          <input
            value={protocol}
            onChange={(event) => setProtocol(event.target.value)}
            disabled={busy || !!pending}
          />
        </label>
        <button type="submit" disabled={busy || !!pending}>
          Preview view creation
        </button>
      </form>
      <h3>Reusable designs</h3>
      <p>
        Designs define exact-type node and edge rules. Rule fields use a fixed vocabulary; view
        overrides stay in each view presentation.
      </p>
      <form
        aria-label="Create or import design"
        onSubmit={(event) => {
          event.preventDefault();
          void preview(designImportMode ? "design/import" : "design/create", {
            path: designPath,
            ...(designIri.trim() ? { iri: designIri.trim() } : {}),
            ...(designImportMode ? { source: importSource.trim() } : {}),
          });
        }}
      >
        <label>
          Design file
          <input
            value={designPath}
            onChange={(event) => setDesignPath(event.target.value)}
            required
            disabled={busy || !!pending}
          />
        </label>
        <label>
          New design graph IRI
          <input
            value={designIri}
            onChange={(event) => setDesignIri(event.target.value)}
            disabled={busy || !!pending}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={designImportMode}
            disabled={busy || !!pending}
            onChange={(event) => setDesignImportMode(event.target.checked)}
          />
          Import an existing design
        </label>
        {designImportMode && (
          <label>
            Source design selector
            <input
              value={importSource}
              disabled={busy || !!pending}
              onChange={(event) => setImportSource(event.target.value)}
              placeholder="dep:id or dep:id/file-key"
              required
            />
          </label>
        )}
        <button type="submit" disabled={busy || !!pending}>
          Preview {designImportMode ? "design import" : "design creation"}
        </button>
      </form>
      {designItems.length ? (
        <ul className="resource-list">
          {designItems.map((item) => (
            <li key={item.selector}>
              <button
                type="button"
                disabled={busy || !!pending}
                onClick={() => void showDesign(item.selector)}
              >
                <strong>{item.selector}</strong>
                <span>{item.ownership === "project" ? "Owned design" : "Locked design"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No reusable designs are available.</p>
      )}
      <form
        aria-label="Choose a design for an exact type"
        onSubmit={(event) => {
          event.preventDefault();
          void preview("design/select", {
            path: designChoiceTarget.trim(),
            source: designChoiceSelector,
          });
        }}
      >
        <label>
          Exact target type IRI
          <input
            value={designChoiceTarget}
            disabled={busy || !!pending}
            onChange={(event) => setDesignChoiceTarget(event.target.value)}
            required
          />
        </label>
        <label>
          Design selector
          <select
            value={designChoiceSelector}
            disabled={busy || !!pending}
            onChange={(event) => setDesignChoiceSelector(event.target.value)}
            required
          >
            <option value="">Choose a design</option>
            {designItems.map((item) => (
              <option key={item.selector} value={item.selector}>
                {item.selector}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy || !!pending || !designChoiceTarget}>
          Preview exact type design choice
        </button>
        <button
          type="button"
          disabled={busy || !!pending || !designChoiceTarget}
          onClick={() => void preview("design/clear", { path: designChoiceTarget.trim() })}
        >
          Preview design choice removal
        </button>
      </form>
      {design && (
        <section aria-label={`Design ${design.resource.selector}`}>
          <h3>{design.resource.selector}</h3>
          <p>
            Graph: <code>{design.resource.graphIri}</code> ·{" "}
            {design.resource.ownership === "project"
              ? "owned and editable"
              : "locked and read-only"}
          </p>
          <label>
            Existing rule
            <select
              value={ruleIri}
              disabled={busy || !!pending}
              onChange={(event) => selectRule(event.target.value)}
            >
              <option value="">Create a new rule</option>
              {design.rules.map((rule) => (
                <option key={rule.iri} value={rule.iri}>
                  {rule.kind} · {rule.targetConcept ?? "missing target"} · {rule.iri}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={busy || !!pending || design.resource.ownership !== "project"}>
            <legend>Visual rule</legend>
            <label>
              Rule IRI
              <input
                value={ruleIri}
                onChange={(event) => setRuleIri(event.target.value)}
                required
              />
            </label>
            <label>
              Exact target class or property IRI
              <input
                value={ruleTarget}
                onChange={(event) => setRuleTarget(event.target.value)}
                required
              />
            </label>
            <label>
              Rule kind
              <select
                value={ruleKind}
                disabled={!!design.rules.some((rule) => rule.iri === ruleIri)}
                onChange={(event) => setRuleKind(event.target.value as "node" | "edge")}
              >
                <option value="node">Node</option>
                <option value="edge">Edge</option>
              </select>
            </label>
            {(ruleKind === "node"
              ? nodeAppearanceFields.filter((field) => !["chosenRule", "group"].includes(field))
              : edgeAppearanceFields
            ).map((field) => (
              <div key={field}>
                <label htmlFor={`design-rule-${field}`}>{field}</label>
                {appearanceOptions[field] ? (
                  <select
                    id={`design-rule-${field}`}
                    value={ruleFieldValues[field] ?? ""}
                    onChange={(event) =>
                      setRuleFieldValues((values) => ({ ...values, [field]: event.target.value }))
                    }
                  >
                    <option value="">Inherit</option>
                    {appearanceOptions[field]?.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`design-rule-${field}`}
                    value={ruleFieldValues[field] ?? ""}
                    onChange={(event) =>
                      setRuleFieldValues((values) => ({ ...values, [field]: event.target.value }))
                    }
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={busy || !!pending}
              onClick={() => void previewRuleSave()}
            >
              Preview rule changes
            </button>
          </fieldset>
          {design.resource.ownership === "project" && (
            <button
              type="button"
              disabled={busy || !!pending}
              onClick={() =>
                void preview("resources/remove", {
                  kind: "design",
                  selector: design.resource.selector,
                })
              }
            >
              Preview design removal
            </button>
          )}
        </section>
      )}
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
          <section aria-label="View canvas">
            <h4>View canvas</h4>
            {designWarnings.length > 0 && (
              <ul className="canvas-warnings" aria-label="Canvas design warnings">
                {designWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="view-canvas">
              <ReactFlow
                nodes={canvasNodes}
                edges={canvasEdges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </div>
          </section>
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
          <fieldset>
            <legend>Node appearance overrides</legend>
            <p>
              Blank values remove this view’s override and return to its effective design/default.
            </p>
            {members.map((member) => (
              <details key={member}>
                <summary>
                  <code>{member}</code>
                </summary>
                <div className="form-row">
                  {nodeAppearanceFields.map((field) => appearanceControl("node", member, field))}
                </div>
              </details>
            ))}
          </fieldset>
          <fieldset>
            <legend>Exact relationship appearance overrides</legend>
            {relationships.map((tuple) => (
              <details key={tupleKey(tuple)}>
                <summary>
                  <code>{tupleLabel(tuple)}</code>
                </summary>
                <div className="form-row">
                  {edgeAppearanceFields.map((field) =>
                    appearanceControl("edge", tupleKey(tuple), field),
                  )}
                </div>
              </details>
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
                nodeAppearances: Object.entries(nodeAppearanceEdits).map(([element, fields]) => ({
                  element,
                  ...fields,
                })),
                relationshipAppearances: Object.entries(relationshipAppearanceEdits)
                  .map(([key, fields]) => {
                    const tuple = relationships.find((item) => tupleKey(item) === key);
                    return tuple ? { ...tuple, ...fields } : null;
                  })
                  .filter((item) => item !== null),
              })
            }
          >
            Preview view and presentation changes
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
          <h3>Review project transaction</h3>
          <ul>
            {pending.preview.changes.map((change) => (
              <li key={change.file}>
                {change.action}: <code>{change.file}</code>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void apply()} disabled={busy}>
            {pending.accept.includes("confirm") ? "Confirm removal" : "Apply changes"}
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
