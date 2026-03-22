import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../src/core/finalizer.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { Step2DependenciesBoundariesStep } from "../../src/core/steps/step2-dependencies-boundaries.ts";
import { Step3KnowledgeSourceOfTruthStep } from "../../src/core/steps/step3-knowledge-source-of-truth.ts";
import { Step4StrategyWhatIfScenariosStep } from "../../src/core/steps/step4-strategy-what-if-scenarios.ts";
import { Step5ValidationInterrogationStep } from "../../src/core/steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "../../src/core/steps/step6-cognitive-simulation.ts";
import { Step7SummaryStep } from "../../src/core/steps/step7-summary.ts";
import {
  StepRunner
} from "../../src/core/step-runner.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";

test("StepRunner returns an apply-able result without mutating state or writing output directly", async () => {
  const lifecycle = [];
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        lifecycle.push(["createSession", profile]);

        return new SessionExecutor({
          async sendAndWait(prompt, timeoutMs) {
            lifecycle.push(["sendAndWait", prompt, timeoutMs]);
            return {
              data: {
                content: "## Overview\n- 整體理解：測試用概覽"
              }
            };
          },
          async disconnect() {
            lifecycle.push(["disconnect"]);
          }
        });
      }
    }
  });

  const result = await runner.run({
    step: {
      stepId: "step1-overview",
      prepare() {
        return {
          stepId: "step1-overview",
          kind: "section",
          sectionKey: "overview",
          prompt: {
            systemMessage: "system prompt",
            userMessage: "user prompt"
          },
          reviewProfile: {
            model: "gpt-5-mini",
            timeoutMs: 300_000
          },
          applyTo(targetContext, responseText) {
            targetContext.setSection("overview", responseText);
          }
        };
      }
    },
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    workingDirectory: "/workspace/repo"
  });

  assert.equal(typeof result.applyTo, "function");
  assert.equal(context.getSection("overview"), undefined);

  result.applyTo(context);

  assert.equal(context.getSection("overview"), "## Overview\n- 整體理解：測試用概覽");
  assert.deepEqual(lifecycle, [
    [
      "createSession",
      {
        knowledgeMode: "built-in-context7",
        model: "gpt-5-mini",
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo",
        systemMessage: "system prompt",
        workingDirectory: "/workspace/repo"
      }
    ],
    ["sendAndWait", { prompt: "user prompt" }, 300_000],
    ["disconnect"]
  ]);
});

test("StepRunner fails on blank responses and does not apply any state", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: "   "
              }
            };
          },
          async disconnect() {}
        });
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: {
          stepId: "step1-overview",
          prepare() {
            return {
              stepId: "step1-overview",
              kind: "section",
              sectionKey: "overview",
              prompt: {
                systemMessage: "system prompt",
                userMessage: "user prompt"
              },
              reviewProfile: {
                model: "gpt-5-mini",
                timeoutMs: 300_000
              },
              applyTo(targetContext, responseText) {
                targetContext.setSection("overview", responseText);
              }
            };
          }
        },
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /step1-overview/u
  );
  assert.equal(context.getSection("overview"), undefined);
});

test("StepRunner wraps prepare failures with step and file context", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        throw new Error("should not create session");
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: {
          stepId: "step1-overview",
          prepare() {
            throw new Error("prepare exploded");
          }
        },
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step step1-overview failed for src\/app\.ts: prepare exploded/u
  );
});

