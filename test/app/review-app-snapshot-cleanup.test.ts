import assert from "node:assert/strict";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { ReviewRunInterruptedError } from "../../src/core/orchestrator.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { RunStepInput } from "../../src/core/step-runner.ts";
import type { ReviewChangesetEntry } from "../../src/providers/review-source-provider.ts";
import type { ReviewSourceSnapshot } from "../../src/providers/local-review-source-snapshot-provider.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { defineOutputSinkDouble, type ReviewOutputBootstrapAndPublisher } from "../helpers/output-sink-double.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";
import { createSingleStepFactory, createUnusedClientManager } from "../helpers/review-app-fakes.ts";
import type { ReviewConfigProvider } from "../../src/providers/config/review-config-provider.ts";
import type { ReviewFileFilter } from "../../src/providers/review-file-filter.ts";

/**
 * Snapshot cleanup guarantee tests.
 *
 * Verifies that snapshot.cleanup() is always called after a review run
 * regardless of where the failure occurs in the pipeline. These tests
 * exercise the error-handling lifecycle in review-app.ts, not snapshot
 * routing semantics (which are owned by review-app-source-snapshot.test.ts).
 */

interface CleanupCallRecorder {
  cleanupCount: number;
}

function createCleanupCallRecorder(): CleanupCallRecorder {
  return { cleanupCount: 0 };
}

function createSnapshotProvider(options: {
  originalRoot: string;
  snapshotRoot: string;
  isDirty?: boolean;
  calls: CleanupCallRecorder;
  cleanupError?: Error;
}) {
  return {
    async createSnapshot(): Promise<ReviewSourceSnapshot> {
      return {
        originalRepoRoot: options.originalRoot,
        reviewSourceRoot: options.snapshotRoot,
        resolvedBaseRef: "base-sha",
        resolvedHeadRef: "head-sha",
        isDirty: options.isDirty ?? false,
        async cleanup() {
          options.calls.cleanupCount += 1;
          if (options.cleanupError) {
            throw options.cleanupError;
          }
        }
      };
    }
  };
}

