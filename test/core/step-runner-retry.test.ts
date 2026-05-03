import assert from "node:assert/strict";
import test from "node:test";

import { StepRunner } from "../../src/core/step-runner.ts";
import { createStructuredResolve } from "../../src/core/steps/step-resolve-helpers.ts";
import {
  createReviewSessionFactory,
  createSectionTestStep,
  createStepRunnerContext,
  DEFAULT_JUDGE_RESOLVE,
  runDefaultJudgeOverviewStep,
  runDefaultSectionStep
} from "../helpers/step-runner-contract-fixture.ts";
import {
  finding as structuredFinding,
  lineRangeTraceability as structuredLineRangeTraceability,
  payload as structuredPayload
} from "../helpers/structured-output-validator-fixture.ts";

test("StepRunner retries the whole section-step when judge rejects the first attempt and applies only the successful retry", async () => {
  const lifecycle: unknown[] = [];
  const prompts: string[] = [];
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
        prompts.push(prompt);
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
  assert.doesNotMatch(prompts[0] ?? "", /retry_repair_context/u);
  assert.match(prompts[1] ?? "", /<retry_repair_context>/u);
  assert.match(prompts[1] ?? "", /Failure reason: judge rejected/u);
});

test("StepRunner adds empty-response repair feedback to the retry prompt", async () => {
  const prompts: string[] = [];
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        reviewAttempts += 1;
        prompts.push(prompt);

        if (reviewAttempts === 1) {
          return "";
        }

        return "## Overview\n- 整體理解：retry after empty response";
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

  result.applyTo(context);

  assert.equal(reviewAttempts, 2);
  assert.doesNotMatch(prompts[0] ?? "", /retry_repair_context/u);
  assert.match(prompts[1] ?? "", /<retry_repair_context>/u);
  assert.match(prompts[1] ?? "", /Previous attempt returned an empty response/u);
  assert.equal(
    context.getSection("overview"),
    "## Overview\n- 整體理解：retry after empty response"
  );
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

test("StepRunner records structured validation reports without committing partial findings", async () => {
  const context = createStepRunnerContext();
  const prompts: string[] = [];
  let reviewAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        prompts.push(prompt);
        reviewAttempts += 1;
        if (reviewAttempts === 1) {
          return structuredPayload([
            structuredFinding({
              findingId: "F1",
              traceability: structuredLineRangeTraceability(1, 1)
            }),
            structuredFinding({
              findingId: "F2",
              traceability: structuredLineRangeTraceability(1, 1),
              type: "maybe"
            })
          ]);
        }

        return structuredPayload([
          structuredFinding({
            findingId: "F3",
            traceability: structuredLineRangeTraceability(1, 1)
          })
        ]);
      }
    })
  });

  const result = await runner.run({
    step: {
      stepId: "step5-validation-interrogation",
      prepare(stepContext) {
        return {
          stepId: "step5-validation-interrogation",
          prompt: { systemMessage: "system prompt", userMessage: "user prompt" },
          reviewProfile: {
            knowledgeMode: "disabled",
            model: "gpt-5.4-mini",
            timeoutMs: 300_000
          },
          resolve: createStructuredResolve({
            stepId: "step5-validation-interrogation",
            filePath: stepContext.filePath,
            diffContent: stepContext.diffContent
          })
        };
      }
    },
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(reviewAttempts, 2);
  assert.doesNotMatch(prompts[0] ?? "", /retry_repair_context/u);
  assert.match(prompts[1] ?? "", /Structured validation report:/u);
  assert.match(prompts[1] ?? "", /findingId=F2/u);
  assert.match(prompts[1] ?? "", /taxonomy=SCHEMA/u);
  assert.match(prompts[1] ?? "", /'type' must be 'must' or 'nice'/u);
  assert.equal(context.getFindings(), undefined);
  assert.deepEqual(
    context.getVerifierReportEntries()?.map((entry) => ({
      findingId: entry.findingId,
      taxonomy: entry.taxonomy,
      outcome: entry.outcome,
      gate: entry.gate
    })),
    [
      {
        findingId: "F1",
        taxonomy: "OK",
        outcome: "accepted",
        gate: "schema"
      },
      {
        findingId: "F2",
        taxonomy: "SCHEMA",
        outcome: "rejected",
        gate: "schema"
      }
    ]
  );

  result.applyTo(context);

  assert.deepEqual(
    context.getFindings()?.map((finding) => finding.findingId),
    ["F3"]
  );
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
          reviewProfile: {
            knowledgeMode: "disabled",
            model: "gpt-5-mini",
            timeoutMs: 300_000
          },
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
