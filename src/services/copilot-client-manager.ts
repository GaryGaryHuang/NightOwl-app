import { CopilotClient, type SessionConfig } from "@github/copilot-sdk";

import type { SessionLike } from "./session-executor.ts";

export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop(): Promise<unknown>;
  createSession(config: SessionConfig): Promise<SessionLike>;
}

export interface ClientManagerLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  forceStop(): Promise<void>;
  getClient(): CopilotClientLike;
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
