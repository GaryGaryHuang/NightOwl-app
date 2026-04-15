export class SessionTurnAbortedError extends Error {
  constructor() {
    super("Session turn aborted by run-level interrupt.");
    this.name = "SessionTurnAbortedError";
  }
}
