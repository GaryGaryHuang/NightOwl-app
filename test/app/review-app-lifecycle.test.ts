import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp, formatLocalReviewRunSummary } from "../../src/app/review-app.ts";
import { ReviewRunInterruptedError } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { buildSessionResponse } from "../helpers/review-app-fixture.ts";

/**
 * Shared factory for signal and lifecycle tests.
 * Uses in-memory stubs for all dependencies; TEST_FILES replaces a real git
 * changeset so no on-disk repo is needed. Injection hooks (`onStep1`,
 * `stopImpl`, `forceStopImpl`, etc.) let individual tests assert or trigger
 * side-effects at specific lifecycle points.
 */
function createSignalTestApp(options: {
  stopCalls: string[];
  onStep1?: () => void;
  step0ShouldThrow?: boolean;
  step0Error?: Error;
  startError?: Error;
  stopImpl?: () => Promise<void>;
  forceStopImpl?: () => Promise<void>;
  gracefulShutdownTimeoutMs?: number;
}) {
  const TEST_FILES = ["src/app.ts", "packages/app/index.ts"];

  return createLocalReviewRunApp({
    workingDirectory: "/tmp/signal-test",
    gracefulShutdownTimeoutMs: options.gracefulShutdownTimeoutMs,
    clientManager: {
      async start() {
        if (options.startError) {
          throw options.startError;
        }
      },
      async stop() {
        options.stopCalls.push("stop");
        await options.stopImpl?.();
      },
      async forceStop() {
        options.stopCalls.push("forceStop");
        await options.forceStopImpl?.();
      },
      getClient() {
        throw new Error("unused");
      }
    },
    sourceProvider: {
      resolveRepoRoot(startPath: string) {
        return startPath;
      },
      getChangesetEntries() {
        return TEST_FILES;
      },
      getCurrentBranch() {
        return "feature-branch";
      },
      getChangedFiles() {
        return TEST_FILES;
      },
      getDiff() {
        return "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
      }
    },
    reviewFileFilter: {
      filterReviewableFiles(_repoRoot: string, files: string[]) {
        return files;
      }
    },
    outputSink: {
      initializeRun() {
        return this;
      },
      publishFileReview() {},
      publishSkippedFile() {},
      publishRunSummary() {},
      publishReviewIndex() {},
      publishRunManifest() {},
      publishChangesetOverview() {}
    },
    changesetOverviewRunner: {
      async run() {
        if (options.step0Error) {
          throw options.step0Error;
        }

        if (options.step0ShouldThrow) {
          throw new Error("step0 fatal error in test");
        }
        return createRunContext({
          changesetOverview: "## Changeset\n- test",
          userContext: []
        });
      }
    },
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          options.onStep1?.();
        }
        return {
          stepId: step.stepId,
          applyTo(_ctx: unknown) {}
        };
      }
    }
  });
}

const SIGNAL_TEST_REQUEST = {
  baseRef: "main",
  headRef: "feature-branch",
  repoPath: ".",
  userContext: [],
  dryRun: false
};

test("createLocalReviewRunApp SIGINT during run propagates ReviewRunInterruptedError to caller", async () => {
  const stopCalls: string[] = [];
  let sigintFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!sigintFired) {
        sigintFired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.deepEqual(stopCalls, ["stop"], "clientManager.stop() must be called after interruption");
});

test("createLocalReviewRunApp SIGTERM during run propagates ReviewRunInterruptedError to caller", async () => {
  const stopCalls: string[] = [];
  let sigtermFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!sigtermFired) {
        sigtermFired = true;
        process.emit("SIGTERM", "SIGTERM");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.deepEqual(stopCalls, ["stop"], "clientManager.stop() must be called after SIGTERM");
});

// ─── Signal identity propagation ────────────────────────────────────────────

