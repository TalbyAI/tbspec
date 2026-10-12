import type { Edit, EditingOptions, EditorData, EditorTerm } from "../src/editing.ts";
import type { StateMachineDraft } from "./drafts.ts";

const sm = "https://talby.ai/ontology/state-machine#";
const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const rdfs = "http://www.w3.org/2000/01/rdf-schema#";
const xsdString = "http://www.w3.org/2001/XMLSchema#string";
const stateTypes = [`${sm}State`, `${sm}InitialState`, `${sm}FinalState`];
const creationTerms = [
  { type: `${sm}StateMachine`, label: "State machine" },
  { type: `${sm}State`, label: "State" },
  { type: `${sm}InitialState`, label: "Initial state" },
  { type: `${sm}FinalState`, label: "Final state" },
  { type: `${sm}Transition`, label: "Transition" },
];
const id = (term: EditorTerm) => JSON.stringify(term);
const display = (term: EditorTerm) =>
  term.kind === "iri"
    ? `<${term.value}>`
    : term.kind === "blank"
      ? `_:${term.value}`
      : `${JSON.stringify(term.value)}${term.language ? `@${term.language}` : `^^<${term.datatype}>`}`;

function hasType(data: EditorData, subject: EditorTerm, type: string) {
  return data.triples.some(
    (triple) =>
      id(triple.subject) === id(subject) &&
      triple.predicate.value === rdfType &&
      triple.object.kind === "iri" &&
      triple.object.value === type,
  );
}

function typedSubjects(data: EditorData, types: string[]) {
  const subjects = new Map<string, EditorTerm>();
  for (const triple of data.triples)
    if (
      triple.predicate.value === rdfType &&
      triple.object.kind === "iri" &&
      types.includes(triple.object.value)
    )
      subjects.set(id(triple.subject), triple.subject);
  return [...subjects.values()];
}

