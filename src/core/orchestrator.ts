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
import type { RunProgressEvent, RunProgressEventHandler } from "./run-progress.ts";
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
  type ReviewOutputTarget,
  type ReviewOutputSink,
  type RunOutputPublisher,
  type SuccessfulSnapshotOutputHealthAssessor
} from "../providers/review-output-sink.ts";
import type { ReviewFileFilter } from "../providers/review-file-filter.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { SessionTurnAbortedError } from "../services/session-executor.ts";

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
  onProgressEvent?: RunProgressEventHandler;
  onOutputTargetReady?: (outputTarget: OutputTarget) => void;
  reviewFileFilter: ReviewFileFilter;
  sourceProvider: ReviewSourceProvider;
  outputSink: ReviewOutputSink;
  successfulSnapshotOutputHealthAssessor?: SuccessfulSnapshotOutputHealthAssessor;
  stepRunner: Pick<StepRunner, "run">;
  workingDirectory: string;
  timestampProvider?: () => string;
}

/**
 * Coordinate the full review run: Step 0, per-file fan-out, and final run-level artifacts.
 */
export class ReviewOrchestrator {
  readonly #changesetOverviewRunner: Pick<ChangesetOverviewRunner, "run">;
  readonly #reviewFileFilter: ReviewFileFilter;
  readonly #sourceProvider: ReviewSourceProvider;
  readonly #outputSink: ReviewOutputSink;
  readonly #successfulSnapshotOutputHealthAssessor: SuccessfulSnapshotOutputHealthAssessor;
  readonly #stepRunner: Pick<StepRunner, "run">;
  readonly #workingDirectory: string;
  readonly #timestampProvider: () => string;
  readonly #finalizer: ReviewNoteFinalizer;
  readonly #runSummaryFinalizer: RunSummaryFinalizer;
  readonly #reviewIndexFinalizer: ReviewIndexFinalizer;
  readonly #runManifestFinalizer: RunManifestFinalizer;
  readonly #maxConcurrentFiles: number;
  readonly #onProgressEvent?: RunProgressEventHandler;
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
    this.#reviewFileFilter = options.reviewFileFilter;
    this.#sourceProvider = options.sourceProvider;
    this.#outputSink = options.outputSink;
    this.#successfulSnapshotOutputHealthAssessor =
      options.successfulSnapshotOutputHealthAssessor ?? {
        assess() {
          return { faultScope: "shared-output-target-fault" as const };
        }
      };
    this.#stepRunner = options.stepRunner;
    this.#workingDirectory = options.workingDirectory;
    this.#timestampProvider = options.timestampProvider ?? defaultTimestampProvider;
    this.#finalizer = new ReviewNoteFinalizer();
    this.#runSummaryFinalizer = new RunSummaryFinalizer();
    this.#reviewIndexFinalizer = new ReviewIndexFinalizer();
    this.#runManifestFinalizer = new RunManifestFinalizer();
    this.#maxConcurrentFiles = options.maxConcurrentFiles ?? 1;
    this.#onProgressEvent = options.onProgressEvent;
    this.#onOutputTargetReady = options.onOutputTargetReady;
  }

  async run(
    request: RunRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ReviewRunSummary> {
    this.#emitProgressEvent({
      type: "phase-changed",
      phase: "step0"
    });

    const startPath = path.resolve(this.#workingDirectory, request.repoPath ?? ".");
    const repoRoot = this.#sourceProvider.resolveRepoRoot(startPath);
    const changesetEntries = this.#sourceProvider.getChangesetEntries(
      repoRoot,
      request.baseRef,
      request.headRef
    );
    // Step 0 must complete first because its RunContext feeds the per-file Overview step.
    let runContext: RunContext;

    try {
      runContext = await this.#changesetOverviewRunner.run({
        model: "gpt-5.4-mini",
        changedFilesList: changesetEntries,
        outputBaseDir: repoRoot,
        repoRoot,
        signal: options?.signal,
        userContext: request.userContext,
        workingDirectory: repoRoot
      });
    } catch (error) {
      if (error instanceof SessionTurnAbortedError && options?.signal?.aborted) {
        throw new ReviewRunInterruptedError(extractSignalName(options.signal.reason));
      }

      throw error;
    }

    // Check if the signal was aborted during Step 0 (or before run() was called).
    // This is the only explicit poll — all later boundaries rely on the event listener below.
    if (options?.signal?.aborted) {
      throw new ReviewRunInterruptedError(extractSignalName(options.signal.reason));
    }

    const runAbortState: AbortState = {};
    const throwIfRunAborted = (): void => {
      if (runAbortState.error) {
        throw runAbortState.error;
      }
    };

    // Establish continuous abort observation before any post-Step0 side effect begins.
    options?.signal?.addEventListener(
      "abort",
      () => {
        runAbortState.error ??= new ReviewRunInterruptedError(
          extractSignalName(options?.signal?.reason)
        );
      },
      { once: true }
    );

    this.#emitProgressEvent({
      type: "phase-changed",
      phase: "planning"
    });
    throwIfRunAborted();

    const branchName = this.#sourceProvider.getCurrentBranch(repoRoot);
    const changedFiles = this.#sourceProvider.getChangedFiles(
      repoRoot,
      request.baseRef,
      request.headRef
    );
    const reviewableFiles = this.#reviewFileFilter.filterReviewableFiles(
      repoRoot,
      changedFiles
    );
    const outputTarget = buildOutputTarget({
      outputBaseDir: repoRoot,
      branchName,
      headRef: request.headRef,
      timestamp: this.#timestampProvider()
    });
    const plannedNoteFiles = planNoteFiles(outputTarget.filesPath, reviewableFiles);
    const providerOutputTarget = toReviewOutputTarget(outputTarget);
    const outputPublisher = this.#outputSink.initializeRun(providerOutputTarget);
    throwIfRunAborted();

    outputPublisher.publishChangesetOverview({ content: runContext.changesetOverview });
    throwIfRunAborted();

    this.#onOutputTargetReady?.(outputTarget);
    throwIfRunAborted();

    this.#emitProgressEvent({
      type: "run-initialized",
      repoRoot,
      outputTarget,
      plannedFileCount: plannedNoteFiles.length
    });
    throwIfRunAborted();

    // Publish bootstrap snapshots before any per-file step runs so every file starts from the same skeleton.
    for (const plannedNote of plannedNoteFiles) {
      throwIfRunAborted();
      outputPublisher.publishFileReview({
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
      throwIfRunAborted();
    }

    this.#emitProgressEvent({
      type: "phase-changed",
      phase: "reviewing"
    });
    throwIfRunAborted();

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
    const sharedAbortState: AbortState = {};
    const outcomeSlots: PlannedOutcomeSlot[] = new Array(plannedNoteFiles.length);

    await this.#runPlannedFileWorkers({
      plannedNoteFiles,
      outcomeSlots,
      outputPublisher,
      outputTarget,
      request,
      repoRoot,
      signal: options?.signal,
      steps,
      runAbortState,
      sharedAbortState
    });

    const successfulFiles = outcomeSlots.flatMap((slot) =>
      slot?.successful ? [slot.successful] : []
    );
    const skippedFiles = outcomeSlots.flatMap((slot) =>
      slot?.skipped ? [slot.skipped] : []
    );

    this.#emitProgressEvent({
      type: "run-finalizing",
      plannedFileCount: plannedNoteFiles.length,
      successfulFileCount: successfulFiles.length,
      skippedFileCount: skippedFiles.length
    });

    outputPublisher.publishRunSummary({
      content: this.#runSummaryFinalizer.render({
        repoRoot,
        baseRef: request.baseRef,
        headRef: request.headRef,
        plannedFileCount: plannedNoteFiles.length,
        successfulFiles,
        skippedFiles
      })
    });
    outputPublisher.publishReviewIndex({
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
    outputPublisher.publishRunManifest({
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
    outputPublisher: RunOutputPublisher;
    outputTarget: OutputTarget;
    request: RunRequest;
    repoRoot: string;
    signal?: AbortSignal;
    runAbortState: AbortState;
    steps: StepDefinition[];
    sharedAbortState: SharedAbortState;
  }): Promise<void> {
    const workerCount = Math.min(
      this.#maxConcurrentFiles,
      input.plannedNoteFiles.length
    );
    let nextPlannedIndex = 0;
    let claimOrder = 0;

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

      claimOrder += 1;
      this.#emitProgressEvent({
        type: "file-claimed",
        filePath: input.plannedNoteFiles[plannedIndex].filePath,
        claimOrder
      });

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
              outputPublisher: input.outputPublisher,
              outputTarget: input.outputTarget,
              request: input.request,
              repoRoot: input.repoRoot,
              signal: input.signal,
              runAbortState: input.runAbortState,
              sharedAbortState: input.sharedAbortState,
              steps: input.steps
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
    outputPublisher: RunOutputPublisher;
    outputTarget: OutputTarget;
    request: RunRequest;
    repoRoot: string;
    signal?: AbortSignal;
    runAbortState: AbortState;
    sharedAbortState: SharedAbortState;
    steps: StepDefinition[];
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
          outputBaseDir: input.repoRoot,
          repoRoot: input.repoRoot,
          signal: input.signal,
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
          input.outputPublisher.publishFileReview({
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
          input.outputPublisher.publishSkippedFile({
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

        this.#emitProgressEvent({
          type: "file-skipped",
          filePath: fileContext.filePath,
          stepId: step.stepId,
          reason,
          ...countResolvedOutcomes(input.outcomeSlots)
        });

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
        input.outputPublisher.publishFileReview({
          noteFilePath: fileContext.noteFilePath,
          content: this.#finalizer.render(fileContext)
        });
      } catch (outputError) {
        // A snapshot write failure is classified before deciding whether the run should abort or the file should skip.
        const assessment = resolveSuccessfulSnapshotFailureAssessment(
          this.#successfulSnapshotOutputHealthAssessor,
          {
            outputTarget: toReviewOutputTarget(input.outputTarget),
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
          outputPublisher: input.outputPublisher,
          runAbortState: input.runAbortState,
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

        this.#emitProgressEvent({
          type: "file-skipped",
          filePath: fileContext.filePath,
          stepId: step.stepId,
          reason: outputError instanceof Error ? outputError.message : String(outputError),
          ...countResolvedOutcomes(input.outcomeSlots)
        });
        return;
      }

      this.#emitProgressEvent({
        type: "file-progressed",
        filePath: fileContext.filePath,
        stepId: step.stepId
      });
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

    this.#emitProgressEvent({
      type: "file-completed",
      filePath: fileContext.filePath,
      ...countResolvedOutcomes(input.outcomeSlots)
    });
  }

  async #downgradeSuccessfulSnapshotOutputFailure(input: {
    context: FileReviewContext;
    stepId: string;
    error: unknown;
    outputPublisher: RunOutputPublisher;
    runAbortState: AbortState;
    sharedAbortState: SharedAbortState;
  }): Promise<void> {
    const reason =
      input.error instanceof Error ? input.error.message : String(input.error);

    input.context.markInterrupted(input.stepId, reason);

    if (input.runAbortState.error) {
      return;
    }

    try {
      input.outputPublisher.publishFileReview({
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
      input.outputPublisher.publishSkippedFile({
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

  #emitProgressEvent(event: RunProgressEvent): void {
    this.#onProgressEvent?.(event);
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

function countResolvedOutcomes(outcomeSlots: PlannedOutcomeSlot[]): {
  successfulFileCount: number;
  skippedFileCount: number;
} {
  let successfulFileCount = 0;
  let skippedFileCount = 0;

  for (const slot of outcomeSlots) {
    if (slot?.successful) {
      successfulFileCount += 1;
    }

    if (slot?.skipped) {
      skippedFileCount += 1;
    }
  }

  return {
    successfulFileCount,
    skippedFileCount
  };
}


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

function toReviewOutputTarget(outputTarget: OutputTarget): ReviewOutputTarget {
  return {
    basePath: outputTarget.basePath,
    changesetOverviewPath: outputTarget.changesetOverviewPath,
    filesPath: outputTarget.filesPath,
    skippedPath: outputTarget.skippedPath,
    summaryPath: outputTarget.summaryPath,
    indexPath: outputTarget.indexPath,
    manifestPath: outputTarget.manifestPath,
    toolAuditPath: outputTarget.toolAuditPath
  };
}
