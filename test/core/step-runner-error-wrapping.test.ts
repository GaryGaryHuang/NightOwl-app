import assert from "node:assert/strict";
import test from "node:test";

import { StepRunner } from "../../src/core/step-runner.ts";
import {
  createReviewSessionFactory,
  createSectionTestStep,
  createStepRunnerContext,
  DEFAULT_JUDGE_RESOLVE
} from "../helpers/step-runner-contract-fixture.ts";

// The step runner returns a result object; state is not written to the context
// until the caller invokes result.applyTo(). This separation lets the
// orchestrator inspect the result before committing it.
test("StepRunner returns an apply-able result without mutating state or writing output directly", async () => {
  const lifecycle: unknown[] = [];
  const context = createStepRunnerContext();
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onCreateSession(profile) {
        lifecycle.push(["createSession", profile]);
      },
      onSendAndWait({ prompt, timeoutMs }) {
        lifecycle.push(["sendAndWait", { prompt }, timeoutMs]);
        return "## Overview\n- 整體理解：測試用概覽";
      },
      onDisconnect() {
        lifecycle.push(["disconnect"]);
      }
    })
  });

  const result = await runner.run({
    step: createSectionTestStep({}),
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
        stepId: "step1-overview",
        knowledgeMode: "disabled",
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

test("StepRunner passes the step-provided knowledgeMode into review sessions", async () => {
  const lifecycle: unknown[] = [];
  const context = createStepRunnerContext();
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onCreateSession(profile) {
        lifecycle.push(["createSession", profile]);
      },
      onSendAndWait() {
        return "## Knowledge & Source of Truth\n- 版本／文件參考：\n  - 無";
      },
      onDisconnect() {
        lifecycle.push(["disconnect"]);
      }
    })
  });

  const result = await runner.run({
    step: createSectionTestStep({
      stepId: "step3-knowledge-source-of-truth",
      sectionKey: "knowledge-source-of-truth",
      reviewProfile: {
        knowledgeMode: "built-in-context7",
        model: "gpt-5-mini",
        timeoutMs: 300_000
      }
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    workingDirectory: "/workspace/repo"
  });

  result.applyTo(context);

  assert.deepEqual(lifecycle, [
    [
      "createSession",
      {
        stepId: "step3-knowledge-source-of-truth",
        knowledgeMode: "built-in-context7",
        model: "gpt-5-mini",
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo",
        systemMessage: "system prompt",
        workingDirectory: "/workspace/repo"
      }
    ],
    ["disconnect"]
  ]);
  assert.equal(
    context.getSection("knowledge-source-of-truth"),
    "## Knowledge & Source of Truth\n- 版本／文件參考：\n  - 無"
  );
});

test("StepRunner fails on blank responses and does not apply any state", async () => {
  const context = createStepRunnerContext();
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "   ";
      }
    })
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createSectionTestStep({}),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /step1-overview/u
  );
  assert.equal(context.getSection("overview"), undefined);
});

test("StepRunner wraps prepare failures with step and file context", async () => {
  const context = createStepRunnerContext();
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

test("StepRunner does not duplicate contextual prefixes for judge failures", async () => {
  const context = createStepRunnerContext();
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Overview\n- 整體理解：attempt 1";
      }
    }),
    judgeService: {
      async evaluate() {
        throw new Error("judge timeout");
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createSectionTestStep({
          resolve: DEFAULT_JUDGE_RESOLVE
        }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /^StepExecutionError: Step step1-overview failed for src\/app\.ts: judge timeout$/u
  );
});