test("createLocalReviewRunApp SIGINT during run produces ReviewRunInterruptedError with signal === 'SIGINT'", async () => {
  const stopCalls: string[] = [];
  let sigintFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!sigintFired) {
        sigintFired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGINT"
  );
});

test("createLocalReviewRunApp SIGTERM during run produces ReviewRunInterruptedError with signal === 'SIGTERM'", async () => {
  const stopCalls: string[] = [];
  let sigtermFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!sigtermFired) {
        sigtermFired = true;
        process.emit("SIGTERM", "SIGTERM");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGTERM"
  );
});

// ─── First-signal-wins ──────────────────────────────────────────────────────

test("createLocalReviewRunApp first signal wins when SIGINT then SIGTERM arrive in quick succession", async () => {
  const stopCalls: string[] = [];
  let fired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!fired) {
        fired = true;
        process.emit("SIGINT", "SIGINT");
        process.emit("SIGTERM", "SIGTERM");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError && err.signal === "SIGINT"
  );
});

test("createLocalReviewRunApp removes SIGINT and SIGTERM handlers after normal run completion", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  const app = createSignalTestApp({
    stopCalls,
    async stopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before stop() on normal completion"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before stop() on normal completion"
      );
    }
  });

  await app.run(SIGNAL_TEST_REQUEST);

  assert.equal(
    process.listenerCount("SIGINT"),
    sigintBefore,
    "SIGINT listener should be removed after normal completion"
  );
  assert.equal(
    process.listenerCount("SIGTERM"),
    sigtermBefore,
    "SIGTERM listener should be removed after normal completion"
  );
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp removes SIGINT and SIGTERM handlers after a run error", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  const app = createSignalTestApp({
    stopCalls,
    step0ShouldThrow: true,
    async stopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before stop() after error"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before stop() after error"
      );
    }
  });

  await assert.rejects(() => app.run(SIGNAL_TEST_REQUEST));

  assert.equal(
    process.listenerCount("SIGINT"),
    sigintBefore,
    "SIGINT listener should be removed after error"
  );
  assert.equal(
    process.listenerCount("SIGTERM"),
    sigtermBefore,
    "SIGTERM listener should be removed after error"
  );
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp removes SIGINT and SIGTERM handlers after an interrupted run", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  let fired = false;

  const app = createSignalTestApp({
    stopCalls,
    async stopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before stop() after interruption"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before stop() after interruption"
      );
    },
    onStep1() {
      if (!fired) {
        fired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );

  assert.equal(
    process.listenerCount("SIGINT"),
    sigintBefore,
    "SIGINT listener should be removed after interruption"
  );
  assert.equal(
    process.listenerCount("SIGTERM"),
    sigtermBefore,
    "SIGTERM listener should be removed after interruption"
  );
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp calls clientManager.stop() on normal completion", async () => {
  const stopCalls: string[] = [];
  const app = createSignalTestApp({ stopCalls });

  await app.run(SIGNAL_TEST_REQUEST);

  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp calls clientManager.stop() when run throws a non-signal error", async () => {
  const stopCalls: string[] = [];
  const app = createSignalTestApp({ stopCalls, step0ShouldThrow: true });

  await assert.rejects(() => app.run(SIGNAL_TEST_REQUEST));

  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp keeps the successful summary when stop() resolves before the graceful shutdown timeout", async () => {
  const stopCalls: string[] = [];
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1, // 1 ms deadline; sleep(0) resolves within it
    async stopImpl() {
      await sleep(0);
    }
  });

  const summary = await app.run(SIGNAL_TEST_REQUEST);

  assert.equal(summary.repoRoot, "/tmp/signal-test");
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp falls back to clientManager.forceStop() after a successful run when stop() exceeds the graceful shutdown timeout", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before forceStop() on normal completion"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before forceStop() on normal completion"
      );
    }
  });

  const summary = await app.run(SIGNAL_TEST_REQUEST);

  assert.equal(summary.repoRoot, "/tmp/signal-test");
  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
  assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp preserves ReviewRunInterruptedError when forceStop() follows a timed-out stop()", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  let sigintFired = false;
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before forceStop() after interruption"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before forceStop() after interruption"
      );
    },
    onStep1() {
      if (!sigintFired) {
        sigintFired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );

  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
  assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp preserves the original run error when forceStop() follows a timed-out stop()", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  const runError = new Error("step0 fatal error in test");
  const app = createSignalTestApp({
    stopCalls,
    step0Error: runError,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before forceStop() after error"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before forceStop() after error"
      );
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === runError
  );

  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
  assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp surfaces a fast stop() rejection without calling forceStop()", async () => {
  const stopCalls: string[] = [];
  const stopError = new Error("stop failed fast");
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      throw stopError;
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === stopError
  );

  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp surfaces a forceStop() rejection instead of the original run outcome", async () => {
  const stopCalls: string[] = [];
  const forceStopError = new Error("forceStop failed");
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      throw forceStopError;
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === forceStopError
  );

  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp skips stop() and forceStop() when client startup fails", async () => {
  const stopCalls: string[] = [];
  const startError = new Error("client start failed");
  const app = createSignalTestApp({
    stopCalls,
    startError
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === startError
  );

  assert.deepEqual(stopCalls, []);
});

