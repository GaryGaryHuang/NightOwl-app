import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ReviewOrchestrator,
  type ReviewOrchestratorOptions
} from "../../src/core/orchestrator.ts";
import type { RunStepInput, StepResult, StepRunner } from "../../src/core/step-runner.ts";
import { StepExecutionError } from "../../src/core/step-execution-error.ts";
import type { OutputTarget } from "../../src/core/review-path-resolver.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import type {
  ReviewArtifactKind,
  ReviewOutputPlan,
  ReviewOutputTarget,
  RunOutputPublisher
} from "../../src/providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../../src/providers/review-source-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  buildSuccessfulStepResult,
  type SuccessfulStepResultOptions
} from "../helpers/orchestrator-fixture.ts";
import {
  REQUEST,
  RUN_TIMESTAMP,
  bootstrapReviewHarness,
  createDefaultChangesetOverviewRunner,
  type ReviewHarness
} from "../helpers/orchestrator-harness.ts";

type OutputCall = "initializeRun"
  | "publishFileReview"
  | `publishArtifact:${ReviewArtifactKind}`;

type RunLevelArtifact = "index";

const RUN_LEVEL_FINALIZER_CALLS: OutputCall[] = [
  "publishArtifact:index"
];

test("ReviewOrchestrator dispatches every run-level finalizer for an all-successful run and writes their artifacts", async () => {
  await withReviewHarness({}, async (harness) => {
    const outputSink = new RecordingOutputSink();
    const result = await runOrchestrator(harness, {
      outputSink,
      stepRunner: createSuccessfulSummaryRunner()
    });

    assert.equal(result.plannedFileCount, harness.reviewableFiles.length);
    assert.equal(result.successfulFileCount, harness.reviewableFiles.length);
    assert.equal(result.skippedFileCount, 0);
    assert.deepEqual(result.finalizerFailures, []);
    assertOutputTargetPaths(result.outputTarget, harness.repoRoot);
    assertOutputArtifactsExist(result.outputTarget);
    for (const call of RUN_LEVEL_FINALIZER_CALLS) {
      assert.equal(outputSink.calls.includes(call), true, call);
    }
  });
});

