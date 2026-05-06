import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { SkipRecord } from "../../src/providers/review-output-sink.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import {
  buildSessionResponse,
  isChangesetOverviewSystemMessage,
  isJudgeSystemMessage,
  isReviewBasisSystemMessage
} from "../helpers/review-app-fixture.ts";

test("createLocalReviewRunApp aborts Step 0 MCP startup failure after retry without initializing output", async () => {
  const fixture = createReviewRepoFixture();

  try {
    let startCalls = 0;
    let stopCalls = 0;
    let initializeRunCalls = 0;
    let step0Context7Failures = 0;
    const sessionConfigs: SessionConfig[] = [];
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
          return {
            async start() {},
            async stop() {},
            async forceStop() {},
            async createSession(config: SessionConfig) {
              sessionConfigs.push(config);

              if (
                config.mcpServers?.context7 &&
                isChangesetOverviewSystemMessage(config.systemMessage)
              ) {
                step0Context7Failures += 1;
                throw new Error("context7 startup failed");
              }

              return {
                async sendAndWait() {
                  return {
                    data: {
                      content: "## Changeset Overview\n- 調整範圍：feature"
                    }
                  };
                },
                async disconnect() {}
              };
            }
          };
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          initializeRunCalls += 1;
          return this;
        },
        async publishFileReview() {},
        async publishSkippedFile() {},
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
      /context7 startup failed/u
    );

    assert.ok(step0Context7Failures >= 2);
    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 1);
    assert.equal(initializeRunCalls, 0);
    // Both the initial attempt and the retry must target the canonical Context7
    // MCP URL; verifies no fallback or misconfigured URL was used on retry.
    assert.ok(
      sessionConfigs.every(
        (config) =>
          !isChangesetOverviewSystemMessage(config.systemMessage) ||
          (config.mcpServers?.context7?.type === "http" &&
            (config.mcpServers.context7 as { url?: string }).url ===
              "https://mcp.context7.com/mcp")
      )
    );
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp skips one file after per-file MCP startup retry exhaustion", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for ReviewBasis Context7 startup failure");

    const sessionConfigs: SessionConfig[] = [];
    let context7Failures = 0;
    const skippedRecords: SkipRecord[] = [];
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
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

              if (
                config.mcpServers?.context7 &&
                isReviewBasisSystemMessage(config.systemMessage)
              ) {
                context7Failures += 1;

                // Fail the first three attempts (initial + 2 retries), exhausting
                // one file's retry budget so it is skipped. The rest succeed.
                if (context7Failures <= 3) {
                  throw new Error("context7 startup failed");
                }
              }

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
        async publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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

    assert.ok(context7Failures >= 3);
    assert.equal(result.skippedFileCount, 1);
    assert.ok(result.plannedFileCount >= 3);
    assert.ok(result.successfulFileCount >= 1);
    assert.match(
      skippedRecords[0]?.reason ?? "",
      /context7 startup failed/u
    );
    assert.ok(
      sessionConfigs.some(
        (config) =>
          config.mcpServers?.context7 &&
          config.mcpServers.context7.type === "http" &&
          (config.mcpServers.context7 as { url?: string }).url ===
            "https://mcp.context7.com/mcp" &&
          isReviewBasisSystemMessage(config.systemMessage)
      )
    );
    assert.ok(
      sessionConfigs.some(
        (config) =>
          !config.mcpServers &&
          isJudgeSystemMessage(config.systemMessage)
      )
    );
  } finally {
    fixture.cleanup();
  }
});
