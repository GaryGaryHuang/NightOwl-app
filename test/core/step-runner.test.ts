import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../src/core/finalizer.ts";
import { Step2DependenciesBoundariesStep } from "../../src/core/steps/step2-dependencies-boundaries.ts";
import { Step3KnowledgeSourceOfTruthStep } from "../../src/core/steps/step3-knowledge-source-of-truth.ts";
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
