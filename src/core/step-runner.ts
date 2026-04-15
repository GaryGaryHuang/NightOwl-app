import type { FileReviewContext } from "./file-review-context.ts";
import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";
import type { ReviewSessionFactoryLike } from "./session-factory-contracts.ts";
import { StructuredOutputValidator } from "./structured-output-validator.ts";
import type { FindingsPayload } from "./file-review-context.ts";
import { SessionTurnAbortedError } from "../services/session-executor.ts";

export interface StepResolveServices {
  judgeService?: {
    evaluate(input: {
      stepId: string;
      filePath: string;
      criteria: string;
      sectionContent: string;
    }): Promise<{ passed: boolean; cause?: string }>;
  };
  validator: {
    validate(input: {
      responseText: string;
      diffContent?: string;
    }): FindingsPayload;
    filterByConfidence(payload: FindingsPayload): FindingsPayload;
  };
}

export interface StepExecutionPlan {
  stepId: string;
  prompt: {
    systemMessage: string;
    userMessage: string;
  };
  reviewProfile: {
    knowledgeMode?: ReviewKnowledgeMode;
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
  structuredOutputValidator?: {
    validate(input: {
      responseText: string;
      diffContent?: string;
    }): FindingsPayload;
    filterByConfidence(payload: FindingsPayload): FindingsPayload;
  };
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const plan = input.step.prepare(input.context);
        const sessionProfile = {
          stepId: plan.stepId,
          knowledgeMode: plan.reviewProfile.knowledgeMode ?? "built-in-context7",
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

        const deferred = await plan.resolve(response, {
          judgeService: this.#judgeService,
          validator: this.#structuredOutputValidator
        });

        return {
          stepId: plan.stepId,
          applyTo(context: FileReviewContext) {
            // Defer canonical state mutation until the orchestrator accepts the validated step result.
            deferred(context);
          }
        };
      } catch (error) {
        if (error instanceof SessionTurnAbortedError) {
          throw error;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        const stepId = input.step.stepId;
        const contextualError = new Error(
          `Step ${stepId} failed for ${input.context.filePath}: ${message}`
        );

        if (attempt === 1) {
          throw contextualError;
        }

        try {
          this.#onStepRetry?.({
            stepId: input.step.stepId,
            filePath: input.context.filePath,
            attempt,
            cause: message
          });
        } catch {
          // swallow: onStepRetry is a side-channel notification only
        }
      }
    }

    throw new Error(
      `Step ${input.step.stepId} failed for ${input.context.filePath}: retry exhausted`
    );
  }
}
