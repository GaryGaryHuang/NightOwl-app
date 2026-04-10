import assert from "node:assert/strict";
import test from "node:test";

import { ReviewNoteFinalizer } from "../../src/core/finalizer.ts";
import { FileReviewContext } from "../../src/core/file-review-context.ts";
import {
  assertBootstrapShape,
  assertFindingsStats,
  assertFindingsTitlesInOrder,
  assertTextContainsAll,
  assertTextContainsInOrder,
  assertTextExcludesAll,
  assertTraceabilityForms,
  assertWarningBlock,
  assertWarningBlockAtEnd
} from "../helpers/finalizer-contract-fixture.ts";

const FILE_PATH = "src/app.ts";
const NOTE_PATH = "/workspace/.nightowl/review/run/files/src__app.ts.md";
const DIFF_CONTENT = "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n";

const OVERVIEW_SECTION = [
  "## Overview",
  "- 整體理解：測試用概覽",
  "- 行為變更：無行為變更",
  "- 檔案職責：維護 app value",
  "- 改動目的：調整常數",
  "- 影響範圍：src/app.ts",
  "- 測試覆蓋觀察：未見對應測試異動"
].join("\n");

const DEPENDENCIES_SECTION = [
  "## Dependencies & Boundaries",
  "- 相依清單：",
  "  - `[valueService]` → 提供 value 更新 → Consume",
  "    - Contract：輸入 value 並回傳更新結果",
  "    - 評估：此 diff 維持既有 boundary",
  "- 隱含相依：",
  "  - 無"
].join("\n");

const SIMPLE_DEPENDENCIES_SECTION = [
  "## Dependencies & Boundaries",
  "- 相依清單：",
  "  - 無外部相依",
  "- 隱含相依：",
  "  - 無"
].join("\n");

const KNOWLEDGE_SECTION = [
  "## Knowledge & Source of Truth",
  "- 版本／文件參考：",
  "  - package.json — repo local source",
  "- 採用規則與假設：",
  "  - 依 repo 設定檔判讀版本約束",
  "- 排除範圍：",
  "  - 外部官方文件查證不在本次 foundation 範圍內"
].join("\n");

const SIMPLE_KNOWLEDGE_SECTION = [
  "## Knowledge & Source of Truth",
  "- 版本／文件參考：",
  "  - 無",
  "- 採用規則與假設：",
  "  - 依 repo 規則判讀",
  "- 排除範圍：",
  "  - 外部知識不在本次範圍內"
].join("\n");

const STRATEGY_SECTION = [
  "## Strategy & What-if Scenarios",
  "- 高風險區域：",
  "  - state transition：這次改動調整 value 更新流程，值得驗證狀態切換是否一致",
  "- What-if 假設情境：",
  "  - W1: 觸發條件：value 為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新的分支是否略過 fallback；與本次改動的關聯：diff 調整了 value 更新路徑",
  "  - W2: 觸發條件：dependency 回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示 valueService boundary",
  "  - W3: 觸發條件：多次重複呼叫；預期正確行為：應保持可預測結果；待驗證風險/不確定性：狀態是否會累積偏移；與本次改動的關聯：Step 3 已收斂 repo 假設"
].join("\n");

const SIMPLE_STRATEGY_SECTION = [
  "## Strategy & What-if Scenarios",
  "- 高風險區域：",
  "  - state transition：值得驗證",
  "- What-if 假設情境：",
  "  - W1: 觸發條件：空輸入；預期正確行為：維持 fallback；待驗證風險/不確定性：流程是否偏移；與本次改動的關聯：diff 調整流程",
  "  - W2: 觸發條件：dependency 異常；預期正確行為：保留錯誤處理；待驗證風險/不確定性：邊界是否改變；與本次改動的關聯：Step 2 已標示邊界",
  "  - W3: 觸發條件：重複呼叫；預期正確行為：結果穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
].join("\n");

const SUMMARY_MEDIUM = [
  "## Summary",
  "### 審查基礎",
  "- 改動概要：調整主要執行流程。",
  "- 依據規範：依 repo source-of-truth 與版本假設審查。",
  "- 審查假設：未擴張到外部知識查證。",
  "### 行為變更提醒",
  "- 無",
  "### 風險評估",
  "- 整體風險等級：Medium",
  "- 風險理由：final findings 仍需留意。"
].join("\n");