test("StepRunner retries the whole section-step when judge rejects the first attempt and applies only the successful retry", async () => {
  const lifecycle = [];
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  let reviewAttempts = 0;
  let judgeAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        lifecycle.push(["review.createSession", profile]);

        return new SessionExecutor({
          async sendAndWait(prompt, timeoutMs) {
            reviewAttempts += 1;
            lifecycle.push(["review.sendAndWait", prompt, timeoutMs, reviewAttempts]);

            return {
              data: {
                content: `## Overview\n- 整體理解：attempt ${reviewAttempts}`
              }
            };
          },
          async disconnect() {
            lifecycle.push(["review.disconnect", reviewAttempts]);
          }
        });
      }
    },
    judgeService: {
      async evaluate(input) {
        judgeAttempts += 1;
        lifecycle.push(["judge.evaluate", input, judgeAttempts]);

        if (judgeAttempts === 1) {
          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: {
      stepId: "step1-overview",
      prepare() {
        return {
          stepId: "step1-overview",
          kind: "section",
          sectionKey: "overview",
          prompt: {
            systemMessage: "system prompt",
            userMessage: "user prompt"
          },
          reviewProfile: {
            model: "gpt-5-mini",
            timeoutMs: 300_000
          },
          completionCheck: {
            kind: "judge",
            criteria: "must contain overview fields"
          },
          applyTo(targetContext, responseText) {
            targetContext.setSection("overview", responseText);
          }
        };
      }
    },
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    workingDirectory: "/workspace/repo"
  });

  assert.equal(context.getSection("overview"), undefined);
  result.applyTo(context);
  assert.equal(context.getSection("overview"), "## Overview\n- 整體理解：attempt 2");
  assert.equal(reviewAttempts, 2);
  assert.equal(judgeAttempts, 2);
});

test("StepRunner fails after retry exhaustion on judge rejection and does not apply provisional state", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  let reviewAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            reviewAttempts += 1;

            return {
              data: {
                content: `## Overview\n- 整體理解：attempt ${reviewAttempts}`
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate() {
        return { passed: false, cause: "judge rejected" };
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: {
          stepId: "step1-overview",
          prepare() {
            return {
              stepId: "step1-overview",
              kind: "section",
              sectionKey: "overview",
              prompt: {
                systemMessage: "system prompt",
                userMessage: "user prompt"
              },
              reviewProfile: {
                model: "gpt-5-mini",
                timeoutMs: 300_000
              },
              completionCheck: {
                kind: "judge",
                criteria: "must contain overview fields"
              },
              applyTo(targetContext, responseText) {
                targetContext.setSection("overview", responseText);
              }
            };
          }
        },
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step step1-overview failed for src\/app\.ts: judge rejected/u
  );

  assert.equal(reviewAttempts, 2);
  assert.equal(context.getSection("overview"), undefined);
});

test("StepRunner retries the whole step on judge timeout with fresh review and judge attempts", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  let reviewAttempts = 0;
  let judgeAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            reviewAttempts += 1;

            return {
              data: {
                content: `## Overview\n- 整體理解：attempt ${reviewAttempts}`
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate() {
        judgeAttempts += 1;

        if (judgeAttempts === 1) {
          throw new Error("judge timeout");
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: {
      stepId: "step1-overview",
      prepare() {
        return {
          stepId: "step1-overview",
          kind: "section",
          sectionKey: "overview",
          prompt: {
            systemMessage: "system prompt",
            userMessage: "user prompt"
          },
          reviewProfile: {
            model: "gpt-5-mini",
            timeoutMs: 300_000
          },
          completionCheck: {
            kind: "judge",
            criteria: "must contain overview fields"
          },
          applyTo(targetContext, responseText) {
            targetContext.setSection("overview", responseText);
          }
        };
      }
    },
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);
  assert.equal(reviewAttempts, 2);
  assert.equal(judgeAttempts, 2);
  assert.equal(context.getSection("overview"), "## Overview\n- 整體理解：attempt 2");
});

test("StepRunner does not duplicate contextual prefixes for judge failures", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: "## Overview\n- 整體理解：attempt 1"
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate() {
        throw new Error("judge timeout");
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: {
          stepId: "step1-overview",
          prepare() {
            return {
              stepId: "step1-overview",
              kind: "section",
              sectionKey: "overview",
              prompt: {
                systemMessage: "system prompt",
                userMessage: "user prompt"
              },
              reviewProfile: {
                model: "gpt-5-mini",
                timeoutMs: 300_000
              },
              completionCheck: {
                kind: "judge",
                criteria: "must contain overview fields"
              },
              applyTo(targetContext, responseText) {
                targetContext.setSection("overview", responseText);
              }
            };
          }
        },
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /^Error: Step step1-overview failed for src\/app\.ts: judge timeout$/u
  );
});

test("StepRunner retries the whole step when review session startup fails and eventually succeeds", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  let createAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        createAttempts += 1;

        if (createAttempts === 1) {
          throw new Error("review startup failed");
        }

        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: "## Overview\n- 整體理解：attempt 2"
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate() {
        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: {
      stepId: "step1-overview",
      prepare() {
        return {
          stepId: "step1-overview",
          kind: "section",
          sectionKey: "overview",
          prompt: {
            systemMessage: "system prompt",
            userMessage: "user prompt"
          },
          reviewProfile: {
            model: "gpt-5-mini",
            timeoutMs: 300_000
          },
          completionCheck: {
            kind: "judge",
            criteria: "must contain overview fields"
          },
          applyTo(targetContext, responseText) {
            targetContext.setSection("overview", responseText);
          }
        };
      }
    },
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);
  assert.equal(createAttempts, 2);
  assert.equal(context.getSection("overview"), "## Overview\n- 整體理解：attempt 2");
});

test("StepRunner reports standardized review startup failure after retry exhaustion", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  let createAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        createAttempts += 1;
        throw new Error("review startup failed");
      }
    },
    judgeService: {
      async evaluate() {
        return { passed: true };
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: {
          stepId: "step1-overview",
          prepare() {
            return {
              stepId: "step1-overview",
              kind: "section",
              sectionKey: "overview",
              prompt: {
                systemMessage: "system prompt",
                userMessage: "user prompt"
              },
              reviewProfile: {
                model: "gpt-5-mini",
                timeoutMs: 300_000
              },
              completionCheck: {
                kind: "judge",
                criteria: "must contain overview fields"
              },
              applyTo(targetContext, responseText) {
                targetContext.setSection("overview", responseText);
              }
            };
          }
        },
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step step1-overview failed for src\/app\.ts: review startup failed/u
  );

  assert.equal(createAttempts, 2);
});

