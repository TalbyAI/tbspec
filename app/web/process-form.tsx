import type { EditingOptions, EditorData, EditorTerm, Triple } from "../src/editing.ts";
import type { ProcessAssociation } from "../src/process.ts";
import { pPlan, proc } from "../src/process.ts";
import type { ProcessDraft } from "./drafts.ts";

const xsdString = "http://www.w3.org/2001/XMLSchema#string";
const key = (term: EditorTerm) => JSON.stringify(term);
function termText(term: EditorTerm) {
  return term.kind === "iri"
    ? `<${term.value}>`
    : term.kind === "blank"
      ? `_:${term.value}`
      : `${JSON.stringify(term.value)}${term.language ? `@${term.language}` : `^^<${term.datatype}>`}`;
}
function tripleText(triple: Triple) {
  return `${termText(triple.subject)} ${termText(triple.predicate)} ${termText(triple.object)}`;
}
function chooseTerm(value: string) {
  return value ? (JSON.parse(value) as EditorTerm) : undefined;
}
function isType(data: EditorData, subject: EditorTerm | undefined, type: string) {
  return (
    !!subject &&
    data.sections.some(
      (section) =>
        section.type === type && section.subjects.some((term) => key(term) === key(subject)),
    )
  );
}
function associationTriple(
  kind: "input" | "output",
  step: EditorTerm,
  variable: EditorTerm,
): Triple {
  return {
    subject: step,
    predicate: { kind: "iri", value: `${pPlan}has${kind === "input" ? "Input" : "Output"}Var` },
    object: variable,
  };
}
function addEdit(triple: Triple) {
  return { action: "add" as const, after: triple };
}
function removeEdit(triple: Triple) {
  return { action: "remove" as const, before: triple };
}

