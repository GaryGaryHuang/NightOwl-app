import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step4StrategyWhatIfScenariosStep } from "../../../src/core/steps/step4-strategy-what-if-scenarios.ts";
import {
  assertNightOwlSharedToolGuidance,
  assertJudgeCriteriaContains,
  assertSectionPlanShape,
  assertTaggedBlockContains,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../../helpers/step-prompt-contract-fixture.ts";

test("Step4StrategyWhatIfScenariosStep prepares the Step 4 prompt contract from diff and current review", () => {
  const context = createContextWithStep3();
  const step = new Step4StrategyWhatIfScenariosStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assertSectionPlanShape(plan, {
    stepId: "step4-strategy-what-if-scenarios",
    sectionKey: "strategy-what-if-scenarios",
    reviewProfile: {
      model: "gpt-5.4-mini",
      timeoutMs: 300_000
    }
  });
  assertJudgeCriteriaContains(plan.completionCheck, [
    "段落 `## Strategy & What-if Scenarios` 必須存在",
    "高風險區域",
    "What-if",
    "W1",
    "觸發條件或情境",
    "預期正確行為",
    "待驗證的風險或不確定性",
    "與本次改動的關聯"
  ]);

  assertTextContainsAll(plan.prompt.systemMessage, [
    "## Current Step: Strategy & What-if Scenarios",
    "Do not perform the validation itself",
    "Each What-if scenario must be a neutral, testable hypothesis",
    "Begin the response with `## Strategy & What-if Scenarios`."
  ]);
  assertNightOwlSharedToolGuidance(plan.prompt.systemMessage);

  assertTextContainsAll(plan.prompt.userMessage, [
    '<diff path="src/app.ts" base="main" head="feature-branch">',
    "Based on the Overview, Dependencies & Boundaries, and Knowledge & Source of Truth in <current_review>",
    "At least 3 What-if scenarios",
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    "- What-if 假設情境：",
    "W1",
    "W2"
  ]);
  assertTaggedBlockContains(plan.prompt.userMessage, "current_review", [
    "## Overview",
    "## Dependencies & Boundaries",
    "## Knowledge & Source of Truth"
  ]);
  assertTextExcludesAll(plan.prompt.userMessage, [
    "<changeset_context>",
    "Review not yet generated."
  ]);
});

// Step 4 is a plain Markdown section step — `applyTo` only writes to the
// strategy-what-if-scenarios section and must not populate findings or advance
// into Steps 5-6 territory. This distinguishes section steps (1-4, 7) from the
// structured JSON steps (5-6).
test("Step4StrategyWhatIfScenariosStep remains a section-only state update under strategy-what-if-scenarios", () => {
  const context = createContextWithStep3();
  const step = new Step4StrategyWhatIfScenariosStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);
  const responseText = [
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    "  - state transition：本次改動調整了 value 更新路徑",
    "- What-if 假設情境：",
    "  - W1: 觸發條件：輸入為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整流程",
    "  - W2: 觸發條件：依賴回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否變動；與本次改動的關聯：Step 2 已標示依賴邊界",
    "  - W3: 觸發條件：重複呼叫；預期正確行為：結果應保持穩定；待驗證風險/不確定性：狀態是否累積偏移；與本次改動的關聯：Step 3 已收斂假設"
  ].join("\n");

  assert.equal(context.getSection("strategy-what-if-scenarios"), undefined);

  plan.applyTo(context, responseText);

  assert.equal(context.getSection("strategy-what-if-scenarios"), responseText);
  assert.doesNotMatch(context.getSection("strategy-what-if-scenarios") ?? "", /^## Findings/mu);
  assert.doesNotMatch(context.getSection("strategy-what-if-scenarios") ?? "", /Step 5|Step 6|Step 7/u);
});

function createContextWithStep3(): FileReviewContext {
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

  return context;
}
