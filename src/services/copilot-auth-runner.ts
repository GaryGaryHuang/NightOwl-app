import { spawn } from "node:child_process";

import {
  CopilotClient,
  RuntimeConnection,
  type GetAuthStatusResponse
} from "@github/copilot-sdk";

import {
  CopilotClientManagerBase,
  buildCopilotClientEnvironment
} from "./copilot-client-manager.ts";
import {
  DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  stopClientManagerWithTimeout
} from "./copilot-client-shutdown.ts";
import { resolveCopilotCliPath } from "./copilot-runtime-resolver.ts";

export type CopilotAuthAction = "login" | "status";

export interface CopilotAuthRunnerLike {
  run(action: CopilotAuthAction): Promise<void>;
}

export interface CopilotAuthRunnerSpawnOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  stdio: "inherit";
}

export interface SpawnedCopilotAuthProcess {
  once(
    event: "error",
    listener: (error: Error) => void
  ): SpawnedCopilotAuthProcess;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): SpawnedCopilotAuthProcess;
}

export interface CopilotAuthStatusClientLike {
  start(): Promise<void>;
  stop(): Promise<readonly Error[]>;
  forceStop(): Promise<unknown>;
  getAuthStatus(): Promise<GetAuthStatusResponse>;
}

interface CopilotAuthRunnerOptions {
  env?: NodeJS.ProcessEnv;
  nodeExecutable?: string;
  stdout?: Pick<typeof console, "log">;
  workingDirectory?: string;
  createStatusClient?: () => CopilotAuthStatusClientLike;
  spawnProcess?: (
    command: string,
    args: string[],
    options: CopilotAuthRunnerSpawnOptions
  ) => SpawnedCopilotAuthProcess;
}

export class CopilotAuthRunner implements CopilotAuthRunnerLike {
  readonly #env: NodeJS.ProcessEnv;
  readonly #nodeExecutable: string;
  readonly #stdout: Pick<typeof console, "log">;
  readonly #workingDirectory: string;
  readonly #createStatusClient: () => CopilotAuthStatusClientLike;
  readonly #spawnProcess: (
    command: string,
    args: string[],
    options: CopilotAuthRunnerSpawnOptions
  ) => SpawnedCopilotAuthProcess;

  constructor(options: CopilotAuthRunnerOptions = {}) {
    this.#env = options.env ?? process.env;
    this.#nodeExecutable = options.nodeExecutable ?? process.execPath;
    this.#stdout = options.stdout ?? console;
    this.#workingDirectory = options.workingDirectory ?? process.cwd();
    this.#createStatusClient =
      options.createStatusClient ??
      (() =>
        new CopilotClient({
          connection: RuntimeConnection.forStdio({
            path: resolveCopilotCliPath({ env: this.#env })
          }),
          env: buildCopilotClientEnvironment(this.#env)
        }) as CopilotAuthStatusClientLike);
    this.#spawnProcess =
      options.spawnProcess ??
      ((command, args, spawnOptions) =>
        spawn(command, args, spawnOptions) as SpawnedCopilotAuthProcess);
  }

  async run(action: CopilotAuthAction): Promise<void> {
    if (action === "status") {
      await this.#runStatus();
      return;
    }

    const runtimePath = resolveCopilotCliPath({ env: this.#env });
    const runtimeArgs = [action];
    const command = runtimePath.endsWith(".js") ? this.#nodeExecutable : runtimePath;
    const args = runtimePath.endsWith(".js")
      ? [runtimePath, ...runtimeArgs]
      : runtimeArgs;
    const child = this.#spawnProcess(command, args, {
      cwd: this.#workingDirectory,
      env: buildCopilotClientEnvironment(this.#env),
      stdio: "inherit"
    });

    await waitForAuthProcess(child, action);
  }

  async #runStatus(): Promise<void> {
    const clientManager = new CopilotClientManagerBase(
      this.#createStatusClient,
      (client) => client
    );
    let hasPrimaryError = false;

    try {
      await clientManager.start();
      const status = await clientManager.getClient().getAuthStatus();
      this.#stdout.log(formatAuthStatus(status));
    } catch (error) {
      hasPrimaryError = true;
      throw error;
    } finally {
      try {
        const cleanupErrors = await stopClientManagerWithTimeout(
          clientManager,
          DEFAULT_GRACEFUL_SHUTDOWN_TIMEOUT_MS
        );
        if (!hasPrimaryError && cleanupErrors.length > 0) {
          throw new AggregateError(
            cleanupErrors,
            `Copilot auth status cleanup completed with ${cleanupErrors.length} diagnostic error(s).`
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

function formatAuthStatus(status: GetAuthStatusResponse): string {
  if (!status.isAuthenticated) {
    const detail = status.statusMessage ? ` ${status.statusMessage}` : "";
    throw new Error(`GitHub Copilot is not authenticated.${detail}`);
  }

  const lines = ["GitHub Copilot is authenticated."];
  if (status.login) {
    lines.push(`Login: ${status.login}`);
  }
  if (status.host) {
    lines.push(`Host: ${status.host}`);
  }
  if (status.authType) {
    lines.push(`Auth type: ${status.authType}`);
  }
  if (status.statusMessage) {
    lines.push(`Status: ${status.statusMessage}`);
  }

  return lines.join("\n");
}

function waitForAuthProcess(
  child: SpawnedCopilotAuthProcess,
  action: CopilotAuthAction
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(
          new Error(`GitHub Copilot auth ${action} was terminated by ${signal}.`)
        );
        return;
      }

      reject(
        new Error(
          `GitHub Copilot auth ${action} failed with exit code ${code ?? "unknown"}.`
        )
      );
    });
  });
}
