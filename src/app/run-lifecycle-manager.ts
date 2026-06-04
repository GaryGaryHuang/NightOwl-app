import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  type GracefulShutdownClientManagerLike,
  stopClientManagerWithTimeout
} from "../services/copilot-client-shutdown.ts";

export interface SignalSource {
  on(signal: string, handler: () => void): void;
  off(signal: string, handler: () => void): void;
}

/**
 * Minimal slice of the TTY stdin stream used to suppress the terminal's
 * `^C` echo while a run is in progress. Satisfied by `process.stdin`.
 */
interface TtyInputSource {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(mode: boolean): void;
  isPaused(): boolean;
  on(event: "data", handler: (chunk: Buffer) => void): void;
  off(event: "data", handler: (chunk: Buffer) => void): void;
  resume(): void;
  pause(): void;
}

const ETX_BYTE = 0x03;

export interface RunLifecycleManagerOptions {
  clientManager?: GracefulShutdownClientManagerLike & {
    start(): Promise<void>;
  };
  signalSource?: SignalSource;
  ttyInput?: TtyInputSource;
  gracefulShutdownTimeoutMs?: number;
}

export class RunLifecycleManager {
  readonly #clientManager?: GracefulShutdownClientManagerLike & {
    start(): Promise<void>;
  };
  readonly #signalSource: SignalSource;
  readonly #ttyInput: TtyInputSource;
  readonly #gracefulShutdownTimeoutMs: number;

  constructor(options: RunLifecycleManagerOptions = {}) {
    this.#clientManager = options.clientManager;
    this.#signalSource = options.signalSource ?? process;
    this.#ttyInput = options.ttyInput ?? process.stdin;
    this.#gracefulShutdownTimeoutMs =
      options.gracefulShutdownTimeoutMs ?? DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  }

  async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let hasPrimaryError = false;
    const clientManager = this.#clientManager;

    if (clientManager) {
      await clientManager.start();
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

    let restoreTty: () => void = () => {};
    try {
      restoreTty = this.#suppressCtrlCEcho(handleSigint);
      return await fn(controller.signal);
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      restoreTty();
      this.#signalSource.off("SIGINT", handleSigint);
      this.#signalSource.off("SIGTERM", handleSigterm);
      if (clientManager) {
        try {
          await stopClientManagerWithTimeout(
            clientManager,
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

  /**
   * While the run is active, put the TTY into raw mode so the terminal no
   * longer echoes `^C`. Raw mode also stops the OS from synthesizing SIGINT,
   * so Ctrl+C is detected as the ETX byte on stdin and routed to the same
   * abort handler. Returns a function that restores the prior TTY state.
   */
  #suppressCtrlCEcho(onCtrlC: () => void): () => void {
    const input = this.#ttyInput;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      return () => {};
    }

    const wasRaw = input.isRaw === true;
    const wasPaused = input.isPaused();
    const handleData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        if (byte === ETX_BYTE) {
          onCtrlC();
        }
      }
    };

    const restorePriorState = (): void => {
      input.off("data", handleData);
      try {
        input.setRawMode?.(wasRaw);
      } catch {
        // Best-effort restore; nothing actionable if the terminal rejects it.
      }
      // Restore the prior flow state instead of forcing a pause, so a nested
      // (inner) run does not pause stdin out from under an outer run that is
      // still listening for Ctrl+C.
      if (wasPaused) {
        input.pause();
      }
    };

    try {
      input.setRawMode(true);
      input.on("data", handleData);
      input.resume();
    } catch {
      // Echo suppression is non-essential; if the terminal refuses raw mode,
      // roll back any partial setup and let the run proceed normally.
      restorePriorState();
      return () => {};
    }

    return restorePriorState;
  }
}
