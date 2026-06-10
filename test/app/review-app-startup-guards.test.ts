import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { isChangesetOverviewSystemMessage } from "../helpers/review-app-fixture.ts";

test("createLocalReviewRunApp preserves default Copilot session behavior when modelProvider is omitted", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const sessionConfigs: SessionConfig[] = [];
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
              sessionConfigs.push(config);
              throw new Error("abort after first session config");
            }
          };
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishArtifact() {}
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
      /abort after first session config/u
    );

    const changesetOverviewConfig = sessionConfigs.find((config) =>
      isChangesetOverviewSystemMessage(config.systemMessage)
    );
    assert.ok(changesetOverviewConfig, "Changeset Overview session should be attempted");
    assert.equal(changesetOverviewConfig.model, "gpt-5.4-mini");
    assert.equal(changesetOverviewConfig.reasoningEffort, undefined);
    assert.equal(changesetOverviewConfig.provider, undefined);
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp passes repo BYOK modelProvider to real review sessions", async () => {
  const fixture = createReviewRepoFixture();
  const previousApiKey = process.env.NIGHTOWL_TEST_OPENAI_API_KEY;

  try {
    process.env.NIGHTOWL_TEST_OPENAI_API_KEY = "sk-test";
    fixture.writeFile(
      ".nightowl/reviewconfig.json",
      JSON.stringify({
        modelProvider: {
          kind: "byok",
          type: "openai",
          baseUrl: "https://llm-gateway.example.com/v1",
          model: "company-review",
          apiKeyEnv: "NIGHTOWL_TEST_OPENAI_API_KEY"
        }
      })
    );
    fixture.commitAll("add byok review config");

    const sessionConfigs: SessionConfig[] = [];
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
              sessionConfigs.push(config);
              throw new Error("abort after first BYOK session config");
            }
          };
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishArtifact() {}
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
      /abort after first BYOK session config/u
    );

    const changesetOverviewConfig = sessionConfigs.find((config) =>
      isChangesetOverviewSystemMessage(config.systemMessage)
    );
    assert.ok(changesetOverviewConfig, "Changeset Overview session should be attempted");
    assert.equal(changesetOverviewConfig.model, "company-review");
    assert.deepEqual(changesetOverviewConfig.provider, {
      type: "openai",
      baseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-test"
    });
    assert.equal(changesetOverviewConfig.reasoningEffort, undefined);
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.NIGHTOWL_TEST_OPENAI_API_KEY;
    } else {
      process.env.NIGHTOWL_TEST_OPENAI_API_KEY = previousApiKey;
    }
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp fails before client startup, Changeset Overview, and output initialization when review config is invalid", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewconfig.json", "{");
    fixture.commitAll("add invalid review config");

    let startCalls = 0;
    let stopCalls = 0;
    let changesetOverviewCalls = 0;
    let initializeRunCalls = 0;
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {
          startCalls += 1;
        },
        async stop() {
          stopCalls += 1;
          return [];
        },
        async forceStop() {},
        getClient() {
          throw new Error("unused");
        }
      },
      changesetOverviewRunner: {
        async run() {
          changesetOverviewCalls += 1;
          throw new Error("should not start changesetOverview");
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          initializeRunCalls += 1;
          return this;
        },
        async publishFileReview() {},
        async publishArtifact() {}
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
    assert.equal(changesetOverviewCalls, 0);
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
        async stop() { return []; },
        async forceStop() {},
        getClient() {
          return {
            async start() {},
            async stop() { return []; },
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
        async publishArtifact() {}
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

    // The Changeset Overview (Changeset Overview) session config should contain the injected API key.
    const changesetOverviewConfig = sessionConfigs.find((c) => isChangesetOverviewSystemMessage(c.systemMessage));
    assert.ok(changesetOverviewConfig, "a Changeset Overview session config must be present");
    assert.equal(
      (changesetOverviewConfig.mcpServers?.context7 as { headers?: Record<string, string> } | undefined)
        ?.headers?.CONTEXT7_API_KEY,
      "injected-test-key",
      "injected context7ApiKey must appear in session config headers"
    );
  } finally {
    fixture.cleanup();
  }
});
