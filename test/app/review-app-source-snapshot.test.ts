import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { ReviewRunInterruptedError } from "../../src/core/orchestrator.ts";
import type {
  ReviewPerFileStepsFactory,
  ReviewRunSummary
} from "../../src/core/orchestrator.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { StepDefinition, RunStepInput } from "../../src/core/step-runner.ts";
import type {
  ReviewSourceSnapshot,
  ReviewSourceSnapshotProvider
} from "../../src/providers/local-review-source-snapshot-provider.ts";
import type {
  ReviewChangesetEntry,
  ReviewSourceProvider
} from "../../src/providers/review-source-provider.ts";
import type { ReviewConfigProvider } from "../../src/providers/config/review-config-provider.ts";
import type { ReviewFileFilter } from "../../src/providers/review-file-filter.ts";
import type { ReviewOutputPlan } from "../../src/providers/review-output-sink.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import {
  createWritableOutputSink,
  defineOutputSinkDouble,
  type ReviewOutputBootstrapAndPublisher
} from "../helpers/output-sink-double.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";

test("createLocalReviewRunApp reviews the resolved head snapshot while keeping artifacts in the original repo", async () => {
  const originalRoot = "/workspace/repo";
  const snapshotRoot = "/tmp/nightowl-source-snapshot";
  const calls = createRunCallRecorder();
  const events: RunProgressEvent[] = [];
  let outputPlan: ReviewOutputPlan | undefined;

  const app = createLocalReviewRunApp({
    workingDirectory: originalRoot,
    timestampProvider: () => "05191200",
    sourceProvider: createRecordingSourceProvider({
      originalRoot,
      snapshotRoot,
      calls
    }),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot,
      snapshotRoot,
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: true,
      calls
    }),
    reviewConfigProvider: createRecordingConfigProvider(calls),
    reviewFileFilter: createRecordingReviewFileFilter(calls),
    changesetOverviewRunner: {
      async run(input) {
        calls.changesetOverviewInputs.push(input);
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：snapshot"),
          userContext: []
        });
      }
    },
    outputSink: defineOutputSinkDouble({
      async initializeRun(plan) {
        outputPlan = plan;
        return this;
      },
      async publishFileReview() {},
      async publishArtifact() {}
    }),
    stepRunner: {
      async run(input) {
        calls.stepInputs.push(input);
        return buildSuccessfulStepResult(input.step.stepId, input.context.filePath);
      }
    },
    perFileStepsFactory: createSingleStepFactory(),
    clientManager: createUnusedClientManager(),
    onProgressEvent(event) {
      events.push(event);
    }
  });

  const result = await app.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: false
  });

  assert.equal(calls.configRoots.at(0), snapshotRoot);
  assert.equal(calls.filterInputs.at(0)?.repoRoot, snapshotRoot);
  assert.deepEqual(calls.changedFileCalls.at(0), {
    repoRoot: snapshotRoot,
    baseRef: "base-sha",
    headRef: "head-sha"
  });
  assert.deepEqual(calls.changesetEntryCalls.at(0), {
    repoRoot: snapshotRoot,
    baseRef: "base-sha",
    headRef: "head-sha"
  });
  assert.deepEqual(calls.diffCalls.at(0), {
    repoRoot: snapshotRoot,
    baseRef: "base-sha",
    headRef: "head-sha",
    filePath: "src/app.ts"
  });
  assert.deepEqual(calls.branchRoots, [originalRoot]);
  assert.equal(calls.changesetOverviewInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.workingDirectory, snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.outputBaseDir, originalRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.sourceBaseRef, "base-sha");
  assert.equal(calls.changesetOverviewInputs.at(0)?.sourceHeadRef, "head-sha");
  assert.equal(calls.stepInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.stepInputs.at(0)?.workingDirectory, snapshotRoot);
  assert.equal(calls.stepInputs.at(0)?.outputBaseDir, result.outputTarget.basePath);
  assert.equal(calls.stepInputs.at(0)?.sourceBaseRef, "base-sha");
  assert.equal(calls.stepInputs.at(0)?.sourceHeadRef, "head-sha");
  assert.ok(result.outputTarget.basePath.startsWith(path.join(originalRoot, ".nightowl", "review")));
  assert.equal(result.outputTarget.basePath.startsWith(snapshotRoot), false);
  assert.match(result.outputTarget.basePath, /feature-branch_05191200$/u);
  assert.equal(outputPlan?.outputTarget.basePath, result.outputTarget.basePath);
  assert.equal(calls.cleanupCount, 1);
  assert.ok(
    events.some(
      (event) =>
        event.type === "run-warning" &&
        /uncommitted changes are ignored/iu.test(event.message)
    ),
    "dirty working tree should produce a transient progress warning"
  );
});

