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
import { StepExecutionError } from "./step-execution-error.ts";
import { ReviewNoteFinalizer } from "./finalizers/review-note-finalizer.ts";
import { RunSummaryFinalizer } from "./finalizers/run-summary-finalizer.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "./run-outcomes.ts";
import { ReviewIndexFinalizer } from "./finalizers/review-index-finalizer.ts";
import { RunManifestFinalizer } from "./finalizers/run-manifest-finalizer.ts";
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
  type ReviewOutputTarget,
  type ReviewOutputSink,
  type RunOutputPublisher
} from "../providers/review-output-sink.ts";
import {
  resolveSuccessfulSnapshotFailureAssessment,
} from "../providers/resolve-successful-snapshot-failure-assessment.ts";
import {
  type SuccessfulSnapshotOutputHealthAssessor
} from "../providers/review-output-health-assessor.ts";
import type { ReviewFileFilter } from "../providers/review-file-filter.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { SessionTurnAbortedError } from "./session-turn-aborted-error.ts";

export interface FinalizerFailure {
  artifact: "summary" | "index" | "manifest";
  message: string;
}

export interface ReviewRunSummary {
  repoRoot: string;
  runContext: RunContext;
  outputTarget: OutputTarget;
  plannedFileCount: number;
  successfulFileCount: number;
  skippedFileCount: number;
  dryRun: boolean;
  finalizerFailures: FinalizerFailure[];
}

export interface ReviewPerFileStepsFactoryInput {
  runContext: RunContext;
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

export type ReviewPerFileStepsFactory = (
  input: ReviewPerFileStepsFactoryInput
) => StepDefinition[];

export interface ReviewOrchestratorOptions {
  changesetOverviewRunner: Pick<ChangesetOverviewRunner, "run">;
  maxConcurrentFiles?: number;
  onProgressEvent?: RunProgressEventHandler;
  onOutputTargetReady?: (outputTarget: OutputTarget) => void;
  perFileStepsFactory?: ReviewPerFileStepsFactory;
  reviewFileFilter: ReviewFileFilter;
  reviewNoteFinalizer?: Pick<ReviewNoteFinalizer, "render">;
  reviewIndexFinalizer?: Pick<ReviewIndexFinalizer, "render">;
  runManifestFinalizer?: Pick<RunManifestFinalizer, "render">;
  runSummaryFinalizer?: Pick<RunSummaryFinalizer, "render">;
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
  readonly #finalizer: Pick<ReviewNoteFinalizer, "render">;
  readonly #runSummaryFinalizer: Pick<RunSummaryFinalizer, "render">;
  readonly #reviewIndexFinalizer: Pick<ReviewIndexFinalizer, "render">;
  readonly #runManifestFinalizer: Pick<RunManifestFinalizer, "render">;
  readonly #maxConcurrentFiles: number;
  readonly #onProgressEvent?: RunProgressEventHandler;
  readonly #onOutputTargetReady?: (outputTarget: OutputTarget) => void;
  readonly #perFileStepsFactory: ReviewPerFileStepsFactory;

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
        async assess() {
          return { faultScope: "shared-output-target-fault" as const };
        }
      };
    this.#stepRunner = options.stepRunner;
    this.#workingDirectory = options.workingDirectory;
    this.#timestampProvider = options.timestampProvider ?? defaultTimestampProvider;
    this.#finalizer = options.reviewNoteFinalizer ?? new ReviewNoteFinalizer();
    this.#runSummaryFinalizer = options.runSummaryFinalizer ?? new RunSummaryFinalizer();
    this.#reviewIndexFinalizer = options.reviewIndexFinalizer ?? new ReviewIndexFinalizer();
    this.#runManifestFinalizer = options.runManifestFinalizer ?? new RunManifestFinalizer();
    this.#maxConcurrentFiles = options.maxConcurrentFiles ?? 1;
    this.#onProgressEvent = options.onProgressEvent;
    this.#onOutputTargetReady = options.onOutputTargetReady;
    this.#perFileStepsFactory =
      options.perFileStepsFactory ?? buildDefaultPerFileSteps;
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
    const repoRoot = await this.#sourceProvider.resolveRepoRoot(startPath);
    const changesetEntries = await this.#sourceProvider.getChangesetEntries(
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

    const abortGuard = new RunAbortGuard();

