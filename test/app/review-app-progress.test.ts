import assert from "node:assert/strict";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";

test("createLocalReviewRunApp emits deterministic progress events for planning, per-file progress, skip, and finalizing", async () => {
  const events: string[] = [];
  let step2FailureTriggered = false;

  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    timestampProvider: () => "03131430",
    sourceProvider: {
      resolveRepoRoot() {
        return "/workspace/repo";
      },
      getChangesetEntries() {
        return ["src/app.ts", "packages/app/index.ts"];
      },
      getCurrentBranch() {
        return "feature-branch";
      },
      getChangedFiles() {
        return ["src/app.ts", "packages/app/index.ts"];
      },
      filterIgnoredFiles(_repoRoot, files) {
        return files;
      },
      getDiff(_repoRoot, _baseRef, _headRef, filePath) {
        return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`;
      }
    },
    reviewConfigProvider: {
      loadReviewConfig() {
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
      async start() {},
      async stop() {},
      async forceStop() {},
      getClient() {
        throw new Error("unused");
      }
    },
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
          userContext: []
        });
      }
    },
    outputSink: {
      initializeRun() {},
      publishFileReview() {},
      publishSkippedFile() {},
      publishRunSummary() {},
      publishReviewIndex() {},
      publishRunManifest() {},
      publishChangesetOverview() {}
    },
    stepRunner: {
      async run({ step, context }) {
        if (
          context.filePath === "packages/app/index.ts" &&
          step.stepId === "step2-dependencies-boundaries" &&
          !step2FailureTriggered
        ) {
          step2FailureTriggered = true;
          throw new Error("deterministic validation failed");
        }

        return buildSuccessfulStepResult(step.stepId, context.filePath);
      }
    },
    onProgressEvent(event) {
      events.push(renderProgressEvent(event));
    }
  });

  const result = await app.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: false
  });

  assert.equal(result.plannedFileCount, 2);
  assert.equal(result.successfulFileCount, 1);
  assert.equal(result.skippedFileCount, 1);
  assert.deepEqual(events, [
    "phase:step0",
    "phase:planning",
    "initialized:2:/workspace/repo/.nightowl/review/feature-branch_03131430",
    "phase:reviewing",
    "claimed:1:src/app.ts",
    "progress:src/app.ts:step1-overview",
    "progress:src/app.ts:step2-dependencies-boundaries",
    "progress:src/app.ts:step3-knowledge-source-of-truth",
    "progress:src/app.ts:step4-strategy-what-if-scenarios",
    "progress:src/app.ts:step5-validation-interrogation",
    "progress:src/app.ts:step6-cognitive-simulation",
    "progress:src/app.ts:step7-summary",
    "completed:src/app.ts:1:0",
    "claimed:2:packages/app/index.ts",
    "progress:packages/app/index.ts:step1-overview",
    "skipped:packages/app/index.ts:step2-dependencies-boundaries:deterministic validation failed:1:1",
    "finalizing:2:1:1"
  ]);
});

function renderProgressEvent(event: any): string {
  switch (event.type) {
    case "phase-changed":
      return `phase:${event.phase}`;
    case "run-initialized":
      return `initialized:${event.plannedFileCount}:${event.outputTarget.basePath}`;
    case "file-claimed":
      return `claimed:${event.claimOrder}:${event.filePath}`;
    case "file-progressed":
      return `progress:${event.filePath}:${event.stepId}`;
    case "file-completed":
      return `completed:${event.filePath}:${event.successfulFileCount}:${event.skippedFileCount}`;
    case "file-skipped":
      return `skipped:${event.filePath}:${event.stepId}:${event.reason}:${event.successfulFileCount}:${event.skippedFileCount}`;
    case "run-finalizing":
      return `finalizing:${event.plannedFileCount}:${event.successfulFileCount}:${event.skippedFileCount}`;
    default:
      throw new Error(`Unexpected progress event: ${JSON.stringify(event)}`);
  }
}