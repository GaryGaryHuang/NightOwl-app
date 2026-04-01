import { CopilotClient, type SessionConfig } from "@github/copilot-sdk";

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

export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop(): Promise<unknown>;
  createSession(config: SessionConfig): Promise<SessionLike>;
}

export interface CopilotClientManagerOptions {
  createClient?: () => CopilotClientLike;
}

/**
 * Own the single Copilot client instance for one review run.
 */
export class CopilotClientManager {
  readonly #createClient: () => CopilotClientLike;
  #client?: CopilotClientLike;

  constructor(options: CopilotClientManagerOptions = {}) {
    this.#createClient = options.createClient ?? (() => new CopilotClient());
  }

  async start(): Promise<void> {
    if (!this.#client) {
      this.#client = this.#createClient();
    }

    await this.#client.start();
  }

  getClient(): CopilotClientLike {
    if (!this.#client) {
      throw new Error("Copilot client has not been started.");
    }

    return this.#client;
  }

  async stop(): Promise<void> {
    if (!this.#client) {
      return;
    }

    await this.#client.stop();
  }

  async forceStop(): Promise<void> {
    if (!this.#client) {
      return;
    }

    await this.#client.forceStop();
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
