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

import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import {
  ReviewOrchestrator,
  type ReviewOrchestratorOptions
} from "../../src/core/orchestrator.ts";
import type { RunStepInput, StepResult, StepRunner } from "../../src/core/step-runner.ts";
import { StepExecutionError } from "../../src/core/step-execution-error.ts";
import type { OutputTarget } from "../../src/core/review-path-resolver.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { deriveFileRiskLevel } from "../../src/core/risk-level.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import type {
  ReviewOutputTarget,
  RunOutputPublisher
} from "../../src/providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../../src/providers/review-source-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  buildFindingsForFile,
  buildSuccessfulStepResult,
  escapeRegExp,
  type SuccessfulStepResultOptions
} from "../helpers/orchestrator-fixture.ts";
import {
  BASE_REF,
  HEAD_REF,
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
  | "publishRunManifest"
  | "publishChangesetOverview";

test("ReviewOrchestrator publishes run-level artifacts for an all-successful run", async () => {
  await withReviewHarness({}, async (harness) => {
    const result = await runOrchestrator(harness, {
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSuccessfulSummaryRunner()
    });

    const plannedNotes = planNoteFiles(
      result.outputTarget.filesPath,
      harness.reviewableFiles
    );
    const representativeNote = plannedNotes.find(
      (plannedNote) => plannedNote.filePath === "packages/app/index.ts"
    );
    assert.ok(representativeNote);

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const manifest = readManifest(result.outputTarget.manifestPath);
    const representativeRisk = deriveFileRiskLevel(
      buildFindingsForFile(representativeNote.filePath)
    );

    assert.equal(result.plannedFileCount, harness.reviewableFiles.length);
    assert.equal(result.successfulFileCount, harness.reviewableFiles.length);
    assert.equal(result.skippedFileCount, 0);
    assertOutputArtifactsExist(result.outputTarget);
    assertOutputTargetPaths(result.outputTarget, harness.repoRoot);
    assert.match(summaryContent, /^# Review Summary$/mu);
    assert.match(
      summaryContent,
      new RegExp(`- Successful files: ${harness.reviewableFiles.length}`, "u")
    );
    assert.equal(
      summaryContent.includes(
        `- [${representativeRisk}] \`${representativeNote.filePath}\` — must=1, nice=0`
      ),
      true
    );
    assert.match(indexContent, /^# Review Index$/mu);
    assert.match(indexContent, /\[changeset-overview\.md\]\(\.\/changeset-overview\.md\)/u);
    assert.match(indexContent, new RegExp(escapeRegExp(representativeNote.filePath), "u"));
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.successfulFileCount, harness.reviewableFiles.length);
    assert.equal(manifest.artifacts.manifestPath, result.outputTarget.manifestPath);
  });
});

test("ReviewOrchestrator publishes summary.md for a mixed-result run from formal in-memory outcomes rather than disk notes", async () => {
  await withReviewHarness(
    {
      commitMessage: "add third changed file for mixed aggregate summary",
      extraFiles: { "README.md": "# Demo feature change\n" }
    },
    async (harness) => {
      const skippedFile = "README.md";
      const outputSink = new CorruptingSummaryOutputSink();

      const result = await runOrchestrator(harness, {
        outputSink,
        stepRunner: createMixedResultRunner(skippedFile)
      });

      const plannedNotes = planNoteFiles(
        result.outputTarget.filesPath,
        harness.reviewableFiles
      );
      const corruptedSuccessfulNote = readFileSync(plannedNotes[0].noteFilePath, "utf8");
      const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
      const manifest = readManifest(result.outputTarget.manifestPath);
      const skippedManifestEntry = manifest.files.find(
        (fileEntry) => fileEntry.filePath === skippedFile
      );

      assert.match(corruptedSuccessfulNote, /CORRUPTED NOTE/u);
      assert.equal(result.successfulFileCount, harness.reviewableFiles.length - 1);
      assert.equal(result.skippedFileCount, 1);
      assertOutputTargetPaths(result.outputTarget, harness.repoRoot);
      assert.match(
        summaryContent,
        new RegExp(`- Successful files: ${harness.reviewableFiles.length - 1}`, "u")
      );
      assert.match(summaryContent, /- Skipped files: 1/u);
      assert.doesNotMatch(summaryContent, /CORRUPTED NOTE/u);
      assert.match(
        summaryContent,
        new RegExp(`- \`${escapeRegExp(skippedFile)}\` — step5-validation-interrogation — deterministic validation failed`, "u")
      );
      assert.equal(manifest.skippedFileCount, 1);
      assert.equal(skippedManifestEntry?.status, "skipped");
      assert.equal(skippedManifestEntry?.failedStepId, "step5-validation-interrogation");
    }
  );
});

test("ReviewOrchestrator publishes summary.md for zero planned files with explicit empty sections", async () => {
  await withReviewHarness({ reviewignore: "**\n" }, async (harness) => {
    const result = await runOrchestrator(harness, {
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createFailingIfStartedRunner()
    });

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const manifest = readManifest(result.outputTarget.manifestPath);

    assert.equal(result.plannedFileCount, 0);
    assert.equal(result.successfulFileCount, 0);
    assert.equal(result.skippedFileCount, 0);
    assertOutputTargetPaths(result.outputTarget, harness.repoRoot);
    assert.match(summaryContent, /- Planned files: 0/u);
    assert.match(summaryContent, /- Successful files: 0/u);
    assert.match(summaryContent, /- Skipped files: 0/u);
    assert.match(summaryContent, /## Successful Files\n- 無/u);
    assert.match(summaryContent, /## Skipped Files\n- 無/u);
    assert.equal(manifest.plannedFileCount, 0);
    assert.equal(manifest.successfulFileCount, 0);
    assert.equal(manifest.skippedFileCount, 0);
    assert.equal(manifest.files.length, 0);
  });
});

test("ReviewOrchestrator treats an all-skipped run as a completed run with zero successful files", async () => {
  await withReviewHarness({}, async (harness) => {
    const result = await runOrchestrator(harness, {
      outputSink: new CorruptingSummaryOutputSink(),
      stepRunner: createAllSkippedRunner(new Set(harness.reviewableFiles))
    });

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const manifest = readManifest(result.outputTarget.manifestPath);
    const plannedNotes = planNoteFiles(
      result.outputTarget.filesPath,
      harness.reviewableFiles
    );

    assert.equal(result.successfulFileCount, 0);
    assert.equal(result.skippedFileCount, harness.reviewableFiles.length);
    assertOutputTargetPaths(result.outputTarget, harness.repoRoot);
    assert.match(summaryContent, /- Successful files: 0/u);
    assert.match(
      summaryContent,
      new RegExp(`- Skipped files: ${harness.reviewableFiles.length}`, "u")
    );
    assert.match(indexContent, /^# Review Index$/mu);
    for (const plannedNote of plannedNotes) {
      const noteLink = toRunRelativeLink(result.outputTarget, plannedNote.noteFilePath);
      assert.equal(
        indexContent.includes(`[Skipped] [\`${plannedNote.filePath}\`](${noteLink})`),
        true
      );
    }
    assert.equal(manifest.successfulFileCount, 0);
    assert.equal(manifest.skippedFileCount, harness.reviewableFiles.length);
  });
});

test("ReviewOrchestrator publishes deterministic index.md for a mixed-result run from formal completed-run data rather than disk artifacts", async () => {
  await withReviewHarness(
    {
      commitMessage: "add third changed file for review index",
      extraFiles: { "README.md": "# Demo feature change\n" }
    },
    async (harness) => {
      const skippedFile = "README.md";
      const outputSink = new CorruptingIndexOutputSink();
      const result = await runOrchestrator(harness, {
        outputSink,
        stepRunner: createMixedResultRunner(skippedFile)
      });

      const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
      const manifestContent = readFileSync(result.outputTarget.manifestPath, "utf8");
      const plannedNotes = planNoteFiles(
        result.outputTarget.filesPath,
        harness.reviewableFiles
      );
      const successfulNote = plannedNotes.find(
        (plannedNote) => plannedNote.filePath === "packages/app/index.ts"
      );
      const skippedNote = plannedNotes.find(
        (plannedNote) => plannedNote.filePath === skippedFile
      );

      assert.equal(result.successfulFileCount, harness.reviewableFiles.length - 1);
      assert.equal(result.skippedFileCount, 1);
      assertOutputTargetPaths(result.outputTarget, harness.repoRoot);
      assert.ok(successfulNote);
      assert.ok(skippedNote);
      assert.match(indexContent, /^# Review Index$/mu);
      assert.match(indexContent, /\[summary\.md\]\(\.\/summary\.md\)/u);
      assert.equal(indexContent.includes(`[High] [\`${successfulNote.filePath}\`]`), true);
      assert.equal(indexContent.includes(`[Skipped] [\`${skippedNote.filePath}\`]`), true);
      assert.doesNotMatch(indexContent, /CORRUPTED SUMMARY/u);
      assert.doesNotMatch(indexContent, /EXTRA DISK FILE/u);
      assert.doesNotMatch(manifestContent, /CORRUPTED/u);
    }
  );
});

test("ReviewOrchestrator publishes index.md for zero planned files with explicit empty file notes", async () => {
  await withReviewHarness({ reviewignore: "**\n" }, async (harness) => {
    const result = await runOrchestrator(harness, {
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createFailingIfStartedRunner()
    });

    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");

    assert.match(indexContent, /^# Review Index$/mu);
    assert.match(indexContent, /- Planned files: 0/u);
    assert.match(indexContent, /- Successful files: 0/u);
    assert.match(indexContent, /- Skipped files: 0/u);
    assert.match(indexContent, /## File Notes\n- 無/u);
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

    assert.equal(outputSink.calls.includes("publishRunSummary"), false);
    assert.equal(outputSink.calls.includes("publishReviewIndex"), false);
    assert.equal(outputSink.calls.includes("publishRunManifest"), false);
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
      commitMessage: "add third changed file for getDiff no-summary",
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
      assert.equal(outputSink.calls.includes("publishRunSummary"), true);
      assert.equal(outputSink.calls.includes("publishReviewIndex"), true);
      assert.equal(outputSink.calls.includes("publishRunManifest"), true);
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
    expectedCalls: OutputCall[];
  }> = [
    {
      artifact: "summary",
      message: /summary write failed/u,
      failure: { summary: "summary write failed" },
      expectedCalls: ["publishRunSummary", "publishReviewIndex", "publishRunManifest"]
    },
    {
      artifact: "index",
      message: /index write failed/u,
      failure: { index: "index write failed" },
      expectedCalls: ["publishRunSummary", "publishReviewIndex", "publishRunManifest"]
    },
    {
      artifact: "manifest",
      message: /manifest write failed/u,
      failure: { manifest: "manifest write failed" },
      expectedCalls: ["publishRunSummary", "publishReviewIndex", "publishRunManifest"]
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
      assert.ok(outputSink.writtenFileReviews.length > 0);
    });
  }
});

test("ReviewOrchestrator returns empty finalizerFailures when all finalizers succeed", async () => {
  await withReviewHarness({}, async (harness) => {
    const result = await runOrchestrator(harness, {
      outputSink: new RecordingOutputSink(),
      stepRunner: createSuccessfulSummaryRunner()
    });

    assert.deepEqual(result.finalizerFailures, []);
  });
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
      assertCallAfter(outputSink.calls, "publishRunManifest", "publishReviewIndex");
      assert.equal(outputSink.afterManifest.publishFileReview, 0);
      assert.equal(outputSink.afterManifest.publishRunSummary, 0);
      assert.equal(outputSink.afterManifest.publishReviewIndex, 0);
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
  calls: OutputCall[] = [];
  records: Array<{ call: OutputCall; value: string }> = [];
  writtenFileReviews: string[] = [];
  afterManifest = {
    publishFileReview: 0,
    publishRunSummary: 0,
    publishReviewIndex: 0
  };
  #manifestPublished = false;

  async initializeRun(outputTarget: ReviewOutputTarget): Promise<RunOutputPublisher> {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.outputTarget = outputTarget;
    this.record("initializeRun", outputTarget.basePath);
    return this;
  }

  async publishFileReview(fileResult: Parameters<RunOutputPublisher["publishFileReview"]>[0]): Promise<void> {
    if (this.#manifestPublished) {
      this.afterManifest.publishFileReview += 1;
    }

    writeArtifact(fileResult.noteFilePath, fileResult.content);
    this.writtenFileReviews.push(fileResult.noteFilePath);
    this.record("publishFileReview", fileResult.noteFilePath);
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
}

class CorruptingSummaryOutputSink extends RecordingOutputSink {
  override async publishFileReview(fileResult: Parameters<RunOutputPublisher["publishFileReview"]>[0]): Promise<void> {
    writeArtifact(fileResult.noteFilePath, "# CORRUPTED NOTE\n");
    this.writtenFileReviews.push(fileResult.noteFilePath);
    this.record("publishFileReview", fileResult.noteFilePath);
  }
}

class CorruptingIndexOutputSink extends RecordingOutputSink {
  override async initializeRun(outputTarget: ReviewOutputTarget): Promise<RunOutputPublisher> {
    const publisher = await super.initializeRun(outputTarget);
    writeFileSync(outputTarget.skippedPath, "# CORRUPTED SKIPPED LOG\n");
    return publisher;
  }

  override async publishFileReview(fileResult: Parameters<RunOutputPublisher["publishFileReview"]>[0]): Promise<void> {
    writeArtifact(fileResult.noteFilePath, "# CORRUPTED NOTE\n");
    writeFileSync(path.join(this.outputTarget.filesPath, "EXTRA DISK FILE.md"), "# extra\n");
    this.writtenFileReviews.push(fileResult.noteFilePath);
    this.record("publishFileReview", fileResult.noteFilePath);
  }

  override async publishSkippedFile(skipRecord: Parameters<RunOutputPublisher["publishSkippedFile"]>[0]): Promise<void> {
    appendFileSync(
      this.outputTarget.skippedPath,
      `CORRUPTED SKIP: ${skipRecord.filePath} ${skipRecord.stepId} ${skipRecord.reason}\n`
    );
    this.record("publishSkippedFile", skipRecord.filePath);
  }

  override async publishRunSummary(summaryResult: Parameters<RunOutputPublisher["publishRunSummary"]>[0]): Promise<void> {
    writeFileSync(this.outputTarget.summaryPath, "# CORRUPTED SUMMARY\n");
    this.record("publishRunSummary", this.outputTarget.summaryPath);
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

function readManifest(manifestPath: string): {
  schemaVersion: number;
  plannedFileCount: number;
  successfulFileCount: number;
  skippedFileCount: number;
  artifacts: {
    manifestPath: string;
    summaryPath: string;
  };
  files: Array<{
    filePath: string;
    status: string;
    failedStepId?: string;
  }>;
} {
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function assertOutputArtifactsExist(outputTarget: OutputTarget): void {
  assert.equal(existsSync(outputTarget.summaryPath), true);
  assert.equal(existsSync(outputTarget.indexPath), true);
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

function toRunRelativeLink(outputTarget: OutputTarget, noteFilePath: string): string {
  return `./${path.relative(outputTarget.basePath, noteFilePath).replace(/\\/gu, "/")}`;
}
