import assert from "node:assert/strict";
import test from "node:test";

import { createLocalReviewRunApp } from "../../src/app/review-app.ts";
import { createRunContext } from "../../src/core/run-context.ts";
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
    const sessionConfigs = [];
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
          return {
            async createSession(config) {
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

    const sessionConfigs = [];
    let context7Failures = 0;
    const skippedRecords = [];
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {},
        async stop() {},
        getClient() {
          return {
            async createSession(config) {
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

async function assertPerFileContext7StartupFailureSkipsOneFile(input: {
  stepMatcher(systemMessage: unknown): boolean;
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add changed file for broader Context7 startup failure coverage");

    const sessionConfigs = [];
    let context7Failures = 0;
    const skippedRecords = [];
    const app = createLocalReviewRunApp({
      workingDirectory: fixture.repoDir,
      clientManager: {
        async start() {},
        async stop() {},
        getClient() {
          return {
            async createSession(config) {
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

function buildSessionResponse(config: { systemMessage?: unknown; availableTools?: string[] }, prompt: { prompt: string }): string {
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

  throw new Error(`Unexpected session prompt: ${prompt.prompt}`);
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
