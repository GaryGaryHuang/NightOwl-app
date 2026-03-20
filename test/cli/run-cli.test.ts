import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  const result = createCompletedRunResult({
    plannedFileCount: 2,
    successfulFileCount: 2,
    skippedFileCount: 0
  });
  const { exitCode, stdout, stderr } = await runCliWithResult(result);

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [renderExpectedSummary(result)]);
  assert.deepEqual(stderr, []);
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

test("runCli prints the exact completed-run artifact surface line order", async () => {
  const result = createCompletedRunResult({
    plannedFileCount: 3,
    successfulFileCount: 1,
    skippedFileCount: 2
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

test("runCli prints the complete deterministic artifact surface from the completed-run result", async () => {
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
      filesPath: `${basePath}/files`,
      skippedPath: `${basePath}/skipped.md`,
      summaryPath: `${basePath}/summary.md`,
      indexPath: `${basePath}/index.md`
    }
  });
  const { exitCode, stdout, stderr } = await runCliWithResult(result);

  assert.equal(exitCode, 0);
  assert.deepEqual(stdout, [renderExpectedSummary(result)]);
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

test("runCli does not print partial completed-run counts or artifact lines on fatal runtime failure", async () => {
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
  assert.doesNotMatch(stderr.join("\n"), /Files:/u);
  assert.doesNotMatch(stderr.join("\n"), /Index:/u);
  assert.doesNotMatch(stderr.join("\n"), /Skipped:/u);
  assert.doesNotMatch(stderr.join("\n"), /Successful files:/u);
  assert.doesNotMatch(stderr.join("\n"), /Skipped files:/u);
});

test("runCli keeps fatal runs on the error path even when artifacts already exist on disk", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-run-cli-"));
  const stdout = [];
  const stderr = [];

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
    assert.doesNotMatch(stderr.join("\n"), /Skipped:/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

async function runCliWithResult(result) {
  const stdout = [];
  const stderr = [];
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

function createCompletedRunResult(overrides = {}) {
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
      filesPath: `${basePath}/files`,
      skippedPath: `${basePath}/skipped.md`,
      summaryPath: `${basePath}/summary.md`,
      indexPath: `${basePath}/index.md`,
      ...outputTargetOverrides
    },
    plannedFileCount: 2,
    successfulFileCount: 2,
    skippedFileCount: 0,
    ...restOverrides
  };
}

function renderExpectedSummary(result) {
  return [
    "Initialized local review run.",
    `Repo root: ${result.repoRoot}`,
    `Output: ${result.outputTarget.basePath}`,
    `Files: ${result.outputTarget.filesPath}`,
    `Summary: ${result.outputTarget.summaryPath}`,
    `Index: ${result.outputTarget.indexPath}`,
    `Skipped: ${result.outputTarget.skippedPath}`,
    `Planned files: ${result.plannedFileCount}`,
    `Successful files: ${result.successfulFileCount}`,
    `Skipped files: ${result.skippedFileCount}`
  ].join("\n");
}
