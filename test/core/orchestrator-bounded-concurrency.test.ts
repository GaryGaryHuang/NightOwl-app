import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { deriveFileRiskLevel } from "../../src/core/risk-level.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import type { ReviewSourceProvider } from "../../src/providers/review-source-provider.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";
import { StepExecutionError } from "../../src/core/step-execution-error.ts";
import {
  buildFindingsForFile,
  buildSuccessfulStepResult,
  escapeRegExp
} from "../helpers/orchestrator-fixture.ts";
import { createWritableOutputSink } from "../helpers/output-sink-double.ts";

const BASE_REF = "main";
const HEAD_REF = "feature-branch";
const RUN_TIMESTAMP = "03131430";
const REQUEST = {
  baseRef: BASE_REF,
  headRef: HEAD_REF,
  repoPath: "./packages/app",
  userContext: [],
  dryRun: false
};

type StepEvent = [string, string];
type StepRunnerDouble = {
  run(input: {
    context: FileReviewContext;
    step: { stepId: string };
  }): Promise<{
    stepId: string;
    applyTo(context: FileReviewContext): void;
  }>;
};

interface ReviewHarness {
  fixture: ReviewRepoFixture;
  repoRoot: string;
  reviewableFiles: string[];
  reviewFileFilter: LocalReviewFileFilter;
  sourceProvider: LocalGitProvider;
}

test("ReviewOrchestrator uses bounded concurrency, finishes bootstrap before fan-out, and keeps summary/index in planned order despite out-of-order completion", async () => {
  await withReviewHarness(
    {
      commitMessage: "add changed files for bounded concurrency ordering",
      extraFiles: { "lib/utils.ts": "export const helper = true;\n" }
    },
    async (harness) => {
      const skippedFile = requireReviewableFile(harness, "README.md");
      const fastSuccessfulFile = requireReviewableFile(harness, "packages/app/index.ts");
      const slowSuccessfulFile = requireReviewableFile(harness, "src/app.ts");
      const mediumSuccessfulFile =
        harness.reviewableFiles.find(
          (filePath) =>
            filePath !== skippedFile &&
            filePath !== fastSuccessfulFile &&
            filePath !== slowSuccessfulFile
        ) ?? slowSuccessfulFile;

      const metrics = createConcurrencyMetrics();
      let bootstrapPublishCount = 0;
      const outputSink = createWritableOutputSink();
      const basePublishFileReview = outputSink.publishFileReview;
      outputSink.publishFileReview = async (fileResult) => {
        if (isBootstrapSnapshot(fileResult.content)) {
          bootstrapPublishCount += 1;
        }
        await basePublishFileReview(fileResult);
      };
      const result = await runOrchestrator(harness, {
        maxConcurrentFiles: harness.reviewableFiles.length,
        outputSink,
        stepRunner: createConcurrentRunner({
          metrics,
          getBootstrapPublishCount: () => bootstrapPublishCount,
          completionDelayByFile: new Map([
            [fastSuccessfulFile, 0],
            [skippedFile, 80],
            [mediumSuccessfulFile, 140],
            [slowSuccessfulFile, 220]
          ]),
          failedFile: skippedFile,
          failedStepId: "step5-validation-interrogation",
          failureCause: "deterministic validation failed"
        })
      });

      assert.equal(metrics.firstStepBootstrapCount, harness.reviewableFiles.length);
      assert.equal(bootstrapPublishCount, harness.reviewableFiles.length);
      assert.ok(metrics.maxActiveFiles > 1);
      assert.notDeepEqual(metrics.completionOrder, harness.reviewableFiles);
      assert.ok(
        metrics.completionOrder.indexOf(fastSuccessfulFile) <
          metrics.completionOrder.indexOf(slowSuccessfulFile)
      );

      const expectedSuccessfulFiles = riskSortedSuccessfulFiles(
        harness.reviewableFiles,
        skippedFile
      );
      const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
      const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");

      assertSuccessfulFileOrder(summaryContent, expectedSuccessfulFiles);
      assert.match(
        summaryContent,
        new RegExp(
          `## Skipped Files\\n- \`${escapeRegExp(skippedFile)}\` — step5-validation-interrogation — deterministic validation failed`,
          "u"
        )
      );
      assertFileNotesOrder(indexContent, [
        ...expectedSuccessfulFiles,
        skippedFile
      ]);
    }
  );
});

