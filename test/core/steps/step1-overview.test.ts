import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { createRunContext } from "../../../src/core/run-context.ts";
import { Step1OverviewStep } from "../../../src/core/steps/step1-overview.ts";
import {
  assertJudgeCriteriaContains,
  assertSectionPlanShape,
  assertTaggedBlockContains,
  assertTextContainsAll,
  assertTextExcludesAll
} from "../../helpers/step-prompt-contract-fixture.ts";

// Step 1 is the only step that draws from RunContext (Step 0 output) rather than
// prior step sections; it seeds the per-file review with changeset context and
// file-level diff.
test("Step1OverviewStep prepares the Step 1 prompt contract from RunContext and file metadata", () => {
  const runContext = createRunContext({
    changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
    userContext: []
  });
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/.nightowl/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  const step = new Step1OverviewStep({ runContext });

  const plan = step.prepare(context);

  assertSectionPlanShape(plan, {
    stepId: "step1-overview",
    sectionKey: "overview",
    reviewProfile: {
      model: "gpt-5-mini",
      timeoutMs: 300_000
    }
  });
  assertJudgeCriteriaContains(plan.completionCheck, [
    "段落 `## Overview` 必須存在",
    "整體理解",
    "行為變更",
    "檔案職責",
    "改動目的",
    "影響範圍",
    "測試覆蓋觀察"
  ]);

  assertTextContainsAll(plan.prompt.systemMessage, [
    "## Current Step: Overview",
    "Combine `<changeset_context>` with the file-level `<diff>`",
    "Do NOT look for bugs",
    "Begin the response with `## Overview`."
  ]);

  assertTaggedBlockContains(plan.prompt.userMessage, "changeset_context", [
    "## Changeset Overview",
    "- 調整範圍：feature"
  ]);
  assertTextContainsAll(plan.prompt.userMessage, [
    '<diff path="src/app.ts" base="main" head="feature-branch">',
    "@@ -1 +1 @@",
    "-export const value = 1;",
    "+export const value = 2;",
    "Read `<changeset_context>` and `<diff>`",
    "## Overview",
    "- 整體理解：",
    "- 行為變更：",
    "- 檔案職責：",
    "- 改動目的：",
    "- 影響範圍：",
    "- 測試覆蓋觀察："
  ]);

  // Step 1 is the first step, so no accumulated review exists yet.
  assertTextExcludesAll(plan.prompt.userMessage, ["<current_review>"]);
});
