import type { EditorTerm, Triple } from "./editing.ts";

const rdfType = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
export const pPlan = "http://purl.org/net/p-plan#";
export const proc = "https://talby.ai/ontology/process#";
export const processCreationRequirements: Record<string, string[]> = {
  [`${pPlan}Plan`]: [],
  [`${pPlan}Step`]: [`${pPlan}isStepOfPlan`],
  [`${proc}Decision`]: [`${pPlan}isStepOfPlan`],
  [`${pPlan}Variable`]: [`${pPlan}isVariableOfPlan`],
  [`${proc}Flow`]: [`${proc}inPlan`, `${proc}source`, `${proc}target`],
};
const labels = [
  "http://www.w3.org/2000/01/rdf-schema#label",
  "http://www.w3.org/2000/01/rdf-schema#comment",
];

const stepFields = [
  ...labels,
  `${pPlan}isStepOfPlan`,
  `${pPlan}hasInputVar`,
  `${pPlan}hasOutputVar`,
  `${proc}responsibleParty`,
];

export const processBindings = [
  { type: `${pPlan}Plan`, label: "Plan", fields: labels },
  { type: `${pPlan}Step`, label: "Step", fields: stepFields },
  { type: `${proc}Decision`, label: "Decision / process step", fields: stepFields },
  {
    type: `${pPlan}Variable`,
    label: "Variable",
    fields: [
      ...labels,
      `${pPlan}isVariableOfPlan`,
      `${pPlan}isInputVarOf`,
      `${pPlan}isOutputVarOf`,
    ],
  },
  {
    type: `${proc}Flow`,
    label: "Flow",
    fields: [...labels, `${proc}source`, `${proc}target`, `${proc}inPlan`, `${proc}condition`],
  },
];

export interface ProcessAssociation {
  kind: "input" | "output";
  step: EditorTerm;
  variable: EditorTerm;
  statements: Triple[];
}

export interface ProcessElements {
  plans: EditorTerm[];
  steps: EditorTerm[];
  variables: EditorTerm[];
  flows: EditorTerm[];
}

function isResource(term: EditorTerm) {
  return term.kind === "iri" || term.kind === "blank";
}

function typedSubjects(triples: Triple[], type: string) {
  const subjects = new Map<string, EditorTerm>();
  for (const triple of triples)
    if (
      triple.predicate.value === rdfType &&
      triple.object.kind === "iri" &&
      triple.object.value === type
    )
      subjects.set(JSON.stringify(triple.subject), triple.subject);
  return [...subjects.values()];
}

export function processElements(triples: Triple[]): ProcessElements {
  return {
    plans: typedSubjects(triples, `${pPlan}Plan`),
    steps: [
      ...new Map(
        [
          ...typedSubjects(triples, `${pPlan}Step`),
          ...typedSubjects(triples, `${proc}Decision`),
        ].map((term) => [JSON.stringify(term), term] as const),
      ).values(),
    ],
    variables: typedSubjects(triples, `${pPlan}Variable`),
    flows: typedSubjects(triples, `${proc}Flow`),
  };
}

export function processAssociations(triples: Triple[]): ProcessAssociation[] {
  const associations = new Map<string, ProcessAssociation>();
  const add = (
    kind: ProcessAssociation["kind"],
    step: EditorTerm,
    variable: EditorTerm,
    statement: Triple,
  ) => {
    if (!isResource(step) || !isResource(variable)) return;
    const key = JSON.stringify([kind, step, variable]);
    const association = associations.get(key) ?? { kind, step, variable, statements: [] };
    association.statements.push(statement);
    associations.set(key, association);
  };
  for (const triple of triples) {
    if (triple.predicate.value === `${pPlan}hasInputVar`)
      add("input", triple.subject, triple.object, triple);
    else if (triple.predicate.value === `${pPlan}isInputVarOf`)
      add("input", triple.object, triple.subject, triple);
    else if (triple.predicate.value === `${pPlan}hasOutputVar`)
      add("output", triple.subject, triple.object, triple);
    else if (triple.predicate.value === `${pPlan}isOutputVarOf`)
      add("output", triple.object, triple.subject, triple);
  }
  return [...associations.values()];
}
