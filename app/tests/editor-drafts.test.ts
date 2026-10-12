import assert from "node:assert/strict";
import test from "node:test";
import { type EditorDraft, updateDraft } from "../web/drafts.ts";

test("graph drafts retain captured revisions and independent edits until explicitly cleared", () => {
  const drafts = new Map<string, EditorDraft>();
  const revision = { state: "present" as const, digest: `sha256:${"a".repeat(64)}` };
  updateDraft(drafts, "one.ttl", {
    sourceDraft: { text: "unsaved source", revision },
    creationDraft: { iri: "urn:new", type: "urn:Type", revision },
    pending: {
      revision,
      edit: {
        action: "add",
        after: {
          subject: { kind: "iri", value: "urn:subject" },
          predicate: { kind: "iri", value: "urn:p" },
          object: { kind: "iri", value: "urn:o" },
        },
      },
    },
    initialValues: [{ id: "one", predicate: "urn:p", object: { kind: "iri", value: "urn:o" } }],
  });
  updateDraft(drafts, "two.ttl", { sourceDraft: { text: "another draft", revision } });
  const restored = drafts.get("one.ttl");
  assert.equal(restored?.sourceDraft?.text, "unsaved source");
  assert.deepEqual(restored?.creationDraft?.revision, revision);
  assert.equal(restored?.initialValues[0]?.predicate, "urn:p");
  updateDraft(drafts, "one.ttl", { sourceDraft: undefined });
  assert.ok(drafts.get("one.ttl")?.creationDraft);
  updateDraft(drafts, "one.ttl", { creationDraft: undefined, initialValues: [] });
  assert.deepEqual(drafts.get("one.ttl")?.pending?.revision, revision);
  assert.equal(drafts.get("two.ttl")?.sourceDraft?.text, "another draft");
});