test("ReviewOrchestrator keeps an all-skipped run as a completed run under bounded concurrency and writes intact skipped.md records", async () => {
  await withReviewHarness(
    { commitMessage: "add third changed file for all-skipped bounded concurrency" },
    async (harness) => {
      const metrics = createConcurrencyMetrics();
      const result = await runOrchestrator(harness, {
        maxConcurrentFiles: 2,
        outputSink: createWritableOutputSink(),
        sourceProvider: withInstantDiff(harness.sourceProvider),
        stepRunner: createConcurrentRunner({
          metrics,
          getBootstrapPublishCount: () => harness.reviewableFiles.length,
          completionDelayByFile: new Map(
            harness.reviewableFiles.map((filePath, index) => [filePath, index * 5])
          ),
          failedFiles: new Set(harness.reviewableFiles),
          failedStepId: "step1-overview",
          failureCause: "judge rejected"
        })
      });

      const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

      assert.equal(metrics.maxActiveFiles, 2);
      assert.equal(result.plannedFileCount, harness.reviewableFiles.length);
      assert.equal(result.successfulFileCount, 0);
      assert.equal(result.skippedFileCount, harness.reviewableFiles.length);
      assert.equal(existsSync(result.outputTarget.summaryPath), true);
      assert.equal(existsSync(result.outputTarget.indexPath), true);

      for (const filePath of harness.reviewableFiles) {
        assert.match(
          skippedLog,
          new RegExp(`- \`${escapeRegExp(filePath)}\` — step1-overview — judge rejected`, "u")
        );
      }

      assert.doesNotMatch(
        skippedLog,
        /step1-overview.*step1-overview.*judge rejected.*judge rejected.*`/u
      );
    }
  );
});

test("ReviewOrchestrator downgrades a file to skipped after a concurrent successful snapshot write failure and later files continue", async () => {
  await withReviewHarness(
    { commitMessage: "add enough changed files for concurrent single-file output fault" },
    async (harness) => {
      const failedFile = harness.reviewableFiles[0];
      const siblingFile = harness.reviewableFiles[1];
      const laterFiles = harness.reviewableFiles.slice(2);
      const failedNotePath = notePathFor(harness, failedFile);
      const stepEvents: StepEvent[] = [];
      const outputSink = createWritableOutputSink();
      let snapshotFailed = false;
      const basePublishFileReview = outputSink.publishFileReview;
      outputSink.publishFileReview = async (fileResult) => {
        if (
          !snapshotFailed &&
          fileResult.noteFilePath === failedNotePath &&
          !isBootstrapSnapshot(fileResult.content)
        ) {
          snapshotFailed = true;
          throw new Error("file review write failed");
        }
        await basePublishFileReview(fileResult);
      };

      const result = await runOrchestrator(harness, {
        maxConcurrentFiles: 2,
        outputSink,
        successfulSnapshotOutputHealthAssessor: {
          assess: async () => ({ faultScope: "single-file-output-fault" as const })
        },
        stepRunner: createConcurrentRunner({
          metrics: createConcurrencyMetrics(),
          getBootstrapPublishCount: () => harness.reviewableFiles.length,
          completionDelayByFile: new Map([[siblingFile, 60]]),
          stepEvents
        })
      });

      assert.equal(result.skippedFileCount, 1);
      assert.equal(hasStepEventForFile(stepEvents, siblingFile), true);
      for (const laterFile of laterFiles) {
        assert.equal(hasStepEventForFile(stepEvents, laterFile), true);
      }

      assert.match(
        readFileSync(result.outputTarget.skippedPath, "utf8"),
        new RegExp(`- \`${escapeRegExp(failedFile)}\` — step1-overview — file review write failed`, "u")
      );
      assert.match(
        readFileSync(failedNotePath, "utf8"),
        /> \[!WARNING\] Review Interrupted/u
      );
    }
  );
});