const SUMMARY_NONE = [
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
].join("\n");

test("ReviewNoteFinalizer renders the bootstrap snapshot shape", () => {
  const finalizer = new ReviewNoteFinalizer();
  const rendered = finalizer.render(createContext());

  assertBootstrapShape(rendered, FILE_PATH);
  assertTextContainsAll(rendered, ["- Status: Review not yet generated."]);
  assertTextExcludesAll(rendered, [
    /^## Overview/mu,
    /^## Findings/mu,
    /^## Summary/mu,
    "> [!WARNING] Review Interrupted"
  ]);
});

test("ReviewNoteFinalizer renders the Step 1 success snapshot without later-step placeholders", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("overview", OVERVIEW_SECTION);

  const rendered = finalizer.render(context);

  assertBootstrapShape(rendered, FILE_PATH);
  assertTextContainsAll(rendered, [
    "## Overview",
    "- 檔案職責：維護 app value"
  ]);
  assertTextExcludesAll(rendered, [
    "Review not yet generated",
    /Step 2|Step 3|pending/u,
    /^## Findings/mu,
    /^## Summary/mu
  ]);
});

test("ReviewNoteFinalizer renders Overview before Dependencies & Boundaries for Step 2 handoff and snapshots", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("overview", OVERVIEW_SECTION);
  context.setSection("dependencies-boundaries", DEPENDENCIES_SECTION);

  const rendered = finalizer.render(context);

  assertTextContainsInOrder(rendered, [
    "## Overview",
    "## Dependencies & Boundaries"
  ]);
  assertTextExcludesAll(rendered, [
    "Review not yet generated",
    /Step 3|pending/u
  ]);
});

test("ReviewNoteFinalizer renders Knowledge & Source of Truth after Dependencies & Boundaries for Step 3 handoff and snapshots", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContextWithPreFindings();
  context.setSection("knowledge-source-of-truth", KNOWLEDGE_SECTION);

  const rendered = finalizer.render(context);

  assertTextContainsInOrder(rendered, [
    "## Overview",
    "## Dependencies & Boundaries",
    "## Knowledge & Source of Truth"
  ]);
  assertTextExcludesAll(rendered, [
    "Review not yet generated",
    /Step 4|pending/u
  ]);
});

test("ReviewNoteFinalizer renders Strategy & What-if Scenarios after Knowledge & Source of Truth for Step 4 handoff and snapshots", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContextWithPreFindings();
  context.setSection("knowledge-source-of-truth", KNOWLEDGE_SECTION);
  context.setSection("strategy-what-if-scenarios", STRATEGY_SECTION);

  const rendered = finalizer.render(context);

  assertTextContainsInOrder(rendered, [
    "## Overview",
    "## Dependencies & Boundaries",
    "## Knowledge & Source of Truth",
    "## Strategy & What-if Scenarios"
  ]);
  assertTextExcludesAll(rendered, [
    "Review not yet generated",
    /^## Findings/mu,
    /Step 5|Step 6|Step 7|pending/u
  ]);
});

test("ReviewNoteFinalizer renders Findings after Strategy & What-if Scenarios without confidence", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContextWithAllPreFindings();
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "問題標題",
        traceability: lineRangeTraceability(14, 18),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 88
      }
    ]
  });

  const rendered = finalizer.render(context);

  assertTextContainsInOrder(rendered, [
    "## Strategy & What-if Scenarios",
    "## Findings"
  ]);
  assertFindingsStats(rendered, { must: 1, nice: 0 });
  assertFindingsTitlesInOrder(rendered, [
    { type: "must", title: "問題標題" }
  ]);
  assertTraceabilityForms(rendered, ["L14-L18"]);
  assertTextContainsAll(rendered, [
    "- Context：具體情境",
    "- Deviation：預期與實際有落差",
    "- Impact：會造成 correctness 問題",
    "- Suggestion：補上 guard"
  ]);
  assertTextExcludesAll(rendered, [/confidence/u]);
});

