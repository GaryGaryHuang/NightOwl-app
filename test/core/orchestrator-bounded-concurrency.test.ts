import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";

import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import { DEFAULT_MAX_CONCURRENT_FILES } from "../../src/core/max-concurrent-files.ts";
import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import type { ReviewSourceProvider } from "../../src/providers/review-source-provider.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";
import { StepExecutionError } from "../../src/core/step-execution-error.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";
import {
  REQUEST,
  RUN_TIMESTAMP,
  bootstrapReviewHarness,
  createDefaultChangesetOverviewRunner,
  type ReviewHarness
} from "../helpers/orchestrator-harness.ts";
import { createWritableOutputSink } from "../helpers/output-sink-double.ts";

type StepRunnerDouble = {
  run(input: {
    context: FileReviewContext;
    step: { stepId: string };
  }): Promise<{
    stepId: string;
    applyTo(context: FileReviewContext): void;
  }>;
};

describe("ReviewOrchestrator bounded concurrency with mixed completion order", () => {
  let fixture: ReviewRepoFixture;
  let harness: ReviewHarness;
  let metrics: ReturnType<typeof createConcurrencyMetrics>;
  let bootstrapPublishCount = 0;
  let skippedFile: string;
  let fastSuccessfulFile: string;
  let slowSuccessfulFile: string;

  before(async () => {
    fixture = createReviewRepoFixture();
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.writeFile("lib/utils.ts", "export const helper = true;\n");
    fixture.commitAll("add changed files for bounded concurrency ordering");

    harness = await bootstrapReviewHarness(fixture);

    skippedFile = requireReviewableFile(harness, "README.md");
    fastSuccessfulFile = requireReviewableFile(harness, "packages/app/index.ts");
    slowSuccessfulFile = requireReviewableFile(harness, "src/app.ts");
    const delayedSuccessfulFile =
      harness.reviewableFiles.find(
        (filePath) =>
          filePath !== skippedFile &&
          filePath !== fastSuccessfulFile &&
          filePath !== slowSuccessfulFile
      ) ?? slowSuccessfulFile;

    metrics = createConcurrencyMetrics();
    bootstrapPublishCount = 0;
    const outputSink = createWritableOutputSink();
    const basePublishFileReview = outputSink.publishFileReview;
    outputSink.publishFileReview = async (fileResult) => {
      if (isBootstrapSnapshot(fileResult.content)) {
        bootstrapPublishCount += 1;
      }
      await basePublishFileReview(fileResult);
    };
    await runOrchestrator(harness, {
      maxConcurrentFiles: harness.reviewableFiles.length,
      outputSink,
      stepRunner: createConcurrentRunner({
        metrics,
        getBootstrapPublishCount: () => bootstrapPublishCount,
        completionDelayByFile: new Map([
          [fastSuccessfulFile, 0],
          [skippedFile, 80],
          [delayedSuccessfulFile, 140],
          [slowSuccessfulFile, 220]
        ]),
        failedFile: skippedFile,
        failedStepId: "step5-validation-interrogation",
        failureCause: "deterministic validation failed"
      })
    });
  });

  after(() => {
    fixture.cleanup();
  });

  test("ReviewOrchestrator caps concurrent file workers at maxConcurrentFiles", () => {
    assert.ok(metrics.maxActiveFiles > 1);
  });

  test("ReviewOrchestrator publishes all bootstrap notes before any worker enters Step 1", () => {
    assert.equal(metrics.firstStepBootstrapCount, harness.reviewableFiles.length);
    assert.equal(bootstrapPublishCount, harness.reviewableFiles.length);
  });

  test("ReviewOrchestrator allows files to complete out of plan order under bounded concurrency", () => {
    assert.notDeepEqual(metrics.completionOrder, harness.reviewableFiles);
    assert.ok(
      metrics.completionOrder.indexOf(fastSuccessfulFile) <
        metrics.completionOrder.indexOf(slowSuccessfulFile)
    );
  });
});

test("ReviewOrchestrator honors a maxConcurrentFiles cap below the planned file count for an all-skipped run", async () => {
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

      assert.equal(metrics.maxActiveFiles, 2);
      assert.equal(result.plannedFileCount, harness.reviewableFiles.length);
      assert.equal(result.successfulFileCount, 0);
      assert.equal(result.skippedFileCount, harness.reviewableFiles.length);
    }
  );
});

test("ReviewOrchestrator uses DEFAULT_MAX_CONCURRENT_FILES when maxConcurrentFiles is omitted", async () => {
  await withReviewHarness(
    {
      commitMessage: "add enough changed files to exercise implicit concurrency cap",
      extraFiles: Object.fromEntries(
        Array.from(
          { length: DEFAULT_MAX_CONCURRENT_FILES + 2 },
          (_, index) => [
            `src/extra-${index}.ts`,
            `export const extra${index} = ${index};\n`
          ]
        )
      )
    },
    async (harness) => {
      const metrics = createConcurrencyMetrics();
      const result = await runOrchestrator(harness, {
        outputSink: createWritableOutputSink(),
        stepRunner: createConcurrentRunner({
          metrics,
          getBootstrapPublishCount: () => harness.reviewableFiles.length,
          completionDelayByFile: new Map(
            harness.reviewableFiles.map((filePath) => [filePath, 40])
          )
        })
      });

      assert.ok(result.plannedFileCount > DEFAULT_MAX_CONCURRENT_FILES);
      assert.equal(metrics.maxActiveFiles, DEFAULT_MAX_CONCURRENT_FILES);
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

    const harness = await bootstrapReviewHarness(fixture);

    await run(harness);
  } finally {
    fixture.cleanup();
  }
}

async function runOrchestrator(
  harness: ReviewHarness,
  overrides: {
    maxConcurrentFiles?: number;
    outputSink: ConstructorParameters<typeof ReviewOrchestrator>[0]["outputSink"];
    stepRunner: StepRunnerDouble;
    sourceProvider?: ReviewSourceProvider;
  }
) {
  const orchestrator = new ReviewOrchestrator({
    sourceProvider: overrides.sourceProvider ?? harness.sourceProvider,
    reviewFileFilter: harness.reviewFileFilter,
    outputSink: overrides.outputSink,
    stepRunner: overrides.stepRunner,
    changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
    workingDirectory: harness.fixture.repoDir,
    timestampProvider: () => RUN_TIMESTAMP,
    ...(overrides.maxConcurrentFiles === undefined
      ? {}
      : { maxConcurrentFiles: overrides.maxConcurrentFiles })
  });

  return await orchestrator.run(REQUEST);
}

function requireReviewableFile(harness: ReviewHarness, filePath: string): string {
  assert.equal(harness.reviewableFiles.includes(filePath), true);
  return filePath;
}

function createConcurrencyMetrics() {
  return {
    maxActiveFiles: 0,
    firstStepBootstrapCount: -1,
    completionOrder: [] as string[]
  };
}

function createConcurrentRunner(input: {
  metrics: ReturnType<typeof createConcurrencyMetrics>;
  getBootstrapPublishCount: () => number;
  completionDelayByFile: Map<string, number>;
  failedFiles?: Set<string>;
  failedFile?: string;
  failedStepId?: "step1-overview" | "step5-validation-interrogation";
  failureCause?: "judge rejected" | "deterministic validation failed";
}): StepRunnerDouble {
  const activeFiles = new Set<string>();
  const startedFiles = new Set<string>();

  return {
    async run({ context, step }) {
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

function isBootstrapSnapshot(content: string): boolean {
  return /- Status: Review not yet generated\./u.test(content);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
