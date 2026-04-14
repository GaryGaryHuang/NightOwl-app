import assert from "node:assert/strict";
import test from "node:test";

import { StepRunner } from "../../src/core/step-runner.ts";
import {
  SessionExecutor,
  SessionTurnAbortedError
} from "../../src/services/session-executor.ts";
import {
  createReviewSessionFactory,
  createSectionTestStep,
  createStructuredTestStep,
  createStepRunnerContext,
  DEFAULT_JUDGE_RESOLVE,
  runDefaultJudgeOverviewStep,
  runDefaultSectionStep
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

test("StepRunner does not consume retry budget or start judge when a section-step review turn is aborted", async () => {
  const controller = new AbortController();
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let abortCalls = 0;
  let judgeCalls = 0;
  let retryCallCount = 0;
  let resolveSend:
    | ((value: { data?: { content?: string } } | undefined) => void)
    | undefined;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        reviewAttempts += 1;

        return new SessionExecutor({
          async sendAndWait() {
            queueMicrotask(() => controller.abort("SIGINT"));
            return await new Promise<{ data?: { content?: string } } | undefined>((resolve) => {
              resolveSend = resolve;
            });
          },
          async abort() {
            abortCalls += 1;
            resolveSend?.(undefined);
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
    onStepRetry() {
      retryCallCount += 1;
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
        repoRoot: "/workspace/repo",
        signal: controller.signal
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(reviewAttempts, 1);
  assert.equal(abortCalls, 1);
  assert.equal(judgeCalls, 0);
  assert.equal(retryCallCount, 0);
});

test("StepRunner does not consume retry budget or run deterministic validation when a structured-step review turn is aborted", async () => {
  const controller = new AbortController();
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let abortCalls = 0;
  let validateCalls = 0;
  let resolveSend:
    | ((value: { data?: { content?: string } } | undefined) => void)
    | undefined;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        reviewAttempts += 1;

        return new SessionExecutor({
          async sendAndWait() {
            queueMicrotask(() => controller.abort("SIGINT"));
            return await new Promise<{ data?: { content?: string } } | undefined>((resolve) => {
              resolveSend = resolve;
            });
          },
          async abort() {
            abortCalls += 1;
            resolveSend?.(undefined);
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: {
      validate() {
        validateCalls += 1;
        return { findings: [] };
      }
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createStructuredTestStep({}),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo",
        signal: controller.signal
      }),
    (error: unknown) => error instanceof SessionTurnAbortedError
  );
  assert.equal(reviewAttempts, 1);
  assert.equal(abortCalls, 1);
  assert.equal(validateCalls, 0);
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

test("StepRunner retries the whole section-step when judge rejects the first attempt and applies only the successful retry", async () => {
  const lifecycle: unknown[] = [];
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let judgeAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onCreateSession(profile) {
        lifecycle.push(["review.createSession", profile]);
      },
      onSendAndWait({ prompt, timeoutMs }) {
        reviewAttempts += 1;
        lifecycle.push(["review.sendAndWait", prompt, timeoutMs, reviewAttempts]);
        return `## Overview\n- 整體理解：attempt ${reviewAttempts}`;
      },
      onDisconnect() {
        lifecycle.push(["review.disconnect", reviewAttempts]);
      }
    }),
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
    step: createSectionTestStep({
      resolve: DEFAULT_JUDGE_RESOLVE
    }),
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
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        reviewAttempts += 1;
        return `## Overview\n- 整體理解：attempt ${reviewAttempts}`;
      }
    }),
    judgeService: {
      async evaluate() {
        return { passed: false, cause: "judge rejected" };
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
    /Step step1-overview failed for src\/app\.ts: judge rejected/u
  );

  assert.equal(reviewAttempts, 2);
  assert.equal(context.getSection("overview"), undefined);
});

test("StepRunner retries the whole step on judge timeout with fresh review and judge attempts", async () => {
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let judgeAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        reviewAttempts += 1;
        return `## Overview\n- 整體理解：attempt ${reviewAttempts}`;
      }
    }),
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
    step: createSectionTestStep({
      resolve: DEFAULT_JUDGE_RESOLVE
    }),
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
    /^Error: Step step1-overview failed for src\/app\.ts: judge timeout$/u
  );
});

