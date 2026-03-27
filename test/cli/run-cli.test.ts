import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import {
  ReviewRunInterruptedError,
  type ReviewRunSummary
} from "../../src/core/orchestrator.ts";
import type { RunRequest } from "../../src/core/run-request.ts";
import { runCli } from "../../src/index.ts";

type ReviewRunSummaryOverrides = Partial<Omit<ReviewRunSummary, "outputTarget">> & {
  outputTarget?: Partial<ReviewRunSummary["outputTarget"]>;
};

test("runCli forwards parsed input to the app boundary once", async () => {
  const seenRequests: RunRequest[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(
    [
      "main",
      "feature-branch",
      "--repo",
      "./demo",
      "--context",
      "release-note"
    ],
    {
      app: {
        async run(request) {
          seenRequests.push(request);

          return createCompletedRunResult({
            plannedFileCount: 1,
            successfulFileCount: 1,
            skippedFileCount: 0
          });
        }
      },
      stdout: {
        log(message) {
          stdout.push(String(message));
        }
      },
      stderr: {
        error(message) {
          stderr.push(String(message));
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(seenRequests, [
    {
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./demo",
      userContext: ["release-note"]
    }
  ]);
  assert.deepEqual(stdout, [renderExpectedSummary(createCompletedRunResult({
    plannedFileCount: 1,
    successfulFileCount: 1,
    skippedFileCount: 0
  }))]);
  assert.deepEqual(stderr, []);
});

test("runCli reports a usage error when head_ref is missing", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(["main"], {
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join("\n"), /head_ref/i);
  assert.match(stderr.join("\n"), /review <base_ref> <head_ref>/i);
});

test("runCli reports zero planned files as a successful summary", async () => {
  const result = createCompletedRunResult({
    plannedFileCount: 0,
    successfulFileCount: 0,
    skippedFileCount: 0
  });
  const { exitCode, stdout, stderr } = await runCliWithResult(result);

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [renderExpectedSummary(result)]);
  assert.deepEqual(stderr, []);
});

test("runCli reports an all-skipped run as a successful completed summary", async () => {
  const result = createCompletedRunResult({
    plannedFileCount: 2,
    successfulFileCount: 0,
    skippedFileCount: 2
  });
  const { exitCode, stdout, stderr } = await runCliWithResult(result);

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [renderExpectedSummary(result)]);
  assert.deepEqual(stderr, []);
});

test("runCli prints the published completed-run summary contract from the app result", async () => {
  const result = createCompletedRunResult({
    plannedFileCount: 2,
    successfulFileCount: 1,
    skippedFileCount: 1
  });
  const { exitCode, stdout, stderr } = await runCliWithResult(result);

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [renderExpectedSummary(result)]);
  assert.deepEqual(stderr, []);
  assert.match(stdout[0], /Files: \/workspace\/repo\/review\/feature-branch_03131430\/files/u);
  assert.match(stdout[0], /Index: \/workspace\/repo\/review\/feature-branch_03131430\/index\.md/u);
  assert.match(stdout[0], /Manifest: \/workspace\/repo\/review\/feature-branch_03131430\/manifest\.json/u);
  assert.match(stdout[0], /Skipped: \/workspace\/repo\/review\/feature-branch_03131430\/skipped\.md/u);
});

test("runCli prints artifact paths directly from the completed-run result without reading artifacts", async () => {
  const basePath = "/definitely/not/on/disk/review/feature-branch_03131430";
  const result = createCompletedRunResult({
    plannedFileCount: 1,
    successfulFileCount: 1,
    skippedFileCount: 0,
    outputTarget: {
      basePath,
      changesetOverviewPath: `${basePath}/changeset-overview.md`,
      filesPath: `${basePath}/files`,
      skippedPath: `${basePath}/skipped.md`,
      summaryPath: `${basePath}/summary.md`,
      indexPath: `${basePath}/index.md`,
      manifestPath: `${basePath}/manifest.json`
    }
  });
  const { exitCode, stdout, stderr } = await runCliWithResult(result);

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [renderExpectedSummary(result)]);
  assert.deepEqual(stderr, []);
});

test("runCli surfaces a clear runtime error when Step 0 session startup fails", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    sourceProvider: {
      resolveRepoRoot() {
        return "/workspace/repo";
      },
      getChangedFiles() {
        throw new Error("unreachable");
      },
      getChangesetEntries() {
        throw new Error("unreachable");
      },
      getDiff() {
        throw new Error("unreachable");
      },
      getCurrentBranch() {
        throw new Error("unreachable");
      },
      filterIgnoredFiles() {
        throw new Error("unreachable");
      }
    },
    clientManager: {
      async start() {
        throw new Error("Copilot CLI is unavailable.");
      },
      async stop() {},
      async forceStop() {},
      getClient() {
        throw new Error("unreachable");
      }
    }
  });

  const exitCode = await runCli(["main", "feature-branch"], {
    app,
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join("\n"), /Copilot CLI is unavailable\./u);
});

