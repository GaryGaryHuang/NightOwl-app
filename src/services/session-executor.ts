export interface SessionLike {
  sendAndWait(
    options: { prompt: string },
    timeout?: number
  ): Promise<
    | {
        data?: {
          content?: string;
        };
      }
    | undefined
  >;
  abort?(): Promise<void>;
  disconnect(): Promise<void>;
}

// Re-export from its canonical home in core/ so existing consumers of this module keep working.
export { SessionTurnAbortedError } from "../core/session-turn-aborted-error.ts";
import { SessionTurnAbortedError } from "../core/session-turn-aborted-error.ts";

const TurnState = {
  Idle: 0,
  Running: 1,
  Settled: 2
} as const;
type TurnState = (typeof TurnState)[keyof typeof TurnState];

const SESSION_EXECUTOR_REUSE_ERROR =
  "SessionExecutor instances are single-use; create a new executor for each turn.";

export class SessionExecutor {
  readonly #session: SessionLike;
  #used = false;

  constructor(session: SessionLike) {
    this.#session = session;
  }

  async sendAndWait(
    prompt: string,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    if (this.#used) {
      throw new Error(SESSION_EXECUTOR_REUSE_ERROR);
    }
    this.#used = true;

    let state: TurnState = TurnState.Idle;
    let abortRequested = false;
    let abortPromise: Promise<void> | undefined;
    const requestAbort = (): void => {
      if (state !== TurnState.Running || abortRequested) {
        return;
      }

      abortRequested = true;
      abortPromise = this.#session.abort?.().catch(() => {});
    };

    try {
      if (signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      signal?.addEventListener("abort", requestAbort, { once: true });
      state = TurnState.Running;

      const response = await this.#session.sendAndWait(
        { prompt },
        timeoutMs
      );
      state = TurnState.Settled;

      if (abortRequested || signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      // Treat blank assistant output as missing content so callers can retry or fail fast.
      const content = response?.data?.content?.trim();

      return content ? content : undefined;
    } catch (error) {
      state = TurnState.Settled;

      if (abortRequested || signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      throw error;
    } finally {
      state = TurnState.Settled;
      signal?.removeEventListener("abort", requestAbort);
      await abortPromise;
      // Each executor is one-shot: release the in-memory session immediately after the exchange.
      await this.#session.disconnect().catch(() => {});
    }
  }
}