test("StepRunner retries the whole step when review session startup fails and eventually succeeds", async () => {
  const context = createStepRunnerContext();
  let createAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: {
      async createSession() {
        createAttempts += 1;

        if (createAttempts === 1) {
          throw new Error("review startup failed");
        }

        return createReviewSessionFactory({
          onSendAndWait() {
            return "## Overview\n- 整體理解：attempt 2";
          }
        }).createSession({
          knowledgeMode: "built-in-context7",
          model: "gpt-5-mini",
          outputBaseDir: "/workspace/output",
          repoRoot: "/workspace/repo",
          systemMessage: "system prompt"
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
    step: createSectionTestStep({
      resolve: DEFAULT_JUDGE_RESOLVE
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);
  assert.equal(createAttempts, 2);
  assert.equal(context.getSection("overview"), "## Overview\n- 整體理解：attempt 2");
});

test("StepRunner reports standardized review startup failure after retry exhaustion", async () => {
  const context = createStepRunnerContext();
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
        step: createSectionTestStep({
          resolve: DEFAULT_JUDGE_RESOLVE
        }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step step1-overview failed for src\/app\.ts: review startup failed/u
  );

  assert.equal(createAttempts, 2);
});

test("StepRunner invokes onStepRetry with stepId, filePath, attempt 0, and cause when the first attempt fails", async () => {
  const context = createStepRunnerContext();
  const retryInfos: unknown[] = [];
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Overview\n- 整體理解：attempt 1";
      }
    }),
    judgeService: {
      async evaluate(input) {
        if (retryInfos.length === 0) {
          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    },
    onStepRetry(info) {
      retryInfos.push({ ...info });
    }
  });

  const result = await runDefaultJudgeOverviewStep(runner, context);

  result.applyTo(context);

  assert.equal(retryInfos.length, 1);
  assert.deepEqual(retryInfos[0], {
    stepId: "step1-overview",
    filePath: "src/app.ts",
    attempt: 0,
    cause: "judge rejected"
  });
});

test("StepRunner does not invoke onStepRetry when the step succeeds on the first attempt", async () => {
  const context = createStepRunnerContext();
  let retryCallCount = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Overview\n- 整體理解：成功一次完成";
      }
    }),
    onStepRetry() {
      retryCallCount += 1;
    }
  });

  const result = await runDefaultSectionStep(runner, context);

  result.applyTo(context);

  assert.equal(retryCallCount, 0);
});

test("StepRunner swallows exceptions thrown by onStepRetry and does not propagate them", async () => {
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        reviewAttempts += 1;
        return `## Overview\n- 整體理解：attempt ${reviewAttempts}`;
      }
    }),
    judgeService: {
      async evaluate() {
        if (reviewAttempts === 1) {
          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    },
    onStepRetry() {
      throw new Error("onStepRetry exploded");
    }
  });

  // Should not throw despite onStepRetry throwing
  const result = await runDefaultJudgeOverviewStep(runner, context);

  result.applyTo(context);

  assert.equal(reviewAttempts, 2);
  assert.match(context.getSection("overview") ?? "", /attempt 2/u);
});

test("StepRunner invokes onStepRetry when prepare itself throws on the first attempt", async () => {
  const context = createStepRunnerContext();
  const retryInfos: unknown[] = [];
  let prepareAttempts = 0;

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Overview\n- 整體理解：retry after prepare failure";
      }
    }),
    onStepRetry(info) {
      retryInfos.push({ ...info });
    }
  });

  const result = await runner.run({
    step: {
      stepId: "step1-overview",
      prepare() {
        prepareAttempts += 1;

        if (prepareAttempts === 1) {
          throw new Error("prepare exploded");
        }

        return {
          stepId: "step1-overview",
          prompt: { systemMessage: "system prompt", userMessage: "user prompt" },
          reviewProfile: { model: "gpt-5-mini", timeoutMs: 300_000 },
          async resolve(response: string) {
            return (targetContext: import("../../src/core/file-review-context.ts").FileReviewContext) => {
              targetContext.setSection("overview", response);
            };
          }
        };
      }
    },
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);

  assert.equal(prepareAttempts, 2);
  assert.equal(retryInfos.length, 1);
  assert.deepEqual(retryInfos[0], {
    stepId: "step1-overview",
    filePath: "src/app.ts",
    attempt: 0,
    cause: "prepare exploded"
  });
  assert.match(context.getSection("overview") ?? "", /retry after prepare failure/u);
});

test("StepRunner does not invoke onStepRetry on the final attempt failure", async () => {
  const context = createStepRunnerContext();
  const retryInfos: unknown[] = [];

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Overview\n- 整體理解：always fails judge";
      }
    }),
    judgeService: {
      async evaluate() {
        return { passed: false, cause: "judge rejected" };
      }
    },
    onStepRetry(info) {
      retryInfos.push({ ...info });
    }
  });

  await assert.rejects(
    () =>
      runDefaultJudgeOverviewStep(runner, context),
    /Step step1-overview failed for src\/app\.ts: judge rejected/u
  );

  // Called exactly once for attempt 0; NOT called for the final failure (attempt 1).
  assert.equal(retryInfos.length, 1);
  assert.equal((retryInfos[0] as { attempt: number }).attempt, 0);
});
