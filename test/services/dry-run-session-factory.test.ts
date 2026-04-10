import assert from "node:assert/strict";
import test from "node:test";

import {
  DryRunReviewSessionFactory,
  DryRunJudgeSessionFactory,
  type DryRunReviewSessionProfile
} from "../../src/services/dry-run-session-factory.ts";
import {
  DRY_RUN_REVIEW_STEP_CONTRACTS
} from "../../src/services/dry-run-review-step-contract.ts";
import {
  getDryRunStubResponse
} from "../../src/services/dry-run-stub-catalog.ts";
import type { DryRunReviewStepContract } from "../../src/services/dry-run-review-step-contract.ts";

function buildProfile(
  dryRunStepContract: DryRunReviewStepContract,
  systemMessage = "Completely different system prompt text."
) {
  return {
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage,
    dryRunStepContract
  };
}

test("DryRunReviewSessionFactory maps every supported contract to the catalog stub response", async () => {
  const factory = new DryRunReviewSessionFactory();
  for (const contract of DRY_RUN_REVIEW_STEP_CONTRACTS) {
    const session = await factory.createSession(buildProfile(contract));
    const response = await session.sendAndWait(`prompt for ${contract}`);

    assert.equal(
      response,
      getDryRunStubResponse(contract),
      `unexpected stub response for contract: ${contract}`
    );
  }
});

test("DryRunReviewSessionFactory ignores system prompt wording when the explicit contract is unchanged", async () => {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(
    buildProfile(
      "overview",
      "No step heading is present here. The contract must drive selection."
    )
  );
  const response = await session.sendAndWait("prompt");

  assert.equal(response, getDryRunStubResponse("overview"));
});

test("DryRunReviewSessionFactory rejects a missing contract with a dry-run contract failure", async () => {
  const factory = new DryRunReviewSessionFactory();

  await assert.rejects(
    () =>
      factory.createSession(
        // Type assertion bypasses compile-time check to verify runtime missing-contract detection.
        {
          model: "gpt-5.4-mini",
          outputBaseDir: "/workspace/repo",
          repoRoot: "/workspace/repo",
          systemMessage: "system prompt"
        } as Omit<DryRunReviewSessionProfile, "dryRunStepContract"> as DryRunReviewSessionProfile
      ),
    /dry-run contract failure: missing dryRunStepContract/u
  );
});

test("DryRunReviewSessionFactory rejects an unsupported contract with a dry-run contract failure", async () => {
  const factory = new DryRunReviewSessionFactory();

  await assert.rejects(
    () =>
      factory.createSession({
        model: "gpt-5.4-mini",
        outputBaseDir: "/workspace/repo",
        repoRoot: "/workspace/repo",
        systemMessage: "system prompt",
        dryRunStepContract: "unknown-step" as DryRunReviewStepContract
      } as DryRunReviewSessionProfile),
    /dry-run contract failure: unsupported dryRunStepContract 'unknown-step'/u
  );
});

test("DryRunJudgeSessionFactory always returns Y across repeated prompts", async () => {
  const factory = new DryRunJudgeSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    systemMessage: "judge system"
  });

  assert.equal(await session.sendAndWait("please evaluate"), "Y");
  assert.equal(await session.sendAndWait("N"), "Y");
  assert.equal(await session.sendAndWait(""), "Y");
  assert.equal(await session.sendAndWait("some long prompt"), "Y");
});
