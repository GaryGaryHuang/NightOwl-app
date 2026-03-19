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
