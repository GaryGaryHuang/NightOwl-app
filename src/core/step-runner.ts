import type { FileReviewContext } from "./file-review-context.ts";
import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";
import type { ReviewSessionFactoryLike } from "./session-factory-contracts.ts";
import { StepExecutionError } from "./errors.ts";
import { retryWithLimit } from "./session-retry.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "./structured-output-validator.ts";
import type { ReviewBasis } from "./review-basis.ts";
import type {
  CandidateFindings,
  ValidationReportV1
} from "./semantic-review.ts";
import type { StructuredValidationReportEntry } from "./validation-report.ts";

export interface StructuredOutputValidatorLike {
  validateCandidateFindingsWithReport(input: {
    responseText: string;
    reviewBasis: ReviewBasis;
    previousCandidateFindings?: CandidateFindings;
  }): { payload: CandidateFindings; report: StructuredValidationReportEntry[] };
  validateValidationReportV1WithReport(input: {
    responseText: string;
    candidateFindings: CandidateFindings | Record<string, unknown>;
    reviewBasis?: ReviewBasis;
  }): { payload: ValidationReportV1; report: StructuredValidationReportEntry[] };
}

export interface StepResolveServices {
  validator: StructuredOutputValidatorLike;
}

export interface StepExecutionPlan {
  stepId: string;
  prompt: {
    systemMessage: string;
    userMessage: string;
  };
  reviewProfile: {
    knowledgeMode: ReviewKnowledgeMode;
    model: string;
    timeoutMs?: number;
  };
  resolve(
    response: string,
    services: StepResolveServices
  ): Promise<(context: FileReviewContext) => void>;
}

export interface StepResult {
  applyTo(context: FileReviewContext): void;
}

export interface StepDefinition {
  stepId: string;
  prepare(context: FileReviewContext): StepExecutionPlan;
}

export interface RunStepInput {
  step: StepDefinition;
  context: FileReviewContext;
  repoRoot: string;
  reviewOutputRoot?: string;
  signal?: AbortSignal;
  sourceBaseRef?: string;
  sourceHeadRef?: string;
  workingDirectory?: string;
}

export interface StepRetryInfo {
  stepId: string;
  filePath: string;
  attempt: number;
  cause: string;
  model?: string;
}

export interface StepRunnerOptions {
  reviewSessionFactory: ReviewSessionFactoryLike;
  onStepRetry?: (info: StepRetryInfo) => void;
}

/**
 * Execute one SOP step, validate its completion, and return a deferred state update for the orchestrator.
 */
export class StepRunner {
  readonly #reviewSessionFactory: ReviewSessionFactoryLike;
  readonly #structuredOutputValidator: StructuredOutputValidatorLike;
  readonly #onStepRetry?: (info: StepRetryInfo) => void;

  constructor(options: StepRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
    this.#structuredOutputValidator = new StructuredOutputValidator();
    this.#onStepRetry = options.onStepRetry;
  }

