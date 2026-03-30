import path from "node:path";

export class ReviewRunInterruptedError extends Error {
  readonly signal: "SIGINT" | "SIGTERM" | undefined;

  constructor(signal?: "SIGINT" | "SIGTERM") {
    super("Run interrupted by external signal.");
    this.name = "ReviewRunInterruptedError";
    this.signal = signal;
  }
}

function extractSignalName(reason: unknown): "SIGINT" | "SIGTERM" | undefined {
  if (reason === "SIGINT" || reason === "SIGTERM") {
    return reason;
  }
  return undefined;
}

import type { ChangesetOverviewRunner } from "./changeset-overview-runner.ts";
import { FileReviewContext } from "./file-review-context.ts";
import { ReviewNoteFinalizer } from "./finalizer.ts";
import {
  RunSummaryFinalizer,
  type SkippedFileOutcome,
  type SuccessfulFileOutcome
} from "./run-summary-finalizer.ts";
import { ReviewIndexFinalizer } from "./review-index-finalizer.ts";
import { RunManifestFinalizer } from "./run-manifest-finalizer.ts";
import type { RunContext } from "./run-context.ts";
import type { RunRequest } from "./run-request.ts";
import type { StepDefinition, StepResult, StepRunner } from "./step-runner.ts";
import {
  buildOutputTarget,
  planNoteFiles,
  type OutputTarget,
  type PlannedNoteFile
} from "./review-path-resolver.ts";
import { Step5ValidationInterrogationStep } from "./steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "./steps/step6-cognitive-simulation.ts";
import { Step7SummaryStep } from "./steps/step7-summary.ts";
import { Step4StrategyWhatIfScenariosStep } from "./steps/step4-strategy-what-if-scenarios.ts";
import { Step3KnowledgeSourceOfTruthStep } from "./steps/step3-knowledge-source-of-truth.ts";
import { Step2DependenciesBoundariesStep } from "./steps/step2-dependencies-boundaries.ts";
import { Step1OverviewStep } from "./steps/step1-overview.ts";
import {
  resolveSuccessfulSnapshotFailureAssessment,
  type ReviewOutputSink
} from "../providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";

export interface ReviewRunSummary {
  repoRoot: string;
  runContext: RunContext;
  outputTarget: OutputTarget;
  plannedFileCount: number;
  successfulFileCount: number;
  skippedFileCount: number;
  dryRun: boolean;
}

export interface ReviewOrchestratorOptions {
  changesetOverviewRunner: Pick<ChangesetOverviewRunner, "run">;
  maxConcurrentFiles?: number;
  onOutputTargetReady?: (outputTarget: OutputTarget) => void;
  sourceProvider: ReviewSourceProvider;
  outputSink: ReviewOutputSink;
  stepRunner: Pick<StepRunner, "run">;
  workingDirectory: string;
  timestampProvider?: () => string;
}

/**
 * Coordinate the full review run: Step 0, per-file fan-out, and final run-level artifacts.
 */
export class ReviewOrchestrator {
  readonly #changesetOverviewRunner: Pick<ChangesetOverviewRunner, "run">;
  readonly #sourceProvider: ReviewSourceProvider;
  readonly #outputSink: ReviewOutputSink;
  readonly #stepRunner: Pick<StepRunner, "run">;
  readonly #workingDirectory: string;
  readonly #timestampProvider: () => string;
  readonly #finalizer: ReviewNoteFinalizer;
  readonly #runSummaryFinalizer: RunSummaryFinalizer;
  readonly #reviewIndexFinalizer: ReviewIndexFinalizer;
  readonly #runManifestFinalizer: RunManifestFinalizer;
  readonly #maxConcurrentFiles: number;
  readonly #onOutputTargetReady?: (outputTarget: OutputTarget) => void;

  constructor(options: ReviewOrchestratorOptions) {
    if (
      options.maxConcurrentFiles !== undefined &&
      (!Number.isInteger(options.maxConcurrentFiles) ||
        options.maxConcurrentFiles < 1)
    ) {
      throw new Error("maxConcurrentFiles must be a positive integer.");
    }

    this.#changesetOverviewRunner = options.changesetOverviewRunner;
    this.#sourceProvider = options.sourceProvider;
    this.#outputSink = options.outputSink;
    this.#stepRunner = options.stepRunner;
    this.#workingDirectory = options.workingDirectory;
    this.#timestampProvider = options.timestampProvider ?? defaultTimestampProvider;
    this.#finalizer = new ReviewNoteFinalizer();
    this.#runSummaryFinalizer = new RunSummaryFinalizer();
    this.#reviewIndexFinalizer = new ReviewIndexFinalizer();
    this.#runManifestFinalizer = new RunManifestFinalizer();
    this.#maxConcurrentFiles = options.maxConcurrentFiles ?? 1;
    this.#onOutputTargetReady = options.onOutputTargetReady;
  }