test("createLocalReviewRunApp keeps snapshot implementation details out of user-facing artifacts", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-snapshot-artifacts-"));
  const originalRoot = path.join(tempDir, "repo");
  const snapshotRoot = path.join(tempDir, "source-snapshot");
  const calls = createRunCallRecorder();

  try {
    const app = createLocalReviewRunApp({
      workingDirectory: originalRoot,
      timestampProvider: () => "05191204",
      sourceProvider: createRecordingSourceProvider({
        originalRoot,
        snapshotRoot,
        calls
      }),
      reviewSourceSnapshotProvider: createSnapshotProvider({
        originalRoot,
        snapshotRoot,
        resolvedBaseRef: "base-sha",
        resolvedHeadRef: "head-sha",
        isDirty: false,
        calls
      }),
      reviewConfigProvider: createRecordingConfigProvider(calls),
      reviewFileFilter: createRecordingReviewFileFilter(calls),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：source pinned"),
            userContext: []
          });
        }
      },
      outputSink: createWritableOutputSink(),
      stepRunner: {
        async run(input) {
          return buildSuccessfulStepResult(input.step.stepId, input.context.filePath);
        }
      },
      perFileStepsFactory: createSingleStepFactory(),
      clientManager: createUnusedClientManager()
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: ".",
      userContext: [],
      dryRun: false
    });

    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const noteContent = readFileSync(
      path.join(result.outputTarget.filesPath, "src__app.ts.md"),
      "utf8"
    );
    const artifactContent = `${indexContent}\n${noteContent}`;

    for (const disallowed of [
      snapshotRoot,
      "base-sha",
      "head-sha",
      "source-snapshot",
      "review source snapshot",
      "snapshot mode"
    ]) {
      assert.equal(
        artifactContent.includes(disallowed),
        false,
        `artifact content must not expose ${disallowed}`
      );
    }

    assert.match(indexContent, /- Base ref: `main`/u);
    assert.match(indexContent, /- Head ref: `feature-branch`/u);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("createLocalReviewRunApp maps absolute repoPath requests onto the snapshot source root for review execution", async () => {
  const originalRoot = "/workspace/repo";
  const snapshotRoot = "/tmp/nightowl-source-snapshot";
  const calls = createRunCallRecorder();
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace",
    timestampProvider: () => "05191203",
    sourceProvider: createRecordingSourceProvider({
      originalRoot,
      snapshotRoot,
      calls
    }),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot,
      snapshotRoot,
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: false,
      calls
    }),
    reviewConfigProvider: createRecordingConfigProvider(calls),
    reviewFileFilter: createRecordingReviewFileFilter(calls),
    changesetOverviewRunner: {
      async run(input) {
        calls.changesetOverviewInputs.push(input);
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：absolute repoPath"),
          userContext: []
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
      async run(input) {
        calls.stepInputs.push(input);
        return buildSuccessfulStepResult(input.step.stepId, input.context.filePath);
      }
    },
    perFileStepsFactory: createSingleStepFactory(),
    clientManager: createUnusedClientManager()
  });

  await app.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: originalRoot,
    userContext: [],
    dryRun: false
  });

  assert.equal(calls.configRoots.at(0), snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.workingDirectory, snapshotRoot);
  assert.equal(calls.filterInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.stepInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.stepInputs.at(0)?.workingDirectory, snapshotRoot);
});

