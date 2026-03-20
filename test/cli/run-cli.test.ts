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
            plannedFileCount: 1
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
      "Planned files: 1"
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
          plannedFileCount: 2
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
      "Planned files: 2"
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
          plannedFileCount: 0
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
  assert.match(stdout.join("\n"), /Planned files: 0/u);
  assert.deepEqual(stderr, []);
});

test("runCli keeps the existing success summary shape even when the app result includes summary.md", async () => {
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
          plannedFileCount: 2
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
      "Planned files: 2"
    ].join("\n")
  ]);
  assert.deepEqual(stderr, []);
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
