import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { isChangesetOverviewSystemMessage } from "../helpers/review-app-fixture.ts";

test("createLocalReviewRunApp fails before client startup, Step 0, and output initialization when review config is invalid", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewconfig.json", "{");

    let startCalls = 0;
    let stopCalls = 0;
    let step0Calls = 0;
    let initializeRunCalls = 0;
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {
          startCalls += 1;
        },
        async stop() {
          stopCalls += 1;
        },
        async forceStop() {},
        getClient() {
          throw new Error("unused");
        }
      },
      changesetOverviewRunner: {
        async run() {
          step0Calls += 1;
          throw new Error("should not start step0");
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          initializeRunCalls += 1;
          return this;
        },
        async publishFileReview() {},
        async publishSkippedFile() {},
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
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
      /invalid review config/u
    );

    assert.equal(startCalls, 0);
    assert.equal(stopCalls, 0);
    assert.equal(step0Calls, 0);
    assert.equal(initializeRunCalls, 0);
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp passes context7ApiKey option to the session config as headers.CONTEXT7_API_KEY", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const sessionConfigs: SessionConfig[] = [];

    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      context7ApiKey: "injected-test-key",
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
              sessionConfigs.push(config);
              // Abort after the first session to keep the test fast.
              throw new Error("abort after first session");
            }
          };
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishSkippedFile() {},
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
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
      /abort after first session/u
    );

    assert.ok(sessionConfigs.length >= 1, "at least one session must have been attempted");

    // The Step 0 (Changeset Overview) session config should contain the injected API key.
    const step0Config = sessionConfigs.find((c) => isChangesetOverviewSystemMessage(c.systemMessage));
    assert.ok(step0Config, "a Step 0 session config must be present");
    assert.equal(
      (step0Config.mcpServers?.context7 as { headers?: Record<string, string> } | undefined)
        ?.headers?.CONTEXT7_API_KEY,
      "injected-test-key",
      "injected context7ApiKey must appear in session config headers"
    );
  } finally {
    fixture.cleanup();
  }
});
