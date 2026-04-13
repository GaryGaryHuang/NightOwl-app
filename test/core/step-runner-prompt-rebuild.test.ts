import assert from "node:assert/strict";
import test from "node:test";

import { ReviewNoteFinalizer } from "../../src/core/finalizer.ts";
import { Step2DependenciesBoundariesStep } from "../../src/core/steps/step2-dependencies-boundaries.ts";
import { Step3KnowledgeSourceOfTruthStep } from "../../src/core/steps/step3-knowledge-source-of-truth.ts";
import { Step4StrategyWhatIfScenariosStep } from "../../src/core/steps/step4-strategy-what-if-scenarios.ts";
import { Step7SummaryStep } from "../../src/core/steps/step7-summary.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import {
  assertPromptRebuildOnRetry,
  createReviewSessionFactory,
  createStepRunnerContext,
  FINAL_FINDING,
  lineRangeTraceability,
  SECTION_SEEDS,
  seedStep4Context,
  SUMMARY_RESPONSE
} from "../helpers/step-runner-contract-fixture.ts";

// On retry the prompt is rebuilt from the context's *committed* state (the last
// successful section), so provisional content from the first attempt never leaks
// into the retry. prompts[0] === prompts[1] proves this.
test("StepRunner rebuilds Step 2 current review from the last successful state on retry and does not leak provisional content", async () => {
  await assertPromptRebuildOnRetry({
    seedSections: ["overview"],
    step: new Step2DependenciesBoundariesStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    response: SECTION_SEEDS["dependencies-boundaries"],
    expectedPromptLandmark: /## Overview/u,
    provisionalLabel: "provisional step 2",
    resultSectionKey: "dependencies-boundaries",
    resultPattern: /^## Dependencies & Boundaries/u
  });
});

test("StepRunner rebuilds Step 3 current review from the last successful Step 2 state on retry and does not leak provisional content", async () => {
  await assertPromptRebuildOnRetry({
    seedSections: ["overview", "dependencies-boundaries"],
    step: new Step3KnowledgeSourceOfTruthStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    response: SECTION_SEEDS["knowledge-source-of-truth"],
    expectedPromptLandmark: /## Dependencies & Boundaries/u,
    provisionalLabel: "provisional step 3",
    resultSectionKey: "knowledge-source-of-truth",
    resultPattern: /^## Knowledge & Source of Truth/u
  });
});

test("StepRunner rebuilds Step 4 current review from the last successful Step 3 state on retry and does not leak provisional content", async () => {
  await assertPromptRebuildOnRetry({
    seedSections: ["overview", "dependencies-boundaries", "knowledge-source-of-truth"],
    step: new Step4StrategyWhatIfScenariosStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    response: SECTION_SEEDS["strategy-what-if-scenarios"],
    expectedPromptLandmark: /## Knowledge & Source of Truth/u,
    provisionalLabel: "provisional step 4",
    resultSectionKey: "strategy-what-if-scenarios",
    resultPattern: /^## Strategy & What-if Scenarios/u,
    extraAssertions(context) {
      assert.doesNotMatch(
        context.getSection("strategy-what-if-scenarios") ?? "",
        /^## Findings/mu
      );
    }
  });
});

test("StepRunner applies Step 7 section output under summary without changing findings", async () => {
  const context = createStepRunnerContext();
  seedStep4Context(context);
  context.setFindings([FINAL_FINDING]);

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return SUMMARY_RESPONSE;
      }
    }),
    judgeService: {
      async evaluate() {
        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: new Step7SummaryStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(context.getSection("summary"), undefined);
  assert.deepEqual(context.getStructuredState(), { findings: [FINAL_FINDING] });

  result.applyTo(context);

  assert.match(context.getSection("summary") ?? "", /^## Summary/u);
  assert.deepEqual(context.getStructuredState(), { findings: [FINAL_FINDING] });
});

test("StepRunner rebuilds Step 7 current review from the last successful Step 6 state on retry and does not leak provisional content", async () => {
  const prompts: string[] = [];
  const context = createStepRunnerContext();
  seedStep4Context(context);
  context.setFindings([
    { ...FINAL_FINDING, traceability: lineRangeTraceability(1, 1) }
  ]);

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        prompts.push(prompt);
        return SUMMARY_RESPONSE;
      }
    }),
    judgeService: {
      async evaluate(input) {
        if (prompts.length === 1) {
          assert.doesNotMatch(input.sectionContent, /provisional step 7/u);
          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: new Step7SummaryStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.match(prompts[0] ?? "", /<current_review>[\s\S]*## Findings[\s\S]*最終 findings/u);
  assert.doesNotMatch(prompts[0] ?? "", /<diff/u);
  assert.doesNotMatch(prompts[0] ?? "", /<changeset_context>/u);
  assert.doesNotMatch(prompts[0] ?? "", /provisional step 7/u);
  assert.equal(context.getSection("summary"), undefined);

  result.applyTo(context);

  assert.match(context.getSection("summary") ?? "", /^## Summary/u);
});