  async run(
    request: RunRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ReviewRunSummary> {
    const startPath = path.resolve(this.#workingDirectory, request.repoPath ?? ".");
    const repoRoot = this.#sourceProvider.resolveRepoRoot(startPath);
    const changesetEntries = this.#sourceProvider.getChangesetEntries(
      repoRoot,
      request.baseRef,
      request.headRef
    );
    // Step 0 must complete first because its RunContext feeds the per-file Overview step.
    const runContext = await this.#changesetOverviewRunner.run({
      model: "gpt-5.4-mini",
      changedFilesList: changesetEntries,
      outputBaseDir: startPath,
      repoRoot,
      userContext: request.userContext,
      workingDirectory: repoRoot
    });

    // Check if the signal was aborted during Step 0 (or before run() was called).
    // This is the only explicit poll — all later boundaries rely on the event listener below.
    if (options?.signal?.aborted) {
      throw new ReviewRunInterruptedError(extractSignalName(options.signal.reason));
    }

    const branchName = this.#sourceProvider.getCurrentBranch(repoRoot);
    const changedFiles = this.#sourceProvider.getChangedFiles(
      repoRoot,
      request.baseRef,
      request.headRef
    );
    const reviewableFiles = this.#sourceProvider.filterIgnoredFiles(
      repoRoot,
      changedFiles
    );
    const outputTarget = buildOutputTarget({
      outputBaseDir: startPath,
      branchName,
      headRef: request.headRef,
      timestamp: this.#timestampProvider()
    });
    const plannedNoteFiles = planNoteFiles(outputTarget.filesPath, reviewableFiles);

    this.#outputSink.initializeRun(outputTarget);

    this.#outputSink.publishChangesetOverview({ content: runContext.changesetOverview });

    this.#onOutputTargetReady?.(outputTarget);

    // Publish bootstrap snapshots before any per-file step runs so every file starts from the same skeleton.
    for (const plannedNote of plannedNoteFiles) {
      this.#outputSink.publishFileReview({
        noteFilePath: plannedNote.noteFilePath,
        content: this.#finalizer.render(
          new FileReviewContext({
            filePath: plannedNote.filePath,
            noteFilePath: plannedNote.noteFilePath,
            diffContent: "",
            baseRef: request.baseRef,
            headRef: request.headRef
          })
        )
      });
    }

    // Steps 2–7 each receive the progressively rendered note via <current_review> so each step builds on prior output.
    const steps = [
      new Step1OverviewStep({ runContext }),
      new Step2DependenciesBoundariesStep({
        reviewNoteFinalizer: this.#finalizer
      }),
      new Step3KnowledgeSourceOfTruthStep({
        reviewNoteFinalizer: this.#finalizer
      }),
      new Step4StrategyWhatIfScenariosStep({
        reviewNoteFinalizer: this.#finalizer
      }),
      new Step5ValidationInterrogationStep({
        reviewNoteFinalizer: this.#finalizer
      }),
      new Step6CognitiveSimulationStep({
        reviewNoteFinalizer: this.#finalizer
      }),
      new Step7SummaryStep({
        reviewNoteFinalizer: this.#finalizer
      })
    ];
    const runAbortState: AbortState = {};

    // Register abort listener — fires synchronously when signal aborts, immediately
    // setting runAbortState.error so all existing safe-boundary guards detect it.
    // { once: true } auto-removes the listener after first fire (no leak).
    options?.signal?.addEventListener(
      "abort",
      () => {
        runAbortState.error ??= new ReviewRunInterruptedError(
          extractSignalName(options?.signal?.reason)
        );
      },
      { once: true }
    );

    const sharedAbortState: AbortState = {};
    const outcomeSlots: PlannedOutcomeSlot[] = new Array(plannedNoteFiles.length);
    let skippedAppendQueue = Promise.resolve();
    // skipped.md is shared across workers, so serialize appends through a promise queue.
    const publishSkippedFileSerialized = (skipRecord: {
      filePath: string;
      stepId: string;
      reason: string;
    }): Promise<void> => {
      const queuedPublish = skippedAppendQueue.then(() => {
        if (runAbortState.error) {
          throw runAbortState.error;
        }

        this.#outputSink.publishSkippedFile(skipRecord);
      });

      skippedAppendQueue = queuedPublish;
      return queuedPublish;
    };

    await this.#runPlannedFileWorkers({
      plannedNoteFiles,
      outcomeSlots,
      request,
      repoRoot,
      startPath,
      steps,
      runAbortState,
      sharedAbortState,
      publishSkippedFileSerialized
    });

    const successfulFiles = outcomeSlots.flatMap((slot) =>
      slot?.successful ? [slot.successful] : []
    );
    const skippedFiles = outcomeSlots.flatMap((slot) =>
      slot?.skipped ? [slot.skipped] : []
    );

    this.#outputSink.publishRunSummary({
      content: this.#runSummaryFinalizer.render({
        repoRoot,
        baseRef: request.baseRef,
        headRef: request.headRef,
        plannedFileCount: plannedNoteFiles.length,
        successfulFiles,
        skippedFiles
      })
    });
    this.#outputSink.publishReviewIndex({
      content: this.#reviewIndexFinalizer.render({
        repoRoot,
        baseRef: request.baseRef,
        headRef: request.headRef,
        successfulFiles,
        skippedFiles,
        outputTarget,
        plannedNotes: plannedNoteFiles
      })
    });
    this.#outputSink.publishRunManifest({
      content: this.#runManifestFinalizer.render({
        repoRoot,
        baseRef: request.baseRef,
        headRef: request.headRef,
        successfulFiles,
        skippedFiles,
        outputTarget,
        plannedNotes: plannedNoteFiles
      })
    });

    return {
      repoRoot,
      runContext,
      outputTarget,
      plannedFileCount: plannedNoteFiles.length,
      successfulFileCount: successfulFiles.length,
      skippedFileCount: skippedFiles.length,
      dryRun: request.dryRun ?? false
    };
  }

  async #runPlannedFileWorkers(input: {
    plannedNoteFiles: PlannedNoteFile[];
    outcomeSlots: PlannedOutcomeSlot[];
    request: RunRequest;
    repoRoot: string;
    startPath: string;
    runAbortState: AbortState;
    steps: StepDefinition[];
    sharedAbortState: SharedAbortState;
    publishSkippedFileSerialized(input: {
      filePath: string;
      stepId: string;
      reason: string;
    }): Promise<void>;
  }): Promise<void> {
    const workerCount = Math.min(
      this.#maxConcurrentFiles,
      input.plannedNoteFiles.length
    );
    let nextPlannedIndex = 0;

    // Each worker pulls the next file atomically from the shared cursor until no work remains.
    const claimNextWorkItem = (): PlannedFileWorkItem | undefined => {
      if (input.runAbortState.error) {
        return undefined;
      }

      if (nextPlannedIndex >= input.plannedNoteFiles.length) {
        return undefined;
      }

      const plannedIndex = nextPlannedIndex;
      nextPlannedIndex += 1;

      return {
        plannedIndex,
        plannedNote: input.plannedNoteFiles[plannedIndex]
      };
    };

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          if (input.runAbortState.error) {
            return;
          }

          const workItem = claimNextWorkItem();

          if (!workItem) {
            return;
          }

          try {
            await this.#processPlannedFile({
              workItem,
              outcomeSlots: input.outcomeSlots,
              request: input.request,
              repoRoot: input.repoRoot,
              startPath: input.startPath,
              runAbortState: input.runAbortState,
              sharedAbortState: input.sharedAbortState,
              steps: input.steps,
              publishSkippedFileSerialized: input.publishSkippedFileSerialized
            });
          } catch (error) {
            input.runAbortState.error ??= error;
            return;
          }
        }
      })
    );

    if (input.runAbortState.error) {
      throw input.runAbortState.error;
    }
  }

  async #processPlannedFile(input: {
    workItem: PlannedFileWorkItem;
    outcomeSlots: PlannedOutcomeSlot[];
    request: RunRequest;
    repoRoot: string;
    startPath: string;
    runAbortState: AbortState;
    sharedAbortState: SharedAbortState;
    steps: StepDefinition[];
    publishSkippedFileSerialized(input: {
      filePath: string;
      stepId: string;
      reason: string;
    }): Promise<void>;
  }): Promise<void> {
    let diffContent: string;

    try {
      // Load the file diff once so the per-file state machine can operate on a stable snapshot.
      diffContent = this.#sourceProvider.getDiff(
        input.repoRoot,
        input.request.baseRef,
        input.request.headRef,
        input.workItem.plannedNote.filePath
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      throw new Error(
        `Step step1-overview failed for ${input.workItem.plannedNote.filePath}: ${message}`
      );
    }

    const fileContext = new FileReviewContext({
      filePath: input.workItem.plannedNote.filePath,
      noteFilePath: input.workItem.plannedNote.noteFilePath,
      diffContent,
      baseRef: input.request.baseRef,
      headRef: input.request.headRef
    });

    if (input.runAbortState.error) {
      return;
    }

    for (const step of input.steps) {
      if (input.runAbortState.error) {
        return;
      }

      let result: StepResult;

      try {
        result = await this.#stepRunner.run({
          step,
          context: fileContext,
          outputBaseDir: input.startPath,
          repoRoot: input.repoRoot,
          workingDirectory: input.repoRoot
        });
      } catch (error) {
        const reason = extractStepFailureReason({
          stepId: step.stepId,
          filePath: fileContext.filePath,
          error
        });

        if (input.runAbortState.error) {
          return;
        }

        fileContext.markInterrupted(step.stepId, reason);

        try {
          this.#outputSink.publishFileReview({
            noteFilePath: fileContext.noteFilePath,
            content: this.#finalizer.render(fileContext)
          });
        } catch (outputError) {
          input.runAbortState.error ??= outputError;
          input.sharedAbortState.error ??= outputError;
          throw outputError;
        }

        if (input.runAbortState.error) {
          return;
        }

        try {
          await input.publishSkippedFileSerialized({
            filePath: fileContext.filePath,
            stepId: step.stepId,
            reason
          });
        } catch (outputError) {
          input.runAbortState.error ??= outputError;
          input.sharedAbortState.error ??= outputError;
          throw outputError;
        }

        input.outcomeSlots[input.workItem.plannedIndex] = {
          skipped: {
            filePath: fileContext.filePath,
            stepId: step.stepId,
            reason
          }
        };

        return;
      }

      if (input.runAbortState.error) {
        return;
      }

      result.applyTo(fileContext);

      if (input.runAbortState.error) {
        return;
      }

      try {
        this.#outputSink.publishFileReview({
          noteFilePath: fileContext.noteFilePath,
          content: this.#finalizer.render(fileContext)
        });
      } catch (outputError) {
        // A snapshot write failure is classified before deciding whether the run should abort or the file should skip.
        const assessment = resolveSuccessfulSnapshotFailureAssessment(
          this.#outputSink,
          {
            noteFilePath: fileContext.noteFilePath,
            error: outputError
          }
        );

        if (assessment.faultScope === "shared-output-target-fault") {
          input.runAbortState.error ??= outputError;
          input.sharedAbortState.error ??= outputError;
          throw outputError;
        }

        await this.#downgradeSuccessfulSnapshotOutputFailure({
          context: fileContext,
          stepId: step.stepId,
          error: outputError,
          runAbortState: input.runAbortState,
          publishSkippedFileSerialized: input.publishSkippedFileSerialized,
          sharedAbortState: input.sharedAbortState
        });
        input.outcomeSlots[input.workItem.plannedIndex] = {
          skipped: {
            filePath: fileContext.filePath,
            stepId: step.stepId,
            reason:
              outputError instanceof Error ? outputError.message : String(outputError)
          }
        };
        return;
      }
    }

    if (input.runAbortState.error) {
      return;
    }

    input.outcomeSlots[input.workItem.plannedIndex] = {
      successful: {
        filePath: fileContext.filePath,
        findings: fileContext.getStructuredState().findings ?? []
      }
    };
  }

  async #downgradeSuccessfulSnapshotOutputFailure(input: {
    context: FileReviewContext;
    stepId: string;
    error: unknown;
    runAbortState: AbortState;
    publishSkippedFileSerialized(input: {
      filePath: string;
      stepId: string;
      reason: string;
    }): Promise<void>;
    sharedAbortState: SharedAbortState;
  }): Promise<void> {
    const reason =
      input.error instanceof Error ? input.error.message : String(input.error);

    input.context.markInterrupted(input.stepId, reason);

    if (input.runAbortState.error) {
      return;
    }

    try {
      this.#outputSink.publishFileReview({
        noteFilePath: input.context.noteFilePath,
        content: this.#finalizer.render(input.context)
      });
    } catch (outputError) {
      input.runAbortState.error ??= outputError;
      input.sharedAbortState.error ??= outputError;
      throw outputError;
    }

    if (input.runAbortState.error) {
      return;
    }

    try {
      await input.publishSkippedFileSerialized({
        filePath: input.context.filePath,
        stepId: input.stepId,
        reason
      });
    } catch (outputError) {
      input.runAbortState.error ??= outputError;
      input.sharedAbortState.error ??= outputError;
      throw outputError;
    }
  }
}

interface PlannedFileWorkItem {
  plannedIndex: number;
  plannedNote: PlannedNoteFile;
}

interface PlannedOutcomeSlot {
  successful?: SuccessfulFileOutcome;
  skipped?: SkippedFileOutcome;
}

interface AbortState {
  error?: unknown;
}

type SharedAbortState = AbortState;


function extractStepFailureReason(input: {
  stepId: string;
  filePath: string;
  error: unknown;
}): string {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);
  const prefix = `Step ${input.stepId} failed for ${input.filePath}: `;

  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function defaultTimestampProvider(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");

  return `${month}${day}${hour}${minute}`;
}
