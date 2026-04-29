export class ReviewRunInterruptedError extends Error {
  readonly signal: "SIGINT" | "SIGTERM" | undefined;

  constructor(signal?: "SIGINT" | "SIGTERM") {
    super("Run interrupted by external signal.");
    this.name = "ReviewRunInterruptedError";
    this.signal = signal;
  }
}
