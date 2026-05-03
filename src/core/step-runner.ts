import type { FileReviewContext } from "./file-review-context.ts";
import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";
import type { ReviewSessionFactoryLike } from "./session-factory-contracts.ts";
import { StepExecutionError } from "./step-execution-error.ts";
import { retryOnce } from "./session-retry.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "./structured-output-validator.ts";
import type { FindingsPayload, FindingDisposition, VerifiedFindingsPayload } from "./file-review-context.ts";
import type {
  VerifierReportArtifactEntry,
  VerifierReportEntry
} from "./verifier-report.ts";

export interface StructuredOutputValidatorLike {
  validate(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): FindingsPayload;
  validateWithReport(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): { payload: FindingsPayload; report: VerifierReportEntry[] };
  filterByAcceptance(payload: FindingsPayload): FindingsPayload;
  filterByAcceptanceWithReport(payload: FindingsPayload): {
    payload: FindingsPayload;
    report: VerifierReportEntry[];
  };
  validateWithDispositions(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): VerifiedFindingsPayload;
  validateWithDispositionsAndReport?(input: {
    responseText: string;
    diffContent?: string;
    filePath?: string;
  }): { payload: VerifiedFindingsPayload; report: VerifierReportEntry[] };
  validateDispositionCompleteness(input: {
    dispositions: FindingDisposition[];
    candidateFindingIds: readonly string[];
    acceptedFindingIds: readonly string[];
  }): void;
}

export interface StepResolveServices {
  judgeService?: {
    evaluate(input: {
      stepId: string;
      filePath: string;
      criteria: string;
      sectionContent: string;
    }): Promise<{ passed: boolean; cause?: string }>;
  };
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
  stepId: string;
  applyTo(context: FileReviewContext): void;
}

export interface StepDefinition {
  stepId: string;
  prepare(context: FileReviewContext): StepExecutionPlan;
}

export interface RunStepInput {
  step: StepDefinition;
  context: FileReviewContext;
  outputBaseDir: string;
  repoRoot: string;
  signal?: AbortSignal;
  workingDirectory?: string;
}

export interface StepRetryInfo {
  stepId: string;
  filePath: string;
  attempt: number;
  cause: string;
}

export interface StepRunnerOptions {
  reviewSessionFactory: ReviewSessionFactoryLike;
  judgeService?: {
    evaluate(input: {
      stepId: string;
      filePath: string;
      criteria: string;
      sectionContent: string;
    }): Promise<{ passed: boolean; cause?: string }>;
  };
  structuredOutputValidator?: StructuredOutputValidatorLike;
  onStepRetry?: (info: StepRetryInfo) => void;
}

/**
 * Execute one SOP step, validate its completion, and return a deferred state update for the orchestrator.
 */
export class StepRunner {
  readonly #reviewSessionFactory: ReviewSessionFactoryLike;
  readonly #judgeService?: StepRunnerOptions["judgeService"];
  readonly #structuredOutputValidator: NonNullable<StepRunnerOptions["structuredOutputValidator"]>;
  readonly #onStepRetry?: (info: StepRetryInfo) => void;

  constructor(options: StepRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
    this.#judgeService = options.judgeService;
    this.#structuredOutputValidator =
      options.structuredOutputValidator ?? new StructuredOutputValidator();
    this.#onStepRetry = options.onStepRetry;
  }

  async run(input: RunStepInput): Promise<StepResult> {
    return retryOnce({
      execute: async () => {
        const plan = input.step.prepare(input.context);
        const sessionProfile = {
          stepId: plan.stepId,
          knowledgeMode: plan.reviewProfile.knowledgeMode,
          model: plan.reviewProfile.model,
          outputBaseDir: input.outputBaseDir,
          repoRoot: input.repoRoot,
          systemMessage: plan.prompt.systemMessage,
          ...(input.workingDirectory === undefined
            ? {}
            : { workingDirectory: input.workingDirectory })
        };
        const session = await this.#reviewSessionFactory.createSession(sessionProfile);
        const response = await session.sendAndWait(
          plan.prompt.userMessage,
          plan.reviewProfile.timeoutMs,
          input.signal
        );

        if (!response) {
          // Blank assistant output is treated as a failed step so the caller can retry or skip.
          throw new Error("empty review response");
        }

        let deferred: (context: FileReviewContext) => void;
        try {
          deferred = await plan.resolve(response, {
            judgeService: this.#judgeService,
            validator: this.#structuredOutputValidator
          });
        } catch (error) {
          const validationReport = toValidationReportArtifactEntries(
            error,
            plan.stepId,
            input.context.filePath
          );
          if (validationReport.length > 0) {
            input.context.appendVerifierReportEntries(validationReport);
          }
          throw error;
        }

        return {
          stepId: plan.stepId,
          applyTo(context: FileReviewContext) {
            // Defer canonical state mutation until the orchestrator accepts the validated step result.
            deferred(context);
          }
        };
      },
      onRetry: (attempt, cause) => {
        this.#onStepRetry?.({
          stepId: input.step.stepId,
          filePath: input.context.filePath,
          attempt,
          cause
        });
      },
      buildFinalError: (lastCause) => {
        return new StepExecutionError({
          stepId: input.step.stepId,
          filePath: input.context.filePath,
          cause: lastCause
        });
      }
    });
  }
}

function toValidationReportArtifactEntries(
  error: unknown,
  stepId: string,
  filePath: string
): VerifierReportArtifactEntry[] {
  if (!(error instanceof StructuredValidationReportError)) {
    return [];
  }

  return error.report.map((entry) => ({
    filePath,
    stepId,
    findingId: entry.findingId,
    taxonomy: entry.taxonomy,
    outcome: entry.outcome,
    gate: entry.gate,
    reason: entry.reason
  }));
}
