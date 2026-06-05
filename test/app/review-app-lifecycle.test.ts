import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { ReviewRunInterruptedError } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { buildSessionResponse } from "../helpers/review-app-fixture.ts";

/**
 * App-level lifecycle smoke only.
 *
 * Detailed shutdown ordering, signal listener cleanup, graceful timeout, and
 * stop()/forceStop() error propagation are owned by:
 *   - test/app/run-lifecycle-manager.test.ts
 *   - test/services/copilot-client-shutdown.test.ts
 *
 * This suite verifies only that createLocalReviewRunApp composes the lifecycle
 * manager with the orchestrator so that:
 *   1. A process signal during a run surfaces as ReviewRunInterruptedError
 *      with the signal identity, and clientManager.stop() is invoked.
 *   2. The composition root wires through to a successful real-fixture run
 *      with on-disk tool-audit.jsonl creation.
 */

function createSignalTestApp(options: {
  stopCalls: string[];
  onReviewBasis?: () => void;
}) {
  const TEST_FILES = ["src/app.ts", "packages/app/index.ts"];

  return createLocalReviewRunApp({
    workingDirectory: "/tmp/signal-test",
    clientManager: {
      async start() {},
      async stop() {
        options.stopCalls.push("stop");
        return [];
      },
      async forceStop() {
        options.stopCalls.push("forceStop");
      },
      getClient() {
        throw new Error("unused");
      }
    },
    sourceProvider: {
      async resolveRepoRoot(startPath: string) {
        return startPath;
      },
      async getChangesetEntries() {
        return TEST_FILES.map((path) => ({ status: "M" as const, path }));
      },
      async getCurrentBranch() {
        return "feature-branch";
      },
      async getChangedFiles() {
        return TEST_FILES;
      },
      async getDiff() {
        return "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
      }
    },
    reviewFileFilter: {
      async filterReviewableFiles(_repoRoot: string, files: string[]) {
        return files;
      }
    },
    reviewSourceSnapshotProvider: {
      async createSnapshot() {
        return {
          originalRepoRoot: "/tmp/signal-test",
          reviewSourceRoot: "/tmp/signal-test",
          resolvedBaseRef: "main",
          resolvedHeadRef: "feature-branch",
          isDirty: false,
          async cleanup() {}
        };
      }
    },
    outputSink: defineOutputSinkDouble({
      async initializeRun() {
        return this;
      },
      async publishFileReview() {},
      async publishArtifact() {}
    }),
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: stubChangeMap("## Changeset\n- test")
        });
      }
    },
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "review-basis") {
          options.onReviewBasis?.();
        }
        return {
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

test("createLocalReviewRunApp surfaces a process signal during a run as ReviewRunInterruptedError and invokes clientManager.stop()", async () => {
  const stopCalls: string[] = [];
  let sigintFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onReviewBasis() {
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
  assert.deepEqual(stopCalls, ["stop"], "clientManager.stop() must be called after interruption");
});

test("createLocalReviewRunApp creates tool-audit.jsonl at outputTarget.toolAuditPath after a successful run", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {},
        async stop() { return []; },
        async forceStop() {},
        getClient() {
          return {
            async start() {},
            async stop() { return []; },
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
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature")
          });
        }
      },
      reviewConfigProvider: {
        async loadReviewConfig() {
          return {
            maxConcurrentFiles: 1,
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

test("createLocalReviewRunApp persists Changeset Overview audit records when Changeset Overview fails before output initialization", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const repoRoot = realpathSync(fixture.repoDir);
    const expectedAuditPath = path.join(
      repoRoot,
      ".nightowl",
      "review",
      "feature-branch_03241401",
      "tool-audit.jsonl"
    );
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03241401",
      clientManager: {
        async start() {},
        async stop() { return []; },
        async forceStop() {},
        getClient() {
          return {
            async start() {},
            async stop() { return []; },
            async forceStop() {},
            async createSession(config: SessionConfig) {
              await config.hooks?.onPreToolUse?.(
                {
                  sessionId: "s1",
                  timestamp: new Date(0),
                  workingDirectory: config.workingDirectory ?? repoRoot,
                  toolName: "bash",
                  toolArgs: { command: "git show HEAD:src/app.ts" }
                } as never,
                { sessionId: "s1" } as never
              );

              return {
                async sendAndWait() {
                  return { data: { content: "not-json" } };
                },
                async disconnect() {}
              };
            }
          };
        }
      }
    });

    await assert.rejects(
      () =>
        app.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: [],
          dryRun: false
        }),
      /Changeset Overview ChangeMapReadiness validation failed/u
    );

    const auditRecords = readFileSync(expectedAuditPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<{
        tool: string;
        decision: string;
        args: Record<string, string | undefined>;
      }>;

    assert.equal(auditRecords.length, 2);
    for (const record of auditRecords) {
      assert.equal(record.tool, "bash");
      assert.equal(record.decision, "allow");
      assert.deepEqual(record.args, { command: "git show HEAD:src/app.ts" });
    }
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp persists Changeset Overview audit records when changeset overview publish fails after output initialization", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const repoRoot = realpathSync(fixture.repoDir);
    const expectedAuditPath = path.join(
      repoRoot,
      ".nightowl",
      "review",
      "feature-branch_03241402",
      "tool-audit.jsonl"
    );
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03241402",
      clientManager: {
        async start() {},
        async stop() { return []; },
        async forceStop() {},
        getClient() {
          return {
            async start() {},
            async stop() { return []; },
            async forceStop() {},
            async createSession(config: SessionConfig) {
              await config.hooks?.onPreToolUse?.(
                {
                  sessionId: "s1",
                  timestamp: new Date(0),
                  workingDirectory: config.workingDirectory ?? repoRoot,
                  toolName: "bash",
                  toolArgs: { command: "git show HEAD:src/app.ts" }
                } as never,
                { sessionId: "s1" } as never
              );

              return {
                async sendAndWait() {
                  return { data: { content: buildValidChangesetOverviewChangeMapJson() } };
                },
                async disconnect() {}
              };
            }
          };
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          mkdirSync(outputPlan.outputTarget.basePath, { recursive: true });
          mkdirSync(outputPlan.outputTarget.filesPath, { recursive: true });
          writeFileSync(outputPlan.outputTarget.toolAuditPath, "");
          return this;
        },
        async publishFileReview() {},
        async publishArtifact(kind) {
          if (kind === "changeset-overview") {
            throw new Error("changeset overview write failed");
          }
        }
      })
    });

    await assert.rejects(
      () =>
        app.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: [],
          dryRun: false
        }),
      /changeset overview write failed/u
    );

    const auditRecords = readFileSync(expectedAuditPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)) as Array<{
        tool: string;
        decision: string;
        args: Record<string, string | undefined>;
      }>;

    assert.equal(auditRecords.length, 1);
    for (const record of auditRecords) {
      assert.equal(record.tool, "bash");
      assert.equal(record.decision, "allow");
      assert.deepEqual(record.args, { command: "git show HEAD:src/app.ts" });
    }
  } finally {
    fixture.cleanup();
  }
});

function buildValidChangesetOverviewChangeMapJson(): string {
  const paths = [
    "dist/app.js",
    "obsolete.txt",
    "packages/app/index.ts",
    "src/app.ts"
  ];

  return JSON.stringify({
    reviewObjective: {
      summary: "Test review context.",
      requestedFocus: [],
      expectedBehaviorSummary: []
    },
    userBehavior: [],
    missingInformation: [],
    overviewMarkdown: "## Changeset Overview\n- 調整範圍：feature",
    behaviorChanges: [
      {
        description: "review flow updates shared run context",
        files: paths,
      }
    ]
  });
}
