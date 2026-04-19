import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { ReviewRunInterruptedError } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { buildSessionResponse } from "../helpers/review-app-fixture.ts";

/**
 * App-level lifecycle smoke only.
 *
 * Detailed shutdown ordering, signal listener cleanup, graceful timeout, and
 * stop()/forceStop() error propagation are owned by:
 *   - test/app/run-lifecycle-manager.test.ts
 *   - test/services/copilot-client-shutdown.test.ts
 *
 * This suite verifies only that createLocalReviewRunApp composes the lifecycle
 * manager with the orchestrator so that:
 *   1. A process signal during a run surfaces as ReviewRunInterruptedError
 *      with the signal identity, and clientManager.stop() is invoked.
 *   2. The composition root wires through to a successful real-fixture run
 *      with on-disk tool-audit.jsonl creation.
 */

function createSignalTestApp(options: {
  stopCalls: string[];
  onStep1?: () => void;
}) {
  const TEST_FILES = ["src/app.ts", "packages/app/index.ts"];

  return createLocalReviewRunApp({
    workingDirectory: "/tmp/signal-test",
    clientManager: {
      async start() {},
      async stop() {
        options.stopCalls.push("stop");
      },
      async forceStop() {
        options.stopCalls.push("forceStop");
      },
      getClient() {
        throw new Error("unused");
      }
    },
    sourceProvider: {
      async resolveRepoRoot(startPath: string) {
        return startPath;
      },
      async getChangesetEntries() {
        return TEST_FILES;
      },
      async getCurrentBranch() {
        return "feature-branch";
      },
      async getChangedFiles() {
        return TEST_FILES;
      },
      async getDiff() {
        return "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
      }
    },
    reviewFileFilter: {
      async filterReviewableFiles(_repoRoot: string, files: string[]) {
        return files;
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
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset\n- test"),
          userContext: []
        });
      }
    },
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          options.onStep1?.();
        }
        return {
          stepId: step.stepId,
          applyTo(_ctx: unknown) {}
        };
      }
    }
  });
}

const SIGNAL_TEST_REQUEST = {
  baseRef: "main",
  headRef: "feature-branch",
  repoPath: ".",
  userContext: [],
  dryRun: false
};

test("createLocalReviewRunApp surfaces a process signal during a run as ReviewRunInterruptedError and invokes clientManager.stop()", async () => {
  const stopCalls: string[] = [];
  let sigintFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!sigintFired) {
        sigintFired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGINT"
  );
  assert.deepEqual(stopCalls, ["stop"], "clientManager.stop() must be called after interruption");
});

test("createLocalReviewRunApp creates tool-audit.jsonl at outputTarget.toolAuditPath after a successful run", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {},
        async stop() {},
        async forceStop() {},
        getClient() {
          return {
            async start() {},
            async stop() {},
            async forceStop() {},
            async createSession(config: SessionConfig) {
              return {
                async sendAndWait({ prompt }: { prompt: string }) {
                  return { data: { content: buildSessionResponse(config, prompt) } };
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
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
            userContext: []
          });
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
      outputSink: new LocalWorkspaceProvider(),
      timestampProvider: () => "03241400"
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.ok(
      result.outputTarget.toolAuditPath.endsWith("tool-audit.jsonl"),
      "toolAuditPath must end with tool-audit.jsonl"
    );
    assert.ok(
      existsSync(result.outputTarget.toolAuditPath),
      `tool-audit.jsonl must exist at ${result.outputTarget.toolAuditPath}`
    );
  } finally {
    fixture.cleanup();
  }
});
