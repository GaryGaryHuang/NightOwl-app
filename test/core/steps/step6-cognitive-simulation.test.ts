import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step6CognitiveSimulationStep } from "../../../src/core/steps/step6-cognitive-simulation.ts";
import {
  assertNightOwlSharedToolGuidance,
  assertDeterministicFindingsCheck,
  assertStructuredPlanShape,
  assertTaggedBlockContains,
  assertTaggedBlockExcludes,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../../helpers/step-prompt-contract-fixture.ts";

test("Step6CognitiveSimulationStep prepares the Step 6 prompt contract from diff and current review", () => {
  const context = createContextWithStep5Findings();
  const step = new Step6CognitiveSimulationStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assertStructuredPlanShape(plan, {
    stepId: "step6-cognitive-simulation",
    structuredTarget: "findings",
    reviewProfile: {
      dryRunStepContract: "cognitive-simulation",
      model: "gpt-5.4-mini",
      timeoutMs: 300_000
    }
  });
  assertDeterministicFindingsCheck(plan.completionCheck);

  assertTextContainsAll(plan.prompt.systemMessage, [
    "## Current Step: Cognitive Simulation",
    "Verify and finalize this file's findings through end-to-end execution simulation",
    "The Findings section in <current_review> is a Markdown rendering",
    "Output valid JSON only."
  ]);
  assertNightOwlSharedToolGuidance(plan.prompt.systemMessage);

  assertTextContainsAll(plan.prompt.userMessage, [
    '<diff path="src/app.ts" base="main" head="feature-branch">',
    "Perform a cognitive simulation of this file's changes",
    "If no valid findings remain, return an empty `findings` array.",
    "Output exactly one JSON object"
  ]);
  assertTaggedBlockContains(plan.prompt.userMessage, "current_review", [
    "## Overview",
    "## Dependencies & Boundaries",
    "## Knowledge & Source of Truth",
    "## Strategy & What-if Scenarios",
    "## Findings",
    "- [must] 既有問題",
    "Traceability: L14-L18"
  ]);

  // confidence scores from Step 5 are stripped so Step 6 forms an independent
  // assessment without being anchored to Step 5's scores.
  assertTaggedBlockExcludes(plan.prompt.userMessage, "current_review", [
    /confidence/u
  ]);
  assertTextExcludesAll(plan.prompt.userMessage, ["<changeset_context>"]);
});

// Empty findings from Step 5 must still render as `- 無` in the <current_review>
// block; the section must never be absent or replaced with a stub message.
test("Step6CognitiveSimulationStep carries explicit empty findings state in current review", () => {
  const context = createContextWithStep5EmptyFindings();
  const step = new Step6CognitiveSimulationStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.match(plan.prompt.userMessage, /<current_review>[\s\S]*## Findings\n- 無/u);
  assert.doesNotMatch(plan.prompt.userMessage, /無 findings\./u);
  assert.doesNotMatch(plan.prompt.userMessage, /Review not yet generated/u);
});

// The <current_review> block content must exactly match what ReviewNoteFinalizer
// produces — this prevents step-specific ad-hoc rendering from drifting out of sync
// with the canonical projection used everywhere else.
test("Step6CognitiveSimulationStep uses the canonical finalizer projection for <current_review>", () => {
  const reviewNoteFinalizer = new ReviewNoteFinalizer();
  const context = createContextWithStep5Findings();
  const step = new Step6CognitiveSimulationStep({
    reviewNoteFinalizer
  });

  const plan = step.prepare(context);
  const currentReviewMatch = plan.prompt.userMessage.match(
    /<current_review>\n([\s\S]*)\n<\/current_review>/u
  );

  assert.ok(currentReviewMatch, "expected <current_review> block in prompt");
  assert.equal(currentReviewMatch[1], reviewNoteFinalizer.render(context));
});

function createContextWithStep5Findings(): FileReviewContext {
  const context = createBaseContext();

  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "既有問題",
        traceability: lineRangeTraceability(14, 18),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 88
      }
    ]
  });

  return context;
}

function createContextWithStep5EmptyFindings(): FileReviewContext {
  const context = createBaseContext();
  context.updateStructuredState({ findings: [] });
  return context;
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
