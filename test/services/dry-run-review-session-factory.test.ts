import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DryRunReviewSessionFactory
} from "../../src/services/dry-run-review-session-factory.ts";
import {
  getDryRunStubResponse
} from "../../src/services/dry-run-stub-catalog.ts";

describe("DryRunReviewSessionFactory stub mapping", () => {
  test("returns built-in stub for known stepId", async () => {
    const factory = new DryRunReviewSessionFactory();
    const session = await factory.createSession({
      knowledgeMode: "disabled",
      model: "gpt-5.4-mini",
      outputBaseDir: "/workspace/output",
      repoRoot: "/workspace/repo",
      systemMessage: "step system",
      stepId: "review-summary"
    });

    const response = await session.sendAndWait("please review");
    assert.equal(response, getDryRunStubResponse("review-summary"));
  });

  test("falls back to generic stub for unknown step IDs", async () => {
    const factory = new DryRunReviewSessionFactory();
    const session = await factory.createSession({
      knowledgeMode: "disabled",
      model: "gpt-5.4-mini",
      outputBaseDir: "/workspace/output",
      repoRoot: "/workspace/repo",
      systemMessage: "step system",
      stepId: "custom-diagnostic-step"
    });

    const response = await session.sendAndWait("please review");
    assert.equal(response, "[dry-run] No built-in stub template for this step.");
  });
});
