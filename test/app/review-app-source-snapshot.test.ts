import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import type { RunProgressEvent } from "../../src/core/run-progress.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { ChangesetOverviewRunnerInput } from "../../src/core/changeset-overview-runner.ts";
import type { RunStepInput } from "../../src/core/step-runner.ts";
import type {
  ReviewSourceSnapshot,
  ReviewSourceSnapshotProvider
} from "../../src/providers/local-review-source-snapshot-provider.ts";
import type {
  ReviewChangesetEntry,
  ReviewSourceProvider
} from "../../src/providers/review-source-provider.ts";
import type { ReviewOutputPlan } from "../../src/providers/review-output-sink.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import {
  createWritableOutputSink,
  defineOutputSinkDouble
} from "../helpers/output-sink-double.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";
import { createSingleStepFactory, createUnusedClientManager } from "../helpers/review-app-fakes.ts";

/**
 * Snapshot source routing tests.
 *
 * Verifies that when a review source snapshot is active:
 *  - All source-reading operations target the snapshot root
 *  - All output-writing operations target the original repo root
 *  - Resolved refs (not user-facing refs) are forwarded to providers
 *  - Snapshot implementation details do not leak into user-facing artifacts
 *
 * Cleanup guarantee tests are owned by review-app-snapshot-cleanup.test.ts.
 */

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

  // Source-reading operations target the snapshot root with resolved refs
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

  // Branch resolution targets the original repo (for output directory naming)
  assert.deepEqual(calls.branchRoots, [originalRoot]);

  // Orchestrator runners receive snapshot root as repoRoot and workingDirectory
  assert.equal(calls.changesetOverviewInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.workingDirectory, snapshotRoot);
  assert.equal(calls.changesetOverviewInputs.at(0)?.outputBaseDir, originalRoot);
  assert.equal(calls.stepInputs.at(0)?.repoRoot, snapshotRoot);
  assert.equal(calls.stepInputs.at(0)?.workingDirectory, snapshotRoot);
  assert.equal(calls.stepInputs.at(0)?.outputBaseDir, result.outputTarget.basePath);

  // Output targets are under the original repo, not the snapshot
  assert.ok(result.outputTarget.basePath.startsWith(path.join(originalRoot, ".nightowl", "review")));
  assert.equal(result.outputTarget.basePath.startsWith(snapshotRoot), false);
  assert.match(result.outputTarget.basePath, /feature-branch_05191200$/u);
  assert.equal(outputPlan?.outputTarget.basePath, result.outputTarget.basePath);

  // Snapshot is cleaned up and dirty warning is emitted
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

// --- Helpers ---

interface RunCallRecorder {
  branchRoots: string[];
  changedFileCalls: Array<{ repoRoot: string; baseRef: string; headRef: string }>;
  changesetEntryCalls: Array<{ repoRoot: string; baseRef: string; headRef: string }>;
  changesetOverviewInputs: Array<Pick<ChangesetOverviewRunnerInput, "repoRoot" | "outputBaseDir" | "workingDirectory">>;
  cleanupCount: number;
  configRoots: string[];
  diffCalls: Array<{ repoRoot: string; baseRef: string; headRef: string; filePath: string }>;
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
        }
      };
    }
  };
}

function createRecordingConfigProvider(calls: RunCallRecorder) {
  return {
    async loadReviewConfig(repoRoot: string) {
      calls.configRoots.push(repoRoot);
      return { maxConcurrentFiles: 1, mcpServers: {} };
    }
  };
}

function createRecordingReviewFileFilter(calls: RunCallRecorder) {
  return {
    async filterReviewableFiles(repoRoot: string, files: string[]) {
      calls.filterInputs.push({ repoRoot, files });
      return files;
    }
  };
}
