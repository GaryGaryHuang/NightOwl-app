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

async function runDryRunReviewSession(
  dryRunStepContract: DryRunReviewStepContract,
  systemMessage?: string
): Promise<string | undefined> {
  const factory = new DryRunReviewSessionFactory();
  const session = await factory.createSession(
    buildProfile(dryRunStepContract, systemMessage)
  );

  return await session.sendAndWait(`prompt for ${dryRunStepContract}`);
}

test("DryRunReviewSessionFactory creates a non-empty stub session for every supported contract", async () => {
  for (const contract of DRY_RUN_REVIEW_STEP_CONTRACTS) {
    const response = await runDryRunReviewSession(contract);

    assert.equal(typeof response, "string");
    assert.notEqual(
      response?.trim(),
      "",
      `stub response must not be empty for contract: ${contract}`
    );
  }
});

test("DryRunReviewSessionFactory selects the stub response from the explicit contract instead of prompt wording", async () => {
  const misleadingSystemPrompt =
    "No step heading is present here. The contract must drive selection.";

  const overviewResponse = await runDryRunReviewSession(
    "overview",
    misleadingSystemPrompt
  );
  const findingsResponse = await runDryRunReviewSession(
    "validation-interrogation",
    misleadingSystemPrompt
  );

  assert.match(overviewResponse ?? "", /^## Overview/u);
  assert.deepEqual(JSON.parse(findingsResponse ?? ""), { findings: [] });
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

test("DryRunJudgeSessionFactory approves regardless of prompt wording", async () => {
  const factory = new DryRunJudgeSessionFactory();
  const session = await factory.createSession({
    model: "gpt-5.4-mini",
    systemMessage: "judge system"
  });

  assert.equal(await session.sendAndWait("please evaluate"), "Y");
  assert.equal(await session.sendAndWait("N"), "Y");
});
