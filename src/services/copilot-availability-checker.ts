import { CopilotClient } from "@github/copilot-sdk";

import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  stopClientManagerWithTimeout
} from "./copilot-client-shutdown.ts";

interface CopilotAvailabilityProbeLike {
  ping(message?: string): Promise<{ message: string; timestamp: number }>;
}

interface CopilotAvailabilityClientLike extends CopilotAvailabilityProbeLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop(): Promise<unknown>;
}

interface CopilotAvailabilityClientManagerLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  forceStop(): Promise<unknown>;
  getClient(): CopilotAvailabilityProbeLike;
}

interface CopilotAvailabilityClientManagerOptions {
  createClient?: () => CopilotAvailabilityClientLike;
}

export interface CopilotAvailabilityCheckerOptions {
  clientManager?: CopilotAvailabilityClientManagerLike;
  gracefulShutdownTimeoutMs?: number;
  pingMessage?: string;
}

class CopilotAvailabilityClientManager
  implements CopilotAvailabilityClientManagerLike {
  readonly #createClient: () => CopilotAvailabilityClientLike;
  #client?: CopilotAvailabilityClientLike;

  constructor(options: CopilotAvailabilityClientManagerOptions = {}) {
    this.#createClient = options.createClient ?? (() => new CopilotClient());
  }

  async start(): Promise<void> {
    if (!this.#client) {
      this.#client = this.#createClient();
    }

    await this.#client.start();
  }

  getClient(): CopilotAvailabilityProbeLike {
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

export class CopilotAvailabilityChecker {
  readonly #clientManager: CopilotAvailabilityClientManagerLike;
  readonly #gracefulShutdownTimeoutMs: number;
  readonly #pingMessage: string;

  constructor(options: CopilotAvailabilityCheckerOptions = {}) {
    this.#clientManager =
      options.clientManager ?? new CopilotAvailabilityClientManager();
    this.#gracefulShutdownTimeoutMs =
      options.gracefulShutdownTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
    this.#pingMessage = options.pingMessage ?? "health check";
  }

  async check(): Promise<void> {
    let primaryError: unknown;

    try {
      await this.#clientManager.start();
      await this.#clientManager.getClient().ping(this.#pingMessage);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await stopClientManagerWithTimeout(
          this.#clientManager,
          this.#gracefulShutdownTimeoutMs
        );
      } catch (cleanupError) {
        if (!primaryError) {
          throw cleanupError;
        }
      }
    }
  }
}