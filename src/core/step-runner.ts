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
}

export class StepRunner {
  readonly #reviewSessionFactory: StepReviewSessionFactoryLike;

  constructor(options: StepRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
  }

  async run(input: RunStepInput): Promise<StepResult> {
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
        throw new Error("empty response.");
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

      throw new Error(
        `Step ${stepId} failed for ${input.context.filePath}: ${message}`
      );
    }
  }
}
