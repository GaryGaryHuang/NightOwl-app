import type { FileReviewContext } from "./file-review-context.ts";
import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";
import { StructuredOutputValidator } from "./structured-output-validator.ts";
import type { FindingsPayload } from "./structured-output-validator.ts";

export interface StepExecutionPlan {
  stepId: string;
  kind: "section" | "structured";
  sectionKey?: string;
  structuredTarget?: "findings";
  prompt: {
    systemMessage: string;
    userMessage: string;
  };
  reviewProfile: {
    knowledgeMode?: ReviewKnowledgeMode;
    model: string;
    timeoutMs?: number;
  };
  completionCheck?: {
    kind: "judge";
    criteria: string;
  } | {
    kind: "deterministic";
    validatorId: "findings-json";
  };
  applyTo(
    context: FileReviewContext,
    response: string | FindingsPayload
  ): void;
}

export interface StepResult {
  stepId: string;
  applyTo(context: FileReviewContext): void;
}

export interface StepDefinition {
  stepId: string;
  prepare(context: FileReviewContext): StepExecutionPlan;
}

export interface StepReviewSessionFactoryLike {
  createSession(profile: {
    knowledgeMode?: ReviewKnowledgeMode;
    model: string;
    outputBaseDir: string;
    repoRoot: string;
    systemMessage: string;
    workingDirectory?: string;
  }): Promise<{
    sendAndWait(prompt: string, timeoutMs?: number): Promise<string | undefined>;
  }>;
}

export interface RunStepInput {
  step: StepDefinition;
  context: FileReviewContext;
  outputBaseDir: string;
  repoRoot: string;
  workingDirectory?: string;
}

export interface StepRunnerOptions {
  reviewSessionFactory: StepReviewSessionFactoryLike;
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
      validatorId: "findings-json";
      responseText: string;
    }): FindingsPayload;
  };
}

export class StepRunner {
  readonly #reviewSessionFactory: StepReviewSessionFactoryLike;
  readonly #judgeService?: StepRunnerOptions["judgeService"];
  readonly #structuredOutputValidator?: StepRunnerOptions["structuredOutputValidator"];

  constructor(options: StepRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
    this.#judgeService = options.judgeService;
    this.#structuredOutputValidator =
      options.structuredOutputValidator ?? new StructuredOutputValidator();
  }

  async run(input: RunStepInput): Promise<StepResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const plan = input.step.prepare(input.context);
        const session = await this.#reviewSessionFactory.createSession({
          knowledgeMode: plan.reviewProfile.knowledgeMode ?? "built-in-context7",
          model: plan.reviewProfile.model,
          outputBaseDir: input.outputBaseDir,
          repoRoot: input.repoRoot,
          systemMessage: plan.prompt.systemMessage,
          workingDirectory: input.workingDirectory
        });
        const response = await session.sendAndWait(
          plan.prompt.userMessage,
          plan.reviewProfile.timeoutMs
        );

        if (!response) {
          throw new Error("empty review response");
        }

        let validatedResponse: string | FindingsPayload = response;

        if (plan.completionCheck?.kind === "judge") {
          if (!this.#judgeService) {
            throw new Error("judge service is not configured");
          }

          const judgeResult = await this.#judgeService.evaluate({
            stepId: plan.stepId,
            filePath: input.context.filePath,
            criteria: plan.completionCheck.criteria,
            sectionContent: response
          });

          if (!judgeResult.passed) {
            throw new Error(judgeResult.cause ?? "judge rejected");
          }
        } else if (plan.completionCheck?.kind === "deterministic") {
          if (!this.#structuredOutputValidator) {
            throw new Error("structured output validator is not configured");
          }

          validatedResponse = this.#structuredOutputValidator.validate({
            validatorId: plan.completionCheck.validatorId,
            responseText: response
          });
        }

        return {
          stepId: plan.stepId,
          applyTo(context: FileReviewContext) {
            plan.applyTo(context, validatedResponse);
          }
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        const stepId = input.step.stepId;
        const contextualError = new Error(
          `Step ${stepId} failed for ${input.context.filePath}: ${message}`
        );

        if (attempt === 1) {
          throw contextualError;
        }
      }
    }

    throw new Error(
      `Step ${input.step.stepId} failed for ${input.context.filePath}: retry exhausted`
    );
  }
}
