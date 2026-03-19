import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../src/core/file-review-context.ts";
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