    // Establish continuous abort observation before any post-Step0 side effect begins.
    options?.signal?.addEventListener(
      "abort",
      () => {
        abortGuard.markAborted(
          new ReviewRunInterruptedError(extractSignalName(options?.signal?.reason))
        );
      },
      { once: true }
    );

    this.#emitProgressEvent({
      type: "phase-changed",
      phase: "planning"
    });
    abortGuard.throwIfAborted();

    const branchName = await this.#sourceProvider.getCurrentBranch(repoRoot);
    const changedFiles = await this.#sourceProvider.getChangedFiles(
      repoRoot,
      request.baseRef,
      request.headRef
    );
    const reviewableFiles = await this.#reviewFileFilter.filterReviewableFiles(
      repoRoot,
      changedFiles
    );
    const outputTarget = buildOutputTarget({
      repoRoot,
      branchName,
      headRef: request.headRef,
      timestamp: this.#timestampProvider()
    });
    const plannedNoteFiles = planNoteFiles(outputTarget.filesPath, reviewableFiles);
    const providerOutputTarget = toReviewOutputTarget(outputTarget);
    const outputPublisher = await this.#outputSink.initializeRun(providerOutputTarget);
    abortGuard.throwIfAborted();

    await outputPublisher.publishChangesetOverview({ content: runContext.changesetOverviewMarkdown });
    abortGuard.throwIfAborted();

    this.#onOutputTargetReady?.(outputTarget);
    abortGuard.throwIfAborted();

    this.#emitProgressEvent({
      type: "run-initialized",
      repoRoot,
      outputTarget,
      plannedFileCount: plannedNoteFiles.length
    });
    abortGuard.throwIfAborted();

    // Publish bootstrap snapshots before any per-file step runs so every file starts from the same skeleton.
    for (const plannedNote of plannedNoteFiles) {
      abortGuard.throwIfAborted();
      await outputPublisher.publishFileReview({
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
      abortGuard.throwIfAborted();
    }

    this.#emitProgressEvent({
      type: "phase-changed",
      phase: "reviewing"
    });
    abortGuard.throwIfAborted();

    // Steps 2–7 each receive the progressively rendered note via <current_review> so each step builds on prior output.
    const steps = this.#perFileStepsFactory({
      runContext,
      reviewNoteFinalizer: this.#finalizer
    });
    const outcomeSlots: (PlannedOutcomeSlot | undefined)[] = new Array(plannedNoteFiles.length);

    await this.#runPlannedFileWorkers({
      plannedNoteFiles,
      outcomeSlots,
      outputPublisher,
      outputTarget,
      request,
      repoRoot,
      signal: options?.signal,
      steps,
      abortGuard
    });

    const successfulFiles = outcomeSlots.flatMap((slot) =>
      slot?.kind === "successful" ? [slot.outcome] : []
    );
    const skippedFiles = outcomeSlots.flatMap((slot) =>
      slot?.kind === "skipped" ? [slot.outcome] : []
    );

    this.#emitProgressEvent({
      type: "run-finalizing",
      plannedFileCount: plannedNoteFiles.length,
      successfulFileCount: successfulFiles.length,
      skippedFileCount: skippedFiles.length
    });

    const finalizerFailures: FinalizerFailure[] = [];

    await this.#tryPublishFinalizer("summary", finalizerFailures, () =>
      outputPublisher.publishRunSummary({
        content: this.#runSummaryFinalizer.render({
          repoRoot,
          baseRef: request.baseRef,
          headRef: request.headRef,
          plannedNotes: plannedNoteFiles,
          successfulFiles,
          skippedFiles
        })
      })
    );

    await this.#tryPublishFinalizer("index", finalizerFailures, () =>
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
      })
    );

    await this.#tryPublishFinalizer("manifest", finalizerFailures, () =>
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
      })
    );

    return {
      repoRoot,
      runContext,
      outputTarget,
      plannedFileCount: plannedNoteFiles.length,
      successfulFileCount: successfulFiles.length,
      skippedFileCount: skippedFiles.length,
      dryRun: request.dryRun ?? false,
      finalizerFailures
    };
  }

  async #runPlannedFileWorkers(input: {
    plannedNoteFiles: PlannedNoteFile[];
    outcomeSlots: (PlannedOutcomeSlot | undefined)[];
    outputPublisher: RunOutputPublisher;
    outputTarget: OutputTarget;
    request: RunRequest;
    repoRoot: string;
    signal?: AbortSignal;
    abortGuard: RunAbortGuard;
    steps: StepDefinition[];
  }): Promise<void> {
    const workerCount = Math.min(
      this.#maxConcurrentFiles,
      input.plannedNoteFiles.length
    );
    let nextPlannedIndex = 0;
    let claimOrder = 0;

    // Each worker pulls the next file atomically from the shared cursor until no work remains.
    const claimNextWorkItem = (): PlannedFileWorkItem | undefined => {
      if (input.abortGuard.isAborted) {
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
          if (input.abortGuard.isAborted) {
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
              abortGuard: input.abortGuard,
              steps: input.steps
            });
          } catch (error) {
            input.abortGuard.markAborted(error);
            return;
          }
        }
      })
    );

    input.abortGuard.throwIfAborted();
  }

  async #processPlannedFile(input: {
    workItem: PlannedFileWorkItem;
    outcomeSlots: (PlannedOutcomeSlot | undefined)[];
    outputPublisher: RunOutputPublisher;
    outputTarget: OutputTarget;
    request: RunRequest;
    repoRoot: string;
    signal?: AbortSignal;
    abortGuard: RunAbortGuard;
    steps: StepDefinition[];
  }): Promise<void> {
    let diffContent: string;

    try {
      // Load the file diff once so the per-file state machine can operate on a stable snapshot.
      diffContent = await this.#sourceProvider.getDiff(
        input.repoRoot,
        input.request.baseRef,
        input.request.headRef,
        input.workItem.plannedNote.filePath
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      await this.#skipFile({
        fileContext: new FileReviewContext({
          filePath: input.workItem.plannedNote.filePath,
          noteFilePath: input.workItem.plannedNote.noteFilePath,
          diffContent: "",
          baseRef: input.request.baseRef,
          headRef: input.request.headRef
        }),
        stepId: "diff-loading",
        reason,
        outcomeSlots: input.outcomeSlots,
        plannedIndex: input.workItem.plannedIndex,
        outputPublisher: input.outputPublisher,
        abortGuard: input.abortGuard
      });

      return;
    }

    const fileContext = new FileReviewContext({
      filePath: input.workItem.plannedNote.filePath,
      noteFilePath: input.workItem.plannedNote.noteFilePath,
      diffContent,
      baseRef: input.request.baseRef,
      headRef: input.request.headRef
    });

    if (input.abortGuard.isAborted) {
      return;
    }

    for (const step of input.steps) {
      if (input.abortGuard.isAborted) {
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
        const reason = error instanceof StepExecutionError
          ? error.stepCause
          : (error instanceof Error ? error.message : String(error));

        if (input.abortGuard.isAborted) {
          return;
        }

        await this.#skipFile({
          fileContext,
          stepId: step.stepId,
          reason,
          outcomeSlots: input.outcomeSlots,
          plannedIndex: input.workItem.plannedIndex,
          outputPublisher: input.outputPublisher,
          abortGuard: input.abortGuard
        });

        return;
      }

      if (input.abortGuard.isAborted) {
        return;
      }

      result.applyTo(fileContext);

      if (input.abortGuard.isAborted) {
        return;
      }

      try {
        await input.outputPublisher.publishFileReview({
          noteFilePath: fileContext.noteFilePath,
          content: this.#finalizer.render(fileContext)
        });
      } catch (outputError) {
        // A snapshot write failure is classified before deciding whether the run should abort or the file should skip.
        const assessment = await resolveSuccessfulSnapshotFailureAssessment(
          this.#successfulSnapshotOutputHealthAssessor,
          {
            outputTarget: toReviewOutputTarget(input.outputTarget),
            noteFilePath: fileContext.noteFilePath,
            error: outputError
          }
        );

        if (assessment.faultScope === "shared-output-target-fault") {
          input.abortGuard.markAborted(outputError);
          throw outputError;
        }

        const reason = outputError instanceof Error ? outputError.message : String(outputError);

        if (input.abortGuard.isAborted) {
          return;
        }

        await this.#skipFile({
          fileContext,
          stepId: step.stepId,
          reason,
          outcomeSlots: input.outcomeSlots,
          plannedIndex: input.workItem.plannedIndex,
          outputPublisher: input.outputPublisher,
          abortGuard: input.abortGuard
        });

        return;
      }

      this.#emitProgressEvent({
        type: "file-progressed",
        filePath: fileContext.filePath,
        stepId: step.stepId
      });
    }

    if (input.abortGuard.isAborted) {
      return;
    }

    input.outcomeSlots[input.workItem.plannedIndex] = {
      kind: "successful",
      outcome: {
        filePath: fileContext.filePath,
        findings: fileContext.getFindings() ?? []
      }
    };

    this.#emitProgressEvent({
      type: "file-completed",
      filePath: fileContext.filePath
    });
  }

  async #skipFile(input: {
    fileContext: FileReviewContext;
    stepId: string;
    reason: string;
    outcomeSlots: (PlannedOutcomeSlot | undefined)[];
    plannedIndex: number;
    outputPublisher: RunOutputPublisher;
    abortGuard: RunAbortGuard;
  }): Promise<void> {
    input.fileContext.markInterrupted(input.stepId, input.reason);

    try {
      await input.outputPublisher.publishFileReview({
        noteFilePath: input.fileContext.noteFilePath,
        content: this.#finalizer.render(input.fileContext)
      });
    } catch (outputError) {
      input.abortGuard.markAborted(outputError);
      throw outputError;
    }

    try {
      await input.outputPublisher.publishSkippedFile({
        filePath: input.fileContext.filePath,
        stepId: input.stepId,
        reason: input.reason
      });
    } catch (outputError) {
      input.abortGuard.markAborted(outputError);
      throw outputError;
    }

    this.#recordFileSkipped({
      outcomeSlots: input.outcomeSlots,
      plannedIndex: input.plannedIndex,
      filePath: input.fileContext.filePath,
      stepId: input.stepId,
      reason: input.reason
    });
  }

  #recordFileSkipped(input: {
    outcomeSlots: (PlannedOutcomeSlot | undefined)[];
    plannedIndex: number;
    filePath: string;
    stepId: string;
    reason: string;
  }): void {
    input.outcomeSlots[input.plannedIndex] = {
      kind: "skipped",
      outcome: {
        filePath: input.filePath,
        stepId: input.stepId,
        reason: input.reason
      }
    };

    this.#emitProgressEvent({
      type: "file-skipped",
      filePath: input.filePath,
      stepId: input.stepId,
      reason: input.reason
    });
  }

  async #tryPublishFinalizer(
    artifact: FinalizerFailure["artifact"],
    failures: FinalizerFailure[],
    publish: () => Promise<void>
  ): Promise<void> {
    try {
      await publish();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ artifact, message });
      this.#emitProgressEvent({ type: "finalizer-failed", artifact, message });
    }
  }

  #emitProgressEvent(event: RunProgressEvent): void {
    this.#onProgressEvent?.(event);
  }
}

