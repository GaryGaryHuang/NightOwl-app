import assert from "node:assert/strict";

import type { ReviewKnowledgeMode } from "../../src/core/review-knowledge-mode.ts";
import type { StepExecutionPlan } from "../../src/core/step-runner.ts";

type TextPattern = string | RegExp;

type ExpectedReviewProfile = {
  model: string;
  timeoutMs: number;
  knowledgeMode?: ReviewKnowledgeMode;
};

export function assertSectionPlanShape(
  plan: StepExecutionPlan,
  expected: {
    stepId: string;
    sectionKey: string;
    reviewProfile: ExpectedReviewProfile;
  }
): void {
  assert.equal(plan.stepId, expected.stepId);
  assert.equal(plan.kind, "section");
  assert.equal(plan.sectionKey, expected.sectionKey);
  assertReviewProfile(plan.reviewProfile, expected.reviewProfile);
}

export function assertStructuredPlanShape(
  plan: StepExecutionPlan,
  expected: {
    stepId: string;
    structuredTarget: "findings";
    reviewProfile: ExpectedReviewProfile;
  }
): void {
  assert.equal(plan.stepId, expected.stepId);
  assert.equal(plan.kind, "structured");
  assert.equal(plan.structuredTarget, expected.structuredTarget);
  assertReviewProfile(plan.reviewProfile, expected.reviewProfile);
}

export function assertJudgeCriteriaContains(
  completionCheck: StepExecutionPlan["completionCheck"],
  patterns: TextPattern[]
): void {
  assert.ok(completionCheck);
  assert.equal(completionCheck?.kind, "judge");
  assertTextContainsAll(
    completionCheck?.kind === "judge" ? completionCheck.criteria : "",
    patterns
  );
}

export function assertDeterministicFindingsCheck(
  completionCheck: StepExecutionPlan["completionCheck"]
): void {
  assert.deepEqual(completionCheck, {
    kind: "deterministic",
    validatorId: "findings-json"
  });
}

export function assertTextContainsAll(
  text: string,
  patterns: TextPattern[]
): void {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      assert.match(text, new RegExp(escapeRegExp(pattern), "u"));
      continue;
    }

    assert.match(text, pattern);
  }
}

export function assertTextExcludesAll(
  text: string,
  patterns: TextPattern[]
): void {
  for (const pattern of patterns) {
    if (typeof pattern === "string") {
      assert.doesNotMatch(text, new RegExp(escapeRegExp(pattern), "u"));
      continue;
    }

    assert.doesNotMatch(text, pattern);
  }
}

export function assertTaggedBlockContains(
  text: string,
  tagName: string,
  patterns: TextPattern[]
): void {
  assertTextContainsAll(getTaggedBlock(text, tagName), patterns);
}

export function assertTaggedBlockExcludes(
  text: string,
  tagName: string,
  patterns: TextPattern[]
): void {
  assertTextExcludesAll(getTaggedBlock(text, tagName), patterns);
}

export function getTaggedBlock(text: string, tagName: string): string {
  const match = text.match(
    new RegExp(
      `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>\\n([\\s\\S]*?)\\n<\\/${escapeRegExp(tagName)}>`,
      "u"
    )
  );

  assert.ok(match, `expected <${tagName}> block in prompt`);
  return match[1];
}

function assertReviewProfile(
  actual: StepExecutionPlan["reviewProfile"],
  expected: ExpectedReviewProfile
): void {
  assert.equal(actual.model, expected.model);
  assert.equal(actual.timeoutMs, expected.timeoutMs);
  assert.equal(actual.knowledgeMode, expected.knowledgeMode);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