test("ReviewOrchestrator suppresses sibling successful snapshots and later dispatch after a shared-target successful snapshot failure", async () => {
  await withReviewHarness(
    { commitMessage: "add files for shared-target successful snapshot abort coordination" },
    async (harness) => {
      const failedFile = harness.reviewableFiles[0];
      const siblingFile = harness.reviewableFiles[1];
      const laterFile = harness.reviewableFiles[2];
      const siblingReleased = createDeferred<void>();
      const stepEvents: StepEvent[] = [];
      const failedNotePath = notePathFor(harness, failedFile);
      const outputSink = createWritableOutputSink();
      let snapshotFailed = false;
      let siblingSuccessfulSnapshotCount = 0;
      let siblingSkippedRecordCount = 0;
      const basePublishFileReview = outputSink.publishFileReview;
      const basePublishSkippedFile = outputSink.publishSkippedFile;
      outputSink.publishFileReview = async (fileResult) => {
        const isBootstrap = isBootstrapSnapshot(fileResult.content);
        const isInterrupted = isInterruptedSnapshot(fileResult.content);
        if (
          !snapshotFailed &&
          fileResult.noteFilePath === failedNotePath &&
          !isBootstrap &&
          !isInterrupted
        ) {
          snapshotFailed = true;
          // Defer release to a macrotask so that the orchestrator's async
          // assess() call completes and sets runAbortState.error before the
          // sibling resumes.  This mirrors the original sync timing where
          // assess was synchronous and the abort state was set before the
          // sibling's continuation.
          setTimeout(() => siblingReleased.resolve(), 0);
          throw new Error("disk full");
        }
        if (!isBootstrap && !isInterrupted && !fileResult.noteFilePath.includes(failedFile)) {
          siblingSuccessfulSnapshotCount += 1;
        }
        await basePublishFileReview(fileResult);
      };
      outputSink.publishSkippedFile = async (skipRecord) => {
        if (skipRecord.filePath !== failedFile) {
          siblingSkippedRecordCount += 1;
        }
        await basePublishSkippedFile(skipRecord);
      };

      await assert.rejects(
        () =>
          runOrchestrator(harness, {
            maxConcurrentFiles: 2,
            outputSink,
            sourceProvider: withInstantDiff(harness.sourceProvider),
            successfulSnapshotOutputHealthAssessor: {
              assess: async () => ({ faultScope: "shared-output-target-fault" as const })
            },
            stepRunner: createSharedAbortRunner({
              stepEvents,
              gateByFileAndStep: new Map([[`${siblingFile}:step1-overview`, siblingReleased.promise]])
            })
          }),
        /disk full/u
      );

      assert.deepEqual(eventsForFile(stepEvents, siblingFile), [
        ["step1-overview", siblingFile]
      ]);
      assert.equal(hasStepEventForFile(stepEvents, laterFile), false);
      assert.equal(siblingSuccessfulSnapshotCount, 0);
      assert.equal(siblingSkippedRecordCount, 0);
    }
  );
});