function buildDefaultPerFileSteps(
  input: ReviewPerFileStepsFactoryInput
): StepDefinition[] {
  return [
    new Step1OverviewStep({ runContext: input.runContext }),
    new Step2DependenciesBoundariesStep({
      reviewNoteFinalizer: input.reviewNoteFinalizer
    }),
    new Step3KnowledgeSourceOfTruthStep({
      reviewNoteFinalizer: input.reviewNoteFinalizer
    }),
    new Step4StrategyWhatIfScenariosStep({
      reviewNoteFinalizer: input.reviewNoteFinalizer
    }),
    new Step5ValidationInterrogationStep({
      reviewNoteFinalizer: input.reviewNoteFinalizer
    }),
    new Step6CognitiveSimulationStep({
      reviewNoteFinalizer: input.reviewNoteFinalizer
    }),
    new Step7SummaryStep({
      reviewNoteFinalizer: input.reviewNoteFinalizer
    })
  ];
}

interface PlannedFileWorkItem {
  plannedIndex: number;
  plannedNote: PlannedNoteFile;
}

type PlannedOutcomeSlot =
  | { kind: "successful"; outcome: SuccessfulFileOutcome }
  | { kind: "skipped"; outcome: SkippedFileOutcome };

class RunAbortGuard {
  #error?: unknown;

  get isAborted(): boolean {
    return this.#error !== undefined;
  }

  throwIfAborted(): void {
    if (this.#error) {
      throw this.#error;
    }
  }

  markAborted(error: unknown): void {
    this.#error ??= error;
  }
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
  return { ...outputTarget };
}
