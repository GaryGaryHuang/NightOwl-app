import assert from "node:assert/strict";
import test from "node:test";

import { CliProgressReporter } from "../../src/cli/progress-reporter.ts";
import {
  ReviewRunInterruptedError,
  type ReviewRunSummary
} from "../../src/core/orchestrator.ts";
import { runCli } from "../../src/index.ts";
import { createOutputTarget } from "../helpers/completed-run-finalizer-contract-fixture.ts";

const CLEAR_TTY_LIVE_LINE = "\u001b[2K\r";
const REVIEW_BASE_PATH =
  "/workspace/repo/.nightowl/review/feature-branch_03131430";
const REPO_ROOT = "/workspace/repo";

test("runCli finalizes a live TTY progress surface before terminal output", async () => {
  const cases: Array<{
    name: string;
    runAfterProgress(): ReviewRunSummary;
    expectedExitCode: number;
    expectedStderr: string[];
    expectsCompletedSummary: boolean;
  }> = [
    {
      name: "completed-run summary",
      runAfterProgress() {
        return createCompletedRunResult();
      },
      expectedExitCode: 0,
      expectedStderr: [],
      expectsCompletedSummary: true
    },
    {
      name: "fatal error",
      runAfterProgress() {
        throw new Error("summary write failed");
      },
      expectedExitCode: 1,
      expectedStderr: ["summary write failed"],
      expectsCompletedSummary: false
    },
    {
      name: "interrupt error",
      runAfterProgress() {
        throw new ReviewRunInterruptedError("SIGINT");
      },
      expectedExitCode: 130,
      expectedStderr: ["Review run interrupted by SIGINT."],
      expectsCompletedSummary: false
    }
  ];

  for (const scenario of cases) {
    const { exitCode, stdout, stderr } =
      await runCliWithLiveProgress(scenario.runAfterProgress);

    assert.equal(exitCode, scenario.expectedExitCode, scenario.name);
    assert.equal(stdout.writes.at(-1), CLEAR_TTY_LIVE_LINE, scenario.name);
    assert.deepEqual(stderr, scenario.expectedStderr, scenario.name);

    if (scenario.expectsCompletedSummary) {
      assert.match(
        stdout.logs.at(-1) ?? "",
        /^Review run completed\./u,
        scenario.name
      );
    } else {
      assert.ok(
        stdout.logs.every((line) => !line.startsWith("Review run completed.")),
        scenario.name
      );
    }
  }
});

async function runCliWithLiveProgress(
  runAfterProgress: () => ReviewRunSummary
): Promise<{
  exitCode: number;
  stdout: FakeStdout;
  stderr: string[];
}> {
  const stdout = createFakeStdout();
  const stderr: string[] = [];
  const progressReporter = new CliProgressReporter({ stdout });

  const exitCode = await runCli(["main", "feature-branch"], {
    progressReporter,
    app: {
      async run() {
        emitReviewingProgress(progressReporter);
        return runAfterProgress();
      }
    },
    stdout,
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  return { exitCode, stdout, stderr };
}

function emitReviewingProgress(progressReporter: CliProgressReporter): void {
  progressReporter.handleEvent({ type: "phase-changed", phase: "step0" });
  progressReporter.handleEvent({
    type: "run-initialized",
    repoRoot: REPO_ROOT,
    outputTarget: createOutputTarget({ basePath: REVIEW_BASE_PATH }),
    plannedFileCount: 2
  });
  progressReporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  progressReporter.handleEvent({
    type: "file-claimed",
    filePath: "src/app.ts",
    claimOrder: 1
  });
  progressReporter.handleEvent({
    type: "file-progressed",
    filePath: "src/app.ts",
    stepId: "step1-overview"
  });
}

function createCompletedRunResult(): ReviewRunSummary {
  return {
    repoRoot: REPO_ROOT,
    runContext: {
      changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
      userContext: []
    },
    outputTarget: createOutputTarget({ basePath: REVIEW_BASE_PATH }),
    plannedFileCount: 2,
    successfulFileCount: 1,
    skippedFileCount: 1,
    dryRun: false,
    finalizerFailures: []
  };
}

type FakeStdout = ReturnType<typeof createFakeStdout>;

function createFakeStdout() {
  return {
    isTTY: true,
    logs: [] as string[],
    writes: [] as string[],
    log(message: unknown) {
      this.logs.push(String(message));
    },
    write(chunk: string) {
      this.writes.push(String(chunk));
      return true;
    }
  };
}
