import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { SkipRecord } from "../../src/providers/review-output-sink.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  buildSessionResponse,
  createResolvedRedirectResolver,
  isChangesetOverviewSystemMessage,
  isJudgeSystemMessage,
  isKnowledgeSourceOfTruthSystemMessage,
  isStrategyWhatIfSystemMessage,
  isValidationInterrogationSystemMessage
} from "../helpers/review-app-fixture.ts";

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
      webFetchRedirectResolver: createResolvedRedirectResolver(),
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
      outputSink: {
        initializeRun() {
          initializeRunCalls += 1;
        },
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
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

test("createLocalReviewRunApp keeps Step 0 Context7 startup failure on the existing retry-and-abort path", async () => {
  const fixture = createReviewRepoFixture();

  try {
    let startCalls = 0;
    let stopCalls = 0;
    let initializeRunCalls = 0;
    let step0Context7Failures = 0;
    const sessionConfigs: SessionConfig[] = [];
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      webFetchRedirectResolver: createResolvedRedirectResolver(),
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
      outputSink: {
        initializeRun() {
          initializeRunCalls += 1;
        },
        publishFileReview() {},
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {},
        publishChangesetOverview() {}
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
      /context7 startup failed/u
    );

    assert.ok(step0Context7Failures >= 2);
    assert.equal(startCalls, 1);
    assert.equal(stopCalls, 1);
    assert.equal(initializeRunCalls, 0);
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

test("createLocalReviewRunApp keeps Step 3 Context7 startup failure on the existing retry-and-skip path", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for Step 3 Context7 startup failure");

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
                isKnowledgeSourceOfTruthSystemMessage(config.systemMessage)
              ) {
                context7Failures += 1;

                if (context7Failures <= 2) {
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
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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
      userContext: []
    });

    assert.ok(context7Failures >= 2);
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
          isKnowledgeSourceOfTruthSystemMessage(config.systemMessage)
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

test("createLocalReviewRunApp keeps a representative per-file Context7 startup failure on the existing retry-and-skip path", async () => {
  await assertPerFileContext7StartupFailureSkipsOneFile({
    stepMatcher: isValidationInterrogationSystemMessage
  });
});

test("createLocalReviewRunApp keeps Step 0 custom MCP startup failure on the existing retry-and-abort path", async () => {
  const fixture = createReviewRepoFixture();

  try {
    let customMcpFailures = 0;
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
              if (
                config.mcpServers?.demo &&
                isChangesetOverviewSystemMessage(config.systemMessage)
              ) {
                customMcpFailures += 1;
                throw new Error("custom mcp startup failed");
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
      reviewConfigProvider: {
        loadReviewConfig() {
          return {
            maxConcurrentFiles: 1,
            confidenceThresholds: {
              must: 80,
              nice: 90
            },
            mcpServers: {
              demo: {
                type: "local",
                command: "npx",
                args: ["-y", "@example/demo-mcp"],
                tools: ["*"]
              }
            }
          };
        }
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
      /custom mcp startup failed/u
    );

    assert.ok(customMcpFailures >= 2);
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp keeps Step 4 custom MCP startup failure on the existing retry-and-skip path", async () => {
  await assertPerFileCustomMcpStartupFailureSkipsOneFile({
    stepMatcher: isStrategyWhatIfSystemMessage
  });
});

test("createLocalReviewRunApp keeps Step 0 remote MCP startup failure on the existing retry-and-abort path", async () => {
  const fixture = createReviewRepoFixture();

  try {
    let remoteMcpFailures = 0;
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
              if (
                config.mcpServers?.["my-remote"] &&
                isChangesetOverviewSystemMessage(config.systemMessage)
              ) {
                remoteMcpFailures += 1;
                throw new Error("remote mcp startup failed");
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
      reviewConfigProvider: {
        loadReviewConfig() {
          return {
            maxConcurrentFiles: 1,
            confidenceThresholds: { must: 80, nice: 90 },
            mcpServers: {
              "my-remote": {
                type: "http",
                url: "https://mcp.example.com/v1",
                tools: ["*"]
              }
            }
          };
        }
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
      /remote mcp startup failed/u
    );

    assert.ok(remoteMcpFailures >= 2);
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp keeps per-file remote MCP startup failure on the existing retry-and-skip path", async () => {
  await assertPerFileRemoteMcpStartupFailureSkipsOneFile({
    stepMatcher: isStrategyWhatIfSystemMessage
  });
});

async function assertPerFileContext7StartupFailureSkipsOneFile(input: {
  stepMatcher(systemMessage: unknown): boolean;
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add changed file for broader Context7 startup failure coverage");

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
                input.stepMatcher(config.systemMessage)
              ) {
                context7Failures += 1;

                if (context7Failures <= 2) {
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
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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
      userContext: []
    });

    assert.ok(context7Failures >= 2);
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
          config.mcpServers?.context7 && input.stepMatcher(config.systemMessage)
      )
    );
  } finally {
    fixture.cleanup();
  }
}

async function assertPerFileCustomMcpStartupFailureSkipsOneFile(input: {
  stepMatcher(systemMessage: unknown): boolean;
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add changed file for custom MCP startup failure coverage");

    const skippedRecords: SkipRecord[] = [];
    let customMcpFailures = 0;
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
              if (config.mcpServers?.demo && input.stepMatcher(config.systemMessage)) {
                customMcpFailures += 1;

                if (customMcpFailures <= 2) {
                  throw new Error("custom mcp startup failed");
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
            mcpServers: {
              demo: {
                type: "local",
                command: "npx",
                args: ["-y", "@example/demo-mcp"],
                tools: ["*"]
              }
            }
          };
        }
      },
      outputSink: {
        initializeRun() {},
        publishFileReview() {},
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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
      userContext: []
    });

    assert.ok(customMcpFailures >= 2);
    assert.equal(result.skippedFileCount, 1);
    assert.match(
      skippedRecords[0]?.reason ?? "",
      /custom mcp startup failed/u
    );
  } finally {
    fixture.cleanup();
  }
}

async function assertPerFileRemoteMcpStartupFailureSkipsOneFile(input: {
  stepMatcher(systemMessage: unknown): boolean;
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add changed file for remote MCP startup failure coverage");

    const skippedRecords: SkipRecord[] = [];
    let remoteMcpFailures = 0;
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
              if (config.mcpServers?.["my-remote"] && input.stepMatcher(config.systemMessage)) {
                remoteMcpFailures += 1;

                if (remoteMcpFailures <= 2) {
                  throw new Error("remote mcp startup failed");
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
            mcpServers: {
              "my-remote": {
                type: "http",
                url: "https://mcp.example.com/v1",
                tools: ["*"]
              }
            }
          };
        }
      },
      outputSink: {
        initializeRun() {},
        publishFileReview() {},
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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
      userContext: []
    });

    assert.ok(remoteMcpFailures >= 2);
    assert.equal(result.skippedFileCount, 1);
    assert.match(
      skippedRecords[0]?.reason ?? "",
      /remote mcp startup failed/u
    );
  } finally {
    fixture.cleanup();
  }
}