test("ReviewOrchestrator suppresses later interrupted snapshots and skipped records after shared abort from skipped-artifact failure", async () => {
  await withReviewHarness(
    { commitMessage: "add files for skipped artifact abort coordination" },
    async (harness) => {
      const failedFile = harness.reviewableFiles[0];
      const siblingFile = harness.reviewableFiles[1];
      const stepEvents: StepEvent[] = [];
      const siblingFailureReleased = createDeferred<void>();
      const outputSink = createWritableOutputSink();
      let siblingInterruptedSnapshotCount = 0;
      let siblingSkippedRecordCount = 0;
      const basePublishFileReview = outputSink.publishFileReview;
      const basePublishSkippedFile = outputSink.publishSkippedFile;
      outputSink.publishFileReview = async (fileResult) => {
        if (
          isInterruptedSnapshot(fileResult.content) &&
          !fileResult.noteFilePath.includes(failedFile)
        ) {
          siblingInterruptedSnapshotCount += 1;
        }
        await basePublishFileReview(fileResult);
      };
      outputSink.publishSkippedFile = async (skipRecord) => {
        if (skipRecord.filePath === failedFile) {
          siblingFailureReleased.resolve();
          throw new Error("skipped log write failed");
        }
        siblingSkippedRecordCount += 1;
        await basePublishSkippedFile(skipRecord);
      };

      await assert.rejects(
        () =>
          runOrchestrator(harness, {
            maxConcurrentFiles: 2,
            outputSink,
            sourceProvider: withInstantDiff(harness.sourceProvider),
            stepRunner: createSharedAbortRunner({
              stepEvents,
              failByFileAndStep: new Map([
                [`${failedFile}:step1-overview`, "judge rejected"],
                [`${siblingFile}:step1-overview`, "judge rejected"]
              ]),
              gateByFileAndStep: new Map([[`${siblingFile}:step1-overview`, siblingFailureReleased.promise]])
            })
          }),
        /skipped log write failed/u
      );

      assert.deepEqual(eventsForFile(stepEvents, siblingFile), [
        ["step1-overview", siblingFile]
      ]);
      assert.equal(siblingInterruptedSnapshotCount, 0);
      assert.equal(siblingSkippedRecordCount, 0);
    }
  );
});

test("ReviewOrchestrator records finalizerFailure when summary publishing fails after concurrent file processing", async () => {
  await withReviewHarness(
    { commitMessage: "add third changed file for fatal bounded concurrency summary failure" },
    async (harness) => {
      const metrics = createConcurrencyMetrics();
      const outputSink = createWritableOutputSink();
      const writtenFileReviews: string[] = [];
      let publishRunSummaryCalls = 0;
      const basePublishFileReview = outputSink.publishFileReview;
      outputSink.publishFileReview = async (fileResult) => {
        await basePublishFileReview(fileResult);
        writtenFileReviews.push(fileResult.noteFilePath);
      };
      outputSink.publishRunSummary = async () => {
        publishRunSummaryCalls += 1;
        throw new Error("summary write failed");
      };
      outputSink.publishReviewIndex = async () => {};
      outputSink.publishRunManifest = async () => {};

      const result = await runOrchestrator(harness, {
        maxConcurrentFiles: 2,
        outputSink,
        stepRunner: createConcurrentRunner({
          metrics,
          getBootstrapPublishCount: () => harness.reviewableFiles.length,
          completionDelayByFile: new Map([
            [harness.reviewableFiles[0], 40],
            [harness.reviewableFiles[1], 0],
            [harness.reviewableFiles[2], 10]
          ])
        })
      });

      assert.equal(result.finalizerFailures.length, 1);
      assert.equal(result.finalizerFailures[0].artifact, "summary");
      assert.match(result.finalizerFailures[0].message, /summary write failed/u);
      assert.equal(metrics.maxActiveFiles, 2);
      assert.equal(publishRunSummaryCalls, 1);
      assert.ok(writtenFileReviews.length > 0);
    }
  );
});

async function withReviewHarness(
  input: {
    commitMessage: string;
    extraFiles?: Record<string, string>;
  },
  run: (harness: ReviewHarness) => Promise<void>
): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");

    for (const [filePath, content] of Object.entries(input.extraFiles ?? {})) {
      fixture.writeFile(filePath, content);
    }

    fixture.commitAll(input.commitMessage);

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = await sourceProvider.resolveRepoRoot(fixture.appDir);
    const changedFiles = await sourceProvider.getChangedFiles(repoRoot, BASE_REF, HEAD_REF);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      changedFiles
    );

    await run({
      fixture,
      repoRoot,
      reviewableFiles,
      reviewFileFilter,
      sourceProvider
    });
  } finally {
    fixture.cleanup();
  }
}

