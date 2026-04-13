import assert from "node:assert/strict";
import { describe, before, after, test } from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { ReviewConfig } from "../../src/providers/review-config-provider.ts";
import type { WebFetchHostnameClassifier } from "../../src/services/web-fetch-hostname-classifier.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import {
  buildSessionResponse,
  isKnowledgeSourceOfTruthSystemMessage
} from "../helpers/review-app-fixture.ts";

type PreToolUseHook = NonNullable<NonNullable<SessionConfig["hooks"]>["onPreToolUse"]>;

// Returns "allowed" for every hostname so tests can focus on the policy
// logic (URL shape, redirect chain) without coupling to the real classifier.
function createAllowingHostnameClassifier(): WebFetchHostnameClassifier {
  return {
    async classifyHostname() {
      return { kind: "allowed" };
    }
  };
}

/**
 * Runs the full review pipeline and returns the onPreToolUse hook installed on
 * the Step 3 (Knowledge & Source of Truth) session by the tool policy guard.
 *
 * Centralises the composition-root wiring shared by all web-fetch policy
 * tests, so each test only needs to declare its policy variant and assertions.
 */
async function runPipelineAndGetPreToolUse(
  fixture: ReviewRepoFixture,
  reviewConfigOverrides: Partial<Pick<ReviewConfig, "webFetchAllowedHosts" | "webFetchDeniedHosts">> = {}
): Promise<{ preToolUse: PreToolUseHook; result: ReviewRunSummary }> {
  const sessionConfigs: SessionConfig[] = [];

  const app = createLocalReviewRunApp({
    workingDirectory: fixture.repoDir,
    webFetchHostnameClassifier: createAllowingHostnameClassifier(),
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
          mcpServers: {},
          ...reviewConfigOverrides
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

  // Step 3 (Knowledge & Source of Truth) is the only step that enables
  // external URL retrieval and installs the onPreToolUse enforcement hook.
  const step3Config = sessionConfigs.find(
    (config) =>
      isKnowledgeSourceOfTruthSystemMessage(config.systemMessage) &&
      config.hooks?.onPreToolUse
  );
  const preToolUse = step3Config?.hooks?.onPreToolUse;
  assert.ok(preToolUse, "Step 3 session must have an onPreToolUse hook installed");

  return { preToolUse, result };
}

describe("web-fetch policy: open (no allowlist)", () => {
  let fixture: ReviewRepoFixture;
  let repoDir: string;
  let preToolUse!: PreToolUseHook;

  before(async () => {
    fixture = createReviewRepoFixture();
    repoDir = fixture.repoDir;
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    const run = await runPipelineAndGetPreToolUse(fixture);
    assert.ok(run.result.plannedFileCount >= 2);
    assert.ok(run.result.successfulFileCount >= 1);
    preToolUse = run.preToolUse;
  });

  after(() => {
    fixture.cleanup();
  });

  test("non-https and localhost URLs are denied for both web_fetch and url tool names", async () => {
    for (const toolName of ["web_fetch", "url"]) {
      assert.deepEqual(
        await preToolUse(
          { timestamp: Date.now(), cwd: repoDir, toolName, toolArgs: { url: "http://localhost:3000" } },
          { sessionId: "session-1" }
        ),
        {
          permissionDecision: "deny",
          permissionDecisionReason:
            "Review sessions only allow fetching absolute public https URLs."
        }
      );
    }
  });

  test("absolute public https URL is allowed", async () => {
    assert.equal(
      await preToolUse(
        { timestamp: Date.now(), cwd: repoDir, toolName: "url", toolArgs: { url: "https://docs.example.com/guide" } },
        { sessionId: "session-1" }
      ),
      undefined
    );
  });
});

describe("web-fetch policy: host allowlist configured", () => {
  let fixture: ReviewRepoFixture;
  let repoDir: string;
  let preToolUse!: PreToolUseHook;

  before(async () => {
    fixture = createReviewRepoFixture();
    repoDir = fixture.repoDir;
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    const run = await runPipelineAndGetPreToolUse(fixture, {
      webFetchAllowedHosts: ["docs.example.com"]
    });
    assert.ok(run.result.plannedFileCount >= 2);
    assert.ok(run.result.successfulFileCount >= 1);
    preToolUse = run.preToolUse;
  });

  after(() => {
    fixture.cleanup();
  });

  test("URL in allowlist is allowed", async () => {
    assert.equal(
      await preToolUse(
        { timestamp: Date.now(), cwd: repoDir, toolName: "web_fetch", toolArgs: { url: "https://docs.example.com/guide" } },
        { sessionId: "session-1" }
      ),
      undefined
    );
  });

  test("URL not in allowlist is denied", async () => {
    assert.deepEqual(
      await preToolUse(
        { timestamp: Date.now(), cwd: repoDir, toolName: "web_fetch", toolArgs: { url: "https://react.dev/reference" } },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow fetching configured public https hosts."
      }
    );
  });

  test("deny applies to all unlisted hosts regardless of path", async () => {
    assert.deepEqual(
      await preToolUse(
        { timestamp: Date.now(), cwd: repoDir, toolName: "web_fetch", toolArgs: { url: "https://reference.example.net/page" } },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow fetching configured public https hosts."
      }
    );
  });
});