function createMinimalSourceProvider(snapshotRoot: string) {
  return {
    async resolveRepoRoot() {
      return snapshotRoot;
    },
    async getChangesetEntries(): Promise<ReviewChangesetEntry[]> {
      return [{ status: "M" as const, path: "src/app.ts" }];
    },
    async getCurrentBranch() {
      return "feature-branch";
    },
    async getChangedFiles() {
      return ["src/app.ts"];
    },
    async getDiff(_repoRoot: string, _baseRef: string, _headRef: string, filePath: string) {
      return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`;
    }
  };
}

function createRecordingConfigProvider(): ReviewConfigProvider {
  return {
    async loadReviewConfig() {
      return { maxConcurrentFiles: 1, mcpServers: {} };
    }
  };
}

function createMinimalApp(options: {
  calls: CleanupCallRecorder;
  cleanupError?: Error;
  changesetOverviewError?: Error;
  events?: RunProgressEvent[];
  outputSink?: ReviewOutputBootstrapAndPublisher;
  reviewFileFilter?: ReviewFileFilter;
  onStepRunnerRun?: (input: RunStepInput) => void | Promise<void>;
  stepRunnerError?: Error;
}) {
  const originalRoot = "/workspace/repo";
  const snapshotRoot = "/tmp/nightowl-source-snapshot";

  return createLocalReviewRunApp({
    workingDirectory: originalRoot,
    timestampProvider: () => "05201200",
    sourceProvider: createMinimalSourceProvider(snapshotRoot),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot,
      snapshotRoot,
      calls: options.calls,
      cleanupError: options.cleanupError
    }),
    reviewConfigProvider: createRecordingConfigProvider(),
    reviewFileFilter:
      options.reviewFileFilter ?? {
        async filterReviewableFiles(_repoRoot: string, files: string[]) {
          return files;
        }
      },
    changesetOverviewRunner: {
      async run() {
        if (options.changesetOverviewError) {
          throw options.changesetOverviewError;
        }
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- cleanup test"),
          userContext: []
        });
      }
    },
    outputSink:
      options.outputSink ??
      defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishArtifact() {}
      }),
    stepRunner: {
      async run(input) {
        await options.onStepRunnerRun?.(input);
        if (options.stepRunnerError) {
          throw options.stepRunnerError;
        }
        return buildSuccessfulStepResult(input.step.stepId, input.context.filePath);
      }
    },
    perFileStepsFactory: createSingleStepFactory(),
    clientManager: createUnusedClientManager(),
    onProgressEvent(event) {
      options.events?.push(event);
    }
  });
}

const RUN_REQUEST = {
  baseRef: "main",
  headRef: "feature-branch",
  repoPath: ".",
  userContext: [] as string[],
  dryRun: false
};

// --- Cleanup guarantee: errors before orchestration ---

test("createLocalReviewRunApp cleans up the snapshot if config loading fails", async () => {
  const calls = createCleanupCallRecorder();
  const primaryError = new Error("invalid snapshot config");
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createMinimalSourceProvider("/tmp/nightowl-source-snapshot"),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      calls
    }),
    reviewConfigProvider: {
      async loadReviewConfig() {
        throw primaryError;
      }
    },
    clientManager: createUnusedClientManager()
  });

  await assert.rejects(() => app.run(RUN_REQUEST), primaryError);
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot if the dirty warning progress callback fails", async () => {
  const calls = createCleanupCallRecorder();
  const progressError = new Error("progress callback failed");
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createMinimalSourceProvider("/tmp/nightowl-source-snapshot"),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      isDirty: true,
      calls
    }),
    reviewConfigProvider: createRecordingConfigProvider(),
    clientManager: createUnusedClientManager(),
    onProgressEvent(event) {
      if (event.type === "run-warning") {
        throw progressError;
      }
    }
  });

  await assert.rejects(() => app.run(RUN_REQUEST), progressError);
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot if interrupted during snapshot config loading", async () => {
  const calls = createCleanupCallRecorder();
  let clientStartCalls = 0;
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createMinimalSourceProvider("/tmp/nightowl-source-snapshot"),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      calls
    }),
    reviewConfigProvider: {
      async loadReviewConfig() {
        process.emit("SIGINT", "SIGINT");
        return { maxConcurrentFiles: 1, mcpServers: {} };
      }
    },
    clientManager: {
      async start() {
        clientStartCalls += 1;
      },
      async stop() {},
      async forceStop() {},
      getClient() {
        throw new Error("clientManager.getClient() must not be called");
      }
    }
  });

  await assert.rejects(
    () => app.run(RUN_REQUEST),
    (error: unknown) =>
      error instanceof ReviewRunInterruptedError && error.signal === "SIGINT"
  );
  assert.equal(calls.cleanupCount, 1);
  assert.equal(clientStartCalls, 0);
});

test("createLocalReviewRunApp does not call cleanup when snapshot creation itself fails", async () => {
  const calls = createCleanupCallRecorder();
  const missingRefError = new Error("Review source snapshot failed to resolve ref 'missing'.");
  let outputInitializeCalls = 0;
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createMinimalSourceProvider("/tmp/nightowl-source-snapshot"),
    reviewSourceSnapshotProvider: {
      async createSnapshot() {
        throw missingRefError;
      }
    },
    outputSink: defineOutputSinkDouble({
      async initializeRun() {
        outputInitializeCalls += 1;
        return this;
      },
      async publishFileReview() {},
      async publishArtifact() {}
    }),
    clientManager: createUnusedClientManager()
  });

  await assert.rejects(() => app.run(RUN_REQUEST), missingRefError);
  assert.equal(outputInitializeCalls, 0);
  assert.equal(calls.cleanupCount, 0);
});

// --- Cleanup guarantee: errors during orchestration ---

test("createLocalReviewRunApp cleans up the snapshot if review planning fails", async () => {
  const calls = createCleanupCallRecorder();
  const planningError = new Error("review planning failed");
  const app = createMinimalApp({
    calls,
    reviewFileFilter: {
      async filterReviewableFiles() {
        throw planningError;
      }
    }
  });

  await assert.rejects(() => app.run(RUN_REQUEST), planningError);
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot when lifecycle signal interrupts during per-file execution", async () => {
  const calls = createCleanupCallRecorder();
  let didSignal = false;
  const app = createMinimalApp({
    calls,
    async onStepRunnerRun() {
      if (!didSignal) {
        didSignal = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(RUN_REQUEST),
    (error: unknown) =>
      error instanceof ReviewRunInterruptedError && error.signal === "SIGINT"
  );
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot after a per-file review failure is skipped", async () => {
  const calls = createCleanupCallRecorder();
  const result = await createMinimalApp({
    calls,
    stepRunnerError: new Error("per-file step failed")
  }).run(RUN_REQUEST);

  assert.equal(result.successfulFileCount, 0);
  assert.equal(result.skippedFileCount, 1);
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot after an index finalizer failure", async () => {
  const calls = createCleanupCallRecorder();
  const result = await createMinimalApp({
    calls,
    outputSink: defineOutputSinkDouble({
      async initializeRun() {
        return this;
      },
      async publishFileReview() {},
      async publishArtifact(kind) {
        if (kind === "index") {
          throw new Error("index write failed");
        }
      }
    })
  }).run(RUN_REQUEST);

  assert.deepEqual(result.finalizerFailures, [
    { artifact: "index", message: "index write failed" }
  ]);
  assert.equal(calls.cleanupCount, 1);
});

// --- Cleanup error propagation ---

test("createLocalReviewRunApp surfaces cleanup failure after a successful run", async () => {
  const calls = createCleanupCallRecorder();
  const cleanupError = new Error("snapshot cleanup failed");
  const app = createMinimalApp({ calls, cleanupError });

  await assert.rejects(() => app.run(RUN_REQUEST), cleanupError);
});

test("createLocalReviewRunApp preserves the primary failure when snapshot cleanup also fails", async () => {
  const calls = createCleanupCallRecorder();
  const primaryError = new Error("changeset overview failed");
  const cleanupError = new Error("snapshot cleanup failed");
  const events: RunProgressEvent[] = [];
  const app = createMinimalApp({
    calls,
    cleanupError,
    events,
    changesetOverviewError: primaryError
  });

  await assert.rejects(() => app.run(RUN_REQUEST), primaryError);

  assert.ok(
    events.some(
      (event) =>
        event.type === "run-warning" &&
        /snapshot cleanup failed/iu.test(event.message)
    ),
    "cleanup failure after primary failure should be diagnostic"
  );
});

test("createLocalReviewRunApp preserves lifecycle interruption when snapshot cleanup also fails", async () => {
  const calls = createCleanupCallRecorder();
  const primaryError = new ReviewRunInterruptedError("SIGINT");
  const cleanupError = new Error("snapshot cleanup failed");
  const events: RunProgressEvent[] = [];
  const app = createMinimalApp({
    calls,
    cleanupError,
    events,
    changesetOverviewError: primaryError
  });

  await assert.rejects(() => app.run(RUN_REQUEST), primaryError);
  assert.equal(calls.cleanupCount, 1);
});
