import { CopilotClient } from "@github/copilot-sdk";

import { CopilotClientManagerBase } from "./copilot-client-manager.ts";
import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  stopClientManagerWithTimeout
} from "./copilot-client-shutdown.ts";

interface CopilotAvailabilityProbeLike {
  ping(message?: string): Promise<{ message: string; timestamp: string }>;
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
  extends CopilotClientManagerBase<CopilotAvailabilityClientLike, CopilotAvailabilityProbeLike>
  implements CopilotAvailabilityClientManagerLike {

  constructor(options: CopilotAvailabilityClientManagerOptions = {}) {
    super(
      options.createClient ?? (() => new CopilotClient() as CopilotAvailabilityClientLike),
      (client) => client
    );
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
    let hasPrimaryError = false;

    try {
      await this.#clientManager.start();
      await this.#clientManager.getClient().ping(this.#pingMessage);
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      try {
        await stopClientManagerWithTimeout(
          this.#clientManager,
          this.#gracefulShutdownTimeoutMs
        );
      } catch (cleanupError) {
        if (!hasPrimaryError) {
          throw cleanupError;
        }
      }
    }
  }
}
