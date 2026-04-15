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
 * Generic start/stop/getClient lifecycle for a Copilot client process.
 *
 * `TClient` is the full SDK client shape (must support start/stop/forceStop).
 * `TSurface` is the capability surface returned by getClient() — a subset of TClient
 * that varies per use-case (e.g. createSession for review, ping for availability).
 */
export class CopilotClientManagerBase<
  TClient extends { start(): Promise<void>; stop(): Promise<unknown>; forceStop(): Promise<unknown> },
  TSurface
> {
  readonly #createClient: () => TClient;
  readonly #extractSurface: (client: TClient) => TSurface;
  #client?: TClient;

  constructor(
    createClient: () => TClient,
    extractSurface: (client: TClient) => TSurface
  ) {
    this.#createClient = createClient;
    this.#extractSurface = extractSurface;
  }

  async start(): Promise<void> {
    if (!this.#client) {
      this.#client = this.#createClient();
    }

    await this.#client.start();
  }

  getClient(): TSurface {
    if (!this.#client) {
      throw new Error("Copilot client has not been started.");
    }

    return this.#extractSurface(this.#client);
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

/**
 * Own the single Copilot client instance for one review run.
 */
export class CopilotClientManager extends CopilotClientManagerBase<CopilotClientLike, CopilotClientLike> {
  constructor(options: CopilotClientManagerOptions = {}) {
    super(
      options.createClient ?? (() => new CopilotClient() as CopilotClientLike),
      (client) => client
    );
  }
}
