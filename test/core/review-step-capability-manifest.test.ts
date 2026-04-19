import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_STEP_CAPABILITIES,
  getReviewStepCapability,
  resolveReviewKnowledgeMode
} from "../../src/core/review-step-capability-manifest.ts";

test("review step capability manifest covers Step 0 and every per-file step", () => {
  assert.equal(REVIEW_STEP_CAPABILITIES.length, 8);
  assert.deepEqual(
    REVIEW_STEP_CAPABILITIES.map((entry) => entry.stepId),
    [
      "changeset-overview",
      "step1-overview",
      "step2-dependencies-boundaries",
      "step3-knowledge-source-of-truth",
      "step4-strategy-what-if-scenarios",
      "step5-validation-interrogation",
      "step6-cognitive-simulation",
      "step7-summary"
    ]
  );
});

test("review step capability manifest narrows knowledge mode by step", () => {
  const expectations = new Map([
    ["changeset-overview", "built-in-context7"],
    ["step1-overview", "disabled"],
    ["step2-dependencies-boundaries", "disabled"],
    ["step3-knowledge-source-of-truth", "built-in-context7"],
    ["step4-strategy-what-if-scenarios", "disabled"],
    ["step5-validation-interrogation", "disabled"],
    ["step6-cognitive-simulation", "disabled"],
    ["step7-summary", "disabled"]
  ] as const);

  for (const [stepId, knowledgeMode] of expectations) {
    assert.equal(getReviewStepCapability(stepId).knowledgeMode, knowledgeMode, stepId);
  }
});

test("review step capability manifest keeps the shared review-default tool profile", () => {
  for (const entry of REVIEW_STEP_CAPABILITIES) {
    assert.equal(entry.toolProfile, "review-default", entry.stepId);
  }
});

test("resolveReviewKnowledgeMode rejects steps that are not declared in the manifest", () => {
  assert.throws(
    () => resolveReviewKnowledgeMode("step999-unknown"),
    /Unknown review step capability/
  );
});

test("review step capability manifest describes Step 5 structured artifact contracts", () => {
  const step5 = getReviewStepCapability("step5-validation-interrogation");

  assert.ok(step5.artifactInputs.includes("review-state"));
  assert.ok(step5.artifactInputs.includes("diff"));
  assert.ok(step5.artifactOutputs.includes("candidate-finding-set"));
});