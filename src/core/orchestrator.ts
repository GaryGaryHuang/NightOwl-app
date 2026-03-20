import path from "node:path";

import type { ChangesetOverviewRunner } from "./changeset-overview-runner.ts";
import { FileReviewContext } from "./file-review-context.ts";
import { ReviewNoteFinalizer } from "./finalizer.ts";
import {
  RunSummaryFinalizer,
  type SkippedFileOutcome,
  type SuccessfulFileOutcome
} from "./run-summary-finalizer.ts";
import type { RunContext } from "./run-context.ts";
import type { RunRequest } from "./run-request.ts";
import type { StepResult, StepRunner } from "./step-runner.ts";
import {
  buildOutputTarget,
  planNoteFiles,
  type OutputTarget
} from "./review-path-resolver.ts";
import { Step5ValidationInterrogationStep } from "./steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "./steps/step6-cognitive-simulation.ts";
import { Step7SummaryStep } from "./steps/step7-summary.ts";
import { Step4StrategyWhatIfScenariosStep } from "./steps/step4-strategy-what-if-scenarios.ts";
import { Step3KnowledgeSourceOfTruthStep } from "./steps/step3-knowledge-source-of-truth.ts";
import { Step2DependenciesBoundariesStep } from "./steps/step2-dependencies-boundaries.ts";
import { Step1OverviewStep } from "./steps/step1-overview.ts";
import type { ReviewOutputSink } from "../providers/review-output-sink.ts";
import type { ReviewSourceProvider } from "../providers/review-source-provider.ts";

export interface ReviewRunSummary {
  repoRoot: string;
  runContext: RunContext;
  outputTarget: OutputTarget;
  plannedFileCount: number;
  successfulFileCount: number;
  skippedFileCount: number;
}

export interface ReviewOrchestratorOptions {
  changesetOverviewRunner: Pick<ChangesetOverviewRunner, "run">;
  sourceProvider: ReviewSourceProvider;
  outputSink: ReviewOutputSink;
  stepRunner: Pick<StepRunner, "run">;
  workingDirectory: string;
  timestampProvider?: () => string;
}

export class ReviewOrchestrator {
  readonly #changesetOverviewRunner: Pick<ChangesetOverviewRunner, "run">;
  readonly #sourceProvider: ReviewSourceProvider;
  readonly #outputSink: ReviewOutputSink;
  readonly #stepRunner: Pick<StepRunner, "run">;
  readonly #workingDirectory: string;
  readonly #timestampProvider: () => string;
  readonly #finalizer: ReviewNoteFinalizer;
  readonly #runSummaryFinalizer: RunSummaryFinalizer;

  constructor(options: ReviewOrchestratorOptions) {
    this.#changesetOverviewRunner = options.changesetOverviewRunner;
    this.#sourceProvider = options.sourceProvider;
    this.#outputSink = options.outputSink;
    this.#stepRunner = options.stepRunner;
    this.#workingDirectory = options.workingDirectory;
    this.#timestampProvider = options.timestampProvider ?? defaultTimestampProvider;
    this.#finalizer = new ReviewNoteFinalizer();
    this.#runSummaryFinalizer = new RunSummaryFinalizer();
  }

  async run(request: RunRequest): Promise<ReviewRunSummary> {
    const startPath = path.resolve(this.#workingDirectory, request.repoPath ?? ".");
    const repoRoot = this.#sourceProvider.resolveRepoRoot(startPath);
    const changesetEntries = this.#sourceProvider.getChangesetEntries(
      repoRoot,
      request.baseRef,
      request.headRef
    );
    const runContext = await this.#changesetOverviewRunner.run({
      model: "gpt-5.4-mini",
      changedFilesList: changesetEntries,
      outputBaseDir: startPath,
      repoRoot,
      userContext: request.userContext,
      workingDirectory: repoRoot
    });
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
    const successfulFiles: SuccessfulFileOutcome[] = [];
    const skippedFiles: SkippedFileOutcome[] = [];

    for (const plannedNote of plannedNoteFiles) {
      let diffContent: string;

      try {
        diffContent = this.#sourceProvider.getDiff(
          repoRoot,
          request.baseRef,
          request.headRef,
          plannedNote.filePath
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);

        throw new Error(
          `Step step1-overview failed for ${plannedNote.filePath}: ${message}`
        );
      }

      const fileContext = new FileReviewContext({
        filePath: plannedNote.filePath,
        noteFilePath: plannedNote.noteFilePath,
        diffContent,
        baseRef: request.baseRef,
        headRef: request.headRef
      });
      let skipped = false;

      for (const step of steps) {
        let result: StepResult;

        try {
          result = await this.#stepRunner.run({
            step,
            context: fileContext,
            outputBaseDir: startPath,
            repoRoot,
            workingDirectory: repoRoot
          });
        } catch (error) {
          const reason = extractStepFailureReason({
            stepId: step.stepId,
            filePath: fileContext.filePath,
            error
          });

          fileContext.markInterrupted(step.stepId, reason);

          this.#outputSink.publishFileReview({
            noteFilePath: fileContext.noteFilePath,
            content: this.#finalizer.render(fileContext)
          });
          this.#outputSink.publishSkippedFile({
            filePath: fileContext.filePath,
            stepId: step.stepId,
            reason
          });
          skippedFiles.push({
            filePath: fileContext.filePath,
            stepId: step.stepId,
            reason
          });
          skipped = true;

          break;
        }

        result.applyTo(fileContext);

        this.#outputSink.publishFileReview({
          noteFilePath: fileContext.noteFilePath,
          content: this.#finalizer.render(fileContext)
        });
      }

      if (!skipped) {
        successfulFiles.push({
          filePath: fileContext.filePath,
          findings: fileContext.getStructuredState().findings ?? []
        });
      }
    }

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

    return {
      repoRoot,
      runContext,
      outputTarget,
      plannedFileCount: plannedNoteFiles.length,
      successfulFileCount: successfulFiles.length,
      skippedFileCount: skippedFiles.length
    };
  }
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
