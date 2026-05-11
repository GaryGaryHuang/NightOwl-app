import type { FileReviewContext } from "./file-review-context.ts";
import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";
import type { ReviewSessionFactoryLike } from "./session-factory-contracts.ts";
import { StepExecutionError } from "./step-execution-error.ts";
import { retryWithLimit } from "./session-retry.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "./structured-output-validator.ts";
import type { ReviewBasisV1 } from "./review-basis.ts";
import {
  CANDIDATE_FINDINGS_STEP_ID,
  REVIEW_BASIS_STEP_ID,
  REVIEW_SUMMARY_STEP_ID,
  SEMANTIC_VALIDATION_STEP_ID
} from "./review-step-ids.ts";
import type {
  CandidateFindingsV3,
  ValidationReportV1
} from "./semantic-review.ts";
import type {
  VerifierReportArtifactEntry,
  VerifierReportEntry
} from "./verifier-report.ts";

export interface StructuredOutputValidatorLike {
  validateCandidateFindingsV3WithReport(input: {
    responseText: string;
    reviewBasis: ReviewBasisV1;
    diffContent?: string;
    filePath?: string;
  }): { payload: CandidateFindingsV3; report: VerifierReportEntry[] };
  validateValidationReportV1WithReport(input: {
    responseText: string;
    candidateFindings: CandidateFindingsV3 | Record<string, unknown>;
    reviewBasis?: ReviewBasisV1;
    diffContent?: string;
    filePath?: string;
  }): { payload: ValidationReportV1; report: VerifierReportEntry[] };
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
  model?: string;
  promptHash?: string;
  schemaId?: string;
  outputBaseDir?: string;
  verifierReportPath?: string;
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
          model: plan.reviewProfile.model,
          promptHash: hashPrompt(plan.prompt.systemMessage, plan.prompt.userMessage),
          schemaId: schemaIdForStep(plan.stepId),
          outputBaseDir: input.outputBaseDir,
          verifierReportPath: `${input.outputBaseDir}/verifier-report.jsonl`
        };
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
          retryFeedback = buildRetryFeedback(error);
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
          stepId: retryDiagnostics?.stepId ?? input.step.stepId,
          filePath: retryDiagnostics?.filePath ?? input.context.filePath,
          attempt,
          cause,
          ...(retryDiagnostics?.model === undefined ? {} : { model: retryDiagnostics.model }),
          ...(retryDiagnostics?.promptHash === undefined
            ? {}
            : { promptHash: retryDiagnostics.promptHash }),
          ...(retryDiagnostics?.schemaId === undefined ? {} : { schemaId: retryDiagnostics.schemaId }),
          ...(retryDiagnostics?.outputBaseDir === undefined
            ? {}
            : { outputBaseDir: retryDiagnostics.outputBaseDir }),
          ...(retryDiagnostics?.verifierReportPath === undefined
            ? {}
            : { verifierReportPath: retryDiagnostics.verifierReportPath })
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

function schemaIdForStep(stepId: string): string {
  switch (stepId) {
    case REVIEW_BASIS_STEP_ID:
      return "ReviewBasisV1";
    case CANDIDATE_FINDINGS_STEP_ID:
      return "CandidateFindingsV3";
    case SEMANTIC_VALIDATION_STEP_ID:
      return "ValidationReportV1";
    case REVIEW_SUMMARY_STEP_ID:
      return "ReviewSummaryMarkdown";
    default:
      return "unknown";
  }
}

function hashPrompt(systemMessage: string, userMessage: string): string {
  const value = `${systemMessage}\n---\n${userMessage}`;
  let hash = 0x811c9dc5; // FNV-1a 32-bit; diagnostic identity only.

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function appendRetryRepairContext(userMessage: string, retryFeedback: string): string {
  return [
    userMessage,
    "",
    "<retry_repair_context>",
    "The previous attempt failed deterministic validation or completion checking.",
    "Repair the output so it satisfies this step's required format and contract. Do not add unrelated analysis.",
    retryFeedback,
    "</retry_repair_context>"
  ].join("\n");
}

function buildRetryFeedback(error: unknown): string {
  if (error instanceof StructuredValidationReportError) {
    const rejectedEntries = error.report.filter((entry) => entry.outcome === "rejected");
    const entries = rejectedEntries.length > 0 ? rejectedEntries : error.report;
    const details = entries.map(
      (entry) =>
        `- findingId=${entry.findingId}; gate=${entry.gate}; taxonomy=${entry.taxonomy}; reason=${entry.reason}`
    );

    return [
      "Structured validation report:",
      ...details
    ].join("\n");
  }

  const message = error instanceof Error ? error.message : String(error);
  return `Failure reason: ${message}`;
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