// ---------------------------------------------------------------------------
// Composition root wiring — tool-audit.jsonl integration
// ---------------------------------------------------------------------------

test("createLocalReviewRunApp creates tool-audit.jsonl at outputTarget.toolAuditPath after a successful run", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {},
        async stop() {},
        async forceStop() {},
        getClient() {
          return {
            async start() {},
            async stop() {},
            async forceStop() {},
            async createSession(config: SessionConfig) {
              return {
                async sendAndWait({ prompt }: { prompt: string }) {
                  return { data: { content: buildSessionResponse(config, prompt) } };
                },
                async disconnect() {}
              };
            }
          };
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      reviewConfigProvider: {
        loadReviewConfig() {
          return {
            maxConcurrentFiles: 1,
            confidenceThresholds: { must: 80, nice: 90 },
            mcpServers: {}
          };
        }
      },
      outputSink: new LocalWorkspaceProvider(),
      timestampProvider: () => "03241400"
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.ok(
      result.outputTarget.toolAuditPath.endsWith("tool-audit.jsonl"),
      "toolAuditPath must end with tool-audit.jsonl"
    );
    assert.ok(
      existsSync(result.outputTarget.toolAuditPath),
      `tool-audit.jsonl must exist at ${result.outputTarget.toolAuditPath}`
    );
  } finally {
    fixture.cleanup();
  }
});

// ─── formatLocalReviewRunSummary: reduced CLI summary contract ──────────────

test("formatLocalReviewRunSummary keeps only completion counts in the final CLI summary", () => {
  const basePath = "/workspace/.nightowl/review/feature-branch_03131430";
  const result = {
    repoRoot: "/workspace/repo",
    runContext: { changesetOverview: "## Changeset Overview", userContext: [] },
    outputTarget: {
      basePath,
      changesetOverviewPath: `${basePath}/changeset-overview.md`,
      filesPath: `${basePath}/files`,
      summaryPath: `${basePath}/summary.md`,
      indexPath: `${basePath}/index.md`,
      manifestPath: `${basePath}/manifest.json`,
      skippedPath: `${basePath}/skipped.md`,
      toolAuditPath: `${basePath}/tool-audit.jsonl`
    },
    plannedFileCount: 1,
    successfulFileCount: 1,
    skippedFileCount: 0,
    dryRun: false
  };

  const output = formatLocalReviewRunSummary(result);
  const lines = output.split("\n");

  assert.deepEqual(lines, [
    "Review run completed.",
    "Planned files: 1",
    "Successful files: 1",
    "Skipped files: 0"
  ]);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
