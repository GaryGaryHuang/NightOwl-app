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
const SESSION_ABORT_WAIT_TIMEOUT_MS = 1000;

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
    let rejectOnAbort: (() => void) | undefined;
    let sendPromise: ReturnType<SessionLike["sendAndWait"]> | undefined;
    const abortSignalPromise = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(new SessionTurnAbortedError());
    });
    const requestAbort = (): void => {
      if (state !== TurnState.Running || abortRequested) {
        return;
      }

      abortRequested = true;
      abortPromise = this.#session.abort?.().catch(() => {});
      rejectOnAbort?.();
    };

    try {
      if (signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      signal?.addEventListener("abort", requestAbort, { once: true });
      state = TurnState.Running;

      sendPromise = this.#session.sendAndWait(
        { prompt },
        timeoutMs
      );
      const response = await (signal
        ? Promise.race([sendPromise, abortSignalPromise])
        : sendPromise);
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
      if (sendPromise) {
        void sendPromise.catch(() => {});
      }
      await waitForAbortAttempt(abortPromise);
      // Each executor is one-shot: release the in-memory session immediately after the exchange.
      await this.#session.disconnect().catch(() => {});
    }
  }
}

async function waitForAbortAttempt(
  abortPromise: Promise<void> | undefined
): Promise<void> {
  if (!abortPromise) {
    return;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      abortPromise,
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(resolve, SESSION_ABORT_WAIT_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
