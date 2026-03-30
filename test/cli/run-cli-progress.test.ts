import assert from "node:assert/strict";
import test from "node:test";

import { ReviewRunInterruptedError, type ReviewRunSummary } from "../../src/core/orchestrator.ts";
import { CliProgressReporter } from "../../src/cli/progress-reporter.ts";
import { runCli } from "../../src/index.ts";

test("runCli finalizes a live TTY progress surface before printing the completed-run summary", async () => {
  const stdout = createFakeStdout();
  const stderr: string[] = [];
  const progressReporter = new CliProgressReporter({ stdout });

  const exitCode = await runCli(["main", "feature-branch"], {
    progressReporter,
    app: {
      async run() {
        emitReviewingProgress(progressReporter);
        return createCompletedRunResult();
      }
    },
    stdout,
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 0);
  assert.equal(stdout.writes.at(-1), "\u001b[2K\r");
  assert.equal(stderr.length, 0);
  assert.match(stdout.logs.at(-1) ?? "", /^Review run completed\./u);
});

test("runCli finalizes a live TTY progress surface before printing a fatal error", async () => {
  const stdout = createFakeStdout();
  const stderr: string[] = [];
  const progressReporter = new CliProgressReporter({ stdout });

  const exitCode = await runCli(["main", "feature-branch"], {
    progressReporter,
    app: {
      async run() {
        emitReviewingProgress(progressReporter);
        throw new Error("summary write failed");
      }
    },
    stdout,
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.writes.at(-1), "\u001b[2K\r");
  assert.equal(stderr[0], "summary write failed");
  assert.ok(stdout.logs.every((line) => !line.startsWith("Review run completed.")));
});

test("runCli finalizes a live TTY progress surface before printing an interrupt error", async () => {
  const stdout = createFakeStdout();
  const stderr: string[] = [];
  const progressReporter = new CliProgressReporter({ stdout });

  const exitCode = await runCli(["main", "feature-branch"], {
    progressReporter,
    app: {
      async run() {
        emitReviewingProgress(progressReporter);
        throw new ReviewRunInterruptedError("SIGINT");
      }
    },
    stdout,
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 130);
  assert.equal(stdout.writes.at(-1), "\u001b[2K\r");
  assert.equal(stderr[0], "Review run interrupted by SIGINT.");
  assert.ok(stdout.logs.every((line) => !line.startsWith("Review run completed.")));
});

test("runCli rejects mismatched stdout and progressReporter writers to preserve a single writer boundary", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    progressReporter: new CliProgressReporter({ stdout: createFakeStdout() }),
    stdout: {
      log() {},
      write() {
        return true;
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 1);
  assert.equal(
    stderr[0],
    "CliRuntime stdout and progressReporter must share the same writer."
  );
});

function emitReviewingProgress(progressReporter: CliProgressReporter): void {
  progressReporter.handleEvent({ type: "phase-changed", phase: "step0" });
  progressReporter.handleEvent({
    type: "run-initialized",
    repoRoot: "/workspace/repo",
    outputTarget: {
      basePath: "/workspace/repo/.nightowl/review/feature-branch_03131430",
      changesetOverviewPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/changeset-overview.md",
      filesPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/files",
      skippedPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/skipped.md",
      summaryPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/summary.md",
      indexPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/index.md",
      manifestPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/manifest.json",
      toolAuditPath: "/workspace/repo/.nightowl/review/feature-branch_03131430/tool-audit.jsonl"
    },
    plannedFileCount: 2
  });
  progressReporter.handleEvent({ type: "phase-changed", phase: "reviewing" });
  progressReporter.handleEvent({ type: "file-claimed", filePath: "src/app.ts", claimOrder: 1 });
  progressReporter.handleEvent({ type: "file-progressed", filePath: "src/app.ts", stepId: "step1-overview" });
}

function createCompletedRunResult(): ReviewRunSummary {
  const basePath = "/workspace/repo/.nightowl/review/feature-branch_03131430";

  return {
    repoRoot: "/workspace/repo",
    runContext: {
      changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
      userContext: []
    },
    outputTarget: {
      basePath,
      changesetOverviewPath: `${basePath}/changeset-overview.md`,
      filesPath: `${basePath}/files`,
      skippedPath: `${basePath}/skipped.md`,
      summaryPath: `${basePath}/summary.md`,
      indexPath: `${basePath}/index.md`,
      manifestPath: `${basePath}/manifest.json`,
      toolAuditPath: `${basePath}/tool-audit.jsonl`
    },
    plannedFileCount: 2,
    successfulFileCount: 1,
    skippedFileCount: 1,
    dryRun: false
  };
}

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