async function runOrchestrator(
  harness: ReviewHarness,
  overrides: {
    maxConcurrentFiles: number;
    outputSink: ConstructorParameters<typeof ReviewOrchestrator>[0]["outputSink"];
    stepRunner: StepRunnerDouble;
    sourceProvider?: ReviewSourceProvider;
    successfulSnapshotOutputHealthAssessor?: ConstructorParameters<typeof ReviewOrchestrator>[0]["successfulSnapshotOutputHealthAssessor"];
  }
) {
  const orchestrator = new ReviewOrchestrator({
    sourceProvider: overrides.sourceProvider ?? harness.sourceProvider,
    reviewFileFilter: harness.reviewFileFilter,
    outputSink: overrides.outputSink,
    ...(overrides.successfulSnapshotOutputHealthAssessor === undefined
      ? {}
      : {
          successfulSnapshotOutputHealthAssessor:
            overrides.successfulSnapshotOutputHealthAssessor
        }),
    stepRunner: overrides.stepRunner,
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
          userContext: []
        });
      }
    },
    workingDirectory: harness.fixture.repoDir,
    timestampProvider: () => RUN_TIMESTAMP,
    maxConcurrentFiles: overrides.maxConcurrentFiles
  });

  return await orchestrator.run(REQUEST);
}

function requireReviewableFile(harness: ReviewHarness, filePath: string): string {
  assert.equal(harness.reviewableFiles.includes(filePath), true);
  return filePath;
}

function notePathFor(harness: ReviewHarness, filePath: string): string {
  return planNoteFiles(expectedFilesPath(harness.repoRoot), harness.reviewableFiles).find(
    (plannedNote) => plannedNote.filePath === filePath
  )!.noteFilePath;
}

function expectedFilesPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    ".nightowl",
    "review",
    `feature-branch_${RUN_TIMESTAMP}`,
    "files"
  );
}

function riskSortedSuccessfulFiles(
  reviewableFiles: string[],
  skippedFile: string
): string[] {
  const riskOrder = { High: 0, Medium: 1, Low: 2, None: 3 } as const;

  return reviewableFiles
    .filter((filePath) => filePath !== skippedFile)
    .sort((a, b) => {
      const aRisk = deriveFileRiskLevel(buildFindingsForFile(a));
      const bRisk = deriveFileRiskLevel(buildFindingsForFile(b));
      if (aRisk !== bRisk) {
        return riskOrder[aRisk] - riskOrder[bRisk];
      }

      return reviewableFiles.indexOf(a) - reviewableFiles.indexOf(b);
    });
}

function eventsForFile(stepEvents: StepEvent[], filePath: string): StepEvent[] {
  return stepEvents.filter(([, eventFilePath]) => eventFilePath === filePath);
}

function hasStepEventForFile(stepEvents: StepEvent[], filePath: string): boolean {
  return eventsForFile(stepEvents, filePath).length > 0;
}

