import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, before, test } from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";
import { createPassthroughSnapshotProvider, createSingleStepFactory } from "../helpers/review-app-fakes.ts";

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
  const cleanupWarning = new Error("sdk cleanup warning");

  before(async () => {
    const app = createLocalReviewRunApp({
      workingDirectory: "/workspace/repo",
      timestampProvider: () => "03131430",
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
      reviewSourceSnapshotProvider: createPassthroughSnapshotProvider("/workspace/repo"),
      reviewFileFilter: {
        async filterReviewableFiles(_repoRoot: string, files: string[]) {
          return files;
        }
      },
      reviewConfigProvider: {
        async loadReviewConfig() {
          return {
            maxConcurrentFiles: 1,
            mcpServers: {}
          };
        }
      },
      clientManager: {
        async start() {},
        async stop() { return [cleanupWarning]; },
        async forceStop() {},
        getClient() {
          throw new Error("unused");
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature")
          });
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishArtifact() {}
      }),
      stepRunner: {
        async run({ step, context }) {
          if (
            context.filePath === "packages/app/index.ts" &&
            step.stepId === "review-basis"
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

  test("forwards Copilot cleanup diagnostics as a run warning", () => {
    assert.ok(
      events.some(
        (event) =>
          event.type === "run-warning" &&
          /Copilot client cleanup completed with 1 diagnostic error/u.test(
            event.message
          ) &&
          /sdk cleanup warning/u.test(event.message)
      ),
      "expected Copilot cleanup diagnostics to be forwarded as a run warning"
    );
  });
});

test("createLocalReviewRunApp emits a progress warning when tool-audit writes fail", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "nightowl-audit-warning-"));
  const events: RunProgressEvent[] = [];

  try {
    const app = createLocalReviewRunApp({
      workingDirectory: repoRoot,
      timestampProvider: () => "03131431",
      sourceProvider: {
        async resolveRepoRoot() {
          return repoRoot;
        },
        async getChangesetEntries() {
          return [{ status: "M" as const, path: "src/app.ts" }];
        },
        async getCurrentBranch() {
          return "feature-branch";
        },
        async getChangedFiles() {
          return ["src/app.ts"];
        },
        async getDiff(_repoRoot, _baseRef, _headRef, filePath) {
          return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`;
        }
      },
      reviewSourceSnapshotProvider: createPassthroughSnapshotProvider(repoRoot),
      reviewFileFilter: {
        async filterReviewableFiles(_repoRoot: string, files: string[]) {
          return files;
        }
      },
      reviewConfigProvider: {
        async loadReviewConfig() {
          return {
            maxConcurrentFiles: 1,
            mcpServers: {}
          };
        }
      },
      clientManager: {
        async start() {},
        async stop() { return []; },
        async forceStop() {},
        getClient() {
          return {
            async start() {},
            async stop() { return []; },
            async forceStop() {},
            async createSession(config: SessionConfig) {
              await config.hooks?.onPreToolUse?.(
                {
                  sessionId: "s1",
                  timestamp: new Date(0),
                  workingDirectory: repoRoot,
                  toolName: "bash",
                  toolArgs: { command: "git log --oneline" }
                } as never,
                { sessionId: "s1" } as never
              );

              return {
                async sendAndWait() {
                  return {
                    data: {
                      content: "custom-step-ok"
                    }
                  };
                },
                async disconnect() {}
              };
            }
          };
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature")
          });
        }
      },
      perFileStepsFactory: createSingleStepFactory(),
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          await mkdir(outputPlan.outputTarget.toolAuditPath, { recursive: true });
          return this;
        },
        async publishFileReview() {},
        async publishArtifact() {}
      }),
      onProgressEvent(event) {
        events.push(event);
      }
    });

    await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: ".",
      userContext: [],
      dryRun: false
    });

    assert.ok(
      events.some(
        (event) =>
          event.type === "tool-audit-write-failed" &&
          event.message.includes(repoRoot)
      ),
      "expected tool-audit write failure warning to be emitted"
    );
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});
