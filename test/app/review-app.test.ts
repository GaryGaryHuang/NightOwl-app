import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { ReviewRunInterruptedError } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { SkipRecord } from "../../src/providers/review-output-sink.ts";
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

test("createLocalReviewRunApp fails before client startup, Step 0, and output initialization when maxConcurrentFiles is invalid", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 0
      })
    );

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
          Boolean(config.mcpServers?.context7)
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
        publishReviewIndex() {}
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

test("createLocalReviewRunApp keeps Step 4 Context7 startup failure on the existing retry-and-skip path", async () => {
  await assertPerFileContext7StartupFailureSkipsOneFile({
    stepMatcher: isStrategyWhatIfSystemMessage
  });
});

test("createLocalReviewRunApp keeps Step 5 Context7 startup failure on the existing retry-and-skip path", async () => {
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

test("createLocalReviewRunApp keeps Step 5 custom MCP startup failure on the existing retry-and-skip path", async () => {
  await assertPerFileCustomMcpStartupFailureSkipsOneFile({
    stepMatcher: isValidationInterrogationSystemMessage
  });
});

test("createLocalReviewRunApp exposes runtime web_fetch guardrails without introducing a new step failure family", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    const sessionConfigs: SessionConfig[] = [];
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
        publishReviewIndex() {}
      }
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
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
    assert.deepEqual(
      await preToolUse(
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
    fixture.writeFile(".reviewignore", "dist/**\n");
    const sessionConfigs: SessionConfig[] = [];
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
        publishReviewIndex() {}
      }
    });

    const result = await app.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
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
    assert.deepEqual(
      await preToolUse(
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
      await preToolUse(
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
        publishReviewIndex() {}
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
        publishReviewIndex() {}
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

function buildSessionResponse(
  config: { systemMessage?: unknown; availableTools?: string[] },
  prompt: string
): string {
  if (Array.isArray(config.availableTools) && config.availableTools.length === 0) {
    return "Y";
  }

  const systemMessage = extractSystemMessageContent(config.systemMessage);

  if (/## Current Step: Overview/u.test(systemMessage)) {
    return [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n");
  }

  if (/## Current Step: Dependencies & Boundaries/u.test(systemMessage)) {
    return [
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n");
  }

  if (/## Current Step: Knowledge & Source of Truth/u.test(systemMessage)) {
    return [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - demo-lib 1.0 — https://example.com/demo-lib",
      "- 採用規則與假設：",
      "  - 以 repo 內設定與版本化行為作為判讀依據",
      "- 排除範圍：",
      "  - 外部非官方補充資料不在本次範圍內"
    ].join("\n");
  }

  if (/## Current Step: Strategy & What-if Scenarios/u.test(systemMessage)) {
    return [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：值得驗證狀態切換是否一致",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程"
    ].join("\n");
  }

  if (/## Current Step: Validation & Interrogation/u.test(systemMessage)) {
    return JSON.stringify({
      findings: [
        {
          type: "must",
          title: "問題標題",
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "會造成 correctness 問題",
          suggestion: "補上 guard",
          confidence: 90
        }
      ]
    });
  }

  if (/## Current Step: Cognitive Simulation/u.test(systemMessage)) {
    return JSON.stringify({
      findings: [
        {
          type: "must",
          title: "問題標題",
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "會造成 correctness 問題",
          suggestion: "補上 guard",
          confidence: 91
        }
      ]
    });
  }

  if (/## Current Step: Summary/u.test(systemMessage)) {
    return [
      "## Summary",
      "### 審查基礎",
      "- 改動概要：這次改動主要調整執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 審查假設：未擴張到外部知識查證。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：Medium",
      "- 風險理由：final findings 仍需留意。"
    ].join("\n");
  }

  throw new Error(`Unexpected session prompt: ${prompt}`);
}

function extractSystemMessageContent(systemMessage: unknown): string {
  if (
    systemMessage &&
    typeof systemMessage === "object" &&
    "content" in systemMessage &&
    typeof systemMessage.content === "string"
  ) {
    return systemMessage.content;
  }

  return "";
}

function isKnowledgeSourceOfTruthSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Knowledge & Source of Truth/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

function isChangesetOverviewSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Changeset Overview/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

function isStrategyWhatIfSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Strategy & What-if Scenarios/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

function isValidationInterrogationSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Validation & Interrogation/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

function isJudgeSystemMessage(systemMessage: unknown): boolean {
  return /Output only Y or N/u.test(extractSystemMessageContent(systemMessage));
}

// ─── Task 3.1: App lifecycle signal handling tests ────────────────────────────

function createSignalTestApp(options: {
  stopCalls: string[];
  onStep1?: () => void;
  step0ShouldThrow?: boolean;
  step0Error?: Error;
  startError?: Error;
  stopImpl?: () => Promise<void>;
  forceStopImpl?: () => Promise<void>;
  gracefulShutdownTimeoutMs?: number;
}) {
  const TEST_FILES = ["src/app.ts", "packages/app/index.ts"];

  return createLocalReviewRunApp({
    workingDirectory: "/tmp/signal-test",
    gracefulShutdownTimeoutMs: options.gracefulShutdownTimeoutMs,
    clientManager: {
      async start() {
        if (options.startError) {
          throw options.startError;
        }
      },
      async stop() {
        options.stopCalls.push("stop");
        await options.stopImpl?.();
      },
      async forceStop() {
        options.stopCalls.push("forceStop");
        await options.forceStopImpl?.();
      },
      getClient() {
        throw new Error("unused");
      }
    },
    sourceProvider: {
      resolveRepoRoot(startPath: string) {
        return startPath;
      },
      getChangesetEntries() {
        return TEST_FILES;
      },
      getCurrentBranch() {
        return "feature-branch";
      },
      getChangedFiles() {
        return TEST_FILES;
      },
      filterIgnoredFiles(_repoRoot: string, files: string[]) {
        return files;
      },
      getDiff() {
        return "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n";
      }
    },
    outputSink: {
      initializeRun() {},
      publishFileReview() {},
      publishSkippedFile() {},
      publishRunSummary() {},
      publishReviewIndex() {}
    },
    changesetOverviewRunner: {
      async run() {
        if (options.step0Error) {
          throw options.step0Error;
        }

        if (options.step0ShouldThrow) {
          throw new Error("step0 fatal error in test");
        }
        return createRunContext({
          changesetOverview: "## Changeset\n- test",
          userContext: []
        });
      }
    },
    stepRunner: {
      async run({ step }: { step: { stepId: string } }) {
        if (step.stepId === "step1-overview") {
          options.onStep1?.();
        }
        return {
          stepId: step.stepId,
          applyTo(_ctx: unknown) {}
        };
      }
    }
  });
}

const SIGNAL_TEST_REQUEST = {
  baseRef: "main",
  headRef: "feature-branch",
  repoPath: ".",
  userContext: []
};

test("createLocalReviewRunApp SIGINT during run propagates ReviewRunInterruptedError to caller", async () => {
  const stopCalls: string[] = [];
  let sigintFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!sigintFired) {
        sigintFired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.deepEqual(stopCalls, ["stop"], "clientManager.stop() must be called after interruption");
});

test("createLocalReviewRunApp SIGTERM during run propagates ReviewRunInterruptedError to caller", async () => {
  const stopCalls: string[] = [];
  let sigtermFired = false;

  const app = createSignalTestApp({
    stopCalls,
    onStep1() {
      if (!sigtermFired) {
        sigtermFired = true;
        process.emit("SIGTERM", "SIGTERM");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );
  assert.deepEqual(stopCalls, ["stop"], "clientManager.stop() must be called after SIGTERM");
});

test("createLocalReviewRunApp removes SIGINT and SIGTERM handlers after normal run completion", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  const app = createSignalTestApp({
    stopCalls,
    async stopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before stop() on normal completion"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before stop() on normal completion"
      );
    }
  });

  await app.run(SIGNAL_TEST_REQUEST);

  assert.equal(
    process.listenerCount("SIGINT"),
    sigintBefore,
    "SIGINT listener should be removed after normal completion"
  );
  assert.equal(
    process.listenerCount("SIGTERM"),
    sigtermBefore,
    "SIGTERM listener should be removed after normal completion"
  );
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp removes SIGINT and SIGTERM handlers after a run error", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");

  const app = createSignalTestApp({
    stopCalls,
    step0ShouldThrow: true,
    async stopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before stop() after error"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before stop() after error"
      );
    }
  });

  await assert.rejects(() => app.run(SIGNAL_TEST_REQUEST));

  assert.equal(
    process.listenerCount("SIGINT"),
    sigintBefore,
    "SIGINT listener should be removed after error"
  );
  assert.equal(
    process.listenerCount("SIGTERM"),
    sigtermBefore,
    "SIGTERM listener should be removed after error"
  );
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp removes SIGINT and SIGTERM handlers after an interrupted run", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  let fired = false;

  const app = createSignalTestApp({
    stopCalls,
    async stopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before stop() after interruption"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before stop() after interruption"
      );
    },
    onStep1() {
      if (!fired) {
        fired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );

  assert.equal(
    process.listenerCount("SIGINT"),
    sigintBefore,
    "SIGINT listener should be removed after interruption"
  );
  assert.equal(
    process.listenerCount("SIGTERM"),
    sigtermBefore,
    "SIGTERM listener should be removed after interruption"
  );
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp calls clientManager.stop() on normal completion", async () => {
  const stopCalls: string[] = [];
  const app = createSignalTestApp({ stopCalls });

  await app.run(SIGNAL_TEST_REQUEST);

  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp calls clientManager.stop() when run throws a non-signal error", async () => {
  const stopCalls: string[] = [];
  const app = createSignalTestApp({ stopCalls, step0ShouldThrow: true });

  await assert.rejects(() => app.run(SIGNAL_TEST_REQUEST));

  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp keeps the successful summary when stop() resolves before the graceful shutdown timeout", async () => {
  const stopCalls: string[] = [];
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(0);
    }
  });

  const summary = await app.run(SIGNAL_TEST_REQUEST);

  assert.equal(summary.repoRoot, "/tmp/signal-test");
  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp falls back to clientManager.forceStop() after a successful run when stop() exceeds the graceful shutdown timeout", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before forceStop() on normal completion"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before forceStop() on normal completion"
      );
    }
  });

  const summary = await app.run(SIGNAL_TEST_REQUEST);

  assert.equal(summary.repoRoot, "/tmp/signal-test");
  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
  assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp preserves ReviewRunInterruptedError when forceStop() follows a timed-out stop()", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  let sigintFired = false;
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before forceStop() after interruption"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before forceStop() after interruption"
      );
    },
    onStep1() {
      if (!sigintFired) {
        sigintFired = true;
        process.emit("SIGINT", "SIGINT");
      }
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err instanceof ReviewRunInterruptedError
  );

  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
  assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp preserves the original run error when forceStop() follows a timed-out stop()", async () => {
  const stopCalls: string[] = [];
  const sigintBefore = process.listenerCount("SIGINT");
  const sigtermBefore = process.listenerCount("SIGTERM");
  const runError = new Error("step0 fatal error in test");
  const app = createSignalTestApp({
    stopCalls,
    step0Error: runError,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      assert.equal(
        process.listenerCount("SIGINT"),
        sigintBefore,
        "SIGINT listener should be removed before forceStop() after error"
      );
      assert.equal(
        process.listenerCount("SIGTERM"),
        sigtermBefore,
        "SIGTERM listener should be removed before forceStop() after error"
      );
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === runError
  );

  assert.equal(process.listenerCount("SIGINT"), sigintBefore);
  assert.equal(process.listenerCount("SIGTERM"), sigtermBefore);
  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp surfaces a fast stop() rejection without calling forceStop()", async () => {
  const stopCalls: string[] = [];
  const stopError = new Error("stop failed fast");
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      throw stopError;
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === stopError
  );

  assert.deepEqual(stopCalls, ["stop"]);
});

test("createLocalReviewRunApp surfaces a forceStop() rejection instead of the original run outcome", async () => {
  const stopCalls: string[] = [];
  const forceStopError = new Error("forceStop failed");
  const app = createSignalTestApp({
    stopCalls,
    gracefulShutdownTimeoutMs: 1,
    async stopImpl() {
      await sleep(20);
    },
    async forceStopImpl() {
      throw forceStopError;
    }
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === forceStopError
  );

  assert.deepEqual(stopCalls, ["stop", "forceStop"]);
});

test("createLocalReviewRunApp skips stop() and forceStop() when client startup fails", async () => {
  const stopCalls: string[] = [];
  const startError = new Error("client start failed");
  const app = createSignalTestApp({
    stopCalls,
    startError
  });

  await assert.rejects(
    () => app.run(SIGNAL_TEST_REQUEST),
    (err: unknown) => err === startError
  );

  assert.deepEqual(stopCalls, []);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
