import assert from "node:assert/strict";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { runCli } from "../../src/index.ts";

test("runCli forwards parsed input to the app boundary once", async () => {
  const seenRequests = [];
  const stdout = [];
  const stderr = [];

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
          return {
            repoRoot: "/workspace/repo",
            runContext: {
              changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
              userContext: ["release-note"]
            },
            outputTarget: {
              basePath: "/workspace/repo/review/feature-branch_03131430",
              filesPath: "/workspace/repo/review/feature-branch_03131430/files",
              skippedPath:
                "/workspace/repo/review/feature-branch_03131430/skipped.md",
              summaryPath:
                "/workspace/repo/review/feature-branch_03131430/summary.md"
            },
            plannedFileCount: 1,
            successfulFileCount: 1,
            skippedFileCount: 0
          };
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
  assert.deepEqual(stdout, [
    [
      "Initialized local review run.",
      "Repo root: /workspace/repo",
      "Output: /workspace/repo/review/feature-branch_03131430",
      "Summary: /workspace/repo/review/feature-branch_03131430/summary.md",
      "Planned files: 1",
      "Successful files: 1",
      "Skipped files: 0"
    ].join("\n")
  ]);
  assert.deepEqual(stderr, []);
});

test("runCli reports a usage error when head_ref is missing", async () => {
  const stdout = [];
  const stderr = [];

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

test("runCli prints the prepared-run summary from the app result", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        return {
          repoRoot: "/workspace/repo",
          runContext: {
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          },
          outputTarget: {
            basePath: "/workspace/repo/review/feature-branch_03131430",
            filesPath: "/workspace/repo/review/feature-branch_03131430/files",
            skippedPath:
              "/workspace/repo/review/feature-branch_03131430/skipped.md",
            summaryPath:
              "/workspace/repo/review/feature-branch_03131430/summary.md"
          },
          plannedFileCount: 2,
          successfulFileCount: 2,
          skippedFileCount: 0
        };
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

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    [
      "Initialized local review run.",
      "Repo root: /workspace/repo",
      "Output: /workspace/repo/review/feature-branch_03131430",
      "Summary: /workspace/repo/review/feature-branch_03131430/summary.md",
      "Planned files: 2",
      "Successful files: 2",
      "Skipped files: 0"
    ].join("\n")
  ]);
  assert.deepEqual(stderr, []);
});

test("runCli reports zero planned files as a successful summary", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        return {
          repoRoot: "/workspace/repo",
          runContext: {
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          },
          outputTarget: {
            basePath: "/workspace/repo/review/feature-branch_03131430",
            filesPath: "/workspace/repo/review/feature-branch_03131430/files",
            skippedPath:
              "/workspace/repo/review/feature-branch_03131430/skipped.md",
            summaryPath:
              "/workspace/repo/review/feature-branch_03131430/summary.md"
          },
          plannedFileCount: 0,
          successfulFileCount: 0,
          skippedFileCount: 0
        };
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

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    [
      "Initialized local review run.",
      "Repo root: /workspace/repo",
      "Output: /workspace/repo/review/feature-branch_03131430",
      "Summary: /workspace/repo/review/feature-branch_03131430/summary.md",
      "Planned files: 0",
      "Successful files: 0",
      "Skipped files: 0"
    ].join("\n")
  ]);
  assert.deepEqual(stderr, []);
});

test("runCli prints the exact completed-run summary line order", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        return {
          repoRoot: "/workspace/repo",
          runContext: {
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          },
          outputTarget: {
            basePath: "/workspace/repo/review/feature-branch_03131430",
            filesPath: "/workspace/repo/review/feature-branch_03131430/files",
            skippedPath:
              "/workspace/repo/review/feature-branch_03131430/skipped.md",
            summaryPath:
              "/workspace/repo/review/feature-branch_03131430/summary.md"
          },
          plannedFileCount: 3,
          successfulFileCount: 1,
          skippedFileCount: 2
        };
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

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    [
      "Initialized local review run.",
      "Repo root: /workspace/repo",
      "Output: /workspace/repo/review/feature-branch_03131430",
      "Summary: /workspace/repo/review/feature-branch_03131430/summary.md",
      "Planned files: 3",
      "Successful files: 1",
      "Skipped files: 2"
    ].join("\n")
  ]);
  assert.deepEqual(stderr, []);
});

test("runCli reports an all-skipped run as a successful completed summary", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        return {
          repoRoot: "/workspace/repo",
          runContext: {
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          },
          outputTarget: {
            basePath: "/workspace/repo/review/feature-branch_03131430",
            filesPath: "/workspace/repo/review/feature-branch_03131430/files",
            skippedPath:
              "/workspace/repo/review/feature-branch_03131430/skipped.md",
            summaryPath:
              "/workspace/repo/review/feature-branch_03131430/summary.md"
          },
          plannedFileCount: 2,
          successfulFileCount: 0,
          skippedFileCount: 2
        };
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

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    [
      "Initialized local review run.",
      "Repo root: /workspace/repo",
      "Output: /workspace/repo/review/feature-branch_03131430",
      "Summary: /workspace/repo/review/feature-branch_03131430/summary.md",
      "Planned files: 2",
      "Successful files: 0",
      "Skipped files: 2"
    ].join("\n")
  ]);
  assert.deepEqual(stderr, []);
});

test("runCli keeps the existing success summary shape even when the run result includes indexPath", async () => {
  const stdout = [];
  const stderr = [];

  const exitCode = await runCli(["main", "feature-branch"], {
    app: {
      async run() {
        return {
          repoRoot: "/workspace/repo",
          runContext: {
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          },
          outputTarget: {
            basePath: "/workspace/repo/review/feature-branch_03131430",
            filesPath: "/workspace/repo/review/feature-branch_03131430/files",
            skippedPath:
              "/workspace/repo/review/feature-branch_03131430/skipped.md",
            summaryPath:
              "/workspace/repo/review/feature-branch_03131430/summary.md",
            indexPath:
              "/workspace/repo/review/feature-branch_03131430/index.md"
          },
          plannedFileCount: 2,
          successfulFileCount: 1,
          skippedFileCount: 1
        };
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

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [
    [
      "Initialized local review run.",
      "Repo root: /workspace/repo",
      "Output: /workspace/repo/review/feature-branch_03131430",
      "Summary: /workspace/repo/review/feature-branch_03131430/summary.md",
      "Planned files: 2",
      "Successful files: 1",
      "Skipped files: 1"
    ].join("\n")
  ]);
  assert.deepEqual(stderr, []);
  assert.doesNotMatch(stdout[0], /Index:/u);
});

test("runCli surfaces a clear runtime error when Step 0 session startup fails", async () => {
  const stdout = [];
  const stderr = [];
  const app = createLocalReviewRunApp({
    workingDirectory: "/workspace/repo",
    clientManager: {
      async start() {
        throw new Error("Copilot CLI is unavailable.");
      },
      async stop() {},
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

test("runCli does not print partial completed-run counts on fatal runtime failure", async () => {
  const stdout = [];
  const stderr = [];

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
  assert.doesNotMatch(stderr.join("\n"), /Successful files:/u);
  assert.doesNotMatch(stderr.join("\n"), /Skipped files:/u);
});
