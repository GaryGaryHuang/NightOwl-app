import path from "node:path";

import { ReviewRunInterruptedError } from "./review-run-interrupted-error.ts";
export { ReviewRunInterruptedError } from "./review-run-interrupted-error.ts";

function extractSignalName(reason: unknown): "SIGINT" | "SIGTERM" | undefined {
  if (reason === "SIGINT" || reason === "SIGTERM") {
    return reason;
  }
  return undefined;
}

import type { ChangesetOverviewRunner } from "./changeset-overview-runner.ts";
import { FileReviewContext } from "./file-review-context.ts";
import { DEFAULT_MAX_CONCURRENT_FILES } from "./max-concurrent-files.ts";
import { StepExecutionError } from "./step-execution-error.ts";
import { renderReviewNote, type ReviewNoteRenderer } from "./finalizers/review-note-finalizer.ts";
import { renderRunSummary, type RunSummaryRenderer } from "./finalizers/run-summary-finalizer.ts";
import type { SkippedFileOutcome, SuccessfulFileOutcome } from "./run-outcomes.ts";
import { renderReviewIndex, type ReviewIndexRenderer } from "./finalizers/review-index-finalizer.ts";
import { renderRunManifest, type RunManifestRenderer } from "./finalizers/run-manifest-finalizer.ts";
import { renderVerifierReport, type VerifierReportRenderer } from "./finalizers/verifier-report-finalizer.ts";
import { resolveFileOutcomes, type ResolvedFileOutcome } from "./run-outcome-resolver.ts";
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
import { ReviewStatePromptSerializer } from "./review-state-prompt-serializer.ts";
import { ReviewBasisStep } from "./steps/review-basis-step.ts";
import { Step5ValidationInterrogationStep } from "./steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "./steps/step6-cognitive-simulation.ts";
import { Step7SummaryStep } from "./steps/step7-summary.ts";
import {
  type ReviewOutputPlan,
  type ReviewOutputTarget,
  type ReviewOutputSink,
  type RunOutputPublisher
} from "../providers/review-output-sink.ts";
import {
  resolveOutputWriteFailureAssessment,
} from "../providers/resolve-output-write-failure-assessment.ts";
import {
  type OutputWriteHealthAssessor
} from "../providers/review-output-health-assessor.ts";
import type { ReviewFileFilter } from "../providers/review-file-filter.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";
import { SessionTurnAbortedError } from "./session-turn-aborted-error.ts";

