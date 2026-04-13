import assert from "node:assert/strict";
import test from "node:test";

import {
  FileReviewContext,
  type FileReviewContextInput
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
  assert.deepEqual(context.getStructuredState(), {});
  assert.equal(context.getInterruption(), undefined);
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
  assert.deepEqual(context.getStructuredState(), {});

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

  context.clearInterruption();

  assert.equal(context.getInterruption(), undefined);
});

function createContext(
  overrides: Partial<FileReviewContextInput> = {}
): FileReviewContext {
  return new FileReviewContext({
    ...DEFAULT_CONTEXT_INPUT,
    ...overrides
  });
}