test("StepRunner rebuilds Step 2 current review from the last successful state on retry and does not leak provisional content", async () => {
  const prompts = [];
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  context.setSection(
    "overview",
    [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait(options) {
            prompts.push(options.prompt);

            return {
              data: {
                content: [
                  "## Dependencies & Boundaries",
                  "- 相依清單：",
                  "  - 無外部相依",
                  "- 隱含相依：",
                  "  - 無"
                ].join("\n")
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate(input) {
        if (prompts.length === 1) {
          assert.doesNotMatch(input.sectionContent, /provisional step 2/u);

          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: new Step2DependenciesBoundariesStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.match(prompts[0] ?? "", /<current_review>[\s\S]*## Overview/u);
  assert.doesNotMatch(prompts[0] ?? "", /Review not yet generated/u);
  assert.doesNotMatch(prompts[0] ?? "", /provisional step 2/u);
  assert.equal(context.getSection("dependencies-boundaries"), undefined);

  result.applyTo(context);

  assert.match(context.getSection("dependencies-boundaries") ?? "", /^## Dependencies & Boundaries/u);
});

test("StepRunner rebuilds Step 3 current review from the last successful Step 2 state on retry and does not leak provisional content", async () => {
  const prompts = [];
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  context.setSection(
    "overview",
    [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );
  context.setSection(
    "dependencies-boundaries",
    [
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - 無外部相依",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait(options) {
            prompts.push(options.prompt);

            return {
              data: {
                content: [
                  "## Knowledge & Source of Truth",
                  "- 版本／文件參考：",
                  "  - 無",
                  "- 採用規則與假設：",
                  "  - 依 repo 內設定檔推論版本約束",
                  "- 排除範圍：",
                  "  - 外部官方文件查證不在本次 foundation 範圍內"
                ].join("\n")
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate(input) {
        if (prompts.length === 1) {
          assert.doesNotMatch(input.sectionContent, /provisional step 3/u);

          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: new Step3KnowledgeSourceOfTruthStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.match(prompts[0] ?? "", /<current_review>[\s\S]*## Dependencies & Boundaries/u);
  assert.doesNotMatch(prompts[0] ?? "", /Review not yet generated/u);
  assert.doesNotMatch(prompts[0] ?? "", /provisional step 3/u);
  assert.equal(context.getSection("knowledge-source-of-truth"), undefined);

  result.applyTo(context);

  assert.match(context.getSection("knowledge-source-of-truth") ?? "", /^## Knowledge & Source of Truth/u);
});

test("StepRunner rebuilds Step 4 current review from the last successful Step 3 state on retry and does not leak provisional content", async () => {
  const prompts = [];
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  context.setSection(
    "overview",
    [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );
  context.setSection(
    "dependencies-boundaries",
    [
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - 無外部相依",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - 無",
      "- 採用規則與假設：",
      "  - 依 repo 內設定檔推論版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait(options) {
            prompts.push(options.prompt);

            return {
              data: {
                content: [
                  "## Strategy & What-if Scenarios",
                  "- 高風險區域：",
                  "  - state transition：本次改動調整 value 更新流程",
                  "- What-if 假設情境：",
                  "  - W1: 觸發條件：value 為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整路徑",
                  "  - W2: 觸發條件：依賴回傳異常；預期正確行為：應保留錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示邊界",
                  "  - W3: 觸發條件：多次呼叫；預期正確行為：結果應穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
                ].join("\n")
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate(input) {
        if (prompts.length === 1) {
          assert.doesNotMatch(input.sectionContent, /provisional step 4/u);

          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: new Step4StrategyWhatIfScenariosStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.match(prompts[0] ?? "", /<current_review>[\s\S]*## Knowledge & Source of Truth/u);
  assert.doesNotMatch(prompts[0] ?? "", /Review not yet generated/u);
  assert.doesNotMatch(prompts[0] ?? "", /provisional step 4/u);
  assert.equal(context.getSection("strategy-what-if-scenarios"), undefined);

  result.applyTo(context);

  assert.match(context.getSection("strategy-what-if-scenarios") ?? "", /^## Strategy & What-if Scenarios/u);
  assert.doesNotMatch(context.getSection("strategy-what-if-scenarios") ?? "", /^## Findings/mu);
});

test("StepRunner validates Step 5 structured output and applies filtered findings without using judge", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  let judgeCalls = 0;

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: JSON.stringify({
                  findings: [
                    {
                      type: "must",
                      title: "保留 must",
                      context: "具體情境",
                      deviation: "預期與實際有落差",
                      impact: "會造成 correctness 問題",
                      suggestion: "補上 guard",
                      confidence: 80
                    },
                    {
                      type: "nice",
                      title: "被過濾的 nice",
                      context: "具體情境",
                      deviation: "可改善",
                      impact: "影響可維護性",
                      suggestion: "補上整理",
                      confidence: 89
                    }
                  ]
                })
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate() {
        judgeCalls += 1;
        return { passed: true };
      }
    },
    structuredOutputValidator: new StructuredOutputValidator()
  });

  const result = await runner.run({
    step: new Step5ValidationInterrogationStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(judgeCalls, 0);
  assert.deepEqual(context.getStructuredState(), {});

  result.applyTo(context);

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "保留 must",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 80
      }
    ]
  });
});

test("StepRunner retries the whole Step 5 structured step when deterministic validation fails first", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  const prompts = [];
  let reviewAttempts = 0;

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait(options) {
            prompts.push(options.prompt);
            reviewAttempts += 1;

            if (reviewAttempts === 1) {
              return {
                data: {
                  content: "{\"findings\":[}"
                }
              };
            }

            return {
              data: {
                content: JSON.stringify({
                  findings: [
                    {
                      type: "must",
                      title: "成功結果",
                      context: "具體情境",
                      deviation: "預期與實際有落差",
                      impact: "會造成 correctness 問題",
                      suggestion: "補上 guard",
                      confidence: 85
                    }
                  ]
                })
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator()
  });

  const result = await runner.run({
    step: new Step5ValidationInterrogationStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(reviewAttempts, 2);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.deepEqual(context.getStructuredState(), {});

  result.applyTo(context);

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "成功結果",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 85
      }
    ]
  });
});

test("StepRunner applies Step 6 structured output by replacing non-empty Step 5 findings with final findings", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "初版 findings",
        context: "初版情境",
        deviation: "初版落差",
        impact: "初版 impact",
        suggestion: "初版建議",
        confidence: 88
      }
    ]
  });

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: JSON.stringify({
                  findings: [
                    {
                      type: "must",
                      title: "最終 findings",
                      context: "最終情境",
                      deviation: "最終落差",
                      impact: "最終 impact",
                      suggestion: "最終建議",
                      confidence: 91
                    }
                  ]
                })
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator()
  });

  const result = await runner.run({
    step: new Step6CognitiveSimulationStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "初版 findings",
        context: "初版情境",
        deviation: "初版落差",
        impact: "初版 impact",
        suggestion: "初版建議",
        confidence: 88
      }
    ]
  });

  result.applyTo(context);

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "最終 findings",
        context: "最終情境",
        deviation: "最終落差",
        impact: "最終 impact",
        suggestion: "最終建議",
        confidence: 91
      }
    ]
  });
});

test("StepRunner applies Step 6 structured output by replacing non-empty Step 5 findings with empty final findings", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "初版 findings",
        context: "初版情境",
        deviation: "初版落差",
        impact: "初版 impact",
        suggestion: "初版建議",
        confidence: 88
      }
    ]
  });

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: JSON.stringify({ findings: [] })
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator()
  });

  const result = await runner.run({
    step: new Step6CognitiveSimulationStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);

  assert.deepEqual(context.getStructuredState(), { findings: [] });
});

test("StepRunner applies Step 6 structured output by replacing empty Step 5 findings with final findings", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  context.updateStructuredState({ findings: [] });

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: JSON.stringify({
                  findings: [
                    {
                      type: "nice",
                      title: "從空 findings 補出的最終問題",
                      context: "最終情境",
                      deviation: "最終落差",
                      impact: "最終 impact",
                      suggestion: "最終建議",
                      confidence: 93
                    }
                  ]
                })
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator()
  });

  const result = await runner.run({
    step: new Step6CognitiveSimulationStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "nice",
        title: "從空 findings 補出的最終問題",
        context: "最終情境",
        deviation: "最終落差",
        impact: "最終 impact",
        suggestion: "最終建議",
        confidence: 93
      }
    ]
  });
});

