import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput,
  type Finding
} from "../../src/core/file-review-context.ts";

const DEFAULT_CONTEXT_INPUT: FileReviewContextInput = {
  filePath: "src/app.ts",
  noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  baseRef: "main",
  headRef: "feature-branch"
};

test("FileReviewContext preserves execution metadata and starts empty", () => {
  const context = createContext();

  assert.equal(context.filePath, DEFAULT_CONTEXT_INPUT.filePath);
  assert.equal(context.noteFilePath, DEFAULT_CONTEXT_INPUT.noteFilePath);
  assert.equal(context.diffContent, DEFAULT_CONTEXT_INPUT.diffContent);
  assert.equal(context.baseRef, DEFAULT_CONTEXT_INPUT.baseRef);
  assert.equal(context.headRef, DEFAULT_CONTEXT_INPUT.headRef);
  assert.equal(context.getSection("overview"), undefined);
  assert.deepEqual(context.getSectionEntries(), []);
  assert.equal(context.getFindings(), undefined);
  assert.equal(context.getInterruption(), undefined);
  assert.equal(context.getFindingsInsertionIndex(), undefined);
});

test("FileReviewContext accepts custom section keys", () => {
  const context = createContext();

  context.setSection("custom-analysis", "custom content");
  assert.equal(context.getSection("custom-analysis"), "custom content");
  assert.deepEqual(context.getSectionEntries(), [["custom-analysis", "custom content"]]);
});

test("FileReviewContext getSection returns undefined for unwritten custom key", () => {
  const context = createContext();

  assert.equal(context.getSection("never-written"), undefined);
});

test("FileReviewContext setSection overwrites same key preserving insertion position", () => {
  const context = createContext();

  context.setSection("overview", "first");
  context.setSection("deps", "second");
  context.setSection("overview", "overwritten");

  assert.equal(context.getSection("overview"), "overwritten");
  const entries = context.getSectionEntries();
  assert.deepEqual(entries, [
    ["overview", "overwritten"],
    ["deps", "second"]
  ]);
});

test("FileReviewContext records findingsInsertionIndex on first setFindings call", () => {
  const context = createContext();

  context.setSection("overview", "o");
  context.setSection("deps", "d");
  context.setSection("knowledge", "k");
  context.setSection("strategy", "s");

  context.setFindings([]);
  assert.equal(context.getFindingsInsertionIndex(), 4);
});

test("FileReviewContext findingsInsertionIndex unchanged on second setFindings call", () => {
  const context = createContext();

  context.setSection("overview", "o");
  context.setSection("deps", "d");

  context.setFindings([]);
  assert.equal(context.getFindingsInsertionIndex(), 2);

  context.setSection("summary", "s");
  context.setFindings([]);
  assert.equal(context.getFindingsInsertionIndex(), 2);
});

test("FileReviewContext getFindingsInsertionIndex returns undefined when setFindings never called", () => {
  const context = createContext();

  context.setSection("overview", "o");
  assert.equal(context.getFindingsInsertionIndex(), undefined);
});

test("FileReviewContext stores interruption state separately and returns defensive copies", () => {
  const context = createContext();

  context.markInterrupted(
    "step5-validation-interrogation",
    "deterministic validation failed"
  );

  assert.deepEqual(context.getInterruption(), {
    stepId: "step5-validation-interrogation",
    reason: "deterministic validation failed"
  });
  assert.equal(context.getSection("overview"), undefined);
  assert.equal(context.getFindings(), undefined);

  const snapshot = context.getInterruption();
  if (!snapshot) {
    throw new Error("expected interruption snapshot");
  }
  snapshot.stepId = "mutated";
  snapshot.reason = "mutated";

  assert.deepEqual(context.getInterruption(), {
    stepId: "step5-validation-interrogation",
    reason: "deterministic validation failed"
  });
});

test("FileReviewContext setFindings deep-clones v2 fields so mutations do not leak", () => {
  const context = createContext();

  const original: Finding = {
    type: "must",
    title: "leak test",
    traceability: { kind: "line-range", lineStart: 1, lineEnd: 2 },
    context: "ctx",
    deviation: "dev",
    impact: "imp",
    suggestion: "sug",
    confidence: 90,
    findingId: "F1",
    supportingEvidence: [
      { source: "diff:src/app.ts:1-2", content: "original content" }
    ],
    reachability: { credible: true, description: "direct path" },
    uncertaintyStatus: "supported" as const
  };

  context.setFindings([original]);

  // Mutate the original object after setFindings
  original.supportingEvidence[0]!.source = "MUTATED";
  original.supportingEvidence[0]!.content = "MUTATED";
  original.reachability.credible = false;
  original.reachability.description = "MUTATED";
  original.findingId = "MUTATED";
  original.uncertaintyStatus = "tentative";

  const stored = context.getFindings()!;
  assert.equal(stored.length, 1);
  const f = stored[0]!;

  assert.equal(f.findingId, "F1");
  assert.equal(f.uncertaintyStatus, "supported");
  assert.equal(f.reachability.credible, true);
  assert.equal(f.reachability.description, "direct path");
  assert.equal(f.supportingEvidence[0]!.source, "diff:src/app.ts:1-2");
  assert.equal(f.supportingEvidence[0]!.content, "original content");
});

function createContext(
  overrides: Partial<FileReviewContextInput> = {}
): FileReviewContext {
  return new FileReviewContext({
    ...DEFAULT_CONTEXT_INPUT,
    ...overrides
  });
}
