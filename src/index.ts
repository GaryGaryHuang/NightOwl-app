import {
  createLocalReviewRunApp,
  type ReviewApp
} from "./app/review-app.ts";
import { formatLocalReviewRunSummary } from "./cli/format-run-summary.ts";
import { CliProgressReporter, type CliProgressStdout } from "./cli/progress-reporter.ts";
import { CliUsageError, parseReviewCommand } from "./cli/parser.ts";
import { ReviewRunInterruptedError } from "./core/orchestrator.ts";
import {
  CopilotAuthRunner,
  type CopilotAuthRunnerLike
} from "./services/copilot-auth-runner.ts";
import { CopilotAvailabilityChecker } from "./services/copilot-availability-checker.ts";

export interface CliRuntime {
  app?: ReviewApp;
  authRunner?: CopilotAuthRunnerLike;
  availabilityChecker?: { check(): Promise<void> };
  progressReporter?: CliProgressReporter;
  stdout?: CliProgressStdout;
  stderr?: Pick<typeof console, "error">;
  workingDirectory?: string;
}

export async function runCli(
  argv: string[],
  runtime: CliRuntime = {}
): Promise<number> {
  const stderr = runtime.stderr ?? console;
  let progressReporter = runtime.progressReporter;

  try {
    const command = parseReviewCommand(argv);
    const stdout =
      progressReporter?.stdout ?? runtime.stdout ?? createProcessCliStdout();

    if (command.kind === "check") {
      const availabilityChecker =
        runtime.availabilityChecker ?? new CopilotAvailabilityChecker();
      await availabilityChecker.check();
      stdout.log("GitHub Copilot is available.");
      return 0;
    }

    if (command.kind === "auth") {
      const authRunner =
        runtime.authRunner ??
        new CopilotAuthRunner({
          stdout
        });
      await authRunner.run(command.action);
      return 0;
    }

    const request = command.request;
    let app = runtime.app;
    if (app === undefined) {
      progressReporter ??= new CliProgressReporter({ stdout });
      const reviewProgressReporter = progressReporter;
      app = createLocalReviewRunApp({
        workingDirectory: runtime.workingDirectory ?? process.cwd(),
        onProgressEvent(event) {
          reviewProgressReporter.handleEvent(event);
        }
      });
    }

    const prefix = request.dryRun ? "[DRY RUN] " : "";
    stdout.log(
      `${prefix}Starting review run for ${request.baseRef}...${request.headRef}.`
    );
    const result = await app.run(request);
    stdout.log(formatLocalReviewRunSummary(result));
    return 0;
  } catch (error) {
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
    progressReporter?.finalize();
  }
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