  async run(input: RunStepInput): Promise<StepResult> {
    let retryFeedback: string | undefined;
    let retryDiagnostics: Omit<
      StepRetryInfo,
      "attempt" | "cause"
    > | undefined;

    return retryWithLimit({
      execute: async (attempt) => {
        const plan = input.step.prepare(input.context);
        retryDiagnostics = {
          stepId: plan.stepId,
          filePath: input.context.filePath,
          model: plan.reviewProfile.model
        };
        const sessionProfile = {
          stepId: plan.stepId,
          knowledgeMode: plan.reviewProfile.knowledgeMode,
          model: plan.reviewProfile.model,
          repoRoot: input.repoRoot,
          ...(input.reviewOutputRoot === undefined
            ? {}
            : { reviewOutputRoot: input.reviewOutputRoot }),
          ...(input.sourceBaseRef === undefined
            ? {}
            : { sourceBaseRef: input.sourceBaseRef }),
          ...(input.sourceHeadRef === undefined
            ? {}
            : { sourceHeadRef: input.sourceHeadRef }),
          systemMessage: plan.prompt.systemMessage,
          ...(input.workingDirectory === undefined
            ? {}
            : { workingDirectory: input.workingDirectory })
        };
        const session = await this.#reviewSessionFactory.createSession(sessionProfile);
        const userMessage =
          attempt > 0 && retryFeedback
            ? appendRetryRepairContext(plan.prompt.userMessage, retryFeedback)
            : plan.prompt.userMessage;
        const response = await session.sendAndWait(
          userMessage,
          plan.reviewProfile.timeoutMs,
          input.signal
        );

        if (!response) {
          // Blank assistant output is treated as a failed step so the caller can retry or skip.
          retryFeedback = "Previous attempt returned an empty response. Return the required output for this step.";
          throw new Error("empty review response");
        }

        let deferred: (context: FileReviewContext) => void;
        try {
          deferred = await plan.resolve(response, {
            validator: this.#structuredOutputValidator
          });
        } catch (error) {
          retryFeedback = buildRetryFeedback(error);
          throw error;
        }

        return {
          applyTo(context: FileReviewContext) {
            // Defer canonical state mutation until the orchestrator accepts the validated step result.
            deferred(context);
          }
        };
      },
      onRetry: (attempt, cause) => {
        this.#onStepRetry?.({
          stepId: retryDiagnostics?.stepId ?? input.step.stepId,
          filePath: retryDiagnostics?.filePath ?? input.context.filePath,
          attempt,
          cause,
          ...(retryDiagnostics?.model === undefined ? {} : { model: retryDiagnostics.model })
        });
      },
      buildFinalError: (lastCause) => {
        return new StepExecutionError({
          stepId: input.step.stepId,
          filePath: input.context.filePath,
          cause: lastCause
        });
      },
      maxAttempts: 3
    });
  }
}

function appendRetryRepairContext(userMessage: string, retryFeedback: string): string {
  return [
    userMessage,
    "",
    "<retry_repair_context>",
    "Previous attempt status:",
    "- The previous response failed host deterministic validation or completion checking for this step.",
    "",
    "Repair authority:",
    "- The current step system message and original user prompt above remain the output contract.",
    "- This block is diagnostic feedback only, not new review evidence or new source input.",
    "",
    "Validation feedback:",
    retryFeedback,
    "",
    "Repair task:",
    "1. Re-read the current step output contract and required final packaging.",
    "2. Internally identify each listed validation or completion failure and the contract rule it violates; do not include that analysis in the output.",
    "3. Fix only the listed failures.",
    "4. Preserve source-grounded content from the current step inputs unless it conflicts with a listed failure.",
    "5. If a failure cannot be satisfied without violating the step contract or fabricating content, keep the output contract-valid and use the step's allowed uncertainty, omission, or fallback behavior instead of inventing data.",
    "6. Return one complete replacement output for the current step.",
    "",
    "Before finishing, self-check the drafted output:",
    "- Each listed failure is resolved.",
    "- No new validation or completion failure was introduced.",
    "- No contract-required source-grounded content, field, or section was dropped or weakened unless the listed failure required it.",
    "- Required fields or sections, allowed values, cross-references, coverage, and final packaging satisfy the current step contract where that contract requires them.",
    "",
    "Output constraints:",
    "- Return one complete output for the current step; do not output a patch, diff, or partial field list.",
    "- Do not output analysis, scratch notes, or a follow-up question.",
    "</retry_repair_context>"
  ].join("\n");
}

function buildRetryFeedback(error: unknown): string {
  if (error instanceof StructuredValidationReportError) {
    const rejectedEntries = error.report.filter((entry) => entry.outcome === "rejected");
    const entries = rejectedEntries.length > 0 ? rejectedEntries : error.report;
    const details = entries.map(formatStructuredValidationReportEntry);

    return [
      "Structured validation report:",
      ...details
    ].join("\n");
  }

  const message = error instanceof Error ? error.message : String(error);
  return `Failure reason: ${message}`;
}

function formatStructuredValidationReportEntry(
  entry: StructuredValidationReportEntry
): string {
  const fields = [
    `findingId=${entry.findingId}`,
    `gate=${entry.gate}`,
    `taxonomy=${entry.taxonomy}`,
    `reason=${entry.reason}`
  ];

  return `- ${fields.join("; ")}`;
}
