import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step5ValidationInterrogationStep } from "../../../src/core/steps/step5-validation-interrogation.ts";
import {
  assertNightOwlSharedToolGuidance,
  assertDeterministicFindingsCheck,
  assertStructuredPlanShape,
  assertTaggedBlockContains,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../../helpers/step-prompt-contract-fixture.ts";

test("Step5ValidationInterrogationStep prepares the Step 5 prompt contract from diff and current review", () => {
  const context = createContextWithStep4();
  const step = new Step5ValidationInterrogationStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  // Steps 5-6 produce structured JSON (findings array) rather than a Markdown
  // section; assertStructuredPlanShape verifies the structuredTarget contract.
  assertStructuredPlanShape(plan, {
    stepId: "step5-validation-interrogation",
    structuredTarget: "findings",
    reviewProfile: {
      dryRunStepContract: "validation-interrogation",
      model: "gpt-5.4-mini",
      timeoutMs: 300_000
    }
  });

  // completionCheck validates JSON structure rather than natural-language criteria.
  assertDeterministicFindingsCheck(plan.completionCheck);

  assertTextContainsAll(plan.prompt.systemMessage, [
    "## Current Step: Validation & Interrogation",
    "Every emitted finding must include a `traceability` object",
    "Do not force a finding for every scenario",
    "Output valid JSON only."
  ]);
  assertNightOwlSharedToolGuidance(plan.prompt.systemMessage);

  assertTextContainsAll(plan.prompt.userMessage, [
    '<diff path="src/app.ts" base="main" head="feature-branch">',
    "Based on the W# scenarios in the Strategy & What-if Scenarios section of <current_review>",
    "The `type` field must be either `\"must\"` or `\"nice\"`.",
    "Output exactly one JSON object",
    "{\"findings\": []}"
  ]);
  assertTaggedBlockContains(plan.prompt.userMessage, "current_review", [
    "## Overview",
    "## Dependencies & Boundaries",
    "## Knowledge & Source of Truth",
    "## Strategy & What-if Scenarios",
    "W1:",
    "W2:",
    "W3:"
  ]);

  // Step 5 starts fresh from W# scenarios — prior findings must not leak into
  // the <current_review> block or the model may anchor to them rather than
  // independently validating each scenario.
  assertTextExcludesAll(plan.prompt.userMessage, [
    "<changeset_context>",
    /^## Findings/mu
  ]);
});

function createContextWithStep4(): FileReviewContext {
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
