import type { Edit, EditorData, EditorTerm } from "../src/editing.ts";
import type { Revision } from "../src/filesystem.ts";

export interface EditorDraft {
  mode: string;
  selected?: EditorTerm;
  section: string;
  sourceDraft?: { text: string; revision: Revision };
  pending?: { edit: Edit; revision: Revision };
  creationDraft?: { iri: string; type: string; revision: Revision };
  initialValues: { id: string; predicate: string; object: EditorTerm }[];
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
