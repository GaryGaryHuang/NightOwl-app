import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext, type Finding } from "../../src/core/file-review-context.ts";

test("FileReviewContext preserves immutable execution metadata and starts with no sections", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  assert.equal(context.filePath, "src/app.ts");
  assert.equal(
    context.noteFilePath,
      "/workspace/.nightowl/review/run/files/src__app.ts.md"
  );
  assert.equal(
    context.diffContent,
    "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n"
  );
  assert.equal(context.baseRef, "main");
  assert.equal(context.headRef, "feature-branch");
  assert.equal(context.getSection("overview"), undefined);
  assert.deepEqual(context.getSectionEntries(), []);
});

// Sections can be written in any order (e.g., summary without prior overview);
// only undeclared section keys are rejected.
test("FileReviewContext accepts declared post-findings sections while keeping absent declared sections valid", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  assert.equal(context.getSection("summary"), undefined);

  context.setSection(
    "summary",
    [
      "## Summary",
      "### 審查基礎",
      "- 改動概要：調整主要執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 審查假設：未擴張到外部知識查證。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：None",
      "- 風險理由：目前未保留 final findings。"
    ].join("\n")
  );

  assert.match(context.getSection("summary") ?? "", /^## Summary/u);
  assert.equal(context.getSection("overview"), undefined);
});

test("FileReviewContext rejects undeclared section identifiers at compile time", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  // setSection and getSection accept ReviewSectionKey, not string.
  // Passing an untyped string is a compile-time error; no runtime guard exists in the core path.
  // @ts-expect-error
  context.setSection("not-a-declared-section", "unexpected");
  // @ts-expect-error
  context.getSection("not-a-declared-section");
});

test("FileReviewContext stores mutable Overview state while keeping snapshot access isolated", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setSection(
    "overview",
    [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );

  assert.match(context.getSection("overview") ?? "", /^## Overview/u);

  // getSectionEntries() returns a defensive copy: pushing to the snapshot
  // must not alter the context's internal state.
  const snapshot = context.getSectionEntries();
  snapshot.push(["summary", "should not mutate context"]);

  assert.deepEqual(context.getSectionEntries(), [
    [
      "overview",
      [
        "## Overview",
        "- 整體理解：測試用概覽",
        "- 行為變更：無行為變更",
        "- 檔案職責：維護 app value",
        "- 改動目的：調整常數",
        "- 影響範圍：src/app.ts",
        "- 測試覆蓋觀察：未見對應測試異動"
      ].join("\n")
    ]
  ]);
});

// Section state and structured state are independent stores; writing findings
// does not affect sections and vice versa.
test("FileReviewContext stores structured findings state separately from section state", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setFindings([
      {
        type: "must",
        title: "問題標題",
        traceability: lineRangeTraceability(14, 18),
        context: "觸發條件",
        deviation: "預期與實際有落差",
        impact: "會造成可觀察錯誤",
        suggestion: "應補上 guard",
        confidence: 85
      }
    ]);

  assert.equal(context.getSection("overview"), undefined);
  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "問題標題",
        traceability: lineRangeTraceability(14, 18),
        context: "觸發條件",
        deviation: "預期與實際有落差",
        impact: "會造成可觀察錯誤",
        suggestion: "應補上 guard",
        confidence: 85
      }
    ]
  });
});

// getStructuredState() must return a defensive copy; mutating the snapshot
// must not corrupt the stored findings, and setFindings with [] must
// fully replace any previous findings.
test("FileReviewContext replaces structured findings state without leaking snapshot mutation", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setFindings([
      {
        type: "nice",
        title: "低優先改善",
        traceability: diffHunkTraceability("@@ -1 +1 @@"),
        context: "初始 findings",
        deviation: "有些不一致",
        impact: "可維護性下降",
        suggestion: "補上整理",
        confidence: 91
      }
    ]);

  const snapshot = context.getStructuredState();
  if (!snapshot.findings?.[0]?.traceability || snapshot.findings[0].traceability.kind !== "diff-hunk") {
    throw new Error("expected traceability snapshot");
  }
  snapshot.findings[0].traceability.hunkHeader = "@@ mutated @@";
  snapshot.findings?.push({
    type: "must",
    title: "不應污染原始狀態",
    traceability: lineRangeTraceability(20, 20),
    context: "外部 snapshot mutation",
    deviation: "snapshot 被直接修改",
    impact: "正式 state 不應受影響",
    suggestion: "回傳 defensive copy",
    confidence: 100
  });

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "nice",
        title: "低優先改善",
        traceability: diffHunkTraceability("@@ -1 +1 @@"),
        context: "初始 findings",
        deviation: "有些不一致",
        impact: "可維護性下降",
        suggestion: "補上整理",
        confidence: 91
      }
    ]
  });

  context.setFindings([]);

  assert.deepEqual(context.getStructuredState(), { findings: [] });

  context.setFindings([
      {
        type: "must",
        title: "從空 findings 補回正式結果",
        traceability: lineRangeTraceability(22, 24),
        context: "Step 6 最終情境",
        deviation: "最終檢查後仍有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 92
      }
    ]);

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "從空 findings 補回正式結果",
        traceability: lineRangeTraceability(22, 24),
        context: "Step 6 最終情境",
        deviation: "最終檢查後仍有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 92
      }
    ]
  });
});

test("FileReviewContext throws a readable error when a formal finding is missing traceability", () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  // `as unknown as NonNullable<...>` bypasses TypeScript's compile-time check
  // so we can test the runtime guard that rejects findings without traceability.
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
  const context = new FileReviewContext({
    filePath: "src/app.ts",
      noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  assert.equal(context.getInterruption(), undefined);

  context.markInterrupted("step5-validation-interrogation", "deterministic validation failed");

  assert.deepEqual(context.getInterruption(), {
    stepId: "step5-validation-interrogation",
    reason: "deterministic validation failed"
  });
  assert.equal(context.getSection("overview"), undefined);
  assert.deepEqual(context.getStructuredState(), {});

  // getInterruption() also returns a defensive copy.
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
