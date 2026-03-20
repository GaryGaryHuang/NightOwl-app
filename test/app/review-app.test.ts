import assert from "node:assert/strict";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("createLocalReviewRunApp fails before client startup, Step 0, and output initialization when review config is invalid", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewconfig.json", "{");

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
      outputSink: {
        initializeRun() {
          initializeRunCalls += 1;
        },
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {}
      }
    });

    await assert.rejects(
      () =>
        app.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: []
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