test("StepRunner retries the whole Step 6 structured step when deterministic validation fails first without mutating Step 5 findings", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "初版 findings",
        context: "初版情境",
        deviation: "初版落差",
        impact: "初版 impact",
        suggestion: "初版建議",
        confidence: 88
      }
    ]
  });
  const prompts = [];
  let reviewAttempts = 0;

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait(options) {
            prompts.push(options.prompt);
            reviewAttempts += 1;

            if (reviewAttempts === 1) {
              return {
                data: {
                  content: "{\"findings\":[}"
                }
              };
            }

            return {
              data: {
                content: JSON.stringify({
                  findings: [
                    {
                      type: "must",
                      title: "成功結果",
                      context: "具體情境",
                      deviation: "預期與實際有落差",
                      impact: "會造成 correctness 問題",
                      suggestion: "補上 final guard",
                      confidence: 91
                    }
                  ]
                })
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator()
  });

  const result = await runner.run({
    step: new Step6CognitiveSimulationStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(reviewAttempts, 2);
  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.match(prompts[0] ?? "", /## Findings[\s\S]*初版 findings/u);
  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "初版 findings",
        context: "初版情境",
        deviation: "初版落差",
        impact: "初版 impact",
        suggestion: "初版建議",
        confidence: 88
      }
    ]
  });

  result.applyTo(context);

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "成功結果",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
});

