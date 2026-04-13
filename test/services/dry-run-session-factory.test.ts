import assert from "node:assert/strict";
import test from "node:test";

import {
  DryRunReviewSessionFactory,
  DryRunJudgeSessionFactory
} from "../../src/services/dry-run-session-factory.ts";

test("DryRunReviewSessionFactory accepts custom step-provided responses for unknown contracts", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    systemMessage: "custom step system",
    dryRunStepContract: "custom-added-step",
    dryRunResponse: "custom dry-run response"
  });

  assert.equal(
    await session.sendAndWait("please review"),
    "custom dry-run response"
  );
});

test("DryRunReviewSessionFactory rejects unknown contracts without a custom dry-run response", async () => {
  const factory = new DryRunReviewSessionFactory();

  await assert.rejects(
    () =>
      factory.createSession({
        model: "gpt-5.4-mini",
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo",
        systemMessage: "custom step system",
        dryRunStepContract: "custom-added-step"
      }),
    /without dryRunResponse/u
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
