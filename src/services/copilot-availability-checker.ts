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
  stop(): Promise<readonly Error[]>;
  forceStop(): Promise<unknown>;
}

interface CopilotAvailabilityClientManagerLike {
  start(): Promise<void>;
  stop(): Promise<readonly Error[]>;
  forceStop(): Promise<unknown>;
  getClient(): CopilotAvailabilityProbeLike;
}

export interface CopilotAvailabilityCheckerOptions {
  clientManager?: CopilotAvailabilityClientManagerLike;
}

class CopilotAvailabilityClientManager
  extends CopilotClientManagerBase<CopilotAvailabilityClientLike, CopilotAvailabilityProbeLike>
  implements CopilotAvailabilityClientManagerLike {

  constructor() {
    super(
      () => new CopilotClient() as CopilotAvailabilityClientLike,
      (client) => client
    );
  }
}

export class CopilotAvailabilityChecker {
  readonly #clientManager: CopilotAvailabilityClientManagerLike;

  constructor(options: CopilotAvailabilityCheckerOptions = {}) {
    this.#clientManager =
      options.clientManager ?? new CopilotAvailabilityClientManager();
  }

  async check(): Promise<void> {
    let hasPrimaryError = false;

    try {
      await this.#clientManager.start();
      await this.#clientManager.getClient().ping("health check");
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      try {
        const cleanupErrors = await stopClientManagerWithTimeout(
          this.#clientManager,
          DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS
        );
        if (!hasPrimaryError && cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            `Copilot cleanup completed with ${cleanupErrors.length} diagnostic error(s).`
          );
        }
      } catch (cleanupError) {
        if (!hasPrimaryError) {
          throw cleanupError;
        }
      }
    }
  }
}