test("ReviewNoteFinalizer renders empty Findings as `- 無`", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("overview", OVERVIEW_SECTION);
  context.setSection("dependencies-boundaries", SIMPLE_DEPENDENCIES_SECTION);
  context.setSection("knowledge-source-of-truth", SIMPLE_KNOWLEDGE_SECTION);
  context.setSection("strategy-what-if-scenarios", SIMPLE_STRATEGY_SECTION);
  context.updateStructuredState({ findings: [] });

  const rendered = finalizer.render(context);

  assertTextContainsAll(rendered, ["## Findings", "## Findings\n- 無"]);
  assertTextExcludesAll(rendered, ["無 findings.", /confidence/u]);
});

test("ReviewNoteFinalizer does not render Findings before structured findings state exists", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("strategy-what-if-scenarios", SIMPLE_STRATEGY_SECTION);

  const rendered = finalizer.render(context);

  assertTextExcludesAll(rendered, [/^## Findings/mu]);
});

test("ReviewNoteFinalizer renders Summary after Findings without changing Findings content", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContextWithAllPreFindings();
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "最終問題",
        traceability: diffHunkTraceability("@@ -1 +1 @@"),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
  context.setSection("summary", SUMMARY_MEDIUM);

  const rendered = finalizer.render(context);

  assertTextContainsInOrder(rendered, [
    "## Findings",
    "## Summary"
  ]);
  assertTextContainsAll(rendered, [
    "[must] 最終問題",
    "### 風險評估"
  ]);
  assert.equal((rendered.match(/^## Summary/mgu) ?? []).length, 1);
});

test("ReviewNoteFinalizer preserves empty Findings before Summary", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("strategy-what-if-scenarios", SIMPLE_STRATEGY_SECTION);
  context.updateStructuredState({ findings: [] });
  context.setSection("summary", SUMMARY_NONE);

  const rendered = finalizer.render(context);

  assertTextContainsInOrder(rendered, [
    "## Findings",
    "- 無",
    "## Summary"
  ]);
  assertTextExcludesAll(rendered, ["無 findings."]);
  assert.equal((rendered.match(/^## Summary/mgu) ?? []).length, 1);
});

test("ReviewNoteFinalizer renders a populated Summary without placeholders when declared pre-findings sections are absent", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("summary", SUMMARY_NONE);

  const rendered = finalizer.render(context);

  assertBootstrapShape(rendered, FILE_PATH);
  assertTextContainsAll(rendered, [
    "## Summary",
    "### 審查基礎",
    "### 風險評估"
  ]);
  assertTextExcludesAll(rendered, [
    "Review not yet generated",
    /^## Overview/mu,
    /^## Findings/mu
  ]);
});

test("ReviewNoteFinalizer renders bootstrap interruption snapshot with deterministic warning block", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.markInterrupted("step1-overview", "judge rejected");

  const rendered = finalizer.render(context);

  assertBootstrapShape(rendered, FILE_PATH);
  assertTextContainsAll(rendered, ["- Status: Review not yet generated."]);
  assertWarningBlock(rendered, {
    stepId: "step1-overview",
    reason: "judge rejected"
  });
  assertWarningBlockAtEnd(rendered, {
    stepId: "step1-overview",
    reason: "judge rejected"
  });
});

test("ReviewNoteFinalizer renders warning block on top of the last successful section snapshot", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("overview", OVERVIEW_SECTION);
  context.markInterrupted("step2-dependencies-boundaries", "judge timeout");

  const rendered = finalizer.render(context);

  assertTextContainsAll(rendered, ["## Overview"]);
  assertTextContainsInOrder(rendered, [
    "## Overview",
    "> [!WARNING] Review Interrupted"
  ]);
  assertWarningBlockAtEnd(rendered, {
    stepId: "step2-dependencies-boundaries",
    reason: "judge timeout"
  });
});

test("ReviewNoteFinalizer renders warning block on top of Step 6 findings snapshot without provisional Summary", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.setSection("strategy-what-if-scenarios", SIMPLE_STRATEGY_SECTION);
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "最終問題",
        traceability: lineRangeTraceability(30, 30),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
  context.markInterrupted("step7-summary", "judge rejected");

  const rendered = finalizer.render(context);

  assertTextContainsAll(rendered, ["## Findings", "[must] 最終問題"]);
  assertTextExcludesAll(rendered, [/^## Summary/mu]);
  assertWarningBlockAtEnd(rendered, {
    stepId: "step7-summary",
    reason: "judge rejected"
  });
});

test("ReviewNoteFinalizer prepends statistics line before grouped findings", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext("");
  context.updateStructuredState({
    findings: [
      {
        type: "nice",
        title: "A",
        traceability: lineRangeTraceability(5, 5),
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 85
      },
      {
        type: "must",
        title: "B",
        traceability: lineRangeTraceability(8, 10),
        context: "ctx",
        deviation: "dev",
        impact: "high",
        suggestion: "fix it",
        confidence: 88
      },
      {
        type: "nice",
        title: "C",
        traceability: diffHunkTraceability("@@ -20,2 +20,4 @@"),
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional too",
        confidence: 82
      }
    ]
  });

  const rendered = finalizer.render(context);

  assertTextContainsInOrder(rendered, [
    "## Findings",
    "1 must-fix issue(s), 2 nice-to-have suggestion(s).",
    "- [must] B",
    "- [nice] A",
    "- [nice] C"
  ]);
  assertTraceabilityForms(rendered, ["L8-L10", "L5", "@@ -20,2 +20,4 @@"]);
});

test("ReviewNoteFinalizer groups all must findings before all nice findings preserving intra-group order", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext("");
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "X",
        traceability: lineRangeTraceability(40, 40),
        context: "ctx",
        deviation: "dev",
        impact: "high",
        suggestion: "fix",
        confidence: 90
      },
      {
        type: "must",
        title: "Y",
        traceability: lineRangeTraceability(42, 43),
        context: "ctx",
        deviation: "dev",
        impact: "high",
        suggestion: "fix",
        confidence: 88
      }
    ]
  });

  const rendered = finalizer.render(context);

  assertFindingsStats(rendered, { must: 2, nice: 0 });
  assertFindingsTitlesInOrder(rendered, [
    { type: "must", title: "X" },
    { type: "must", title: "Y" }
  ]);
});

