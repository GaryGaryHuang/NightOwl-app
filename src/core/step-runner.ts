import type { FileReviewContext } from "./file-review-context.ts";

export interface StepExecutionPlan {
  stepId: string;
  kind: "section";
  sectionKey: string;
  prompt: {
    systemMessage: string;
    userMessage: string;
  };
  reviewProfile: {
    model: string;
    timeoutMs?: number;
  };
  completionCheck?: {
    kind: "judge";
    criteria: string;
  };
  applyTo(context: FileReviewContext, responseText: string): void;
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
}

export class StepRunner {
  readonly #reviewSessionFactory: StepReviewSessionFactoryLike;
  readonly #judgeService?: StepRunnerOptions["judgeService"];

  constructor(options: StepRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
    this.#judgeService = options.judgeService;
  }

  async run(input: RunStepInput): Promise<StepResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const plan = input.step.prepare(input.context);
        const session = await this.#reviewSessionFactory.createSession({
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
        }

        return {
          stepId: plan.stepId,
          applyTo(context: FileReviewContext) {
            plan.applyTo(context, response);
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
