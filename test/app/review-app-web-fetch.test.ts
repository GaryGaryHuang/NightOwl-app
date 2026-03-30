import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { WebFetchHostnameClassifier } from "../../src/services/web-fetch-hostname-classifier.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  buildSessionResponse,
  createResolvedRedirectResolver,
  isKnowledgeSourceOfTruthSystemMessage
} from "../helpers/review-app-fixture.ts";

// Returns "allowed" for every hostname so tests can focus on the policy
// logic (URL shape, redirect chain) without coupling to the real classifier.
function createAllowingHostnameClassifier(): WebFetchHostnameClassifier {
  return {
    async classifyHostname() {
      return { kind: "allowed" };
    }
  };
}

test("createLocalReviewRunApp exposes runtime web_fetch guardrails without introducing a new step failure family", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    const sessionConfigs: SessionConfig[] = [];
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      webFetchHostnameClassifier: createAllowingHostnameClassifier(),
      webFetchRedirectResolver: createResolvedRedirectResolver(),
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

              return {
                async sendAndWait({ prompt }) {
                  return {
                    data: {
                      content: buildSessionResponse(config, prompt)
                    }
                  };
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
            confidenceThresholds: {
              must: 80,
              nice: 90
            },
            mcpServers: {}
          };
        }
      },
      outputSink: {
        initializeRun() {},
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      }
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.ok(result.plannedFileCount >= 2);
    assert.ok(result.successfulFileCount >= 1);

    // Step 3 (Knowledge & Source of Truth) is the only step that enables
    // web_fetch and installs the onPreToolUse enforcement hook.
    const reviewSessionConfig = sessionConfigs.find(
      (config) =>
        isKnowledgeSourceOfTruthSystemMessage(config.systemMessage) &&
        config.hooks?.onPreToolUse
    );
    const preToolUse = reviewSessionConfig?.hooks?.onPreToolUse;

    assert.ok(preToolUse);
    const confirmedPreToolUse = preToolUse!;
    assert.deepEqual(
      await confirmedPreToolUse(
        {
          timestamp: Date.now(),
          cwd: fixture.repoDir,
          toolName: "web_fetch",
          toolArgs: { url: "http://localhost:3000" }
        },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow web_fetch for absolute public http(s) URLs."
      }
    );
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp applies repo-local web_fetch host allowlist without introducing a new step failure family", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    const sessionConfigs: SessionConfig[] = [];
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      webFetchHostnameClassifier: createAllowingHostnameClassifier(),
      webFetchRedirectResolver: createResolvedRedirectResolver(),
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

              return {
                async sendAndWait({ prompt }) {
                  return {
                    data: {
                      content: buildSessionResponse(config, prompt)
                    }
                  };
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
            confidenceThresholds: {
              must: 80,
              nice: 90
            },
            mcpServers: {},
            webFetchAllowedHosts: ["docs.example.com"]
          };
        }
      },
      outputSink: {
        initializeRun() {},
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      }
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.ok(result.plannedFileCount >= 2);
    assert.ok(result.successfulFileCount >= 1);

    const reviewSessionConfig = sessionConfigs.find(
      (config) =>
        isKnowledgeSourceOfTruthSystemMessage(config.systemMessage) &&
        config.hooks?.onPreToolUse
    );
    const preToolUse = reviewSessionConfig?.hooks?.onPreToolUse;

    assert.ok(preToolUse);
    const confirmedPreToolUse = preToolUse!;
    assert.deepEqual(
      await confirmedPreToolUse(
        {
          timestamp: Date.now(),
          cwd: fixture.repoDir,
          toolName: "web_fetch",
          toolArgs: { url: "https://react.dev/reference" }
        },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow web_fetch for configured public http(s) hosts."
      }
    );
    assert.deepEqual(
      await confirmedPreToolUse(
        {
          timestamp: Date.now(),
          cwd: fixture.repoDir,
          toolName: "web_fetch",
          toolArgs: { url: "https://docs.example.com/guide" }
        },
        { sessionId: "session-1" }
      ),
      undefined
    );
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp applies redirect-chain host policy without introducing a new step failure family", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    const sessionConfigs: SessionConfig[] = [];
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      webFetchHostnameClassifier: createAllowingHostnameClassifier(),
      webFetchRedirectResolver: createResolvedRedirectResolver([
        new URL("https://reference.example.net/page")
      ]),
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

              return {
                async sendAndWait({ prompt }) {
                  return {
                    data: {
                      content: buildSessionResponse(config, prompt)
                    }
                  };
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
            confidenceThresholds: {
              must: 80,
              nice: 90
            },
            mcpServers: {},
            webFetchAllowedHosts: ["docs.example.com"]
          };
        }
      },
      outputSink: {
        initializeRun() {},
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      }
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.ok(result.plannedFileCount >= 2);
    assert.ok(result.successfulFileCount >= 1);

    const reviewSessionConfig = sessionConfigs.find(
      (config) =>
        isKnowledgeSourceOfTruthSystemMessage(config.systemMessage) &&
        config.hooks?.onPreToolUse
    );
    const preToolUse = reviewSessionConfig?.hooks?.onPreToolUse;

    assert.ok(preToolUse);
    const confirmedPreToolUse = preToolUse!;
    // docs.example.com is in webFetchAllowedHosts, but the redirect resolver
    // reports it chains to reference.example.net — which is not in the
    // allowlist — so the entire request is denied regardless of the origin URL.
    assert.deepEqual(
      await confirmedPreToolUse(
        {
          timestamp: Date.now(),
          cwd: fixture.repoDir,
          toolName: "web_fetch",
          toolArgs: { url: "https://docs.example.com/start" }
        },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow web_fetch for configured public http(s) hosts."
      }
    );
  } finally {
    fixture.cleanup();
  }
});