test("ReviewNoteFinalizer renders statistics for all-nice findings with 0 must prefix", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext("");
  context.updateStructuredState({
    findings: [
      {
        type: "nice",
        title: "P",
        traceability: lineRangeTraceability(31, 31),
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 85
      },
      {
        type: "nice",
        title: "Q",
        traceability: lineRangeTraceability(42, 43),
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 83
      }
    ]
  });

  const rendered = finalizer.render(context);

  assertFindingsStats(rendered, { must: 0, nice: 2 });
  assertFindingsTitlesInOrder(rendered, [
    { type: "nice", title: "P" },
    { type: "nice", title: "Q" }
  ]);
});

test("ReviewNoteFinalizer renders empty findings as a single - 無 marker", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext("");
  context.updateStructuredState({ findings: [] });

  const rendered = finalizer.render(context);

  assertTextContainsAll(rendered, ["## Findings", "## Findings\n- 無"]);
  assertTextExcludesAll(rendered, ["無 findings."]);
});

test("ReviewNoteFinalizer throws for an unknown FindingTraceability kind", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = createContext();
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "test finding",
        traceability: { kind: "unknown-kind" } as any,
        context: "ctx",
        deviation: "dev",
        impact: "impact",
        suggestion: "fix",
        confidence: 90
      }
    ]
  });

  assert.throws(
    () => finalizer.render(context),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes("unknown-kind"),
        `expected error message to contain "unknown-kind", got: ${err.message}`
      );
      return true;
    }
  );
});

function createContext(diffContent = DIFF_CONTENT): FileReviewContext {
  return new FileReviewContext({
    filePath: FILE_PATH,
    noteFilePath: NOTE_PATH,
    diffContent,
    baseRef: "main",
    headRef: "feature-branch"
  });
}

function createContextWithPreFindings(): FileReviewContext {
  const context = createContext();
  context.setSection("overview", OVERVIEW_SECTION);
  context.setSection("dependencies-boundaries", DEPENDENCIES_SECTION);
  return context;
}

function createContextWithAllPreFindings(): FileReviewContext {
  const context = createContextWithPreFindings();
  context.setSection("knowledge-source-of-truth", KNOWLEDGE_SECTION);
  context.setSection("strategy-what-if-scenarios", STRATEGY_SECTION);
  return context;
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
