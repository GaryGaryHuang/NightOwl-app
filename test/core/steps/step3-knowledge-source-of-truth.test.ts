import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step3KnowledgeSourceOfTruthStep } from "../../../src/core/steps/step3-knowledge-source-of-truth.ts";
import {
  assertNightOwlSharedToolGuidance,
  assertResolveCriteriaContains,
  assertSectionPlanShape,
  assertTaggedBlockContains,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../../helpers/step-prompt-contract-fixture.ts";

test("Step3KnowledgeSourceOfTruthStep prepares the Step 3 prompt contract from diff and current review", async () => {
  const context = createContextWithStep2();
  const step = new Step3KnowledgeSourceOfTruthStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  // Step 3 is the only step that activates the built-in Context7 MCP server for
  // external knowledge retrieval; all other steps have knowledgeMode unset.
  assertSectionPlanShape(plan, {
    stepId: "step3-knowledge-source-of-truth",
    reviewProfile: {
      dryRunStepContract: "knowledge-source-of-truth",
      model: "gpt-5-mini",
      knowledgeMode: "built-in-context7",
      timeoutMs: 300_000
    }
  });
  await assertResolveCriteriaContains(plan, [
    "段落 `## Knowledge & Source of Truth` 必須存在",
    "版本／文件參考",
    "採用規則與假設",
    "排除範圍",
    "來源",
    "無"
  ]);

  assertTextContainsAll(plan.prompt.systemMessage, [
    "## Current Step: Knowledge & Source of Truth",
    "Use external retrieval only when genuine gaps remain",
    "prioritize source-of-truth material",
    "This step is for knowledge convergence"
  ]);
  assertNightOwlSharedToolGuidance(plan.prompt.systemMessage);

  assertTextContainsAll(plan.prompt.userMessage, [
    '<diff path="src/app.ts" base="main" head="feature-branch">',
    "Review the Overview and Dependencies & Boundaries in <current_review>",
    "## Knowledge & Source of Truth",
    "版本／文件參考",
    "採用規則與假設",
    "排除範圍"
  ]);
  assertTaggedBlockContains(plan.prompt.userMessage, "current_review", [
    "## Overview",
    "## Dependencies & Boundaries",
    "- 隱含相依：",
    "  - 無"
  ]);
  assertTextExcludesAll(plan.prompt.userMessage, [
    "<changeset_context>",
    "Review not yet generated."
  ]);
});

// The step must not pressure the model to fabricate knowledge: writing `無`
// (nothing applicable) or stating uncertainty explicitly are both valid outputs.
test("Step3KnowledgeSourceOfTruthStep prompt contract still allows explicit `無` and explicit uncertainty handling", () => {
  const context = createContextWithStep2();
  const step = new Step3KnowledgeSourceOfTruthStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assertTextContainsAll(plan.prompt.userMessage, [
    "write `無` under 版本／文件參考",
    "make that uncertainty explicit rather than overstating confidence"
  ]);
});

function createContextWithStep2(): FileReviewContext {
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

  return context;
}
