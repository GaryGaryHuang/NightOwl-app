import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step2DependenciesBoundariesStep } from "../../../src/core/steps/step2-dependencies-boundaries.ts";
import {
  assertNightOwlSharedToolGuidance,
  assertJudgeCriteriaContains,
  assertSectionPlanShape,
  assertTaggedBlockContains,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../../helpers/step-prompt-contract-fixture.ts";

// `ReviewNoteFinalizer` renders the accumulated <current_review> block from all
// sections written so far; Steps 2-7 all receive it as prompt context.
test("Step2DependenciesBoundariesStep prepares the Step 2 prompt contract from diff and current review", () => {
  const context = createContextWithOverview();
  const step = new Step2DependenciesBoundariesStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assertSectionPlanShape(plan, {
    stepId: "step2-dependencies-boundaries",
    sectionKey: "dependencies-boundaries",
    reviewProfile: {
      dryRunStepContract: "dependencies-boundaries",
      model: "gpt-5.4-mini",
      timeoutMs: 300_000
    }
  });
  assertJudgeCriteriaContains(plan.completionCheck, [
    "段落 `## Dependencies & Boundaries` 必須存在",
    "相依清單",
    "Contract",
    "評估",
    "隱含相依",
    "無外部相依",
    "無"
  ]);

  assertTextContainsAll(plan.prompt.systemMessage, [
    "## Current Step: Dependencies & Boundaries",
    "Map the dependency and interaction boundaries",
    "Do not look for bugs",
    "Begin the response with `## Dependencies & Boundaries`."
  ]);
  assertNightOwlSharedToolGuidance(plan.prompt.systemMessage);

  assertTextContainsAll(plan.prompt.userMessage, [
    '<diff path="src/app.ts" base="main" head="feature-branch">',
    "Based on the diff and the Overview in <current_review>",
    "## Dependencies & Boundaries",
    "無外部相依",
    "隱含相依",
    "Contract",
    "評估"
  ]);
  assertTaggedBlockContains(plan.prompt.userMessage, "current_review", [
    "## Overview",
    "- 檔案職責：維護 app value",
    "- 測試覆蓋觀察：未見對應測試異動"
  ]);
  // From Step 2 onward the changeset overview is subsumed into the Overview
  // section of <current_review>, so the raw <changeset_context> tag is dropped.
  // "Review not yet generated." would appear only if the prior section was absent.
  assertTextExcludesAll(plan.prompt.userMessage, [
    "<changeset_context>",
    "Review not yet generated."
  ]);
});

function createContextWithOverview(): FileReviewContext {
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

  return context;
}