test("createLocalReviewRunApp cleans up the snapshot if config loading fails", async () => {
  const calls = createRunCallRecorder();
  const primaryError = new Error("invalid snapshot config");
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createRecordingSourceProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      calls
    }),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: false,
      calls
    }),
    reviewConfigProvider: {
      async loadReviewConfig() {
        throw primaryError;
      }
    },
    clientManager: createUnusedClientManager()
  });

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    primaryError
  );
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot if the dirty warning progress callback fails", async () => {
  const calls = createRunCallRecorder();
  const progressError = new Error("progress callback failed");
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createRecordingSourceProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      calls
    }),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: true,
      calls
    }),
    reviewConfigProvider: createRecordingConfigProvider(calls),
    clientManager: createUnusedClientManager(),
    onProgressEvent(event) {
      if (event.type === "run-warning") {
        throw progressError;
      }
    }
  });

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    progressError
  );
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot if interrupted during snapshot config loading", async () => {
  const calls = createRunCallRecorder();
  let clientStartCalls = 0;
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createRecordingSourceProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      calls
    }),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: false,
      calls
    }),
    reviewConfigProvider: {
      async loadReviewConfig() {
        process.emit("SIGINT", "SIGINT");
        return {
          maxConcurrentFiles: 1,
          mcpServers: {}
        };
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
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    (error: unknown) =>
      error instanceof ReviewRunInterruptedError && error.signal === "SIGINT"
  );
  assert.equal(calls.cleanupCount, 1);
  assert.equal(clientStartCalls, 0);
});

test("createLocalReviewRunApp fails missing refs before output initialization", async () => {
  const calls = createRunCallRecorder();
  const missingRefError = new Error("Review source snapshot failed to resolve ref 'missing'.");
  let outputInitializeCalls = 0;
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: createRecordingSourceProvider({
      originalRoot: "/workspace/repo",
      snapshotRoot: "/tmp/nightowl-source-snapshot",
      calls
    }),
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

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    missingRefError
  );
  assert.equal(outputInitializeCalls, 0);
  assert.equal(calls.cleanupCount, 0);
});

test("createLocalReviewRunApp cleans up the snapshot if review planning fails", async () => {
  const calls = createRunCallRecorder();
  const planningError = new Error("review planning failed");
  const app = createSuccessfulMinimalApp({
    originalRoot: "/workspace/repo",
    snapshotRoot: "/tmp/nightowl-source-snapshot",
    calls,
    reviewFileFilter: {
      async filterReviewableFiles() {
        throw planningError;
      }
    }
  });

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    planningError
  );
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot when lifecycle signal interrupts during per-file execution", async () => {
  const calls = createRunCallRecorder();
  let didSignal = false;
  const app = createSuccessfulMinimalApp({
    originalRoot: "/workspace/repo",
    snapshotRoot: "/tmp/nightowl-source-snapshot",
    calls,
    async onStepRunnerRun() {
      if (!didSignal) {
        didSignal = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    (error: unknown) =>
      error instanceof ReviewRunInterruptedError && error.signal === "SIGINT"
  );
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot after a per-file review failure is skipped", async () => {
  const calls = createRunCallRecorder();
  const result = await createSuccessfulMinimalApp({
    originalRoot: "/workspace/repo",
    snapshotRoot: "/tmp/nightowl-source-snapshot",
    calls,
    stepRunnerError: new Error("per-file step failed")
  }).run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: false
  });

  assert.equal(result.successfulFileCount, 0);
  assert.equal(result.skippedFileCount, 1);
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp cleans up the snapshot after an index finalizer failure", async () => {
  const calls = createRunCallRecorder();
  const result = await createSuccessfulMinimalApp({
    originalRoot: "/workspace/repo",
    snapshotRoot: "/tmp/nightowl-source-snapshot",
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
  }).run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: false
  });

  assert.deepEqual(result.finalizerFailures, [
    { artifact: "index", message: "index write failed" }
  ]);
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp surfaces cleanup failure after a successful run", async () => {
  const calls = createRunCallRecorder();
  const cleanupError = new Error("snapshot cleanup failed");
  const app = createSuccessfulMinimalApp({
    originalRoot: "/workspace/repo",
    snapshotRoot: "/tmp/nightowl-source-snapshot",
    calls,
    cleanupError
  });

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    cleanupError
  );
});