test("runCli does not print partial completed-run counts or artifact lines on fatal runtime failure", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new Error("summary write failed");
      }
    },
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join("\n"), /summary write failed/u);
  assert.doesNotMatch(stderr.join("\n"), /Files:/u);
  assert.doesNotMatch(stderr.join("\n"), /Index:/u);
  assert.doesNotMatch(stderr.join("\n"), /Manifest:/u);
  assert.doesNotMatch(stderr.join("\n"), /Skipped:/u);
  assert.doesNotMatch(stderr.join("\n"), /Successful files:/u);
  assert.doesNotMatch(stderr.join("\n"), /Skipped files:/u);
});

test("runCli keeps fatal runs on the error path even when artifacts already exist on disk", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-run-cli-"));
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    const basePath = path.join(tempDir, "review", "feature-branch_03131430");
    mkdirSync(path.join(basePath, "files"), { recursive: true });
    writeFileSync(path.join(basePath, "files", "src__app.ts.md"), "# note\n");
    writeFileSync(path.join(basePath, "summary.md"), "# Review Summary\n");
    writeFileSync(path.join(basePath, "index.md"), "# Review Index\n");
    writeFileSync(path.join(basePath, "skipped.md"), "");

    const exitCode = await runCli(["main", "feature-branch"], {
      app: {
        async run() {
          throw new Error("index write failed");
        }
      },
      stdout: {
        log(message) {
          stdout.push(String(message));
        }
      },
      stderr: {
        error(message) {
          stderr.push(String(message));
        }
      }
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(stdout, []);
    assert.match(stderr.join("\n"), /index write failed/u);
    assert.doesNotMatch(stderr.join("\n"), /Files:/u);
    assert.doesNotMatch(stderr.join("\n"), /Summary:/u);
    assert.doesNotMatch(stderr.join("\n"), /Index:/u);
    assert.doesNotMatch(stderr.join("\n"), /Manifest:/u);
    assert.doesNotMatch(stderr.join("\n"), /Skipped:/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function runCliWithResult(result: ReviewRunSummary) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        return result;
      }
    },
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  return { exitCode, stdout, stderr };
}

function createCompletedRunResult(
  overrides: ReviewRunSummaryOverrides = {}
): ReviewRunSummary {
  const basePath = "/workspace/repo/review/feature-branch_03131430";
  const {
    outputTarget: outputTargetOverrides = {},
    ...restOverrides
  } = overrides;

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
      toolAuditPath: `${basePath}/tool-audit.jsonl`,
      ...outputTargetOverrides
    },
    plannedFileCount: 2,
    successfulFileCount: 2,
    skippedFileCount: 0,
    ...restOverrides
  };
}

