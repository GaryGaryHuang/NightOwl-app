import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import type { OutputTarget } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import type { StepResult } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { buildOverviewResponse } from "../helpers/orchestrator-fixture.ts";

test("ReviewOrchestrator does not initialize local output when Step 0 fails", async () => {
  const calls: string[] = [];
  const fixture = createReviewRepoFixture();

  try {
    const outputTarget = path.join(realpathSync(fixture.repoDir), ".nightowl", "review");
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          calls.push("initializeRun");
          return this;
        },
        publishFileReview() {
          calls.push("publishFileReview");
        },
        publishSkippedFile() {
          calls.push("publishSkippedFile");
        },
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      }),
      stepRunner: {
        async run() {
          throw new Error("should not reach step 1");
        }
      },
      changesetOverviewRunner: {
        async run() {
          throw new Error("Step 0 failed");
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: [],
          dryRun: false
        }),
      /Step 0 failed/u
    );

    assert.deepEqual(calls, []);
    assert.equal(existsSync(outputTarget), false);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator invokes onOutputTargetReady callback after initializeRun() and before per-file workers begin", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const callOrder: string[] = [];
    let callbackOutputTarget: OutputTarget | undefined;

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        initializeRun(outputTarget) {
          callOrder.push("initializeRun");
          callbackOutputTarget = outputTarget;
          return this;
        },
        publishFileReview() {
          callOrder.push("publishFileReview");
        },
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      }),
      stepRunner: {
        async run(input) {
          callOrder.push("stepRunner.run");
          return { stepId: input.step.stepId, applyTo() {} };
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({ changesetOverview: "overview", userContext: [] });
        }
      },
      onOutputTargetReady: (outputTarget) => {
        callOrder.push("onOutputTargetReady");
        assert.ok(
          callOrder.includes("initializeRun"),
          "onOutputTargetReady must be called after initializeRun"
        );
        assert.equal(
          callOrder.filter((c) => c === "stepRunner.run").length,
          0,
          "onOutputTargetReady must be called before any per-file step"
        );
        assert.deepEqual(outputTarget, callbackOutputTarget);
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      userContext: [],
      dryRun: false
    });

    assert.ok(callOrder.includes("onOutputTargetReady"), "callback should have been invoked");
    const initIdx = callOrder.indexOf("initializeRun");
    const cbIdx = callOrder.indexOf("onOutputTargetReady");

    assert.ok(initIdx < cbIdx, "initializeRun must precede onOutputTargetReady");
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator works normally when onOutputTargetReady callback is not provided", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: {
        async run(input) {
          return { stepId: input.step.stepId, applyTo() {} };
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({ changesetOverview: "overview", userContext: [] });
        }
      },
      // onOutputTargetReady deliberately omitted
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    // Should not throw
    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      userContext: [],
      dryRun: false
    });

    assert.ok(result.outputTarget !== undefined);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator writes changeset overview after initializeRun and before per-file bootstrap notes", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const callOrder: string[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          callOrder.push("initializeRun");
          return this;
        },
        publishFileReview() {
          callOrder.push("publishFileReview");
        },
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {
          callOrder.push("publishChangesetOverview");
        }
      }),
      stepRunner: {
        async run(input) {
          return { stepId: input.step.stepId, applyTo() {} };
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
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      userContext: [],
      dryRun: false
    });

    const initIdx = callOrder.indexOf("initializeRun");
    const overviewIdx = callOrder.indexOf("publishChangesetOverview");
    const firstBootstrapIdx = callOrder.indexOf("publishFileReview");

    assert.ok(initIdx >= 0, "initializeRun must be called");
    assert.ok(overviewIdx >= 0, "publishChangesetOverview must be called");
    assert.ok(
      initIdx < overviewIdx,
      "publishChangesetOverview must be called after initializeRun"
    );
    assert.ok(
      overviewIdx < firstBootstrapIdx,
      "publishChangesetOverview must be called before first bootstrap note"
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when publishChangesetOverview fails and does not proceed to per-file processing", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for publishChangesetOverview failure");

    const calls: string[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          calls.push("initializeRun");
          return this;
        },
        publishFileReview() {
          calls.push("publishFileReview");
        },
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {
          calls.push("publishChangesetOverview");
          throw new Error("changeset overview write failed");
        }
      }),
      stepRunner: {
        async run(): Promise<StepResult> {
          throw new Error("should not start per-file steps");
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
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: [],
          dryRun: false
        }),
      /changeset overview write failed/u
    );

    assert.ok(calls.includes("initializeRun"), "initializeRun must have been called");
    assert.ok(calls.includes("publishChangesetOverview"), "publishChangesetOverview must have been attempted");
    assert.equal(calls.filter((c) => c === "publishFileReview").length, 0, "no per-file bootstrap notes should be published");
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator writes changeset overview even for a zero-file run", async () => {
  const fixture = createReviewRepoFixture();

  try {
    // Ignore all changed files so planned file count is zero
    fixture.writeFile(".nightowl/reviewignore", "**\n");
    fixture.writeFile("README.md", "# ignored file\n");
    fixture.commitAll("add file that will be ignored");

    let createSessionCalls = 0;

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession() {
            createSessionCalls += 1;

            return new SessionExecutor({
              async sendAndWait() {
                return {
                  data: {
                    content: buildOverviewResponse("unexpected.ts")
                  }
                };
              },
              async disconnect() {}
            });
          }
        }
      }),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：空",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.equal(result.plannedFileCount, 0, "zero planned files");
    assert.equal(createSessionCalls, 0, "Step 1-7 sessions must not be created");
    assert.equal(
      existsSync(result.outputTarget.changesetOverviewPath),
      true,
      "changeset-overview.md must exist after a zero-file run"
    );
    assert.match(
      readFileSync(result.outputTarget.changesetOverviewPath, "utf8"),
      /Changeset Overview/u
    );
  } finally {
    fixture.cleanup();
  }
});
