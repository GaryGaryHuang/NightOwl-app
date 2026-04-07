import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { WebFetchHostnameClassifier } from "../../src/services/web-fetch-hostname-classifier.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
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

test("createLocalReviewRunApp exposes runtime url guardrails and legacy web_fetch alias compatibility without introducing a new step failure family", async () => {
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
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          return this;
        },
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      })
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
    // external URL retrieval and installs the onPreToolUse enforcement hook.
    const reviewSessionConfig = sessionConfigs.find(
      (config) =>
        isKnowledgeSourceOfTruthSystemMessage(config.systemMessage) &&
        config.hooks?.onPreToolUse
    );
    const preToolUse = reviewSessionConfig?.hooks?.onPreToolUse;

    assert.ok(preToolUse);
    const confirmedPreToolUse = preToolUse!;
    for (const toolName of ["web_fetch", "url"]) {
      assert.deepEqual(
        await confirmedPreToolUse(
          {
            timestamp: Date.now(),
            cwd: fixture.repoDir,
            toolName,
            toolArgs: { url: "http://localhost:3000" }
          },
          { sessionId: "session-1" }
        ),
        {
          permissionDecision: "deny",
          permissionDecisionReason:
            "Review sessions only allow fetching absolute public https URLs."
        }
      );
    }

    assert.equal(
      await confirmedPreToolUse(
        {
          timestamp: Date.now(),
          cwd: fixture.repoDir,
          toolName: "url",
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
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          return this;
        },
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      })
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
          "Review sessions only allow fetching configured public https hosts."
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

test("createLocalReviewRunApp applies host policy without redirect-chain resolution", async () => {
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
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          return this;
        },
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
      })
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
    // Redirect resolution has been removed from evaluate(). The redirect
    // resolver is injected but never called. docs.example.com is in the
    // allowlist so the request is allowed despite the resolver being
    // configured with a chain to an unlisted host.
    assert.equal(
      await confirmedPreToolUse(
        {
          timestamp: Date.now(),
          cwd: fixture.repoDir,
          toolName: "web_fetch",
          toolArgs: { url: "https://docs.example.com/start" }
        },
        { sessionId: "session-1" }
      ),
      undefined
    );

    // A host NOT in the allowlist is still denied via host policy.
    assert.deepEqual(
      await confirmedPreToolUse(
        {
          timestamp: Date.now(),
          cwd: fixture.repoDir,
          toolName: "web_fetch",
          toolArgs: { url: "https://reference.example.net/page" }
        },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow fetching configured public https hosts."
      }
    );
  } finally {
    fixture.cleanup();
  }
});
