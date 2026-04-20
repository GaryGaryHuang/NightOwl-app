import assert from "node:assert/strict";
import { describe, before, test } from "node:test";

import { ReviewOrchestrator, type ReviewRunSummary } from "../../src/core/orchestrator.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";

/**
 * Progress event contract tests owned at the orchestrator layer.
 *
 * Drives ReviewOrchestrator end-to-end with injected doubles over a
 * deterministic two-file scenario:
 *  - src/app.ts          → all steps succeed
 *  - packages/app/index.ts → skipped at step2 due to a thrown step failure
 *
 * maxConcurrentFiles is set to 1 so files are processed sequentially,
 * giving the event sequence a deterministic total order.
 */
describe("ReviewOrchestrator progress events", () => {
  let result: ReviewRunSummary;
  const events: string[] = [];

  before(async () => {
    const orchestrator = new ReviewOrchestrator({
      workingDirectory: "/workspace/repo",
      timestampProvider: () => "03131430",
      maxConcurrentFiles: 1,
      sourceProvider: {
        async resolveRepoRoot() {
          return "/workspace/repo";
        },
        async getChangesetEntries() {
          return [
            { status: "M" as const, path: "src/app.ts" },
            { status: "M" as const, path: "packages/app/index.ts" }
          ];
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
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
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
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run({ step, context }) {
          // Deterministic skip: packages/app/index.ts fails at step2.
          // The orchestrator does not retry at this level; it catches and skips.
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
        events.push(renderProgressEvent(event));
      }
    });

    result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: ".",
      userContext: [],
      dryRun: false
    });
  });

  test("run summary counts one success and one skip", () => {
    assert.equal(result.plannedFileCount, 2);
    assert.equal(result.successfulFileCount, 1);
    assert.equal(result.skippedFileCount, 1);
  });

  test("event sequence covers all phases, per-file steps, skip, and finalize", () => {
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
      "completed:src/app.ts",
      "claimed:2:packages/app/index.ts",
      "progress:packages/app/index.ts:step1-overview",
      "skipped:packages/app/index.ts:step2-dependencies-boundaries:deterministic validation failed",
      "finalizing:2:1:1"
    ]);
  });
});

/**
 * Serializes a RunProgressEvent to a compact string for use in deepEqual assertions.
 * The switch is exhaustive over RunProgressEvent — TypeScript will flag a compile error
 * if a new event type is added without a corresponding case here.
 */
function renderProgressEvent(event: RunProgressEvent): string {
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
      return `completed:${event.filePath}`;
    case "file-skipped":
      return `skipped:${event.filePath}:${event.stepId}:${event.reason}`;
    case "run-finalizing":
      return `finalizing:${event.plannedFileCount}:${event.successfulFileCount}:${event.skippedFileCount}`;
    case "finalizer-failed":
      return `finalizer-failed:${event.artifact}:${event.message}`;
  }
}