export function ProcessForm({
  data,
  selected,
  writable,
  busy,
  pending,
  draft,
  setDraft,
  onSave,
}: {
  data: EditorData;
  selected?: EditorTerm;
  writable: boolean;
  busy: boolean;
  pending: boolean;
  draft?: ProcessDraft;
  setDraft: (draft: ProcessDraft | undefined) => void;
  onSave: (options: Omit<EditingOptions, "selector">, draftKind: "process") => Promise<void>;
}) {
  const selectedPlan = isType(data, selected, `${pPlan}Plan`);
  const selectedStep = data.processElements.steps.some(
    (term) => key(term) === key(selected ?? { kind: "iri", value: "" }),
  );
  const selectedVariable = isType(data, selected, `${pPlan}Variable`);
  const plans = data.processElements.plans;
  const steps = data.processElements.steps;
  const variables = data.processElements.variables;
  const selectedStepAssociations = data.processAssociations.filter(
    (association) => selected && key(association.step) === key(selected),
  );
  const selectedVariableAssociations = data.processAssociations.filter(
    (association) => selected && key(association.variable) === key(selected),
  );
  const type = draft?.kind === "creation" ? draft.type : "";
  const isFlow = type === `${proc}Flow`;
  const isStep = type === `${pPlan}Step` || type === `${proc}Decision`;
  const isVariable = type === `${pPlan}Variable`;
  const types = data.creationTypes.filter((item) => processCreationTypes.includes(item.type));

  function createDraft() {
    setDraft({
      kind: "creation",
      revision: data.resource.revision,
      iri: "",
      type: "",
    });
  }
  function startAssociation(relation: "input" | "output", side: "step" | "variable") {
    setDraft({
      kind: "association",
      action: "add",
      relation,
      revision: data.resource.revision,
      ...(side === "step" ? { step: selected } : { variable: selected }),
    });
  }
  function changeAssociation(association: ProcessAssociation) {
    setDraft({
      kind: "association",
      action: "change",
      relation: association.kind,
      revision: data.resource.revision,
      step: association.step,
      variable: association.variable,
      association,
    });
  }
  function removeAssociation(association: ProcessAssociation) {
    setDraft({
      kind: "association",
      action: "remove",
      relation: association.kind,
      revision: data.resource.revision,
      step: association.step,
      variable: association.variable,
      association,
    });
  }
  async function saveAssociation() {
    if (draft?.kind !== "association") return;
    if (draft.action === "remove") {
      if (!draft.association) return;
      await onSave(
        { revision: draft.revision, edits: draft.association.statements.map(removeEdit) },
        "process",
      );
      return;
    }
    if (draft.action === "change") {
      const association = draft.association;
      const replacement = draft.replacement;
      if (!association || !replacement) return;
      const replaceStep = !!selected && key(selected) === key(association.step);
      const step = replaceStep ? association.step : replacement;
      const variable = replaceStep ? replacement : association.variable;
      if (key(step) === key(association.step) && key(variable) === key(association.variable))
        return;
      await onSave(
        {
          revision: draft.revision,
          edits: [
            ...association.statements.map(removeEdit),
            addEdit(associationTriple(draft.relation, step, variable)),
          ],
        },
        "process",
      );
      return;
    }
    const step = draft.step ?? draft.replacement;
    const variable = draft.variable ?? draft.replacement;
    if (!step || !variable) return;
    await onSave(
      {
        revision: draft.revision,
        edits: [addEdit(associationTriple(draft.relation, step, variable))],
      },
      "process",
    );
  }
  async function saveCreation() {
    if (draft?.kind !== "creation" || !draft.type) return;
    const fields: [string, EditorTerm][] = [];
    if (isStep && draft.plan) fields.push([`${pPlan}isStepOfPlan`, draft.plan]);
    if (isVariable && draft.plan) fields.push([`${pPlan}isVariableOfPlan`, draft.plan]);
    if (isFlow && draft.plan && draft.source && draft.target) {
      fields.push(
        [`${proc}inPlan`, draft.plan],
        [`${proc}source`, draft.source],
        [`${proc}target`, draft.target],
      );
    }
    if (draft.condition) fields.push([`${proc}condition`, draft.condition]);
    await onSave(
      {
        revision: draft.revision,
        creation: { iri: draft.iri, type: draft.type },
        edits: fields.map(([predicate, object]) =>
          addEdit({
            subject: { kind: "iri", value: draft.iri },
            predicate: { kind: "iri", value: predicate },
            object,
          }),
        ),
      },
      "process",
    );
  }

  const createFieldsAvailable =
    draft?.kind !== "creation"
      ? false
      : draft.type === `${pPlan}Plan` ||
        ((isStep || isVariable) && !!draft.plan) ||
        (isFlow && !!draft.plan && !!draft.source && !!draft.target);
  const associationSelected = draft?.kind === "association";
  const replacementKind =
    draft?.kind === "association" &&
    ((draft.action === "change" &&
      selected &&
      draft.association &&
      key(selected) === key(draft.association.step)) ||
      (draft.action === "add" && draft.step))
      ? "variable"
      : "step";
  const replacementChoices = replacementKind === "variable" ? variables : steps;
  const associationStep =
    draft?.kind === "association"
      ? draft.action === "change" && draft.association
        ? replacementKind === "step" && draft.replacement
          ? draft.replacement
          : draft.association.step
        : (draft.step ?? draft.replacement)
      : undefined;
  const associationVariable =
    draft?.kind === "association"
      ? draft.action === "change" && draft.association
        ? replacementKind === "variable" && draft.replacement
          ? draft.replacement
          : draft.association.variable
        : (draft.variable ?? draft.replacement)
      : undefined;
  const associationCanSave =
    draft?.kind === "association" &&
    (draft.action === "remove" || !!draft.replacement || (!!draft.step && !!draft.variable));
  const memberships = selectedPlan
    ? data.triples.filter(
        (triple) =>
          key(triple.object) === key(selected ?? { kind: "iri", value: "" }) &&
          [`${pPlan}isStepOfPlan`, `${pPlan}isVariableOfPlan`].includes(triple.predicate.value),
      )
    : [];

  return (
    <>
      {selectedPlan && (
        <section aria-label="Plan members">
          <h4>Plan members</h4>
          <ul>
            {memberships.map((triple) => (
              <li key={JSON.stringify(triple)}>
                <code>{tripleText(triple)}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(selectedStep || selectedVariable) && (
        <section aria-label="Effective inputs and outputs">
          <h4>Effective inputs and outputs</h4>
          <ul>
            {(selectedStep ? selectedStepAssociations : selectedVariableAssociations).map(
              (association) => (
                <li
                  key={JSON.stringify([association.kind, association.step, association.variable])}
                >
                  <strong>{association.kind === "input" ? "Input" : "Output"}</strong>{" "}
                  <code>
                    {termText(association.step)} → {termText(association.variable)}
                  </code>
                  <details>
                    <summary>
                      Explicit supporting statements ({association.statements.length})
                    </summary>
                    {association.statements.map((triple) => (
                      <code key={JSON.stringify(triple)}>{tripleText(triple)}</code>
                    ))}
                  </details>
                  <button
                    type="button"
                    disabled={!writable || busy || pending}
                    onClick={() => changeAssociation(association)}
                  >
                    Change association
                  </button>
                  <button
                    type="button"
                    disabled={!writable || busy || pending}
                    onClick={() => removeAssociation(association)}
                  >
                    Remove association
                  </button>
                </li>
              ),
            )}
          </ul>
          {selectedStep && (
            <div>
              <button
                type="button"
                disabled={!writable || busy || pending || !variables.length}
                onClick={() => startAssociation("input", "step")}
              >
                Add input variable
              </button>
              <button
                type="button"
                disabled={!writable || busy || pending || !variables.length}
                onClick={() => startAssociation("output", "step")}
              >
                Add output variable
              </button>
            </div>
          )}
          {selectedVariable && (
            <div>
              <button
                type="button"
                disabled={!writable || busy || pending || !steps.length}
                onClick={() => startAssociation("input", "variable")}
              >
                Add consumer step
              </button>
              <button
                type="button"
                disabled={!writable || busy || pending || !steps.length}
                onClick={() => startAssociation("output", "variable")}
              >
                Add producer step
              </button>
            </div>
          )}
        </section>
      )}
      {associationSelected && draft && draft.kind === "association" && (
        <form
          aria-label="Process association draft"
          onSubmit={(event) => {
            event.preventDefault();
            void saveAssociation();
          }}
        >
          <h4>
            {draft.action === "remove"
              ? "Review association removal"
              : `${draft.action === "change" ? "Change" : "Add"} ${draft.relation} association`}
          </h4>
          {draft.action === "remove" ? (
            <ul>
              {draft.association?.statements.map((triple) => (
                <li key={JSON.stringify(triple)}>
                  <code>{tripleText(triple)}</code>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p>New associations are written only as Step-to-Variable statements.</p>
              <code>
                {associationStep ? termText(associationStep) : "Choose a Step"} — {draft.relation} —{" "}
                {associationVariable ? termText(associationVariable) : "Choose a Variable"}
              </code>
              <label>
                Choose {replacementKind === "step" ? "Step" : "Variable"}
                <select
                  aria-label={`Process association ${replacementKind}`}
                  required
                  value={draft.replacement ? key(draft.replacement) : ""}
                  onChange={(event) =>
                    setDraft({ ...draft, replacement: chooseTerm(event.target.value) })
                  }
                >
                  <option value="">
                    Choose {replacementKind === "step" ? "Step" : "Variable"}
                  </option>
                  {replacementChoices.map((term) => (
                    <option key={key(term)} value={key(term)}>
                      {termText(term)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button type="submit" disabled={!writable || busy || pending || !associationCanSave}>
            {draft.action === "remove"
              ? "Remove reviewed association"
              : draft.action === "change"
                ? "Save association change"
                : "Add association"}
          </button>
          <button type="button" disabled={busy} onClick={() => setDraft(undefined)}>
            Discard association draft
          </button>
        </form>
      )}
      {draft?.kind === "creation" && (
        <form
          aria-label="Process resource creation"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCreation();
          }}
        >
          <h4>Create process resource</h4>
          {!types.length && (
            <p>No exact process creation terms are available in this graph's vocabulary.</p>
          )}
          <label>
            Exact process type
            <select
              aria-label="Process resource type"
              required
              value={draft.type}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  type: event.target.value,
                  plan: undefined,
                  source: undefined,
                  target: undefined,
                  condition: undefined,
                })
              }
            >
              <option value="">Choose an exact type</option>
              {types.map((item) => (
                <option key={item.type} value={item.type}>
                  {item.label} · {item.type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resource IRI
            <input
              aria-label="New process resource IRI"
              required
              value={draft.iri}
              onChange={(event) => setDraft({ ...draft, iri: event.target.value })}
            />
          </label>
          {(isStep || isVariable || isFlow) && (
            <label>
              Exact Plan
              <select
                aria-label="Flow Plan"
                required
                value={draft.plan ? key(draft.plan) : ""}
                onChange={(event) => setDraft({ ...draft, plan: chooseTerm(event.target.value) })}
              >
                <option value="">Choose a Plan</option>
                {plans.map((plan) => (
                  <option key={key(plan)} value={key(plan)}>
                    {termText(plan)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isFlow && (
            <>
              <label>
                Source Step
                <select
                  aria-label="Flow source Step"
                  required
                  value={draft.source ? key(draft.source) : ""}
                  onChange={(event) =>
                    setDraft({ ...draft, source: chooseTerm(event.target.value) })
                  }
                >
                  <option value="">Choose source Step</option>
                  {steps.map((step) => (
                    <option key={key(step)} value={key(step)}>
                      {termText(step)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Target Step
                <select
                  aria-label="Flow target Step"
                  required
                  value={draft.target ? key(draft.target) : ""}
                  onChange={(event) =>
                    setDraft({ ...draft, target: chooseTerm(event.target.value) })
                  }
                >
                  <option value="">Choose target Step</option>
                  {steps.map((step) => (
                    <option key={key(step)} value={key(step)}>
                      {termText(step)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={!!draft.condition}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      condition: event.target.checked
                        ? { kind: "literal", value: "", datatype: xsdString }
                        : undefined,
                    })
                  }
                />
                Add optional Flow condition
              </label>
              {draft.condition?.kind === "literal" && (
                <>
                  <label>
                    Condition text
                    <input
                      aria-label="Flow condition text"
                      value={draft.condition.value}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          condition: {
                            kind: "literal",
                            value: event.target.value,
                            ...(draft.condition?.language
                              ? { language: draft.condition.language }
                              : { datatype: xsdString }),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Condition language
                    <input
                      aria-label="Flow condition language"
                      value={draft.condition.language ?? ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          condition: event.target.value
                            ? {
                                kind: "literal",
                                value: draft.condition?.value ?? "",
                                language: event.target.value,
                              }
                            : {
                                kind: "literal",
                                value: draft.condition?.value ?? "",
                                datatype: xsdString,
                              },
                        })
                      }
                    />
                  </label>
                </>
              )}
            </>
          )}
          <button
            type="submit"
            disabled={
              !writable ||
              busy ||
              pending ||
              !types.length ||
              !draft.type ||
              !draft.iri ||
              !createFieldsAvailable
            }
          >
            {isFlow
              ? "Create flow"
              : `Create ${types.find((item) => item.type === draft.type)?.label.toLowerCase() ?? "process resource"}`}
          </button>
          <button type="button" disabled={busy} onClick={() => setDraft(undefined)}>
            Discard creation draft
          </button>
        </form>
      )}
      {!draft && writable && (
        <button type="button" disabled={busy || pending || !types.length} onClick={createDraft}>
          Create process resource
        </button>
      )}
    </>
  );
}

const processCreationTypes = [
  `${pPlan}Plan`,
  `${pPlan}Step`,
  `${pPlan}Variable`,
  `${proc}Decision`,
  `${proc}Flow`,
];
