import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { formatLocalReviewRunSummary } from "../../src/cli/format-run-summary.ts";
import {
  ReviewRunInterruptedError,
  type ReviewRunSummary
} from "../../src/core/orchestrator.ts";
import type { RunRequest } from "../../src/core/run-request.ts";
import {
  createDefaultCliRuntime,
  runCli,
  type CliRuntime
} from "../../src/index.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { createOutputTarget } from "../helpers/completed-run-finalizer-contract-fixture.ts";

const DEFAULT_ARGV = ["main", "feature-branch"];
const BASE_REVIEW_PATH =
  "/workspace/repo/.nightowl/review/feature-branch_03131430";
const REPO_ROOT = "/workspace/repo";

// Allows per-test overrides of a completed run result while keeping
// `outputTarget` partially overridable without having to specify every field.
type ReviewRunSummaryOverrides = Partial<Omit<ReviewRunSummary, "outputTarget">> & {
  outputTarget?: Partial<ReviewRunSummary["outputTarget"]>;
};

type CliRuntimeWithoutWriters = Omit<CliRuntime, "stdout" | "stderr">;

test("runCli forwards parsed input including dry-run mode to the app boundary", async () => {
  const cases = [
    {
      name: "normal run with --repo and --context",
      argv: ["main", "feature-branch", "--repo", "./demo", "--context", "release-note"],
      dryRun: false,
      expectedRequest: {
        baseRef: "main",
        headRef: "feature-branch",
        repoPath: "./demo",
        userContext: ["release-note"],
        dryRun: false
      }
    },
    {
      name: "dry-run mode",
      argv: ["main", "feature-branch", "--dry-run"],
      dryRun: true,
      expectedRequest: {
        baseRef: "main",
        headRef: "feature-branch",
        userContext: [],
        dryRun: true
      }
    }
  ];

  for (const { name, argv, dryRun, expectedRequest } of cases) {
    const seenRequests: RunRequest[] = [];
    const result = createCompletedRunResult({
      dryRun,
      plannedFileCount: 1,
      successfulFileCount: 1,
      skippedFileCount: 0
    });

    const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
      argv,
      {
        app: {
          async run(request) {
            seenRequests.push(request);
            return result;
          }
        }
      }
    );

    assert.equal(exitCode, 0, name);
    assert.deepEqual(seenRequests, [expectedRequest], name);
    assert.equal(stdout[0], renderExpectedStartup(dryRun), name);
    assert.deepEqual(stdout, [
      renderExpectedStartup(dryRun),
      formatLocalReviewRunSummary(result)
    ], name);
    assert.deepEqual(stderr, [], name);
  }
});

test("runCli emits startup feedback after parsing and before the app completes", async () => {
  const output = createOutputCollector();
  let resolveRun: ((result: ReviewRunSummary) => void) | undefined;
  const runResult = new Promise<ReviewRunSummary>((resolve) => {
    resolveRun = resolve;
  });

  const exitCodePromise = runCli(DEFAULT_ARGV, {
    app: {
      async run() {
        return runResult;
      }
    },
    stdout: output.stdoutWriter,
    stderr: output.stderrWriter
  });

  await Promise.resolve();

  assert.equal(output.stdout.length, 1, "startup feedback should be visible before app completion");
  assert.match(output.stdout[0] ?? "", /main/u);
  assert.match(output.stdout[0] ?? "", /feature-branch/u);
  assert.notEqual(output.stdout[0], "Review run completed.");
  assert.deepEqual(output.stderr, []);

  const result = createCompletedRunResult({
    plannedFileCount: 1,
    successfulFileCount: 1,
    skippedFileCount: 0
  });
  resolveRun?.(result);

  const exitCode = await exitCodePromise;

  assert.equal(exitCode, 0);
  assert.deepEqual(output.stdout, [
    renderExpectedStartup(),
    formatLocalReviewRunSummary(result)
  ]);
});

test("createDefaultCliRuntime uses a writable process-backed stdout when no stdout override is provided", () => {
  const runtime = createDefaultCliRuntime({
    app: {
      async run() {
        throw new Error("unused");
      }
    }
  });

  assert.equal(typeof runtime.stdout.log, "function");
  assert.equal(typeof runtime.stdout.write, "function");
  assert.equal(runtime.stdout.isTTY, process.stdout.isTTY);
  assert.equal(runtime.progressReporter.stdout, runtime.stdout);
});

test("runCli startup feedback stays distinct from the completed-run success header", async () => {
  const result = createCompletedRunResult({
    plannedFileCount: 1,
    successfulFileCount: 1,
    skippedFileCount: 0
  });
  const { exitCode, stdout, stderr } = await runCliWithResult(result);

  assert.equal(exitCode, 0);
  assert.equal(stdout.length, 2);
  assert.notEqual(stdout[0], "Review run completed.");
  assert.match(stdout[0] ?? "", /main/u);
  assert.match(stdout[0] ?? "", /feature-branch/u);
  assert.match(stdout[1] ?? "", /^Review run completed\./u);
  assert.deepEqual(stderr, []);
});

