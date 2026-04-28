import {
  createLocalReviewRunApp,
  formatLocalReviewRunSummary,
  type ReviewApp
} from "./app/review-app.ts";
import { CliProgressReporter, type CliProgressStdout } from "./cli/progress-reporter.ts";
import { CliUsageError, parseReviewCommand } from "./cli/parser.ts";
import type { RunRequest } from "./core/run-request.ts";
import { ReviewRunInterruptedError } from "./core/orchestrator.ts";
import {
  CopilotAvailabilityChecker
} from "./services/copilot-availability-checker.ts";

interface AvailabilityChecker {
  check(): Promise<void>;
}

export interface CliRuntime {
  app?: ReviewApp;
  availabilityChecker?: AvailabilityChecker;
  progressReporter?: CliProgressReporter;
  stdout?: CliProgressStdout;
  stderr?: Pick<typeof console, "error">;
  workingDirectory?: string;
}

interface ResolvedCliRuntime {
  app: ReviewApp;
  availabilityChecker: AvailabilityChecker;
  progressReporter: CliProgressReporter;
  stdout: CliProgressStdout;
  stderr: Pick<typeof console, "error">;
}

/**
 * Thin CLI entrypoint: parse args, run the app, and translate failures into exit codes.
 *
 * progressReporter.finalize() is invoked once in the finally block. It is
 * idempotent and clears any pending TTY live line before stdout/stderr writes
 * complete in the surrounding shell.
 */
export async function runCli(
  argv: string[],
  runtime: CliRuntime = {}
): Promise<number> {
  let resolvedRuntime: ResolvedCliRuntime | undefined;

  try {
    resolvedRuntime = createDefaultCliRuntime(runtime);
    const command = parseReviewCommand(argv);

    if (command.kind === "check") {
      await resolvedRuntime.availabilityChecker.check();
      resolvedRuntime.stdout.log("GitHub Copilot is available.");
      return 0;
    }

    const request = command.request;
    resolvedRuntime.stdout.log(formatStartupFeedback(request));
    const result = await resolvedRuntime.app.run(request);
    resolvedRuntime.stdout.log(formatLocalReviewRunSummary(result));
    return 0;
  } catch (error) {
    const stderr = resolvedRuntime?.stderr ?? runtime.stderr ?? console;

    if (error instanceof CliUsageError) {
      stderr.error(error.message);
      return 1;
    }

    if (error instanceof ReviewRunInterruptedError) {
      if (error.signal === "SIGTERM") {
        stderr.error("Review run terminated by SIGTERM.");
        return 143;
      }
      if (error.signal === "SIGINT") {
        stderr.error("Review run interrupted by SIGINT.");
        return 130;
      }
      stderr.error("Review run interrupted.");
      return 130;
    }

    const message =
      error instanceof Error ? error.message : "NightOwl CLI failed unexpectedly.";
    stderr.error(message);
    return 2;
  } finally {
    resolvedRuntime?.progressReporter.finalize();
  }
}

/**
 * Build the production runtime, while letting tests inject fakes.
 */
export function createDefaultCliRuntime(
  runtime: CliRuntime = {}
): ResolvedCliRuntime {
  const stdout = runtime.progressReporter?.stdout ?? runtime.stdout ?? createProcessCliStdout();
  const progressReporter = runtime.progressReporter ?? new CliProgressReporter({ stdout });

  return {
    app:
      runtime.app ??
      createLocalReviewRunApp({
        workingDirectory: runtime.workingDirectory ?? process.cwd(),
        onProgressEvent(event) {
          progressReporter.handleEvent(event);
        }
      }),
    availabilityChecker:
      runtime.availabilityChecker ?? new CopilotAvailabilityChecker(),
    progressReporter,
    stdout,
    stderr: runtime.stderr ?? console
  };
}

function formatStartupFeedback(request: RunRequest): string {
  const prefix = request.dryRun ? "[DRY RUN] " : "";
  return `${prefix}Starting review run for ${request.baseRef}...${request.headRef}.`;
}

function createProcessCliStdout(): CliProgressStdout {
  return {
    isTTY: process.stdout.isTTY,
    columns: process.stdout.columns,
    log(message) {
      process.stdout.write(`${String(message)}\n`);
    },
    write(chunk) {
      return process.stdout.write(chunk);
    }
  };
}
