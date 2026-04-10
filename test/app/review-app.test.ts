import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import {
  createLocalReviewRunApp,
  formatLocalReviewRunSummary,
  LOCAL_REVIEW_RUN_HEADER
} from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { ReviewRunSummary } from "../../src/core/orchestrator.ts";
import type { SkipRecord } from "../../src/providers/review-output-sink.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import {
  buildSessionResponse,
  isChangesetOverviewSystemMessage,
  isJudgeSystemMessage,
  isKnowledgeSourceOfTruthSystemMessage,
  isStrategyWhatIfSystemMessage,
  isValidationInterrogationSystemMessage
} from "../helpers/review-app-fixture.ts";

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
        initializeRun() {
          initializeRunCalls += 1;
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
        initializeRun() {
          initializeRunCalls += 1;
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

test("createLocalReviewRunApp keeps Step 3 Context7 startup failure on the existing retry-and-skip path", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
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

                // Fail the first two attempts (initial + 1 retry), exhausting
                // one file's retry budget so it is skipped. The rest succeed.
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
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          return this;
        },
        publishFileReview() {},
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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
          userContext: [],
          dryRun: false
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
          userContext: [],
          dryRun: false
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
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
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

                // Fail the first two attempts (initial + 1 retry), exhausting
                // one file's retry budget so it is skipped. The rest succeed.
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
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          return this;
        },
        publishFileReview() {},
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
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

                // Fail the first two attempts (initial + 1 retry), exhausting
                // one file's retry budget so it is skipped. The rest succeed.
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
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          return this;
        },
        publishFileReview() {},
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
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

                // Fail the first two attempts (initial + 1 retry), exhausting
                // one file's retry budget so it is skipped. The rest succeed.
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
      outputSink: defineOutputSinkDouble({
        initializeRun() {
          return this;
        },
        publishFileReview() {},
        publishSkippedFile(skipRecord) {
          skippedRecords.push(skipRecord);
        },
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

// ---------------------------------------------------------------------------
// formatLocalReviewRunSummary — dry-run header tests
// ---------------------------------------------------------------------------

function buildMinimalRunSummary(overrides: Partial<ReviewRunSummary> = {}): ReviewRunSummary {
  const base = "/workspace/.nightowl/review/run";
  return {
    repoRoot: "/workspace/repo",
    runContext: createRunContext({ changesetOverview: "## Changeset Overview", userContext: [] }),
    outputTarget: {
      basePath: base,
      changesetOverviewPath: `${base}/changeset-overview.md`,
      filesPath: `${base}/files`,
      skippedPath: `${base}/skipped.md`,
      summaryPath: `${base}/summary.md`,
      indexPath: `${base}/index.md`,
      manifestPath: `${base}/manifest.json`,
      toolAuditPath: `${base}/tool-audit.jsonl`
    },
    plannedFileCount: 1,
    successfulFileCount: 1,
    skippedFileCount: 0,
    dryRun: false,
    finalizerFailures: [],
    ...overrides
  };
}

test("formatLocalReviewRunSummary adds [DRY RUN] prefix to header when dryRun is true", () => {
  const result = buildMinimalRunSummary({ dryRun: true });
  const summary = formatLocalReviewRunSummary(result);

  assert.ok(
    summary.startsWith("[DRY RUN] " + LOCAL_REVIEW_RUN_HEADER),
    `Expected [DRY RUN] prefix, got: ${summary.split("\n")[0]}`
  );
});

test("formatLocalReviewRunSummary does not add [DRY RUN] prefix when dryRun is false", () => {
  const result = buildMinimalRunSummary({ dryRun: false });
  const summary = formatLocalReviewRunSummary(result);

  assert.ok(
    summary.startsWith(LOCAL_REVIEW_RUN_HEADER),
    `Expected plain header, got: ${summary.split("\n")[0]}`
  );
  assert.ok(!summary.includes("[DRY RUN]"), "Must not contain [DRY RUN] when dryRun is false");
});

test("formatLocalReviewRunSummary has no warning line when finalizerFailures is empty", () => {
  const result = buildMinimalRunSummary({ finalizerFailures: [] });
  const summary = formatLocalReviewRunSummary(result);

  assert.ok(!summary.includes("Warning:"), "Must not contain Warning when finalizerFailures is empty");
});

test("formatLocalReviewRunSummary appends warning line listing failed artifact names when finalizerFailures is non-empty", () => {
  const result = buildMinimalRunSummary({
    finalizerFailures: [
      { artifact: "summary", message: "ENOSPC" },
      { artifact: "manifest", message: "disk full" }
    ]
  });
  const summary = formatLocalReviewRunSummary(result);

  assert.match(summary, /Warning: Failed to write run-level artifacts: summary, manifest/u);
});

// ---------------------------------------------------------------------------
// dry-run mode — clientManager lifecycle tests
// ---------------------------------------------------------------------------

test("createLocalReviewRunApp does not call clientManager.start() in dry-run mode", async () => {
  const fixture = createReviewRepoFixture();

  try {
    let startCalls = 0;
    let stopCalls = 0;
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
          throw new Error("clientManager.getClient() must not be called in dry-run mode");
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

    await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      userContext: [],
      dryRun: true
    });

    assert.equal(startCalls, 0, "clientManager.start() must not be called in dry-run mode");
    assert.equal(stopCalls, 0, "clientManager.stop() must not be called in dry-run mode");
  } finally {
    fixture.cleanup();
  }
});

test("createLocalReviewRunApp completes dry-run flow and result has dryRun: true", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {
          throw new Error("clientManager.start() must not be called in dry-run mode");
        },
        async stop() {
          throw new Error("clientManager.stop() must not be called in dry-run mode");
        },
        async forceStop() {},
        getClient() {
          throw new Error("clientManager.getClient() must not be called in dry-run mode");
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
      userContext: [],
      dryRun: true
    });

    assert.equal(result.dryRun, true);
    assert.equal(result.skippedFileCount, 0, "dry-run should produce no skipped files");
    assert.ok(result.successfulFileCount > 0, "dry-run should process at least one file");
  } finally {
    fixture.cleanup();
  }
});

// ---------------------------------------------------------------------------
// context7ApiKey injection
// ---------------------------------------------------------------------------

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
