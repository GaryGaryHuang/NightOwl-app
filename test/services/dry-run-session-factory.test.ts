import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DryRunReviewSessionFactory
} from "../../src/services/dry-run-review-session-factory.ts";
import {
  DryRunJudgeSessionFactory
} from "../../src/services/dry-run-judge-session-factory.ts";
import {
  buildDryRunChangesetOverviewResponse,
  getDryRunStubResponse,
  GENERIC_DRY_RUN_STUB
} from "../../src/services/dry-run-stub-catalog.ts";

describe("DryRunReviewSessionFactory stub mapping", () => {
  test("returns built-in stub for known stepId", async () => {
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

  test("returns generic fallback for unknown stepId", async () => {
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

  test("returns generic fallback when stepId is omitted", async () => {
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
});

describe("DryRunJudgeSessionFactory dry-run behavior", () => {
  test("approves regardless of prompt wording", async () => {
    const factory = new DryRunJudgeSessionFactory();
    const session = await factory.createSession({
      model: "gpt-5.4-mini",
      systemMessage: "judge system"
    });

    assert.equal(await session.sendAndWait("please evaluate"), "Y");
    assert.equal(await session.sendAndWait("N"), "Y");
  });
});

describe("Dry-run stub catalog completeness", () => {
  test("covers all built-in step IDs", () => {
    const builtInStepIds = [
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

  test("Step 0 (changeset-overview) is generated dynamically from the prompt", () => {
    const prompt = [
      "<changed_files>",
      "M\tsrc/foo.ts",
      "R100\tsrc/old.ts\tsrc/new.ts",
      "</changed_files>"
    ].join("\n");

    const response = buildDryRunChangesetOverviewResponse(prompt);
    const parsed = JSON.parse(response) as {
      schemaVersion: number;
      changedFiles: { path: string }[];
    };
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(
      parsed.changedFiles.map((entry) => entry.path),
      ["src/foo.ts", "src/new.ts"]
    );
  });
});