export interface FinalizerFailure {
  artifact: "summary" | "index" | "verifier-report" | "manifest";
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
  renderReviewNote: ReviewNoteRenderer;
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

export type ReviewPerFileStepsFactory = (
  input: ReviewPerFileStepsFactoryInput
) => StepDefinition[];

export interface ReviewOrchestratorOptions {
  changesetOverviewRunner: Pick<ChangesetOverviewRunner, "run">;
  maxConcurrentFiles?: number;
  onProgressEvent?: RunProgressEventHandler;
  onOutputTargetReady?: (outputTarget: OutputTarget) => void;
  onRunLevelFailureOutputTargetReady?: (outputTarget: OutputTarget) => Promise<void> | void;
  perFileStepsFactory?: ReviewPerFileStepsFactory;
  reviewFileFilter: ReviewFileFilter;
  renderReviewNote?: ReviewNoteRenderer;
  renderReviewIndex?: ReviewIndexRenderer;
  renderRunManifest?: RunManifestRenderer;
  renderRunSummary?: RunSummaryRenderer;
  renderVerifierReport?: VerifierReportRenderer;
  sourceProvider: ReviewSourceProvider;
  outputSink: ReviewOutputSink;
  successfulSnapshotOutputHealthAssessor?: OutputWriteHealthAssessor;
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
  readonly #successfulSnapshotOutputHealthAssessor: OutputWriteHealthAssessor;
  readonly #stepRunner: Pick<StepRunner, "run">;
  readonly #workingDirectory: string;
  readonly #timestampProvider: () => string;
  readonly #renderReviewNote: ReviewNoteRenderer;
  readonly #renderRunSummary: RunSummaryRenderer;
  readonly #renderReviewIndex: ReviewIndexRenderer;
  readonly #renderVerifierReport: VerifierReportRenderer;
  readonly #renderRunManifest: RunManifestRenderer;
  readonly #maxConcurrentFiles: number;
  readonly #onProgressEvent?: RunProgressEventHandler;
  readonly #onOutputTargetReady?: (outputTarget: OutputTarget) => void;
  readonly #onRunLevelFailureOutputTargetReady?: (outputTarget: OutputTarget) => Promise<void> | void;
  readonly #perFileStepsFactory: ReviewPerFileStepsFactory;
  readonly #promptSerializer: ReviewStatePromptSerializer;

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
    this.#renderReviewNote = options.renderReviewNote ?? renderReviewNote;
    this.#renderRunSummary = options.renderRunSummary ?? renderRunSummary;
    this.#renderReviewIndex = options.renderReviewIndex ?? renderReviewIndex;
    this.#renderVerifierReport = options.renderVerifierReport ?? renderVerifierReport;
    this.#renderRunManifest = options.renderRunManifest ?? renderRunManifest;
    this.#maxConcurrentFiles =
      options.maxConcurrentFiles ?? DEFAULT_MAX_CONCURRENT_FILES;
    this.#onProgressEvent = options.onProgressEvent;
    this.#onOutputTargetReady = options.onOutputTargetReady;
    this.#onRunLevelFailureOutputTargetReady =
      options.onRunLevelFailureOutputTargetReady;
    this.#perFileStepsFactory =
      options.perFileStepsFactory ?? buildDefaultPerFileSteps;
    this.#promptSerializer = new ReviewStatePromptSerializer();
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

