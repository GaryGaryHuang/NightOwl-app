import assert from "node:assert/strict";
import test from "node:test";

import type { Finding } from "../../../src/core/file-review-context.ts";
import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step7SummaryStep } from "../../../src/core/steps/step7-summary.ts";
import {
  assertNightOwlSharedToolGuidance,
  assertJudgeCriteriaContains,
  assertSectionPlanShape,
  assertTaggedBlockContains,
  assertTaggedBlockExcludes,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../../helpers/step-prompt-contract-fixture.ts";

test("Step7SummaryStep prepares the Step 7 prompt contract from current review only", () => {
  const context = createContextWithFindings([createFinding("must", 91, "最終問題")]);
  const step = new Step7SummaryStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assertSectionPlanShape(plan, {
    stepId: "step7-summary",
    sectionKey: "summary",
    reviewProfile: {
      dryRunStepContract: "summary",
      model: "gpt-5-mini",
      timeoutMs: 300_000
    }
  });
  assertJudgeCriteriaContains(plan.completionCheck, [
    "段落 `## Summary` 必須存在",
    "### 審查基礎",
    "改動概要",
    "依據規範",
    "審查假設",
    "### 行為變更提醒",
    "### 風險評估",
    "High / Medium / Low / None"
  ]);

  assertTextContainsAll(plan.prompt.systemMessage, [
    "## Current Step: Summary",
    "Do not list specific findings",
    "every sentence must earn its place",
    "Begin the response with `## Summary`."
  ]);
  assertNightOwlSharedToolGuidance(plan.prompt.systemMessage);

  assertTextContainsAll(plan.prompt.userMessage, [
    "Read <current_review> and write a structured summary",
    "## Summary",
    "### 審查基礎",
    "### 行為變更提醒",
    "### 風險評估"
  ]);
  assertTaggedBlockContains(plan.prompt.userMessage, "current_review", [
    "## Findings",
    "- [must] 最終問題"
  ]);

  // confidence scores are stripped from <current_review> (same contract as Step 6).
  assertTaggedBlockExcludes(plan.prompt.userMessage, "current_review", [
    /confidence/u
  ]);

  // Step 7 writes a reader-facing prose summary and does not re-examine the diff
  // or changeset context; <required_risk_level> is never injected into the prompt.
  assertTextExcludesAll(plan.prompt.userMessage, [
    /<diff/u,
    "<changeset_context>",
    "<required_risk_level>"
  ]);
});

// Risk level is determined solely by the model's summary output — it is never
// pre-specified in the prompt, so the prompt contract is identical regardless
// of whether findings are `must` or `nice`.
test("Step7SummaryStep uses consistent prompt and criteria regardless of findings risk level", () => {
  const context = createContextWithFindings([createFinding("nice", 95, "建議項")]);
  const step = new Step7SummaryStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assertTextExcludesAll(plan.prompt.userMessage, ["<required_risk_level>"]);
  assertJudgeCriteriaContains(plan.completionCheck, [
    "改動概要",
    "依據規範",
    "審查假設",
    "整體風險等級",
    "風險理由"
  ]);
});

// Same empty-findings contract as Step 6: `- 無` must appear, not an absent
// section or a stub, and <required_risk_level> must still be absent.
test("Step7SummaryStep carries explicit empty findings state in current review", () => {
  const context = createContextWithFindings([]);
  const step = new Step7SummaryStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.match(
    plan.prompt.userMessage,
    /<current_review>[\s\S]*## Findings\n- 無[\s\S]*<\/current_review>/u
  );
  assert.doesNotMatch(plan.prompt.userMessage, /無 findings\./u);
  assert.doesNotMatch(plan.prompt.userMessage, /<required_risk_level>/u);
  assertJudgeCriteriaContains(plan.completionCheck, [
    "### 行為變更提醒",
    "### 風險評估"
  ]);
});

function createContextWithFindings(findings: Finding[]): FileReviewContext {
  const context = createBaseContext();
  context.updateStructuredState({ findings });
  return context;
}

function createFinding(
  type: "must" | "nice",
  confidence: number,
  title: string
): Finding {
  return {
    type,
    title,
    traceability: lineRangeTraceability(14, 18),
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 final guard",
    confidence
  };
}

function createBaseContext(): FileReviewContext {
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
  context.setSection(
    "dependencies-boundaries",
    [
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - package.json — repo local source",
      "- 採用規則與假設：",
      "  - 依 repo 設定檔判讀版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );
  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：這次改動調整 value 更新流程，值得驗證狀態切換是否一致",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：value 為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新的分支是否略過 fallback；與本次改動的關聯：diff 調整了 value 更新路徑",
      "  - W2: 觸發條件：dependency 回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示 valueService boundary",
      "  - W3: 觸發條件：多次重複呼叫；預期正確行為：應保持可預測結果；待驗證風險/不確定性：狀態是否會累積偏移；與本次改動的關聯：Step 3 已收斂 repo 假設"
    ].join("\n")
  );

  return context;
}

function lineRangeTraceability(lineStart: number, lineEnd: number) {
  return {
    kind: "line-range" as const,
    lineStart,
    lineEnd
  };
}
