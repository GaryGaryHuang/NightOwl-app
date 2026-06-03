import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import type { OutputTarget } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";

test("ReviewOrchestrator invokes onOutputTargetReady callback after initializeRun() and before per-file workers begin", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const callOrder: string[] = [];
    let callbackOutputTarget: OutputTarget | undefined;

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          callOrder.push("initializeRun");
          callbackOutputTarget = outputPlan.outputTarget;
          return this;
        },
        async publishFileReview() {
          callOrder.push("publishFileReview");
        },
        async publishArtifact() {}
      }),
      stepRunner: {
        async run(input) {
          callOrder.push("stepRunner.run");
          return { stepId: input.step.stepId, applyTo() {} };
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({ changesetOverview: stubChangeMap("overview") });
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
          return createRunContext({ changesetOverview: stubChangeMap("overview") });
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
        async initializeRun() {
          callOrder.push("initializeRun");
          return this;
        },
        async publishFileReview() {
          callOrder.push("publishFileReview");
        },
        async publishArtifact(kind) {
          if (kind === "changeset-overview") {
            callOrder.push("publishChangesetOverview");
          }
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
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature")
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
                    content: "unexpected response"
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
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：空")
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
    assert.equal(createSessionCalls, 0, "per-file review sessions must not be created");
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