function renderExpectedSummary(result: ReviewRunSummary): string {
  return [
    "Initialized local review run.",
    `Repo root: ${result.repoRoot}`,
    `Output: ${result.outputTarget.basePath}`,
    `Changeset Overview: ${result.outputTarget.changesetOverviewPath}`,
    `Files: ${result.outputTarget.filesPath}`,
    `Summary: ${result.outputTarget.summaryPath}`,
    `Index: ${result.outputTarget.indexPath}`,
    `Manifest: ${result.outputTarget.manifestPath}`,
    `Tool Audit: ${result.outputTarget.toolAuditPath}`,
    `Skipped: ${result.outputTarget.skippedPath}`,
    `Planned files: ${result.plannedFileCount}`,
    `Successful files: ${result.successfulFileCount}`,
    `Skipped files: ${result.skippedFileCount}`
  ].join("\n");
}

// ─── Task 4.1: CLI interrupted exit tests ─────────────────────────────────────

test("runCli exits with code 130 when app throws ReviewRunInterruptedError", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new ReviewRunInterruptedError();
      }
    },
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 130);
  assert.deepEqual(stdout, [], "success summary must not be printed after interrupt");
  assert.equal(stderr.length, 1, "exactly one stderr line for interrupt");
});

test("runCli prints a distinct interrupt message (not the generic error format) for ReviewRunInterruptedError", async () => {
  const stderr: string[] = [];

  await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new ReviewRunInterruptedError();
      }
    },
    stdout: { log() {} },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  const interruptMessage = stderr.join("\n");
  assert.match(interruptMessage, /interrupted/i, "interrupt message should mention interruption");
});

test("runCli interrupted message is distinct from the generic error message", async () => {
  const interruptStderr: string[] = [];
  const genericStderr: string[] = [];

  await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new ReviewRunInterruptedError();
      }
    },
    stdout: { log() {} },
    stderr: {
      error(message) {
        interruptStderr.push(String(message));
      }
    }
  });

  await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new Error("some generic step failure");
      }
    },
    stdout: { log() {} },
    stderr: {
      error(message) {
        genericStderr.push(String(message));
      }
    }
  });

  assert.notDeepEqual(
    interruptStderr,
    genericStderr,
    "interrupt stderr must differ from generic error stderr"
  );
});

test("runCli does not print success summary on interrupted run", async () => {
  const stdout: string[] = [];

  await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new ReviewRunInterruptedError();
      }
    },
    stdout: {
      log(message) {
        stdout.push(String(message));
      }
    },
    stderr: { error() {} }
  });

  assert.deepEqual(stdout, [], "stdout must be empty: no success summary on interrupt");
  assert.ok(
    stdout.every((line) => !String(line).includes("Initialized local review run.")),
    "interrupt must not produce the success header"
  );
});

test("runCli still exits with code 1 and generic message for a plain Error", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new Error("some other failure");
      }
    },
    stdout: { log() {} },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join("\n"), /some other failure/u);
});

test("runCli still exits with code 1 for CliUsageError", async () => {
  const exitCode = await runCli(["main"], {
    stdout: { log() {} },
    stderr: { error() {} }
  });

  assert.equal(exitCode, 1);
});

// ─── Task 4.1: CLI per-signal exit code mapping tests ─────────────────────────

test("runCli exits with code 130 and SIGINT-specific message when ReviewRunInterruptedError has signal === 'SIGINT'", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new ReviewRunInterruptedError("SIGINT");
      }
    },
    stdout: { log() {} },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 130);
  assert.equal(stderr[0], "Review run interrupted by SIGINT.");
});

test("runCli exits with code 143 and SIGTERM-specific message when ReviewRunInterruptedError has signal === 'SIGTERM'", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new ReviewRunInterruptedError("SIGTERM");
      }
    },
    stdout: { log() {} },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 143);
  assert.equal(stderr[0], "Review run terminated by SIGTERM.");
});

test("runCli exits with code 130 and generic message when ReviewRunInterruptedError has signal === undefined", async () => {
  const stderr: string[] = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        throw new ReviewRunInterruptedError();
      }
    },
    stdout: { log() {} },
    stderr: {
      error(message) {
        stderr.push(String(message));
      }
    }
  });

  assert.equal(exitCode, 130);
  assert.equal(stderr[0], "Review run interrupted.");
});
