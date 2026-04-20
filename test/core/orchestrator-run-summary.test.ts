import assert from "node:assert/strict";
import {
  appendFileSync,
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
  | "publishSkippedFile"
  | "publishRunSummary"
  | "publishReviewIndex"
  | "publishVerifierReport"
  | "publishRunManifest"
  | "publishChangesetOverview";

const RUN_LEVEL_FINALIZER_CALLS: OutputCall[] = [
  "publishRunSummary",
  "publishReviewIndex",
  "publishVerifierReport",
  "publishRunManifest"
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

      const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
      const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
      const manifestContent = readFileSync(result.outputTarget.manifestPath, "utf8");

      assert.doesNotMatch(summaryContent, /CORRUPTED/u);
      assert.doesNotMatch(indexContent, /CORRUPTED/u);
      assert.doesNotMatch(indexContent, /EXTRA DISK FILE/u);
      assert.doesNotMatch(manifestContent, /CORRUPTED/u);
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
    assert.equal(
      outputSink.records.filter((entry) => entry.call === "publishSkippedFile").length,
      harness.reviewableFiles.length
    );
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
              if (step.stepId !== "step1-overview") {
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

test("ReviewOrchestrator does not initialize output when Step 0 fails", async () => {
  await withReviewHarness({}, async (harness) => {
    const outputSink = new RecordingOutputSink();

    await assert.rejects(
      () =>
        runOrchestrator(harness, {
          outputSink,
          stepRunner: createFailingIfStartedRunner(),
          changesetOverviewRunner: {
            async run() {
              throw new Error("Step 0 failed");
            }
          }
        }),
      /Step 0 failed/u
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
      assert.equal(
        outputSink.records.some(
          (record) =>
            record.call === "publishSkippedFile" && record.value === failedFile
        ),
        true
      );
    }
  );
});

test("ReviewOrchestrator records finalizerFailure and continues remaining finalizers", async () => {
  const cases: Array<{
    artifact: "summary" | "index" | "manifest";
    message: RegExp;
    failure: Partial<Record<"summary" | "index" | "manifest", string>>;
  }> = [
    {
      artifact: "summary",
      message: /summary write failed/u,
      failure: { summary: "summary write failed" }
    },
    {
      artifact: "index",
      message: /index write failed/u,
      failure: { index: "index write failed" }
    },
    {
      artifact: "manifest",
      message: /manifest write failed/u,
      failure: { manifest: "manifest write failed" }
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
      for (const call of RUN_LEVEL_FINALIZER_CALLS) {
        assert.equal(outputSink.calls.includes(call), true, `${testCase.artifact}:${call}`);
      }
      assert.ok(outputSink.writtenFileReviews.length > 0);
    });
  }
});

test("ReviewOrchestrator records multiple finalizerFailures in call order", async () => {
  await withReviewHarness({}, async (harness) => {
    const result = await runOrchestrator(harness, {
      outputSink: new FinalizerFailingOutputSink({
        summary: "summary boom",
        manifest: "manifest boom"
      }),
      stepRunner: createSuccessfulSummaryRunner()
    });

    assert.equal(result.finalizerFailures.length, 2);
    assert.equal(result.finalizerFailures[0].artifact, "summary");
    assert.equal(result.finalizerFailures[1].artifact, "manifest");
  });
});

test("ReviewOrchestrator publishes artifacts in deterministic order and does not rewrite after manifest", async () => {
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

      assert.equal(outputSink.calls.at(-1), "publishRunManifest");
      assert.equal(outputSink.calls.includes("publishSkippedFile"), true);
      assertCallAfter(outputSink.calls, "publishRunSummary", "publishSkippedFile");
      assertCallAfter(outputSink.calls, "publishRunSummary", "publishFileReview");
      assertCallAfter(outputSink.calls, "publishReviewIndex", "publishRunSummary");
      assertCallAfter(outputSink.calls, "publishReviewIndex", "publishSkippedFile");
      assertCallAfter(outputSink.calls, "publishReviewIndex", "publishFileReview");
      assertCallAfter(outputSink.calls, "publishVerifierReport", "publishReviewIndex");
      assertCallAfter(outputSink.calls, "publishVerifierReport", "publishSkippedFile");
      assertCallAfter(outputSink.calls, "publishRunManifest", "publishReviewIndex");
      assertCallAfter(outputSink.calls, "publishRunManifest", "publishVerifierReport");
      assert.equal(outputSink.afterManifest.publishFileReview, 0);
      assert.equal(outputSink.afterManifest.publishRunSummary, 0);
      assert.equal(outputSink.afterManifest.publishReviewIndex, 0);
      assert.equal(outputSink.afterManifest.publishVerifierReport, 0);
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
        step.stepId === "step5-validation-interrogation"
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
      if (skippedFiles.has(context.filePath) && step.stepId === "step1-overview") {
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
  afterManifest = {
    publishFileReview: 0,
    publishRunSummary: 0,
    publishReviewIndex: 0,
    publishVerifierReport: 0
  };
  #manifestPublished = false;

  async initializeRun(outputPlan: ReviewOutputPlan): Promise<RunOutputPublisher> {
    mkdirSync(outputPlan.outputTarget.basePath, { recursive: true });
    mkdirSync(outputPlan.outputTarget.filesPath, { recursive: true });
    writeFileSync(outputPlan.outputTarget.skippedPath, "");
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
    if (this.#manifestPublished) {
      this.afterManifest.publishFileReview += 1;
    }

    const noteFilePath = this.resolveNoteFilePath(fileResult.filePath);
    writeArtifact(noteFilePath, fileResult.content);
    this.writtenFileReviews.push(noteFilePath);
    this.record("publishFileReview", noteFilePath);
  }

  async publishSkippedFile(skipRecord: Parameters<RunOutputPublisher["publishSkippedFile"]>[0]): Promise<void> {
    appendFileSync(
      this.outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
    this.record("publishSkippedFile", skipRecord.filePath);
  }

  async publishRunSummary(summaryResult: Parameters<RunOutputPublisher["publishRunSummary"]>[0]): Promise<void> {
    if (this.#manifestPublished) {
      this.afterManifest.publishRunSummary += 1;
    }

    writeFileSync(this.outputTarget.summaryPath, summaryResult.content);
    this.record("publishRunSummary", this.outputTarget.summaryPath);
  }

  async publishReviewIndex(indexResult: Parameters<RunOutputPublisher["publishReviewIndex"]>[0]): Promise<void> {
    if (this.#manifestPublished) {
      this.afterManifest.publishReviewIndex += 1;
    }

    writeFileSync(this.outputTarget.indexPath, indexResult.content);
    this.record("publishReviewIndex", this.outputTarget.indexPath);
  }

  async publishVerifierReport(result: Parameters<RunOutputPublisher["publishVerifierReport"]>[0]): Promise<void> {
    if (this.#manifestPublished) {
      this.afterManifest.publishVerifierReport += 1;
    }

    writeFileSync(this.outputTarget.verifierReportPath, result.content);
    this.record("publishVerifierReport", this.outputTarget.verifierReportPath);
  }

  async publishRunManifest(manifestResult: Parameters<RunOutputPublisher["publishRunManifest"]>[0]): Promise<void> {
    writeFileSync(this.outputTarget.manifestPath, manifestResult.content);
    this.#manifestPublished = true;
    this.record("publishRunManifest", this.outputTarget.manifestPath);
  }

  async publishChangesetOverview(result: Parameters<RunOutputPublisher["publishChangesetOverview"]>[0]): Promise<void> {
    writeFileSync(this.outputTarget.changesetOverviewPath, result.content);
    this.record("publishChangesetOverview", this.outputTarget.changesetOverviewPath);
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
  override async initializeRun(outputPlan: ReviewOutputPlan): Promise<RunOutputPublisher> {
    const publisher = await super.initializeRun(outputPlan);
    writeFileSync(outputPlan.outputTarget.skippedPath, "# CORRUPTED SKIPPED LOG\n");
    return publisher;
  }

  override async publishFileReview(fileResult: Parameters<RunOutputPublisher["publishFileReview"]>[0]): Promise<void> {
    const noteFilePath = this.resolveNoteFilePath(fileResult.filePath);
    writeArtifact(noteFilePath, "# CORRUPTED NOTE\n");
    writeFileSync(path.join(this.outputTarget.filesPath, "EXTRA DISK FILE.md"), "# extra\n");
    this.writtenFileReviews.push(noteFilePath);
    this.record("publishFileReview", noteFilePath);
  }

  override async publishSkippedFile(skipRecord: Parameters<RunOutputPublisher["publishSkippedFile"]>[0]): Promise<void> {
    appendFileSync(
      this.outputTarget.skippedPath,
      `CORRUPTED SKIP: ${skipRecord.filePath} ${skipRecord.stepId} ${skipRecord.reason}\n`
    );
    this.record("publishSkippedFile", skipRecord.filePath);
  }
}

class FinalizerFailingOutputSink extends RecordingOutputSink {
  readonly #failures: Partial<Record<"summary" | "index" | "manifest", string>>;

  constructor(failures: Partial<Record<"summary" | "index" | "manifest", string>>) {
    super();
    this.#failures = failures;
  }

  override async publishRunSummary(summaryResult: Parameters<RunOutputPublisher["publishRunSummary"]>[0]): Promise<void> {
    this.record("publishRunSummary", this.outputTarget.summaryPath);
    if (this.#failures.summary) {
      throw new Error(this.#failures.summary);
    }

    writeFileSync(this.outputTarget.summaryPath, summaryResult.content);
  }

  override async publishReviewIndex(indexResult: Parameters<RunOutputPublisher["publishReviewIndex"]>[0]): Promise<void> {
    this.record("publishReviewIndex", this.outputTarget.indexPath);
    if (this.#failures.index) {
      throw new Error(this.#failures.index);
    }

    writeFileSync(this.outputTarget.indexPath, indexResult.content);
  }

  override async publishVerifierReport(result: Parameters<RunOutputPublisher["publishVerifierReport"]>[0]): Promise<void> {
    this.record("publishVerifierReport", this.outputTarget.verifierReportPath);
    writeFileSync(this.outputTarget.verifierReportPath, result.content);
  }

  override async publishRunManifest(manifestResult: Parameters<RunOutputPublisher["publishRunManifest"]>[0]): Promise<void> {
    this.record("publishRunManifest", this.outputTarget.manifestPath);
    if (this.#failures.manifest) {
      throw new Error(this.#failures.manifest);
    }

    writeFileSync(this.outputTarget.manifestPath, manifestResult.content);
  }
}

function writeArtifact(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function assertOutputArtifactsExist(outputTarget: OutputTarget): void {
  assert.equal(existsSync(outputTarget.summaryPath), true);
  assert.equal(existsSync(outputTarget.indexPath), true);
  assert.equal(existsSync(outputTarget.verifierReportPath), true);
  assert.equal(existsSync(outputTarget.manifestPath), true);
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
    skippedPath: path.join(basePath, "skipped.md"),
    summaryPath: path.join(basePath, "summary.md"),
    indexPath: path.join(basePath, "index.md"),
    verifierReportPath: path.join(basePath, "verifier-report.jsonl"),
    manifestPath: path.join(basePath, "manifest.json"),
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
