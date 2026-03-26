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
  disconnect(): Promise<void>;
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

  async sendAndWait(prompt: string, timeoutMs?: number): Promise<string | undefined> {
    try {
      const response = await this.#session.sendAndWait(
        { prompt },
        timeoutMs
      );
      // Treat blank assistant output as missing content so callers can retry or fail fast.
      const content = response?.data?.content?.trim();

      return content ? content : undefined;
    } finally {
      // Each executor is one-shot: release the in-memory session immediately after the exchange.
      await this.#session.disconnect();
    }
  }
}