test("StepRunner applies Step 7 section output under summary without changing findings", async () => {
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "最終 findings",
        context: "最終情境",
        deviation: "最終落差",
        impact: "最終 impact",
        suggestion: "最終建議",
        confidence: 91
      }
    ]
  });

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait() {
            return {
              data: {
                content: [
                  "## Summary",
                  "### 審查基礎",
                  "- 改動概要：調整主要執行流程。",
                  "- 依據規範：依 repo source-of-truth 與版本假設審查。",
                  "- 審查假設：未擴張到外部知識查證。",
                  "### 行為變更提醒",
                  "- 無",
                  "### 風險評估",
                  "- 整體風險等級：Medium",
                  "- 風險理由：final findings 仍需留意。"
                ].join("\n")
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate() {
        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: new Step7SummaryStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(context.getSection("summary"), undefined);
  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "最終 findings",
        context: "最終情境",
        deviation: "最終落差",
        impact: "最終 impact",
        suggestion: "最終建議",
        confidence: 91
      }
    ]
  });

  result.applyTo(context);

  assert.match(context.getSection("summary") ?? "", /^## Summary/u);
  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "最終 findings",
        context: "最終情境",
        deviation: "最終落差",
        impact: "最終 impact",
        suggestion: "最終建議",
        confidence: 91
      }
    ]
  });
});

