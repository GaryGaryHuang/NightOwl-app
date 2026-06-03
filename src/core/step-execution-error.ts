export class StepExecutionError extends Error {
  readonly stepCause: string;

  constructor(input: { stepId: string; filePath: string; cause: string }) {
    super(`Step ${input.stepId} failed for ${input.filePath}: ${input.cause}`);
    this.name = "StepExecutionError";
    this.stepCause = input.cause;
  }
}
