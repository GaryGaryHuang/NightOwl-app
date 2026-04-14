import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, before, after, test } from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import type { ReviewPerFileStepsFactory } from "../../src/core/orchestrator.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import type { StepDefinition } from "../../src/core/step-runner.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";

/**
 * End-to-end dry-run integration tests.
 *
 * These tests run the full review pipeline with dryRun: true on a real
 * git repo fixture, using the production DryRunReviewSessionFactory and
 * DryRunJudgeSessionFactory. No Copilot SDK or AI API is invoked.
 *
 * Verifies only generic dry-run behavior:
 *  - clientManager.start() / stop() are never called
 *  - Output folder structure matches production layout
 *  - tool-audit.jsonl is empty (no SDK tool calls)
 *  - skipped.md has no skipped file records
 */
describe("dry-run integration", () => {
  let fixture: ReviewRepoFixture;
  let result: ReviewRunSummary;
  let clientManagerStartCalls: number;
  let clientManagerStopCalls: number;

  before(async () => {
    fixture = createReviewRepoFixture();
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    clientManagerStartCalls = 0;
    clientManagerStopCalls = 0;

    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03300940",
      clientManager: {
        async start() {
          clientManagerStartCalls += 1;
        },
        async stop() {
          clientManagerStopCalls += 1;
        },
        async forceStop() {},
        getClient() {
          throw new Error("clientManager.getClient() must not be called in dry-run");
        }
      }
    });

    result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: true
    });
  });

  after(() => {
    fixture.cleanup();
  });

  test("clientManager lifecycle methods are never invoked", () => {
    assert.equal(clientManagerStartCalls, 0, "clientManager.start() must not be called in dry-run");
    assert.equal(clientManagerStopCalls, 0, "clientManager.stop() must not be called in dry-run");
  });

  test("result metadata reflects dry-run mode", () => {
    assert.equal(result.dryRun, true);
    assert.equal(result.skippedFileCount, 0, "dry-run should skip no files");
    assert.ok(result.successfulFileCount > 0, "dry-run should process at least one file");
  });

  test("output folder contains all required artifacts", () => {
    const { outputTarget } = result;
    assert.ok(existsSync(outputTarget.filesPath), "files/ directory must exist");
    assert.ok(existsSync(outputTarget.changesetOverviewPath), "changeset-overview.md must exist");
    assert.ok(existsSync(outputTarget.summaryPath), "summary.md must exist");
    assert.ok(existsSync(outputTarget.indexPath), "index.md must exist");
    assert.ok(existsSync(outputTarget.manifestPath), "manifest.json must exist");
    assert.ok(existsSync(outputTarget.toolAuditPath), "tool-audit.jsonl must exist");
    assert.ok(existsSync(outputTarget.skippedPath), "skipped.md must exist");
  });

  test("tool-audit.jsonl is empty (no SDK calls in dry-run)", () => {
    const content = readFileSync(result.outputTarget.toolAuditPath, "utf8");
    assert.equal(content.trim(), "", "tool-audit.jsonl must be empty in dry-run");
  });

  test("skipped.md contains no skipped file records", () => {
    const content = readFileSync(result.outputTarget.skippedPath, "utf8");
    assert.ok(!content.includes("##"), "skipped.md should have no skipped file sections in dry-run");
  });
});

interface DryRunStepExecutionRecord {
  filePath: string;
  stepId: string;
}

function createDryRunOnlyStep(
  stepId: string,
  executionLog: DryRunStepExecutionRecord[]
): StepDefinition {
  return {
    stepId,
    prepare(context) {
      return {
        stepId,
        prompt: {
          systemMessage: `custom system for ${stepId}`,
          userMessage: `custom prompt for ${context.filePath}`
        },
        reviewProfile: {
          model: "gpt-5-mini"
        },
        async resolve(actualResponse: string) {
          assert.ok(actualResponse.length > 0, "dry-run should produce a non-empty response");

          return () => {
            executionLog.push({ filePath: context.filePath, stepId });
          };
        }
      };
    }
  };
}

