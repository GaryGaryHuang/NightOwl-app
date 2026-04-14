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

export class SessionTurnAbortedError extends Error {
  constructor() {
    super("Session turn aborted by run-level interrupt.");
    this.name = "SessionTurnAbortedError";
  }
}

export class SessionExecutor {
  readonly #session: SessionLike;

  constructor(session: SessionLike) {
    this.#session = session;
  }

  async sendAndWait(
    prompt: string,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    let turnStarted = false;
    let turnSettled = false;
    let abortRequested = false;
    let abortPromise: Promise<void> | undefined;
    const requestAbort = (): void => {
      if (!turnStarted || turnSettled || abortRequested) {
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
      turnStarted = true;

      const response = await this.#session.sendAndWait(
        { prompt },
        timeoutMs
      );
      turnSettled = true;

      if (abortRequested || signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      // Treat blank assistant output as missing content so callers can retry or fail fast.
      const content = response?.data?.content?.trim();

      return content ? content : undefined;
    } catch (error) {
      turnSettled = true;

      if (abortRequested || signal?.aborted) {
        throw new SessionTurnAbortedError();
      }

      throw error;
    } finally {
      turnSettled = true;
      signal?.removeEventListener("abort", requestAbort);
      await abortPromise;
      // Each executor is one-shot: release the in-memory session immediately after the exchange.
      await this.#session.disconnect();
    }
  }
}
