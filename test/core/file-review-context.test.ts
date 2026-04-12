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
  assert.deepEqual(context.getStructuredState(), {});
  assert.equal(context.getInterruption(), undefined);
});

test("FileReviewContext stores declared sections and returns section-entry snapshots", () => {
  const context = createContext();
  const summarySection = [
    "## Summary",
    "### 審查基礎",
    "- 改動概要：調整主要執行流程。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    "- 整體風險等級：None"
  ].join("\n");

  assert.equal(context.getSection("summary"), undefined);

  context.setSection("summary", summarySection);

  assert.equal(context.getSection("summary"), summarySection);
  assert.equal(context.getSection("overview"), undefined);

  const snapshot = context.getSectionEntries();
  snapshot.push(["overview", "should not mutate context"]);

  assert.deepEqual(context.getSectionEntries(), [["summary", summarySection]]);
});

test("FileReviewContext stores structured findings separately from section state", () => {
  const context = createContext();
  const finding = createFinding({
    type: "must",
    title: "問題標題",
    traceability: lineRangeTraceability(14, 18),
    confidence: 85
  });

  context.setFindings([finding]);

  assert.equal(context.getSection("overview"), undefined);
  assert.deepEqual(context.getStructuredState(), { findings: [finding] });
});

test("FileReviewContext replaces structured findings wholesale", () => {
  const context = createContext();
  const firstFinding = createFinding({
    type: "nice",
    title: "初始 findings",
    traceability: diffHunkTraceability("@@ -1 +1 @@"),
    confidence: 91
  });
  const finalFinding = createFinding({
    type: "must",
    title: "Step 6 最終 findings",
    traceability: lineRangeTraceability(22, 24),
    confidence: 92
  });

  context.setFindings([firstFinding]);
  context.setFindings([]);

  assert.deepEqual(context.getStructuredState(), { findings: [] });

  context.setFindings([finalFinding]);

  assert.deepEqual(context.getStructuredState(), { findings: [finalFinding] });
});

test("FileReviewContext returns defensive copies for structured findings", () => {
  const context = createContext();
  const finding = createFinding({
    type: "nice",
    title: "低優先改善",
    traceability: diffHunkTraceability("@@ -1 +1 @@"),
    confidence: 91
  });

  context.setFindings([finding]);

  const snapshot = context.getStructuredState();
  const snapshotFinding = snapshot.findings?.[0];
  if (!snapshotFinding || snapshotFinding.traceability.kind !== "diff-hunk") {
    throw new Error("expected finding snapshot");
  }

  snapshotFinding.traceability.hunkHeader = "@@ mutated @@";
  snapshot.findings?.push(
    createFinding({
      title: "不應污染原始狀態",
      traceability: lineRangeTraceability(20, 20)
    })
  );

  assert.deepEqual(context.getStructuredState(), { findings: [finding] });
});

test("FileReviewContext throws a readable error when a formal finding is missing traceability", () => {
  const context = createContext();

  assert.throws(
    () =>
      context.setFindings(
        [
          {
            type: "must",
            title: "缺少 traceability 的不合法 finding",
            context: "具體情境",
            deviation: "預期與實際有落差",
            impact: "會造成 correctness 問題",
            suggestion: "補上 traceability",
            confidence: 85
          }
        ] as unknown as Finding[]
      ),
    /Formal finding "缺少 traceability 的不合法 finding" is missing required traceability\./u
  );
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

function createFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    type: "must",
    title: "測試 finding",
    traceability: lineRangeTraceability(14, 18),
    context: "觸發條件",
    deviation: "預期與實際有落差",
    impact: "會造成可觀察錯誤",
    suggestion: "應補上 guard",
    confidence: 85,
    ...overrides
  };
}

function lineRangeTraceability(lineStart: number, lineEnd: number) {
  return {
    kind: "line-range" as const,
    lineStart,
    lineEnd
  };
}

function diffHunkTraceability(hunkHeader: string) {
  return {
    kind: "diff-hunk" as const,
    hunkHeader
  };
}
