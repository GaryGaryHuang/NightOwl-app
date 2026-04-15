/**
 * Typed error thrown by StepRunner when a step fails after retry exhaustion.
 *
 * Carries structured fields (stepId, filePath, stepCause) so callers can
 * extract failure context without parsing the error message string.
 */
export class StepExecutionError extends Error {
  readonly stepId: string;
  readonly filePath: string;
  readonly stepCause: string;

  constructor(input: { stepId: string; filePath: string; cause: string }) {
    super(`Step ${input.stepId} failed for ${input.filePath}: ${input.cause}`);
    this.name = "StepExecutionError";
    this.stepId = input.stepId;
    this.filePath = input.filePath;
    this.stepCause = input.cause;
  }
}
