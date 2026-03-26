import {
  createLocalReviewRunApp,
  formatLocalReviewRunSummary,
  type ReviewApp
} from "./app/review-app.ts";
import { CliUsageError, parseReviewCommand } from "./cli/parser.ts";
import { ReviewRunInterruptedError } from "./core/orchestrator.ts";

export interface CliRuntime {
  app?: ReviewApp;
  stdout?: Pick<typeof console, "log">;
  stderr?: Pick<typeof console, "error">;
  workingDirectory?: string;
}

interface ResolvedCliRuntime {
  app: ReviewApp;
  stdout: Pick<typeof console, "log">;
  stderr: Pick<typeof console, "error">;
}

/**
 * Thin CLI entrypoint: parse args, run the app, and translate failures into exit codes.
 */
export async function runCli(
  argv: string[],
  runtime: CliRuntime = {}
): Promise<number> {
  const resolvedRuntime = createDefaultCliRuntime(runtime);

  try {
    const request = parseReviewCommand(argv);
    const result = await resolvedRuntime.app.run(request);
    resolvedRuntime.stdout.log(formatLocalReviewRunSummary(result));
    return 0;
  } catch (error) {
    if (error instanceof CliUsageError) {
      resolvedRuntime.stderr.error(error.message);
      return 1;
    }

    if (error instanceof ReviewRunInterruptedError) {
      // Preserve conventional shell exit codes for signal-driven shutdowns.
      if (error.signal === "SIGTERM") {
        resolvedRuntime.stderr.error("Review run terminated by SIGTERM.");
        return 143;
      }
      if (error.signal === "SIGINT") {
        resolvedRuntime.stderr.error("Review run interrupted by SIGINT.");
        return 130;
      }
      resolvedRuntime.stderr.error("Review run interrupted.");
      return 130;
    }

    const message =
      error instanceof Error ? error.message : "NightOwl CLI failed unexpectedly.";
    resolvedRuntime.stderr.error(message);
    return 1;
  }
}

/**
 * Build the production runtime, while letting tests inject fakes.
 */
export function createDefaultCliRuntime(
  runtime: CliRuntime = {}
): ResolvedCliRuntime {
  return {
    app:
      runtime.app ??
      createLocalReviewRunApp({
        workingDirectory: runtime.workingDirectory ?? process.cwd()
      }),
    stdout: runtime.stdout ?? console,
    stderr: runtime.stderr ?? console
  };
}
