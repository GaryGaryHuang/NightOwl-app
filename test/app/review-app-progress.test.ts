import assert from "node:assert/strict";
import { describe, before, test } from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";

/**
 * App-level wiring smoke for run progress.
 *
 * Confirms the composition root assembled by createLocalReviewRunApp
 * threads the orchestrator's progress event handler back to the caller and
 * publishes a coherent ReviewRunSummary across one successful and one
 * skipped file. Detailed event ordering for ReviewOrchestrator is owned by
 * test/core/orchestrator-progress-events.test.ts.
 */
describe("createLocalReviewRunApp progress wiring", () => {
  let result: ReviewRunSummary;
  const events: RunProgressEvent[] = [];

  before(async () => {
    const app = createLocalReviewRunApp({
      workingDirectory: "/workspace/repo",
      timestampProvider: () => "03131430",
      sourceProvider: {
        async resolveRepoRoot() {
          return "/workspace/repo";
        },
        async getChangesetEntries() {
          return ["src/app.ts", "packages/app/index.ts"];
        },
        async getCurrentBranch() {
          return "feature-branch";
        },
        async getChangedFiles() {
          return ["src/app.ts", "packages/app/index.ts"];
        },
        async getDiff(_repoRoot, _baseRef, _headRef, filePath) {
          return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`;
        }
      },
      reviewFileFilter: {
        async filterReviewableFiles(_repoRoot: string, files: string[]) {
          return files;
        }
      },
      reviewConfigProvider: {
        async loadReviewConfig() {
          return {
            maxConcurrentFiles: 1,
            confidenceThresholds: { must: 80, nice: 90 },
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
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishSkippedFile() {},
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run({ step, context }) {
          if (
            context.filePath === "packages/app/index.ts" &&
            step.stepId === "step2-dependencies-boundaries"
          ) {
            throw new Error("deterministic validation failed");
          }

          return buildSuccessfulStepResult(step.stepId, context.filePath);
        }
      },
      onProgressEvent(event) {
        events.push(event);
      }
    });

    result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: ".",
      userContext: [],
      dryRun: false
    });
  });

  test("publishes a run summary that aggregates successful and skipped files", () => {
    assert.equal(result.plannedFileCount, 2);
    assert.equal(result.successfulFileCount, 1);
    assert.equal(result.skippedFileCount, 1);
  });

  test("forwards progress events emitted by the orchestrator to the injected handler", () => {
    // Wiring smoke only: app must deliver SOME orchestrator events through
    // the onProgressEvent callback. Detailed sequence is asserted in
    // test/core/orchestrator-progress-events.test.ts.
    assert.ok(events.length > 0, "expected at least one progress event to be forwarded");
    assert.ok(
      events.some((event) => event.type === "run-finalizing"),
      "expected the run-finalizing event to be forwarded as a wiring smoke"
    );
  });
});
