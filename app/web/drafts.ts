import type { Edit, EditorData, EditorTerm } from "../src/editing.ts";
import type { Revision } from "../src/filesystem.ts";
import type { ProcessAssociation } from "../src/process.ts";

export type ProcessDraft =
  | {
      kind: "association";
      action: "add" | "change" | "remove";
      relation: "input" | "output";
      revision: Revision;
      step?: EditorTerm;
      variable?: EditorTerm;
      association?: ProcessAssociation;
      replacement?: EditorTerm;
    }
  | {
      kind: "creation";
      revision: Revision;
      iri: string;
      type: string;
      plan?: EditorTerm;
      source?: EditorTerm;
      target?: EditorTerm;
      condition?: EditorTerm;
    };

export type StateMachineDraft = {
  kind: "creation";
  revision: Revision;
  iri: string;
  type: string;
  machine?: EditorTerm;
  source?: EditorTerm;
  target?: EditorTerm;
  label: string;
  comment: string;
  event: string;
  condition: string;
  action: string;
};

export interface EditorDraft {
  mode: string;
  selected?: EditorTerm;
  section: string;
  sourceDraft?: { text: string; revision: Revision };
  pending?: { edit: Edit; revision: Revision };
  creationDraft?: { iri: string; type: string; revision: Revision };
  processDraft?: ProcessDraft;
  initialValues: { id: string; predicate: string; object: EditorTerm }[];
  stateMachineDraft?: StateMachineDraft;
  conflict?: EditorData;
  conflictKind: string;
}

export const emptyDraft: EditorDraft = {
  mode: "canvas",
  section: "",
  initialValues: [],
  conflictKind: "source",
};

export function updateDraft(
  drafts: Map<string, EditorDraft>,
  selector: string,
  change: Partial<EditorDraft>,
): EditorDraft {
  const next = { ...(drafts.get(selector) ?? emptyDraft), ...change };
  drafts.set(selector, next);
  return next;
}