function createConcurrencyMetrics() {
  return {
    maxActiveFiles: 0,
    firstStepBootstrapCount: -1,
    completionOrder: [] as string[]
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function createConcurrentRunner(input: {
  metrics: ReturnType<typeof createConcurrencyMetrics>;
  getBootstrapPublishCount: () => number;
  completionDelayByFile: Map<string, number>;
  stepEvents?: StepEvent[];
  failedFiles?: Set<string>;
  failedFile?: string;
  failedStepId?: "step1-overview" | "step5-validation-interrogation";
  failureCause?: "judge rejected" | "deterministic validation failed";
}): StepRunnerDouble {
  const activeFiles = new Set<string>();
  const startedFiles = new Set<string>();

  return {
    async run({ context, step }) {
      input.stepEvents?.push([step.stepId, context.filePath]);

      if (!startedFiles.has(context.filePath)) {
        startedFiles.add(context.filePath);
        activeFiles.add(context.filePath);
        input.metrics.maxActiveFiles = Math.max(
          input.metrics.maxActiveFiles,
          activeFiles.size
        );

        if (input.metrics.firstStepBootstrapCount === -1) {
          input.metrics.firstStepBootstrapCount = input.getBootstrapPublishCount();
        }
      }

      const isFailedFile =
        input.failedFiles?.has(context.filePath) === true ||
        context.filePath === input.failedFile;
      const isFailedStep = step.stepId === input.failedStepId;

      if (isFailedFile && isFailedStep) {
        await completeFile(context.filePath, input, activeFiles);
        throw new StepExecutionError({
          stepId: step.stepId,
          filePath: context.filePath,
          cause: input.failureCause!
        });
      }

      if (step.stepId === "step7-summary") {
        await sleep(input.completionDelayByFile.get(context.filePath) ?? 0);
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath, {
        onTerminalApply() {
          if (step.stepId === "step7-summary") {
            activeFiles.delete(context.filePath);
            input.metrics.completionOrder.push(context.filePath);
          }
        }
      });
    }
  };
}

async function completeFile(
  filePath: string,
  input: {
    metrics: ReturnType<typeof createConcurrencyMetrics>;
    completionDelayByFile: Map<string, number>;
  },
  activeFiles: Set<string>
): Promise<void> {
  await sleep(input.completionDelayByFile.get(filePath) ?? 0);
  activeFiles.delete(filePath);
  input.metrics.completionOrder.push(filePath);
}

function createSharedAbortRunner(input: {
  stepEvents: StepEvent[];
  gateByFileAndStep?: Map<string, Promise<void>>;
  failByFileAndStep?: Map<string, string>;
}): StepRunnerDouble {
  return {
    async run({ context, step }) {
      input.stepEvents.push([step.stepId, context.filePath]);

      const gate = input.gateByFileAndStep?.get(`${context.filePath}:${step.stepId}`);
      if (gate) {
        await gate;
      }

      const failureCause = input.failByFileAndStep?.get(
        `${context.filePath}:${step.stepId}`
      );
      if (failureCause) {
        throw new StepExecutionError({
          stepId: step.stepId,
          filePath: context.filePath,
          cause: failureCause
        });
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}

function isBootstrapSnapshot(content: string): boolean {
  return /- Status: Review not yet generated\./u.test(content);
}

function isInterruptedSnapshot(content: string): boolean {
  return /> \[!WARNING\] Review Interrupted/u.test(content);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assertSuccessfulFileOrder(
  summaryContent: string,
  expectedFileOrder: string[]
): void {
  assertRelativeOrder(
    summaryContent,
    expectedFileOrder.map((filePath) => `\`${filePath}\``)
  );
}

function assertFileNotesOrder(indexContent: string, expectedFileOrder: string[]): void {
  assertRelativeOrder(
    indexContent,
    expectedFileOrder.map((filePath) => `\`${filePath}\``)
  );
}

function assertRelativeOrder(content: string, expectedFragments: string[]): void {
  const positions = expectedFragments.map((fragment) => content.indexOf(fragment));

  for (const position of positions) {
    assert.ok(position >= 0);
  }

  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index]);
  }
}

function withInstantDiff(provider: LocalGitProvider): ReviewSourceProvider {
  return {
    resolveRepoRoot: (s) => provider.resolveRepoRoot(s),
    getChangedFiles: (r, b, h) => provider.getChangedFiles(r, b, h),
    getChangesetEntries: (r, b, h) => provider.getChangesetEntries(r, b, h),
    getCurrentBranch: (r) => provider.getCurrentBranch(r),
    async getDiff() {
      return "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
    }
  };
}