function createCustomPerFileStepsFactory(
  stepIds: readonly string[],
  executionLog: DryRunStepExecutionRecord[]
): ReviewPerFileStepsFactory {
  return () => stepIds.map((stepId) => createDryRunOnlyStep(stepId, executionLog));
}

function collectStepIdsByFile(
  executionLog: readonly DryRunStepExecutionRecord[]
): Map<string, string[]> {
  const stepIdsByFile = new Map<string, string[]>();

  for (const entry of executionLog) {
    const steps = stepIdsByFile.get(entry.filePath) ?? [];
    steps.push(entry.stepId);
    stepIdsByFile.set(entry.filePath, steps);
  }

  return stepIdsByFile;
}

async function runDryRunWithCustomStepTopology(
  stepIds: readonly string[]
): Promise<{
  executionLog: DryRunStepExecutionRecord[];
  fixture: ReviewRepoFixture;
  result: ReviewRunSummary;
}> {
  const executionLog: DryRunStepExecutionRecord[] = [];
  const fixture = createReviewRepoFixture();
  fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

  const app = createLocalReviewRunApp({
    workingDirectory: fixture.repoDir,
    timestampProvider: () => "03300941",
    perFileStepsFactory: createCustomPerFileStepsFactory(stepIds, executionLog),
    reviewConfigProvider: {
      async loadReviewConfig() {
        return {
          maxConcurrentFiles: 1,
          confidenceThresholds: {
            must: 80,
            nice: 90
          },
          mcpServers: {}
        };
      }
    },
    clientManager: {
      async start() {
        throw new Error("clientManager.start() must not be called in dry-run");
      },
      async stop() {
        throw new Error("clientManager.stop() must not be called in dry-run");
      },
      async forceStop() {},
      getClient() {
        throw new Error("clientManager.getClient() must not be called in dry-run");
      }
    }
  });

  const result = await app.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: "./packages/app",
    userContext: [],
    dryRun: true
  });

  return { executionLog, fixture, result };
}

function assertCustomTopologyRun(
  result: ReviewRunSummary,
  executionLog: readonly DryRunStepExecutionRecord[],
  expectedStepIds: readonly string[]
): void {
  assert.equal(result.dryRun, true);
  assert.equal(result.skippedFileCount, 0);
  assert.ok(result.successfulFileCount > 0, "dry-run should process at least one file");
  assert.equal(
    executionLog.length,
    result.successfulFileCount * expectedStepIds.length
  );

  const stepIdsByFile = collectStepIdsByFile(executionLog);
  assert.equal(stepIdsByFile.size, result.successfulFileCount);

  for (const stepIds of stepIdsByFile.values()) {
    assert.deepEqual(stepIds, [...expectedStepIds]);
  }
}

test("dry-run still succeeds when a custom step is added to the per-file topology", async () => {
  const stepIds = ["custom-overview", "custom-added-step", "custom-summary"];
  const { fixture, result, executionLog } = await runDryRunWithCustomStepTopology(stepIds);

  try {
    assertCustomTopologyRun(result, executionLog, stepIds);
  } finally {
    fixture.cleanup();
  }
});

test("dry-run still succeeds when a step is removed from the per-file topology", async () => {
  const stepIds = ["custom-overview", "custom-summary"];
  const { fixture, result, executionLog } = await runDryRunWithCustomStepTopology(stepIds);

  try {
    assertCustomTopologyRun(result, executionLog, stepIds);
  } finally {
    fixture.cleanup();
  }
});

test("dry-run still succeeds when the per-file steps are reordered", async () => {
  const stepIds = ["custom-summary", "custom-overview", "custom-added-step"];
  const { fixture, result, executionLog } = await runDryRunWithCustomStepTopology(stepIds);

  try {
    assertCustomTopologyRun(result, executionLog, stepIds);
  } finally {
    fixture.cleanup();
  }
});