test("StepRunner rebuilds Step 7 current review from the last successful Step 6 state on retry and does not leak provisional content", async () => {
  const prompts = [];
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/output/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });
  seedStep4Context(context);
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "最終 findings",
        context: "最終情境",
        deviation: "最終落差",
        impact: "最終 impact",
        suggestion: "最終建議",
        confidence: 91
      }
    ]
  });

  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        return new SessionExecutor({
          async sendAndWait(options) {
            prompts.push(options.prompt);

            return {
              data: {
                content: [
                  "## Summary",
                  "### 審查基礎",
                  "- 改動概要：調整主要執行流程。",
                  "- 依據規範：依 repo source-of-truth 與版本假設審查。",
                  "- 審查假設：未擴張到外部知識查證。",
                  "### 行為變更提醒",
                  "- 無",
                  "### 風險評估",
                  "- 整體風險等級：Medium",
                  "- 風險理由：final findings 仍需留意。"
                ].join("\n")
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    judgeService: {
      async evaluate(input) {
        if (prompts.length === 1) {
          assert.doesNotMatch(input.sectionContent, /provisional step 7/u);

          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: new Step7SummaryStep({
      reviewNoteFinalizer: new ReviewNoteFinalizer()
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.match(prompts[0] ?? "", /<current_review>[\s\S]*## Findings[\s\S]*最終 findings/u);
  assert.doesNotMatch(prompts[0] ?? "", /<diff/u);
  assert.doesNotMatch(prompts[0] ?? "", /<changeset_context>/u);
  assert.doesNotMatch(prompts[0] ?? "", /provisional step 7/u);
  assert.equal(context.getSection("summary"), undefined);

  result.applyTo(context);

  assert.match(context.getSection("summary") ?? "", /^## Summary/u);
});

function seedStep4Context(context: FileReviewContext): void {
  context.setSection(
    "overview",
    [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );
  context.setSection(
    "dependencies-boundaries",
    [
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - 無外部相依",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - 無",
      "- 採用規則與假設：",
      "  - 依 repo 內設定檔推論版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );
  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：本次改動調整 value 更新流程",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：value 為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整路徑",
      "  - W2: 觸發條件：依賴回傳異常；預期正確行為：應保留錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：多次呼叫；預期正確行為：結果應穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );
}
