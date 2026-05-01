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

export function buildCopilotClientEnvironment(
  env: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  return {
    ...env,
    GIT_PAGER: "cat",
    PAGER: "cat"
  };
}

/**
 * Generic start/stop/getClient lifecycle for a Copilot client process.
 *
 * `TClient` is the full SDK client shape (must support start/stop/forceStop).
 * `TSurface` is the capability surface returned by getClient() — a subset of TClient
 * that varies per use-case (e.g. createSession for review, ping for availability).
 *
 * A client becomes visible through getClient() only after start() succeeds.
 * Lifecycle operations are serialized so overlapping calls do not orphan clients.
 * Once stop()/forceStop() completes, the manager no longer exposes that client;
 * a later start() creates a fresh instance.
 */
export class CopilotClientManagerBase<
  TClient extends { start(): Promise<void>; stop(): Promise<unknown>; forceStop(): Promise<unknown> },
  TSurface
> {
  readonly #createClient: () => TClient;
  readonly #extractSurface: (client: TClient) => TSurface;
  #lifecycleQueue: Promise<void> = Promise.resolve();
  #client?: TClient;

  constructor(
    createClient: () => TClient,
    extractSurface: (client: TClient) => TSurface
  ) {
    this.#createClient = createClient;
    this.#extractSurface = extractSurface;
  }

  async start(): Promise<void> {
    await this.#runExclusive(async () => {
      if (this.#client) {
        return;
      }

      const client = this.#createClient();
      await client.start();
      this.#client = client;
    });
  }

  getClient(): TSurface {
    if (!this.#client) {
      throw new Error("Copilot client has not been started.");
    }

    return this.#extractSurface(this.#client);
  }

  async stop(): Promise<void> {
    await this.#runExclusive(async () => {
      const client = this.#client;
      if (!client) {
        return;
      }

      await client.stop();
      if (this.#client === client) {
        this.#client = undefined;
      }
    });
  }

  async forceStop(): Promise<void> {
    await this.#runExclusive(async () => {
      const client = this.#client;
      if (!client) {
        return;
      }

      await client.forceStop();
      if (this.#client === client) {
        this.#client = undefined;
      }
    });
  }

  async #runExclusive<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const prior = this.#lifecycleQueue;
    let release!: () => void;
    this.#lifecycleQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

/**
 * Own the single Copilot client instance for one review run.
 */
export class CopilotClientManager extends CopilotClientManagerBase<CopilotClientLike, CopilotClientLike> {
  constructor(options: CopilotClientManagerOptions = {}) {
    super(
      options.createClient ??
        (() =>
          new CopilotClient({
            env: buildCopilotClientEnvironment()
          }) as CopilotClientLike),
      (client) => client
    );
  }
}
