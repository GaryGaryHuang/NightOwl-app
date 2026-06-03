import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DryRunReviewSessionFactory
} from "../../src/services/dry-run-review-session-factory.ts";

describe("DryRunReviewSessionFactory stub mapping", () => {
  test("returns a response for known stepId", async () => {
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
    assert.notEqual(response, undefined);
  });

  test("returns a response for unknown step IDs", async () => {
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
    assert.notEqual(response, undefined);
  });
});