test("createLocalReviewRunApp preserves the primary failure when snapshot cleanup also fails", async () => {
  const calls = createRunCallRecorder();
  const primaryError = new Error("changeset overview failed");
  const cleanupError = new Error("snapshot cleanup failed");
  const events: RunProgressEvent[] = [];
  const app = createSuccessfulMinimalApp({
    originalRoot: "/workspace/repo",
    snapshotRoot: "/tmp/nightowl-source-snapshot",
    calls,
    cleanupError,
    events,
    changesetOverviewError: primaryError
  });

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    primaryError
  );

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
  const calls = createRunCallRecorder();
  const primaryError = new ReviewRunInterruptedError("SIGINT");
  const cleanupError = new Error("snapshot cleanup failed");
  const events: RunProgressEvent[] = [];
  const app = createSuccessfulMinimalApp({
    originalRoot: "/workspace/repo",
    snapshotRoot: "/tmp/nightowl-source-snapshot",
    calls,
    cleanupError,
    events,
    changesetOverviewError: primaryError
  });

  await assert.rejects(
    () =>
      app.run({
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: ".",
        userContext: [],
        dryRun: false
      }),
    primaryError
  );
  assert.equal(calls.cleanupCount, 1);
});

test("createLocalReviewRunApp applies snapshot source semantics in dry-run mode without starting Copilot", async () => {
  const originalRoot = "/workspace/repo";
  const snapshotRoot = "/tmp/nightowl-dry-run-snapshot";
  const calls = createRunCallRecorder();
  let clientStartCalls = 0;

  const app = createLocalReviewRunApp({
    workingDirectory: originalRoot,
    timestampProvider: () => "05191201",
    sourceProvider: createRecordingSourceProvider({
      originalRoot,
      snapshotRoot,
      calls
    }),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot,
      snapshotRoot,
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: false,
      calls
    }),
    reviewConfigProvider: createRecordingConfigProvider(calls),
    reviewFileFilter: createRecordingReviewFileFilter(calls),
    changesetOverviewRunner: {
      async run(input) {
        calls.changesetOverviewInputs.push(input);
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：dry-run"),
          userContext: []
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
    clientManager: {
      async start() {
        clientStartCalls += 1;
      },
      async stop() {},
      async forceStop() {},
      getClient() {
        throw new Error("dry-run must not create Copilot sessions");
      }
    }
  });

  const result = await app.run({
    baseRef: "main",
    headRef: "feature-branch",
    repoPath: ".",
    userContext: [],
    dryRun: true
  });

  assert.equal(clientStartCalls, 0);
  assert.equal(result.dryRun, true);
  assert.equal(calls.configRoots.at(0), snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.workingDirectory, snapshotRoot);
  assert.ok(result.outputTarget.basePath.startsWith(path.join(originalRoot, ".nightowl", "review")));
});

interface RunCallRecorder {
  branchRoots: string[];
  changedFileCalls: Array<{ repoRoot: string; baseRef: string; headRef: string }>;
  changesetEntryCalls: Array<{ repoRoot: string; baseRef: string; headRef: string }>;
  changesetOverviewInputs: Array<{
    repoRoot: string;
    outputBaseDir: string;
    sourceBaseRef?: string;
    sourceHeadRef?: string;
    workingDirectory?: string;
  }>;
  cleanupCount: number;
  configRoots: string[];
  diffCalls: Array<{
    repoRoot: string;
    baseRef: string;
    headRef: string;
    filePath: string;
  }>;
  filterInputs: Array<{ repoRoot: string; files: string[] }>;
  stepInputs: RunStepInput[];
}

function createRunCallRecorder(): RunCallRecorder {
  return {
    branchRoots: [],
    changedFileCalls: [],
    changesetEntryCalls: [],
    changesetOverviewInputs: [],
    cleanupCount: 0,
    configRoots: [],
    diffCalls: [],
    filterInputs: [],
    stepInputs: []
  };
}