export function StateMachineForm({
  data,
  selected,
  onSelect,
  writable,
  busy,
  draft,
  setDraft,
  onEdit,
  onSave,
}: {
  data: EditorData;
  selected?: EditorTerm;
  onSelect: (term: EditorTerm) => void;
  writable: boolean;
  busy: boolean;
  draft?: StateMachineDraft;
  setDraft: (draft: StateMachineDraft | undefined) => void;
  onEdit: (edit: Edit) => void;
  onSave: (options: Omit<EditingOptions, "selector">, draftKind: "state-machine") => Promise<void>;
}) {
  const machines = typedSubjects(data, [`${sm}StateMachine`]);
  const states = typedSubjects(data, stateTypes);
  const transitions = typedSubjects(data, [`${sm}Transition`]);
  const availableFields = new Set(data.creationFields);
  const availableTypes = new Set(data.creationTypes.map((item) => item.type));
  const createTypes = creationTerms.filter((item) => {
    if (!availableTypes.has(item.type)) return false;
    if (stateTypes.includes(item.type)) return availableFields.has(`${sm}inMachine`);
    if (item.type === `${sm}Transition`)
      return [`${sm}inMachine`, `${sm}source`, `${sm}target`].every((field) =>
        availableFields.has(field),
      );
    return true;
  });
  const blankCreation: Extract<StateMachineDraft, { kind: "creation" }> = {
    kind: "creation",
    revision: data.resource.revision,
    iri: "",
    type: createTypes[0]?.type ?? "",
    label: "",
    comment: "",
    event: "",
    condition: "",
    action: "",
  };
  const creation = draft?.kind === "creation" ? draft : blankCreation;
  const selectedMachine = creation.machine;
  const machineKey =
    selectedMachine && machines.some((term) => id(term) === id(selectedMachine))
      ? id(selectedMachine)
      : "";
  const statesInMachine = creation.machine
    ? states.filter((state) =>
        data.triples.some(
          (triple) =>
            id(triple.subject) === id(state) &&
            triple.predicate.value === `${sm}inMachine` &&
            id(triple.object) === id(creation.machine as EditorTerm),
        ),
      )
    : [];
  const selectedTypes = selected ? stateTypes.filter((type) => hasType(data, selected, type)) : [];
  const machineMembers =
    selected && hasType(data, selected, `${sm}StateMachine`)
      ? data.triples.filter(
          (triple) =>
            triple.predicate.value === `${sm}inMachine` &&
            id(triple.object) === id(selected) &&
            (states.some((term) => id(term) === id(triple.subject)) ||
              transitions.some((term) => id(term) === id(triple.subject))),
        )
      : [];
  const labelOf = (term: EditorTerm) =>
    data.triples.find(
      (triple) =>
        id(triple.subject) === id(term) &&
        triple.predicate.value === `${rdfs}label` &&
        triple.object.kind === "literal",
    )?.object.value ?? display(term);

  const updateCreation = (change: Partial<Extract<StateMachineDraft, { kind: "creation" }>>) =>
    setDraft({ ...creation, ...change });

  function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createTypes.some((item) => item.type === creation.type) || !creation.iri) return;
    const edits: Edit[] = [];
    const addField = (predicate: string, value: EditorTerm) => {
      if (availableFields.has(predicate))
        edits.push({
          action: "add",
          after: {
            subject: { kind: "iri", value: creation.iri },
            predicate: { kind: "iri", value: predicate },
            object: value,
          },
        });
    };
    const addText = (predicate: string, value: string) => {
      if (value) addField(predicate, { kind: "literal", value, datatype: xsdString });
    };
    const inMachine = stateTypes.includes(creation.type) || creation.type === `${sm}Transition`;
    if (inMachine && creation.machine) addField(`${sm}inMachine`, creation.machine);
    if (creation.type === `${sm}Transition`) {
      if (creation.source && creation.target) {
        addField(`${sm}source`, creation.source);
        addField(`${sm}target`, creation.target);
      } else return;
    }
    addText(`${rdfs}label`, creation.label);
    addText(`${rdfs}comment`, creation.comment);
    addText(`${sm}event`, creation.event);
    addText(`${sm}condition`, creation.condition);
    addText(`${sm}action`, creation.action);
    if (inMachine && !creation.machine) return;
    void onSave(
      {
        revision: creation.revision,
        creation: { iri: creation.iri, type: creation.type },
        edits,
      },
      "state-machine",
    );
  }

  return (
    <section aria-label="State-machine forms">
      {selected && selectedTypes.length > 0 && (
        <fieldset>
          <legend>Explicit state types</legend>
          {stateTypes.map((type, index) => {
            const before = data.triples.find(
              (triple) =>
                id(triple.subject) === id(selected) &&
                triple.predicate.value === rdfType &&
                triple.object.kind === "iri" &&
                triple.object.value === type,
            );
            return (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={!!before}
                  disabled={!writable || busy || (!before && !availableTypes.has(type))}
                  onChange={() => {
                    if (before) onEdit({ action: "remove", before });
                    else
                      onEdit({
                        action: "add",
                        after: {
                          subject: selected,
                          predicate: { kind: "iri", value: rdfType },
                          object: { kind: "iri", value: type },
                        },
                      });
                  }}
                />
                {creationTerms[index + 1]?.label ?? type}
              </label>
            );
          })}
        </fieldset>
      )}

      {selected && hasType(data, selected, `${sm}StateMachine`) && (
        <section aria-label="Machine memberships">
          <h4>States explicitly in this machine</h4>
          <ul>
            {machineMembers
              .filter((triple) => states.some((term) => id(term) === id(triple.subject)))
              .map((triple) => (
                <li key={id(triple.subject)}>
                  {labelOf(triple.subject)} <code>{display(triple.subject)}</code>{" "}
                  <button type="button" disabled={busy} onClick={() => onSelect(triple.subject)}>
                    Open state
                  </button>
                </li>
              ))}
          </ul>
          <h4>Transitions explicitly in this machine</h4>
          <ul>
            {machineMembers
              .filter((triple) => transitions.some((term) => id(term) === id(triple.subject)))
              .map((triple) => (
                <li key={id(triple.subject)}>
                  {labelOf(triple.subject)} <code>{display(triple.subject)}</code>{" "}
                  <button type="button" disabled={busy} onClick={() => onSelect(triple.subject)}>
                    Open transition
                  </button>
                </li>
              ))}
          </ul>
          {!machineMembers.length && (
            <p>No local states or transitions are explicitly associated.</p>
          )}
        </section>
      )}

      {writable && (
        <form aria-label="Create state-machine resource" onSubmit={create}>
          <h4>Create state-machine resource</h4>
          {createTypes.length ? (
            <>
              <label>
                Exact type
                <select
                  aria-label="State-machine resource type"
                  required
                  value={creation.type}
                  onChange={(event) =>
                    updateCreation({
                      type: event.target.value,
                      machine: undefined,
                      source: undefined,
                      target: undefined,
                    })
                  }
                >
                  {createTypes.map((item) => (
                    <option key={item.type} value={item.type}>
                      {item.label} · {item.type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                New resource IRI
                <input
                  aria-label="State-machine resource IRI"
                  required
                  value={creation.iri}
                  onChange={(event) => updateCreation({ iri: event.target.value })}
                />
              </label>
              {(stateTypes.includes(creation.type) || creation.type === `${sm}Transition`) && (
                <label>
                  Selected machine
                  <select
                    aria-label="Selected state machine"
                    required
                    value={machineKey}
                    onChange={(event) =>
                      updateCreation({
                        machine: machines.find((term) => id(term) === event.target.value),
                        source: undefined,
                        target: undefined,
                      })
                    }
                  >
                    <option value="">Select a state machine</option>
                    {machines.map((machine) => (
                      <option key={id(machine)} value={id(machine)}>
                        {labelOf(machine)} · {display(machine)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {creation.type === `${sm}Transition` && (
                <>
                  <label>
                    Source state
                    <select
                      aria-label="Transition source state"
                      required
                      value={creation.source ? id(creation.source) : ""}
                      onChange={(event) =>
                        updateCreation({
                          source: statesInMachine.find((term) => id(term) === event.target.value),
                        })
                      }
                    >
                      <option value="">Select a source state</option>
                      {statesInMachine.map((state) => (
                        <option key={id(state)} value={id(state)}>
                          {labelOf(state)} · {display(state)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Target state
                    <select
                      aria-label="Transition target state"
                      required
                      value={creation.target ? id(creation.target) : ""}
                      onChange={(event) =>
                        updateCreation({
                          target: statesInMachine.find((term) => id(term) === event.target.value),
                        })
                      }
                    >
                      <option value="">Select a target state</option>
                      {statesInMachine.map((state) => (
                        <option key={id(state)} value={id(state)}>
                          {labelOf(state)} · {display(state)}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {availableFields.has(`${rdfs}label`) && (
                <label>
                  Label (optional)
                  <input
                    aria-label="State-machine resource label"
                    value={creation.label}
                    onChange={(event) => updateCreation({ label: event.target.value })}
                  />
                </label>
              )}
              {availableFields.has(`${rdfs}comment`) && (
                <label>
                  Comment (optional)
                  <input
                    aria-label="State-machine resource comment"
                    value={creation.comment}
                    onChange={(event) => updateCreation({ comment: event.target.value })}
                  />
                </label>
              )}
              {creation.type === `${sm}Transition` &&
                (
                  [
                    [`${sm}event`, "Event"],
                    [`${sm}condition`, "Condition"],
                    [`${sm}action`, "Action"],
                  ] as const
                ).map(([predicate, label]) =>
                  availableFields.has(predicate) ? (
                    <label key={predicate}>
                      {label} (optional)
                      <input
                        aria-label={`Transition ${label.toLowerCase()}`}
                        value={
                          creation[predicate.slice(sm.length) as "event" | "condition" | "action"]
                        }
                        onChange={(event) =>
                          updateCreation({ [predicate.slice(sm.length)]: event.target.value })
                        }
                      />
                    </label>
                  ) : null,
                )}
              <button
                type="submit"
                disabled={
                  busy ||
                  !writable ||
                  (stateTypes.includes(creation.type) || creation.type === `${sm}Transition`
                    ? !creation.machine
                    : false) ||
                  (creation.type === `${sm}Transition` &&
                    (!creation.source || !creation.target || statesInMachine.length === 0))
                }
              >
                {creation.type === `${sm}Transition`
                  ? "Create transition"
                  : stateTypes.includes(creation.type)
                    ? "Create state"
                    : "Create state machine"}
              </button>
            </>
          ) : (
            <p>
              No supported state-machine creation terms are available in this graph&apos;s
              vocabulary.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
