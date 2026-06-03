export class ReviewRunInterruptedError extends Error {
  readonly signal: "SIGINT" | "SIGTERM" | undefined;

  constructor(signal?: "SIGINT" | "SIGTERM") {
    super("Run interrupted by external signal.");
    this.name = "ReviewRunInterruptedError";
    this.signal = signal;
  }
}

export class StepExecutionError extends Error {
  readonly stepCause: string;

  constructor(input: { stepId: string; filePath: string; cause: string }) {
    super(`Step ${input.stepId} failed for ${input.filePath}: ${input.cause}`);
    this.name = "StepExecutionError";
    this.stepCause = input.cause;
  }
}

export class SessionTurnAbortedError extends Error {
  constructor() {
    super("Session turn aborted by run-level interrupt.");
    this.name = "SessionTurnAbortedError";
  }
}
