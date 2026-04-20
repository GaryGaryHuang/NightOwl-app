import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  type GracefulShutdownClientManagerLike,
  stopClientManagerWithTimeout
} from "../services/copilot-client-shutdown.ts";

export interface SignalSource {
  on(signal: string, handler: () => void): void;
  off(signal: string, handler: () => void): void;
}

export interface RunLifecycleManagerOptions {
  clientManager?: GracefulShutdownClientManagerLike & {
    start(): Promise<void>;
  };
  signalSource?: SignalSource;
  gracefulShutdownTimeoutMs?: number;
}

export class RunLifecycleManager {
  readonly #clientManager?: GracefulShutdownClientManagerLike & {
    start(): Promise<void>;
  };
  readonly #signalSource: SignalSource;
  readonly #gracefulShutdownTimeoutMs: number;

  constructor(options: RunLifecycleManagerOptions) {
    this.#clientManager = options.clientManager;
    this.#signalSource = options.signalSource ?? process;
    this.#gracefulShutdownTimeoutMs =
      options.gracefulShutdownTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  }

  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let clientStarted = false;
    let hasPrimaryError = false;

    if (this.#clientManager) {
      await this.#clientManager.start();
      clientStarted = true;
    }

    const controller = new AbortController();
    const handleSigint = (): void => {
      controller.abort("SIGINT");
    };
    const handleSigterm = (): void => {
      controller.abort("SIGTERM");
    };

    this.#signalSource.on("SIGINT", handleSigint);
    this.#signalSource.on("SIGTERM", handleSigterm);

    try {
      return await fn(controller.signal);
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      this.#signalSource.off("SIGINT", handleSigint);
      this.#signalSource.off("SIGTERM", handleSigterm);
      if (clientStarted) {
        try {
          await stopClientManagerWithTimeout(
            this.#clientManager!,
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
}
