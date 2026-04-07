import assert from "node:assert/strict";

import type { DryRunReviewStepContract } from "../../src/services/dry-run-review-step-contract.ts";
import type { ReviewKnowledgeMode } from "../../src/core/review-knowledge-mode.ts";
import type { StepExecutionPlan } from "../../src/core/step-runner.ts";

type TextPattern = string | RegExp;

type ExpectedReviewProfile = {
  dryRunStepContract?: DryRunReviewStepContract;
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

// Asserts the completion check is a judge check and that its criteria text
// contains every expected pattern. The explicit kind guard prevents tests from
// silently passing when a step switched from judge to deterministic completion.
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

export function assertNightOwlSharedToolGuidance(text: string): void {
  assertTextContainsAll(text, [
    "use `bash` for git operations",
    "Use `web_fetch` and MCP tools only when the current step requires external knowledge verification"
  ]);
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

// Extracts the inner content of an XML-style tagged block from a prompt string,
// e.g. <diff path="...">\ncontent\n</diff>. Fails the test if the tag is absent.
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
  assert.equal(actual.dryRunStepContract, expected.dryRunStepContract);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