    // Step 0 must complete first because its RunContext feeds the per-file Overview step.
    const runContext = await this.#runStep0({
      repoRoot,
      request,
      signal: options?.signal
    });

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
    const outputPlan = toReviewOutputPlan(outputTarget, plannedNoteFiles);
    const outputPublisher = await this.#outputSink.initializeRun(outputPlan);
    abortGuard.throwIfAborted();

    this.#onOutputTargetReady?.(outputTarget);
    abortGuard.throwIfAborted();

    await outputPublisher.publishArtifact("changeset-overview", { content: runContext.changesetOverviewMarkdown });
    abortGuard.throwIfAborted();

    this.#emitProgressEvent({
      type: "run-initialized",
      repoRoot,
      outputTarget,
      plannedFileCount: plannedNoteFiles.length
    });
    abortGuard.throwIfAborted();

    // Publish bootstrap snapshots before any per-file step runs so every file starts from the same skeleton.
    await this.#publishBootstrapSnapshots({
      plannedNoteFiles,
      request,
      outputPublisher,
      abortGuard
    });

    this.#emitProgressEvent({
      type: "phase-changed",
      phase: "reviewing"
    });
    abortGuard.throwIfAborted();

    // Steps 2–7 each receive the progressively built review state via <review_state> so each step builds on prior output.
    const steps = this.#perFileStepsFactory({
      runContext,
      renderReviewNote: this.#renderReviewNote,
      promptSerializer: this.#promptSerializer
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

    const resolvedOutcomes = resolveFileOutcomes(
      plannedNoteFiles,
      successfulFiles,
      skippedFiles
    );

    this.#emitProgressEvent({
      type: "run-finalizing",
      plannedFileCount: plannedNoteFiles.length,
      successfulFileCount: successfulFiles.length,
      skippedFileCount: skippedFiles.length
    });

    const finalizerFailures = await this.#publishFinalizers({
      outputPublisher,
      outputTarget,
      plannedNoteFiles,
      resolvedOutcomes,
      repoRoot,
      request
    });

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

  async #runStep0(input: {
    repoRoot: string;
    request: RunRequest;
    signal?: AbortSignal;
  }): Promise<RunContext> {
    const changesetEntries = await this.#sourceProvider.getChangesetEntries(
      input.repoRoot,
      input.request.baseRef,
      input.request.headRef
    );

    try {
      return await this.#changesetOverviewRunner.run({
        changesetEntries,
        outputBaseDir: input.repoRoot,
        repoRoot: input.repoRoot,
        signal: input.signal,
        userContext: input.request.userContext,
        workingDirectory: input.repoRoot
      });
    } catch (error) {
      if (error instanceof SessionTurnAbortedError && input.signal?.aborted) {
        throw new ReviewRunInterruptedError(extractSignalName(input.signal.reason));
      }

      await this.#onRunLevelFailure({
        repoRoot: input.repoRoot,
        request: input.request
      });
      throw error;
    }
  }

  async #publishBootstrapSnapshots(input: {
    plannedNoteFiles: PlannedNoteFile[];
    request: RunRequest;
    outputPublisher: RunOutputPublisher;
    abortGuard: RunAbortGuard;
  }): Promise<void> {
    for (const plannedNote of input.plannedNoteFiles) {
      input.abortGuard.throwIfAborted();
      await input.outputPublisher.publishFileReview({
        filePath: plannedNote.filePath,
        content: this.#renderReviewNote(
          new FileReviewContext({
            filePath: plannedNote.filePath,
            noteFilePath: plannedNote.noteFilePath,
            diffContent: "",
            baseRef: input.request.baseRef,
            headRef: input.request.headRef
          })
        )
      });
      input.abortGuard.throwIfAborted();
    }
  }

  async #publishFinalizers(input: {
    outputPublisher: RunOutputPublisher;
    outputTarget: OutputTarget;
    plannedNoteFiles: PlannedNoteFile[];
    resolvedOutcomes: ResolvedFileOutcome[];
    repoRoot: string;
    request: RunRequest;
  }): Promise<FinalizerFailure[]> {
    const failures: FinalizerFailure[] = [];

    const summaryPublished = await this.#tryPublishFinalizer("summary", failures, () =>
      input.outputPublisher.publishArtifact("summary", {
        content: this.#renderRunSummary({
          repoRoot: input.repoRoot,
          baseRef: input.request.baseRef,
          headRef: input.request.headRef,
          resolvedOutcomes: input.resolvedOutcomes
        })
      })
    );
    if (!summaryPublished) {
      return failures;
    }

    const indexPublished = await this.#tryPublishFinalizer("index", failures, () =>
      input.outputPublisher.publishArtifact("index", {
        content: this.#renderReviewIndex({
          repoRoot: input.repoRoot,
          baseRef: input.request.baseRef,
          headRef: input.request.headRef,
          resolvedOutcomes: input.resolvedOutcomes,
          outputTarget: input.outputTarget,
          plannedNotes: input.plannedNoteFiles
        })
      })
    );
    if (!indexPublished) {
      return failures;
    }

    const verifierReportPublished = await this.#tryPublishFinalizer("verifier-report", failures, () =>
      input.outputPublisher.publishArtifact("verifier-report", {
        content: this.#renderVerifierReport({
          resolvedOutcomes: input.resolvedOutcomes
        })
      })
    );
    if (!verifierReportPublished) {
      return failures;
    }

    await this.#tryPublishFinalizer("manifest", failures, () =>
      input.outputPublisher.publishArtifact("manifest", {
        content: this.#renderRunManifest({
          repoRoot: input.repoRoot,
          baseRef: input.request.baseRef,
          headRef: input.request.headRef,
          resolvedOutcomes: input.resolvedOutcomes,
          outputTarget: input.outputTarget,
          plannedNotes: input.plannedNoteFiles
        })
      })
    );

    return failures;
  }

  async #handleSnapshotPublishFailure(input: {
    outputError: unknown;
    fileContext: FileReviewContext;
    outputTarget: OutputTarget;
    stepId: string;
    outcomeSlots: (PlannedOutcomeSlot | undefined)[];
    plannedIndex: number;
    outputPublisher: RunOutputPublisher;
    abortGuard: RunAbortGuard;
  }): Promise<void> {
    // A snapshot write failure is classified before deciding whether the run should abort or the file should skip.
    const assessment = await resolveOutputWriteFailureAssessment(
      this.#successfulSnapshotOutputHealthAssessor,
      {
        outputTarget: toReviewOutputTarget(input.outputTarget),
        noteFilePath: input.fileContext.noteFilePath,
        error: input.outputError
      }
    );

    if (assessment.faultScope === "shared-output-target-fault") {
      input.abortGuard.markAborted(input.outputError);
      throw input.outputError;
    }

    const reason = input.outputError instanceof Error
      ? input.outputError.message
      : String(input.outputError);

    if (input.abortGuard.isAborted) {
      return;
    }

    await this.#skipFile({
      fileContext: input.fileContext,
      stepId: input.stepId,
      reason,
      outcomeSlots: input.outcomeSlots,
      plannedIndex: input.plannedIndex,
      outputPublisher: input.outputPublisher,
      abortGuard: input.abortGuard
    });
  }

  async #onRunLevelFailure(input: {
    repoRoot: string;
    request: RunRequest;
  }): Promise<void> {
    if (!this.#onRunLevelFailureOutputTargetReady) {
      return;
    }

    const outputTarget = buildOutputTarget({
      repoRoot: input.repoRoot,
      headRef: input.request.headRef,
      timestamp: this.#timestampProvider()
    });

    await this.#onRunLevelFailureOutputTargetReady(outputTarget);
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
          filePath: fileContext.filePath,
          content: this.#renderReviewNote(fileContext)
        });
      } catch (outputError) {
        await this.#handleSnapshotPublishFailure({
          outputError,
          fileContext,
          outputTarget: input.outputTarget,
          stepId: step.stepId,
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
        findings: fileContext.getFindings() ?? [],
        verifierReportEntries: fileContext.getVerifierReportEntries() ?? []
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
        filePath: input.fileContext.filePath,
        content: this.#renderReviewNote(input.fileContext)
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
      reason: input.reason,
      verifierReportEntries: input.fileContext.getVerifierReportEntries() ?? []
    });
  }

  #recordFileSkipped(input: {
    outcomeSlots: (PlannedOutcomeSlot | undefined)[];
    plannedIndex: number;
    filePath: string;
    stepId: string;
    reason: string;
    verifierReportEntries: SuccessfulFileOutcome["verifierReportEntries"];
  }): void {
    input.outcomeSlots[input.plannedIndex] = {
      kind: "skipped",
      outcome: {
        filePath: input.filePath,
        stepId: input.stepId,
        reason: input.reason,
        verifierReportEntries: input.verifierReportEntries
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
  ): Promise<boolean> {
    try {
      await publish();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ artifact, message });
      this.#emitProgressEvent({ type: "finalizer-failed", artifact, message });
      return false;
    }
  }

  #emitProgressEvent(event: RunProgressEvent): void {
    this.#onProgressEvent?.(event);
  }
}

export function buildDefaultPerFileSteps(
  input: ReviewPerFileStepsFactoryInput
): StepDefinition[] {
  return [
    new ReviewBasisStep({ runContext: input.runContext }),
    new Step5ValidationInterrogationStep({
      promptSerializer: input.promptSerializer
    }),
    new Step6CognitiveSimulationStep({
      promptSerializer: input.promptSerializer
    }),
    new Step7SummaryStep({
      promptSerializer: input.promptSerializer
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

function toReviewOutputPlan(
  outputTarget: OutputTarget,
  plannedNoteFiles: PlannedNoteFile[]
): ReviewOutputPlan {
  return {
    outputTarget: toReviewOutputTarget(outputTarget),
    plannedNotes: plannedNoteFiles.map((plannedNote) => ({ ...plannedNote }))
  };
}

function toReviewOutputTarget(outputTarget: OutputTarget): ReviewOutputTarget {
  return { ...outputTarget };
}
