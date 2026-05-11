import assert from "node:assert/strict";
import test from "node:test";

import { StepRunner } from "../../src/core/step-runner.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../../src/core/review-runtime-contract.ts";
import {
  createReviewSessionFactory,
  createSectionTestStep,
  createStepRunnerContext
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
        return "## Summary\n- 整體理解：測試用摘要";
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
  assert.equal(context.getSection("summary"), undefined);

  result.applyTo(context);

  assert.equal(context.getSection("summary"), "## Summary\n- 整體理解：測試用摘要");
  assert.deepEqual(lifecycle, [
    [
      "createSession",
      {
        stepId: "review-summary",
        knowledgeMode: "disabled",
        model: "gpt-5-mini",
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo",
        systemMessage: "system prompt",
        workingDirectory: "/workspace/repo"
      }
    ],
    ["sendAndWait", { prompt: "user prompt" }, REVIEW_TURN_TIMEOUT_MS],
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
        return "## Custom Knowledge\n- 版本／文件參考：\n  - 無";
      },
      onDisconnect() {
        lifecycle.push(["disconnect"]);
      }
    })
  });

  const result = await runner.run({
    step: createSectionTestStep({
      stepId: "custom-knowledge-step",
      sectionKey: "custom-knowledge",
      reviewProfile: {
        knowledgeMode: "built-in-context7",
        model: "gpt-5-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
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
        stepId: "custom-knowledge-step",
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
    context.getSection("custom-knowledge"),
    "## Custom Knowledge\n- 版本／文件參考：\n  - 無"
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
    /review-summary/u
  );
  assert.equal(context.getSection("summary"), undefined);
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
          stepId: "review-summary",
          prepare() {
            throw new Error("prepare exploded");
          }
        },
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step review-summary failed for src\/app\.ts: prepare exploded/u
  );
});

test("StepRunner does not duplicate contextual prefixes for resolve failures", async () => {
  const context = createStepRunnerContext();
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Summary\n- 整體理解：attempt 1";
      }
    })
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createSectionTestStep({
          resolve: async () => {
            throw new Error("deterministic completion timed out");
          }
        }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /^StepExecutionError: Step review-summary failed for src\/app\.ts: deterministic completion timed out$/u
  );
});
