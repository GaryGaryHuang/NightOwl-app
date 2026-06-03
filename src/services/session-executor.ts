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
export { SessionTurnAbortedError } from "../core/errors.ts";
import { SessionTurnAbortedError } from "../core/errors.ts";

const SESSION_EXECUTOR_REUSE_ERROR =
  "SessionExecutor instances are single-use; create a new executor for each turn.";
const SESSION_ABORT_WAIT_TIMEOUT_MS = 1000;
const SESSION_DISCONNECT_AFTER_ABORT_WAIT_TIMEOUT_MS = 1000;

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

    let isRunning = false;
    let abortRequested = false;
    let abortPromise: Promise<void> | undefined;
    let rejectOnAbort: (() => void) | undefined;
    let sendPromise: ReturnType<SessionLike["sendAndWait"]> | undefined;
    const abortSignalPromise = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(new SessionTurnAbortedError());
    });
    const requestAbort = (): void => {
      if (!isRunning || abortRequested) {
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
      isRunning = true;

      sendPromise = this.#session.sendAndWait(
        { prompt },
        timeoutMs
      );
      const response = await (signal
        ? Promise.race([sendPromise, abortSignalPromise])
        : sendPromise);
      isRunning = false;

      if (abortRequested || signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      // Treat blank assistant output as missing content so callers can retry or fail fast.
      const content = response?.data?.content?.trim();

      return content ? content : undefined;
    } catch (error) {
      isRunning = false;

      if (abortRequested || signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      throw error;
    } finally {
      isRunning = false;
      signal?.removeEventListener("abort", requestAbort);
      if (sendPromise) {
        void sendPromise.catch(() => {});
      }
      await waitForAbortAttempt(abortPromise);
      // Each executor is one-shot: release the in-memory session immediately after the exchange.
      await disconnectSession(this.#session, {
        signal,
        timeoutMsAfterAbort: SESSION_DISCONNECT_AFTER_ABORT_WAIT_TIMEOUT_MS
      });
    }
  }
}

async function waitForAbortAttempt(
  abortPromise: Promise<void> | undefined
): Promise<void> {
  if (!abortPromise) {
    return;
  }

  await waitWithTimeout(abortPromise, SESSION_ABORT_WAIT_TIMEOUT_MS);
}

async function disconnectSession(
  session: SessionLike,
  options: { signal?: AbortSignal; timeoutMsAfterAbort: number }
): Promise<void> {
  const disconnectPromise = session.disconnect().catch(() => {});
  const signal = options.signal;
  if (!signal) {
    await disconnectPromise;
    return;
  }

  if (signal.aborted) {
    await waitWithTimeout(disconnectPromise, options.timeoutMsAfterAbort);
    return;
  }

  let removeAbortListener: (() => void) | undefined;
  const abortDuringDisconnect = new Promise<"aborted">((resolve) => {
    const handleAbort = (): void => resolve("aborted");
    signal.addEventListener("abort", handleAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", handleAbort);
  });

  try {
    const result = await Promise.race([
      disconnectPromise.then(() => "disconnected" as const),
      abortDuringDisconnect
    ]);
    if (result === "aborted") {
      await waitWithTimeout(disconnectPromise, options.timeoutMsAfterAbort);
    }
  } finally {
    removeAbortListener?.();
  }
}

async function waitWithTimeout(
  promise: Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
