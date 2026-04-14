import assert from "node:assert/strict";
import test from "node:test";

import {
  DryRunReviewSessionFactory
} from "../../src/services/dry-run-review-session-factory.ts";
import {
  DryRunJudgeSessionFactory
} from "../../src/services/dry-run-judge-session-factory.ts";
import {
  getDryRunStubResponse,
  GENERIC_DRY_RUN_STUB
} from "../../src/services/dry-run-stub-catalog.ts";

test("DryRunReviewSessionFactory returns built-in stub for known stepId", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    systemMessage: "step system",
    stepId: "step1-overview"
  });

  const response = await session.sendAndWait("please review");
  assert.equal(response, getDryRunStubResponse("step1-overview"));
});

test("DryRunReviewSessionFactory returns generic fallback for unknown stepId", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    systemMessage: "custom step system",
    stepId: "custom-added-step"
  });

  assert.equal(
    await session.sendAndWait("please review"),
    GENERIC_DRY_RUN_STUB
  );
});

test("DryRunReviewSessionFactory returns generic fallback when stepId is omitted", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    systemMessage: "no step id"
  });

  assert.equal(
    await session.sendAndWait("prompt"),
    GENERIC_DRY_RUN_STUB
  );
});

test("DryRunJudgeSessionFactory approves regardless of prompt wording", async () => {
  const factory = new DryRunJudgeSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    systemMessage: "judge system"
  });

  assert.equal(await session.sendAndWait("please evaluate"), "Y");
  assert.equal(await session.sendAndWait("N"), "Y");
});

test("stub catalog covers all built-in step IDs", () => {
  const builtInStepIds = [
    "changeset-overview",
    "step1-overview",
    "step2-dependencies-boundaries",
    "step3-knowledge-source-of-truth",
    "step4-strategy-what-if-scenarios",
    "step5-validation-interrogation",
    "step6-cognitive-simulation",
    "step7-summary"
  ];

  for (const stepId of builtInStepIds) {
    const stub = getDryRunStubResponse(stepId);
    assert.ok(stub !== undefined, `Missing stub catalog entry for stepId "${stepId}"`);
    assert.ok(stub.length > 0, `Empty stub response for stepId "${stepId}"`);
  }
});