function createRecordingSourceProvider(options: {
  originalRoot: string;
  snapshotRoot: string;
  calls: RunCallRecorder;
}): ReviewSourceProvider {
  return {
    async resolveRepoRoot(startPath) {
      return startPath.startsWith(options.snapshotRoot)
        ? options.snapshotRoot
        : options.originalRoot;
    },
    async getChangesetEntries(repoRoot, baseRef, headRef): Promise<ReviewChangesetEntry[]> {
      options.calls.changesetEntryCalls.push({ repoRoot, baseRef, headRef });
      return [{ status: "M", path: "src/app.ts" }];
    },
    async getCurrentBranch(repoRoot) {
      options.calls.branchRoots.push(repoRoot);
      return "feature-branch";
    },
    async getChangedFiles(repoRoot, baseRef, headRef) {
      options.calls.changedFileCalls.push({ repoRoot, baseRef, headRef });
      return ["src/app.ts"];
    },
    async getDiff(repoRoot, baseRef, headRef, filePath) {
      options.calls.diffCalls.push({ repoRoot, baseRef, headRef, filePath });
      return `--- a/${filePath}\n+++ b/${filePath}\n@@ -1 +1 @@\n-old\n+new\n`;
    }
  };
}

function createSnapshotProvider(options: {
  originalRoot: string;
  snapshotRoot: string;
  resolvedBaseRef: string;
  resolvedHeadRef: string;
  isDirty: boolean;
  calls: RunCallRecorder;
  cleanupError?: Error;
}): ReviewSourceSnapshotProvider {
  return {
    async createSnapshot(input): Promise<ReviewSourceSnapshot> {
      assert.deepEqual(input, {
        repoRoot: options.originalRoot,
        baseRef: "main",
        headRef: "feature-branch"
      });

      return {
        originalRepoRoot: options.originalRoot,
        reviewSourceRoot: options.snapshotRoot,
        resolvedBaseRef: options.resolvedBaseRef,
        resolvedHeadRef: options.resolvedHeadRef,
        isDirty: options.isDirty,
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

function createRecordingConfigProvider(
  calls: RunCallRecorder
): ReviewConfigProvider {
  return {
    async loadReviewConfig(repoRoot) {
      calls.configRoots.push(repoRoot);
      return {
        maxConcurrentFiles: 1,
        mcpServers: {}
      };
    }
  };
}

function createRecordingReviewFileFilter(
  calls: RunCallRecorder
): ReviewFileFilter {
  return {
    async filterReviewableFiles(repoRoot, files) {
      calls.filterInputs.push({ repoRoot, files });
      return files;
    }
  };
}

function createSuccessfulMinimalApp(options: {
  originalRoot: string;
  snapshotRoot: string;
  calls: RunCallRecorder;
  cleanupError?: Error;
  changesetOverviewError?: Error;
  events?: RunProgressEvent[];
  outputSink?: ReviewOutputBootstrapAndPublisher;
  reviewFileFilter?: ReviewFileFilter;
  onStepRunnerRun?: (input: RunStepInput) => void | Promise<void>;
  stepRunnerError?: Error;
}) {
  return createLocalReviewRunApp({
    workingDirectory: options.originalRoot,
    timestampProvider: () => "05191202",
    sourceProvider: createRecordingSourceProvider(options),
    reviewSourceSnapshotProvider: createSnapshotProvider({
      originalRoot: options.originalRoot,
      snapshotRoot: options.snapshotRoot,
      resolvedBaseRef: "base-sha",
      resolvedHeadRef: "head-sha",
      isDirty: false,
      calls: options.calls,
      cleanupError: options.cleanupError
    }),
    reviewConfigProvider: createRecordingConfigProvider(options.calls),
    reviewFileFilter:
      options.reviewFileFilter ?? createRecordingReviewFileFilter(options.calls),
    changesetOverviewRunner: {
      async run(input) {
        options.calls.changesetOverviewInputs.push(input);
        if (options.changesetOverviewError) {
          throw options.changesetOverviewError;
        }
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：success"),
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

function createSingleStepFactory(): ReviewPerFileStepsFactory {
  return (): StepDefinition[] => [
    {
      stepId: "review-summary",
      prepare(context) {
        return {
          stepId: "review-summary",
          prompt: {
            systemMessage: "custom system",
            userMessage: `review ${context.filePath}`
          },
          reviewProfile: {
            knowledgeMode: "disabled",
            model: "gpt-5.4-mini"
          },
          async resolve() {
            return (fileContext) => {
              buildSuccessfulStepResult("review-summary", fileContext.filePath).applyTo(fileContext);
            };
          }
        };
      }
    }
  ];
}

function createUnusedClientManager() {
  return {
    async start() {},
    async stop() {},
    async forceStop() {},
    getClient() {
      throw new Error("clientManager.getClient() must not be called by this test");
    }
  };
}
