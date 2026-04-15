import { SessionTurnAbortedError } from "./session-turn-aborted-error.ts";

export interface SessionRetryInput<T> {
  execute(attempt: number): Promise<T>;
  onRetry?: (attempt: number, cause: string) => void;
  buildFinalError(lastCause: string): Error;
}

/**
 * Execute an async operation with one retry.
 *
 * - `SessionTurnAbortedError` is always re-thrown immediately (no retry consumed).
 * - On first failure, `onRetry` is called (if provided; exceptions are swallowed).
 * - On second failure, `buildFinalError` produces the thrown error.
 */
export async function retryOnce<T>(input: SessionRetryInput<T>): Promise<T> {
  let lastCause: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await input.execute(attempt);
    } catch (error) {
      if (error instanceof SessionTurnAbortedError) {
        throw error;
      }

      lastCause = error instanceof Error ? error.message : String(error);

      if (attempt === 0) {
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
