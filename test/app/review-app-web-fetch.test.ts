import assert from "node:assert/strict";
import { describe, before, after, test } from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { WebFetchHostnameClassifier } from "../../src/services/tool-policy/web-fetch-hostname-classifier.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import {
  buildSessionResponse,
  isKnowledgeSourceOfTruthSystemMessage
} from "../helpers/review-app-fixture.ts";

type PreToolUseHook = NonNullable<NonNullable<SessionConfig["hooks"]>["onPreToolUse"]>;

// Returns "allowed" for every hostname so the smoke test does not depend on
// real DNS classification. Detailed classifier behaviour is owned by
// test/services/web-fetch-hostname-classifier.test.ts.
function createAllowingHostnameClassifier(): WebFetchHostnameClassifier {
  return {
    async classifyHostname() {
      return { kind: "allowed" };
    }
  };
}

/**
 * App-level wiring smoke for the web-fetch tool policy.
 *
 * Confirms that createLocalReviewRunApp installs an onPreToolUse hook on the
 * Step 3 (Knowledge & Source of Truth) session so the configured tool policy
 * actually reaches the SDK boundary.
 *
 * Detailed URL policy behaviour (https gate, allowlist/denylist semantics,
 * IP-literal handling) is owned by:
 *   - test/services/tool-policy-web-fetch-policy.test.ts
 *   - test/services/web-fetch-hostname-classifier.test.ts
 *   - test/services/web-fetch-public-address-policy.test.ts
 * Hook surface and dual SDK-permission handling is owned by:
 *   - test/services/tool-policy-guard-pre-tool-hook.test.ts
 *   - test/services/tool-policy-guard-permission-handler.test.ts
 */
describe("createLocalReviewRunApp web-fetch tool policy wiring", () => {
  let fixture: ReviewRepoFixture;
  let repoDir: string;
  let preToolUse!: PreToolUseHook;

  before(async () => {
    fixture = createReviewRepoFixture();
    repoDir = fixture.repoDir;
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const sessionConfigs: SessionConfig[] = [];

    const app = createLocalReviewRunApp({
      workingDirectory: repoDir,
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
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
            userContext: []
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
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          return this;
        },
        async publishFileReview() {},
        async publishSkippedFile() {},
        async publishArtifact() {}
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

    const step3Config = sessionConfigs.find(
      (config) =>
        isKnowledgeSourceOfTruthSystemMessage(config.systemMessage) &&
        config.hooks?.onPreToolUse
    );
    const hook = step3Config?.hooks?.onPreToolUse;
    assert.ok(hook, "Step 3 session must have an onPreToolUse hook installed by the composition root");
    preToolUse = hook;
  });

  after(() => {
    fixture.cleanup();
  });

  test("Step 3 session has the tool-policy guard wired in (composition smoke)", async () => {
    // A single representative deny case proves the hook is a real policy
    // hook and not a no-op placeholder. The exhaustive URL policy matrix
    // lives in test/services/tool-policy-web-fetch-policy.test.ts.
    const decision = await preToolUse(
      {
        timestamp: Date.now(),
        cwd: repoDir,
        toolName: "web_fetch",
        toolArgs: { url: "http://localhost:3000" }
      },
      { sessionId: "session-1" }
    );

    assert.ok(decision, "expected the tool-policy guard to return a decision for an unsafe URL");
    assert.equal(decision.permissionDecision, "deny");
  });
});