test("ReviewOrchestrator feeds finalizers in-memory outcomes rather than reading back corrupted on-disk artifacts", async () => {
  await withReviewHarness(
    {
      commitMessage: "add third changed file for in-memory data source contract",
      extraFiles: { "README.md": "# Demo feature change\n" }
    },
    async (harness) => {
      const skippedFile = "README.md";
      const outputSink = new CorruptingDiskOutputSink();

      const result = await runOrchestrator(harness, {
        outputSink,
        stepRunner: createMixedResultRunner(skippedFile)
      });

      assert.equal(result.successfulFileCount, harness.reviewableFiles.length - 1);
      assert.equal(result.skippedFileCount, 1);

      const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");

      assert.doesNotMatch(indexContent, /CORRUPTED/u);
      assert.doesNotMatch(indexContent, /EXTRA DISK FILE/u);
      assert.match(indexContent, /## Run Summary/u);
    }
  );
});

test("ReviewOrchestrator still dispatches every run-level finalizer when zero files are planned", async () => {
  await withReviewHarness({ reviewignore: "**\n" }, async (harness) => {
    const outputSink = new RecordingOutputSink();
    const result = await runOrchestrator(harness, {
      outputSink,
      stepRunner: createFailingIfStartedRunner()
    });

    assert.equal(result.plannedFileCount, 0);
    assert.equal(result.successfulFileCount, 0);
    assert.equal(result.skippedFileCount, 0);
    assert.deepEqual(result.finalizerFailures, []);
    assertOutputArtifactsExist(result.outputTarget);
    for (const call of RUN_LEVEL_FINALIZER_CALLS) {
      assert.equal(outputSink.calls.includes(call), true, call);
    }
  });
});

test("ReviewOrchestrator treats an all-skipped run as a completed run that still dispatches every run-level finalizer", async () => {
  await withReviewHarness({}, async (harness) => {
    const outputSink = new RecordingOutputSink();
    const result = await runOrchestrator(harness, {
      outputSink,
      stepRunner: createAllSkippedRunner(new Set(harness.reviewableFiles))
    });

    assert.equal(result.successfulFileCount, 0);
    assert.equal(result.skippedFileCount, harness.reviewableFiles.length);
    assert.deepEqual(result.finalizerFailures, []);
    assertOutputArtifactsExist(result.outputTarget);
    for (const call of RUN_LEVEL_FINALIZER_CALLS) {
      assert.equal(outputSink.calls.includes(call), true, call);
    }
  });
});

test("ReviewOrchestrator does not publish run-level artifacts when applyTo fails after bootstrap", async () => {
  await withReviewHarness({}, async (harness) => {
    const outputSink = new RecordingOutputSink();

    await assert.rejects(
      () =>
        runOrchestrator(harness, {
          outputSink,
          stepRunner: {
            async run({ step }) {
              if (step.stepId !== "review-basis") {
                throw new Error(`should not reach ${step.stepId}`);
              }

              return {
                stepId: step.stepId,
                applyTo() {
                  throw new Error("apply failed");
                }
              };
            }
          }
        }),
      /apply failed/u
    );

    for (const call of RUN_LEVEL_FINALIZER_CALLS) {
      assert.equal(outputSink.calls.includes(call), false, call);
    }
  });
});

test("ReviewOrchestrator does not initialize output when Changeset Overview fails", async () => {
  await withReviewHarness({}, async (harness) => {
    const outputSink = new RecordingOutputSink();

    await assert.rejects(
      () =>
        runOrchestrator(harness, {
          outputSink,
          stepRunner: createFailingIfStartedRunner(),
          changesetOverviewRunner: {
            async run() {
              throw new Error("Changeset Overview failed");
            }
          }
        }),
      /Changeset Overview failed/u
    );

    assert.deepEqual(outputSink.calls, []);
  });
});

test("ReviewOrchestrator publishes run-level artifacts when getDiff failure downgrades one file to skipped", async () => {
  await withReviewHarness(
    {
      commitMessage: "add third changed file for getDiff downgrade",
      extraFiles: { "README.md": "# Demo feature change\n" }
    },
    async (harness) => {
      const failedFile = harness.reviewableFiles[1];
      const outputSink = new RecordingOutputSink();
      const result = await runOrchestrator(harness, {
        sourceProvider: createDiffFailingSourceProvider(
          harness.sourceProvider,
          failedFile
        ),
        outputSink,
        stepRunner: createSuccessfulSummaryRunner()
      });

      assert.equal(result.skippedFileCount, 1);
      assert.equal(result.successfulFileCount, harness.reviewableFiles.length - 1);
      for (const call of RUN_LEVEL_FINALIZER_CALLS) {
        assert.equal(outputSink.calls.includes(call), true, call);
      }
    }
  );
});

test("ReviewOrchestrator records finalizerFailure and stops dependent finalizers", async () => {
  const cases: Array<{
    artifact: RunLevelArtifact;
    message: RegExp;
    failure: Partial<Record<RunLevelArtifact, string>>;
    expectedCalls: OutputCall[];
    skippedCalls: OutputCall[];
  }> = [
    {
      artifact: "index",
      message: /index write failed/u,
      failure: { index: "index write failed" },
      expectedCalls: ["publishArtifact:index"],
      skippedCalls: []
    }
  ];

  for (const testCase of cases) {
    await withReviewHarness({}, async (harness) => {
      const outputSink = new FinalizerFailingOutputSink(testCase.failure);
      const result = await runOrchestrator(harness, {
        outputSink,
        stepRunner: createSuccessfulSummaryRunner()
      });

      assert.equal(result.finalizerFailures.length, 1, testCase.artifact);
      assert.equal(result.finalizerFailures[0].artifact, testCase.artifact);
      assert.match(result.finalizerFailures[0].message, testCase.message);
      for (const call of testCase.expectedCalls) {
        assert.equal(outputSink.calls.includes(call), true, `${testCase.artifact}:${call}`);
      }
      for (const call of testCase.skippedCalls) {
        assert.equal(outputSink.calls.includes(call), false, `${testCase.artifact}:${call}`);
      }
      assert.ok(outputSink.writtenFileReviews.length > 0);
    });
  }
});

test("ReviewOrchestrator publishes artifacts in deterministic order after per-file work", async () => {
  await withReviewHarness(
    {
      commitMessage: "add third changed file for publish ordering",
      extraFiles: { "README.md": "# Demo feature change\n" }
    },
    async (harness) => {
      const skippedFile = harness.reviewableFiles[1];
      const outputSink = new RecordingOutputSink();

      await runOrchestrator(harness, {
        outputSink,
        stepRunner: createMixedResultRunner(skippedFile)
      });

      assert.equal(outputSink.calls.at(-1), "publishArtifact:index");
      assertCallAfter(outputSink.calls, "publishArtifact:index", "publishFileReview");
    }
  );
});

async function withReviewHarness(
  input: {
    reviewignore?: string;
    commitMessage?: string;
    extraFiles?: Record<string, string>;
  },
  run: (harness: ReviewHarness) => Promise<void>
): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", input.reviewignore ?? "dist/**\n");

    for (const [filePath, content] of Object.entries(input.extraFiles ?? {})) {
      fixture.writeFile(filePath, content);
    }

    if (input.commitMessage) {
      fixture.commitAll(input.commitMessage);
    }

    const harness = await bootstrapReviewHarness(fixture);

    await run(harness);
  } finally {
    fixture.cleanup();
  }
}

async function runOrchestrator(
  harness: ReviewHarness,
  overrides: {
    outputSink: ReviewOrchestratorOptions["outputSink"];
    stepRunner: ReviewOrchestratorOptions["stepRunner"];
    changesetOverviewRunner?: ReviewOrchestratorOptions["changesetOverviewRunner"];
    sourceProvider?: ReviewSourceProvider;
  }
) {
  const orchestrator = new ReviewOrchestrator({
    sourceProvider: overrides.sourceProvider ?? harness.sourceProvider,
    reviewFileFilter: harness.reviewFileFilter,
    outputSink: overrides.outputSink,
    stepRunner: overrides.stepRunner,
    changesetOverviewRunner:
      overrides.changesetOverviewRunner ?? createDefaultChangesetOverviewRunner(),
    workingDirectory: harness.fixture.repoDir,
    timestampProvider: () => RUN_TIMESTAMP
  });

  return await orchestrator.run(REQUEST);
}

function createSuccessfulSummaryRunner(
  options: SuccessfulStepResultOptions = {}
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      return buildSuccessfulStepResult(step.stepId, context.filePath, options);
    }
  };
}

function createMixedResultRunner(
  skippedFile: string,
  options: SuccessfulStepResultOptions = {}
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      if (
        context.filePath === skippedFile &&
        step.stepId === "candidate-findings"
      ) {
        throw new StepExecutionError({
          stepId: step.stepId,
          filePath: context.filePath,
          cause: "deterministic validation failed"
        });
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath, options);
    }
  };
}

function createAllSkippedRunner(
  skippedFiles: Set<string>,
  options: SuccessfulStepResultOptions = {}
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      if (skippedFiles.has(context.filePath) && step.stepId === "review-basis") {
        throw new StepExecutionError({
          stepId: step.stepId,
          filePath: context.filePath,
          cause: "judge rejected"
        });
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath, options);
    }
  };
}

function createFailingIfStartedRunner(): Pick<StepRunner, "run"> {
  return {
    async run() {
      throw new Error("should not start steps");
    }
  };
}

function createDiffFailingSourceProvider(
  sourceProvider: LocalGitProvider,
  failedFile: string
): ReviewSourceProvider {
  return {
    resolveRepoRoot(startPath) {
      return sourceProvider.resolveRepoRoot(startPath);
    },
    getChangedFiles(repoRootArg, baseRef, headRef) {
      return sourceProvider.getChangedFiles(repoRootArg, baseRef, headRef);
    },
    getChangesetEntries(repoRootArg, baseRef, headRef) {
      return sourceProvider.getChangesetEntries(repoRootArg, baseRef, headRef);
    },
    async getDiff(repoRootArg, baseRef, headRef, filePath) {
      if (filePath === failedFile) {
        throw new Error("git diff failed");
      }

      return sourceProvider.getDiff(repoRootArg, baseRef, headRef, filePath);
    },
    getCurrentBranch(repoRootArg) {
      return sourceProvider.getCurrentBranch(repoRootArg);
    }
  };
}

class RecordingOutputSink {
  protected outputTarget!: ReviewOutputTarget;
  protected notePathByFilePath = new Map<string, string>();
  calls: OutputCall[] = [];
  records: Array<{ call: OutputCall; value: string }> = [];
  writtenFileReviews: string[] = [];

  async initializeRun(outputPlan: ReviewOutputPlan): Promise<RunOutputPublisher> {
    mkdirSync(outputPlan.outputTarget.basePath, { recursive: true });
    mkdirSync(outputPlan.outputTarget.filesPath, { recursive: true });
    this.outputTarget = outputPlan.outputTarget;
    this.notePathByFilePath = new Map(
      outputPlan.plannedNotes.map((plannedNote) => [
        plannedNote.filePath,
        plannedNote.noteFilePath
      ])
    );
    this.record("initializeRun", outputPlan.outputTarget.basePath);
    return this;
  }

  async publishFileReview(fileResult: Parameters<RunOutputPublisher["publishFileReview"]>[0]): Promise<void> {
    const noteFilePath = this.resolveNoteFilePath(fileResult.filePath);
    writeArtifact(noteFilePath, fileResult.content);
    this.writtenFileReviews.push(noteFilePath);
    this.record("publishFileReview", noteFilePath);
  }

  async publishArtifact(kind: ReviewArtifactKind, result: { content: string }): Promise<void> {
    const callName: OutputCall = `publishArtifact:${kind}`;
    const targetPath = this.#resolveArtifactPath(kind);

    writeFileSync(targetPath, result.content);

    this.record(callName, targetPath);
  }

  #resolveArtifactPath(kind: ReviewArtifactKind): string {
    const pathMap: Record<ReviewArtifactKind, string> = {
      "changeset-overview": this.outputTarget.changesetOverviewPath,
      index: this.outputTarget.indexPath
    };

    return pathMap[kind];
  }

  protected record(call: OutputCall, value: string): void {
    this.calls.push(call);
    this.records.push({ call, value });
  }

  protected resolveNoteFilePath(filePath: string): string {
    const noteFilePath = this.notePathByFilePath.get(filePath);

    if (!noteFilePath) {
      throw new Error(`Missing planned note output for ${filePath}`);
    }

    return noteFilePath;
  }
}

class CorruptingDiskOutputSink extends RecordingOutputSink {
  override async publishFileReview(fileResult: Parameters<RunOutputPublisher["publishFileReview"]>[0]): Promise<void> {
    const noteFilePath = this.resolveNoteFilePath(fileResult.filePath);
    writeArtifact(noteFilePath, "# CORRUPTED NOTE\n");
    writeFileSync(path.join(this.outputTarget.filesPath, "EXTRA DISK FILE.md"), "# extra\n");
    this.writtenFileReviews.push(noteFilePath);
    this.record("publishFileReview", noteFilePath);
  }
}

class FinalizerFailingOutputSink extends RecordingOutputSink {
  readonly #failures: Partial<Record<RunLevelArtifact, string>>;

  constructor(failures: Partial<Record<RunLevelArtifact, string>>) {
    super();
    this.#failures = failures;
  }

  override async publishArtifact(kind: ReviewArtifactKind, result: { content: string }): Promise<void> {
    const callName: OutputCall = `publishArtifact:${kind}`;
    const targetPath = this.#resolveOverridePath(kind);

    this.record(callName, targetPath);

    const failure = resolveRunLevelFailure(this.#failures, kind);
    if (failure) {
      throw new Error(failure);
    }

    writeFileSync(targetPath, result.content);
  }

  #resolveOverridePath(kind: ReviewArtifactKind): string {
    const pathMap: Record<ReviewArtifactKind, string> = {
      "changeset-overview": this.outputTarget.changesetOverviewPath,
      index: this.outputTarget.indexPath
    };

    return pathMap[kind];
  }
}

function resolveRunLevelFailure(
  failures: Partial<Record<RunLevelArtifact, string>>,
  kind: ReviewArtifactKind
): string | undefined {
  if (kind === "index") {
    return failures[kind];
  }

  return undefined;
}

function writeArtifact(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function assertOutputArtifactsExist(outputTarget: OutputTarget): void {
  assert.equal(existsSync(outputTarget.indexPath), true);
}

function assertOutputTargetPaths(outputTarget: OutputTarget, repoRoot: string): void {
  const basePath = path.join(
    repoRoot,
    ".nightowl",
    "review",
    `feature-branch_${RUN_TIMESTAMP}`
  );

  assert.deepEqual(outputTarget, {
    basePath,
    changesetOverviewPath: path.join(basePath, "changeset-overview.md"),
    filesPath: path.join(basePath, "files"),
    indexPath: path.join(basePath, "index.md"),
    toolAuditPath: path.join(basePath, "tool-audit.jsonl")
  });
}

function assertCallAfter(
  calls: OutputCall[],
  laterCall: OutputCall,
  earlierCall: OutputCall
): void {
  assert.ok(calls.lastIndexOf(laterCall) > calls.lastIndexOf(earlierCall));
}
