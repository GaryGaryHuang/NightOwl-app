import { SessionTurnAbortedError } from "./errors.ts";

export interface SessionRetryInput<T> {
  execute(attempt: number): Promise<T>;
  onRetry?: (attempt: number, cause: string) => void;
  buildFinalError(lastCause: string): Error;
  maxAttempts?: number;
}

/**
 * Execute an async operation with a bounded retry budget.
 *
 * - `SessionTurnAbortedError` is always re-thrown immediately (no retry consumed).
 * - On every non-final failure, `onRetry` is called (if provided; exceptions are swallowed).
 * - On final failure, `buildFinalError` produces the thrown error.
 * - Defaults to two total attempts for callers that do not set `maxAttempts`.
 */
export async function retryWithLimit<T>(input: SessionRetryInput<T>): Promise<T> {
  let lastCause: string | undefined;
  const maxAttempts = input.maxAttempts ?? 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await input.execute(attempt);
    } catch (error) {
      if (error instanceof SessionTurnAbortedError) {
        throw error;
      }

      lastCause = error instanceof Error ? error.message : String(error);

      if (attempt < maxAttempts - 1) {
        try {
          input.onRetry?.(attempt, lastCause);
        } catch {
          // onRetry is a side-channel notification only
        }
      }
    }
  }

  throw input.buildFinalError(lastCause ?? "retry exhausted");
}