test("runCli reports usage errors before startup feedback and app invocation", async () => {
  const cases: Array<{
    name: string;
    argv: string[];
    messagePattern: RegExp;
  }> = [
    {
      name: "missing head_ref",
      argv: ["main"],
      messagePattern: /head_ref/i
    },
    {
      name: "surplus positional input",
      argv: ["main", "feature-branch", "unexpected"],
      messagePattern: /Unexpected positional input: unexpected/u
    }
  ];

  for (const { name, argv, messagePattern } of cases) {
    const appCalls: string[] = [];
    const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(argv, {
      app: {
        async run() {
          appCalls.push("app.run");
          throw new Error("review app must not run after parser usage error");
        }
      }
    });

    assert.equal(exitCode, 1, name);
    assert.deepEqual(appCalls, [], name);
    assert.deepEqual(stdout, [], name);
    assert.match(stderr.join("\n"), messagePattern, name);
    assert.match(stderr.join("\n"), /review <base_ref> <head_ref>/u, name);
    assert.match(stderr.join("\n"), /review --check/u, name);
  }
});

test("runCli dispatches --check to the availability checker and ignores the review app", async () => {
  const calls: string[] = [];

  const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
    ["--check", "main", "feature-branch", "--dry-run"],
    {
      app: {
        async run() {
          calls.push("app.run");
          throw new Error("review app must not run in check mode");
        }
      },
      availabilityChecker: {
        async check() {
          calls.push("availabilityChecker.check");
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, ["availabilityChecker.check"]);
  assert.deepEqual(stdout, ["GitHub Copilot is available."]);
  assert.deepEqual(stderr, []);
});

test("runCli uses check mode even when argv contains malformed review-run options", async () => {
  let checkerCalls = 0;

  const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
    ["--repo", "--check", "--bogus"],
    {
      availabilityChecker: {
        async check() {
          checkerCalls += 1;
        }
      }
    }
  );

  assert.equal(exitCode, 0);
  assert.equal(checkerCalls, 1);
  assert.deepEqual(stdout, ["GitHub Copilot is available."]);
  assert.deepEqual(stderr, []);
});

test("runCli surfaces availability checker failures through the fatal error path", async () => {
  const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
    ["--check"],
    {
      availabilityChecker: {
        async check() {
          throw new Error("Copilot auth expired.");
        }
      }
    }
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(stdout, []);
  assert.match(stderr.join("\n"), /Copilot auth expired\./u);
});

test("runCli prints the completed-run summary contract from the app result", async () => {
  const cases: Array<{
    name: string;
    result: ReviewRunSummary;
  }> = [
    {
      name: "mixed successful and skipped files",
      result: createCompletedRunResult({
        plannedFileCount: 2,
        successfulFileCount: 1,
        skippedFileCount: 1
      })
    },
    {
      name: "artifact paths do not need to exist on disk",
      result: createCompletedRunResult({
        plannedFileCount: 1,
        successfulFileCount: 1,
        skippedFileCount: 0,
        outputTarget: createOutputTarget({
          basePath: "/definitely/not/on/disk/.nightowl/review/feature-branch_03131430"
        })
      })
    }
  ];

  for (const { name, result } of cases) {
    const { exitCode, stdout, stderr } = await runCliWithResult(result);

    assert.equal(exitCode, 0, name);
    assert.deepEqual(stdout, [renderExpectedStartup(), formatLocalReviewRunSummary(result)], name);
    assert.deepEqual(stderr, [], name);
  }

  const summary = formatLocalReviewRunSummary(cases[0].result);
  assert.match(summary, /Planned files: 2/u);
  assert.match(summary, /Successful files: 1/u);
  assert.match(summary, /Skipped files: 1/u);
  assert.doesNotMatch(summary, /Output:|Repo root:|Files:|Summary:|Index:|Manifest:|Tool Audit:|Skipped:/u);
});

test("runCli surfaces a clear runtime error when Changeset Overview session startup fails", async () => {
  const app = createLocalReviewRunApp({
    workingDirectory: REPO_ROOT,
    sourceProvider: {
      async resolveRepoRoot() {
        return REPO_ROOT;
      },
      async getChangedFiles() {
        throw new Error("unreachable");
      },
      async getChangesetEntries() {
        return [];
      },
      async getDiff() {
        throw new Error("unreachable");
      },
      async getCurrentBranch() {
        throw new Error("unreachable");
      }
    },
    reviewFileFilter: {
      async filterReviewableFiles() {
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

  const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
    DEFAULT_ARGV,
    { app }
  );

  assert.equal(exitCode, 2);
  assert.equal(stdout.length, 1);
  assert.match(stdout[0] ?? "", /main/u);
  assert.match(stdout[0] ?? "", /feature-branch/u);
  assert.notEqual(stdout[0], "Initialized local review run.");
  assert.match(stderr.join("\n"), /Copilot CLI is unavailable\./u);
});

test("runCli does not print partial completed-run counts or artifact lines on fatal runtime failure", async () => {
  const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
    DEFAULT_ARGV,
    {
      app: {
        async run() {
          throw new Error("index write failed");
        }
      }
    }
  );

  assert.equal(exitCode, 2);
  assert.deepEqual(stdout, [renderExpectedStartup()]);
  assert.match(stderr.join("\n"), /index write failed/u);
  assert.doesNotMatch(stderr.join("\n"), /Review run completed\.|Output:/u);
  assert.doesNotMatch(stderr.join("\n"), /Successful files:/u);
  assert.doesNotMatch(stderr.join("\n"), /Skipped files:/u);
});

test("runCli keeps fatal runs on the error path even when artifacts already exist on disk", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-run-cli-"));

  try {
    const basePath = path.join(tempDir, ".nightowl", "review", "feature-branch_03131430");
    mkdirSync(path.join(basePath, "files"), { recursive: true });
    writeFileSync(path.join(basePath, "files", "src__app.ts.md"), "# note\n");
    writeFileSync(path.join(basePath, "index.md"), "# Review Index\n");
    writeFileSync(path.join(basePath, "skipped.md"), "");

    // The CLI must not infer success from on-disk artifacts; the authoritative
    // signal is the app throwing an error or returning a summary object.
    const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
      DEFAULT_ARGV,
      {
        app: {
          async run() {
            throw new Error("index write failed");
          }
        }
      }
    );

    assert.equal(exitCode, 2);
    assert.deepEqual(stdout, [renderExpectedStartup()]);
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

test("runCli maps interrupted runs to signal-specific exit codes and messages", async () => {
  const cases: Array<{
    name: string;
    error: ReviewRunInterruptedError;
    expectedExitCode: number;
    expectedStderr: string;
  }> = [
    {
      name: "default interrupt",
      error: new ReviewRunInterruptedError(),
      expectedExitCode: 130,
      expectedStderr: "Review run interrupted."
    },
    {
      name: "SIGINT interrupt",
      error: new ReviewRunInterruptedError("SIGINT"),
      expectedExitCode: 130,
      expectedStderr: "Review run interrupted by SIGINT."
    },
    {
      name: "SIGTERM interrupt",
      error: new ReviewRunInterruptedError("SIGTERM"),
      expectedExitCode: 143,
      expectedStderr: "Review run terminated by SIGTERM."
    }
  ];

  for (const { name, error, expectedExitCode, expectedStderr } of cases) {
    const { exitCode, stdout, stderr } = await runCliWithCapturedOutput(
      DEFAULT_ARGV,
      {
        app: {
          async run() {
            throw error;
          }
        }
      }
    );

    assert.equal(exitCode, expectedExitCode, name);
    assert.deepEqual(stdout, [renderExpectedStartup()], name);
    assert.deepEqual(stderr, [expectedStderr], name);
  }
});

test("runCli exits with code 2 and generic message for an unexpected runtime error", async () => {
  const { exitCode, stderr } = await runCliWithCapturedOutput(
    DEFAULT_ARGV,
    {
      app: {
        async run() {
          throw new Error("some other failure");
        }
      }
    }
  );

  assert.equal(exitCode, 2);
  assert.match(stderr.join("\n"), /some other failure/u);
});

async function runCliWithResult(result: ReviewRunSummary) {
  return runCliWithCapturedOutput(DEFAULT_ARGV, {
    app: {
      async run() {
        return result;
      }
    }
  });
}

async function runCliWithCapturedOutput(
  argv: string[],
  runtime: CliRuntimeWithoutWriters = {}
) {
  const output = createOutputCollector();
  const exitCode = await runCli(argv, {
    ...runtime,
    stdout: output.stdoutWriter,
    stderr: output.stderrWriter
  });

  return {
    exitCode,
    stdout: output.stdout,
    stderr: output.stderr
  };
}

function createOutputCollector() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    stdoutWriter: {
      log(message: unknown) {
        stdout.push(String(message));
      }
    },
    stderrWriter: {
      error(message: unknown) {
        stderr.push(String(message));
      }
    }
  };
}

function createCompletedRunResult(
  overrides: ReviewRunSummaryOverrides = {}
): ReviewRunSummary {
  const {
    outputTarget: outputTargetOverrides = {},
    ...restOverrides
  } = overrides;

  return {
    repoRoot: REPO_ROOT,
    runContext: {
      changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
      changesetOverviewMarkdown: "## Changeset Overview\n- 調整範圍：feature\n",
      userContext: [],
      changesetFiles: []
    },
    outputTarget: {
      ...createOutputTarget({ basePath: BASE_REVIEW_PATH }),
      ...outputTargetOverrides
    },
    plannedFileCount: 2,
    successfulFileCount: 2,
    skippedFileCount: 0,
    dryRun: false,
    finalizerFailures: [],
    ...restOverrides
  };
}

function renderExpectedStartup(dryRun = false): string {
  const prefix = dryRun ? "[DRY RUN] " : "";
  return `${prefix}Starting review run for main...feature-branch.`;
}
