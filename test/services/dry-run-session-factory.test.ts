import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { REVIEW_STEP_CAPABILITIES } from "../../src/core/review-step-capability-manifest.ts";
import {
  DryRunReviewSessionFactory
} from "../../src/services/dry-run-review-session-factory.ts";
import {
  DryRunJudgeSessionFactory
} from "../../src/services/dry-run-judge-session-factory.ts";
import {
  buildDryRunChangesetOverviewResponse,
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
      stepId: "step1-overview"
    });

    const response = await session.sendAndWait("please review");
    assert.equal(response, getDryRunStubResponse("step1-overview"));
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
    const builtInStepIds = REVIEW_STEP_CAPABILITIES
      .map((capability) => capability.stepId)
      .filter((stepId) => stepId !== "changeset-overview");

    for (const stepId of builtInStepIds) {
      const stub = getDryRunStubResponse(stepId);
      assert.ok(stub !== undefined, `Missing stub catalog entry for stepId "${stepId}"`);
      assert.ok(stub.length > 0, `Empty stub response for stepId "${stepId}"`);
    }
  });

  test("Step 0 (changeset-overview) is generated dynamically from the prompt with normalized statuses and template markdown", () => {
    const prompt = [
      "<changed_files>",
      "A\tsrc/added.ts",
      "M\tsrc/foo.ts",
      "D\tsrc/deleted.ts",
      "</changed_files>"
    ].join("\n");

    const response = buildDryRunChangesetOverviewResponse(prompt);
    const parsed = JSON.parse(response) as {
      schemaVersion: number;
      overviewMarkdown: string;
      changedFiles: { path: string; status: string }[];
    };
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(
      parsed.changedFiles.map(({ path, status }) => ({ path, status })),
      [
        { path: "src/added.ts", status: "A" },
        { path: "src/foo.ts", status: "M" },
        { path: "src/deleted.ts", status: "D" }
      ]
    );
    assert.match(parsed.overviewMarkdown, /^## Changeset Overview\n- Scope:/u);
    assert.equal(parsed.overviewMarkdown.includes("### Scope"), false);
  });
});
