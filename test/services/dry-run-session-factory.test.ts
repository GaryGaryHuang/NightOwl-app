import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DryRunReviewSessionFactory
} from "../../src/services/dry-run-review-session-factory.ts";
import {
  DryRunJudgeSessionFactory
} from "../../src/services/dry-run-judge-session-factory.ts";
import {
  BUILT_IN_DRY_RUN_STEP_IDS,
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
      stepId: "step7-summary"
    });

    const response = await session.sendAndWait("please review");
    assert.equal(response, getDryRunStubResponse("step7-summary"));
  });

  test("falls back to generic stub for removed legacy Step 1-4 step IDs", async () => {
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
    assert.equal(response, "[dry-run] No built-in stub template for this step.");
  });
});

describe("DryRunJudgeSessionFactory dry-run behavior", () => {
  test("approves regardless of prompt wording", async () => {
    const factory = new DryRunJudgeSessionFactory();
    const firstSession = await factory.createSession({
      model: "gpt-5.4-mini",
      systemMessage: "judge system"
    });
    const secondSession = await factory.createSession({
      model: "gpt-5.4-mini",
      systemMessage: "judge system"
    });

    assert.equal(await firstSession.sendAndWait("please evaluate"), "Y");
    assert.equal(await secondSession.sendAndWait("N"), "Y");
  });

  test("honors a custom responseProvider override (e.g., simulate denial)", async () => {
    const seenProfiles: { model: string; systemMessage: string }[] = [];
    const factory = new DryRunJudgeSessionFactory({
      responseProvider: (prompt, profile) => {
        seenProfiles.push({
          model: profile.model,
          systemMessage: profile.systemMessage
        });
        return prompt.includes("deny") ? "N" : "Y";
      }
    });

    const session = await factory.createSession({
      model: "gpt-5.4-mini",
      systemMessage: "judge system"
    });

    assert.equal(await session.sendAndWait("please deny this"), "N");
    assert.deepEqual(seenProfiles, [
      { model: "gpt-5.4-mini", systemMessage: "judge system" }
    ]);
  });
});

describe("Dry-run stub catalog completeness", () => {
  test("covers all built-in step IDs", () => {
    for (const stepId of BUILT_IN_DRY_RUN_STEP_IDS) {
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
      "C75\tsrc/original.ts\tsrc/copied.ts",
      "</changed_files>"
    ].join("\n");

    const response = buildDryRunChangesetOverviewResponse(prompt);
    const parsed = JSON.parse(response) as {
      schemaVersion: number;
      overviewMarkdown: string;
      behaviorChanges: { files: string[] }[];
    };
    assert.equal(parsed.schemaVersion, 2);
    assert.deepEqual(parsed.behaviorChanges[0]?.files, [
      "src/added.ts",
      "src/foo.ts",
      "src/deleted.ts",
      "src/copied.ts"
    ]);
    assert.match(parsed.overviewMarkdown, /^## Changeset Overview\n- Scope:/u);
    assert.equal(parsed.overviewMarkdown.includes("### Scope"), false);
  });
});
