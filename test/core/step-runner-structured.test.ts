import assert from "node:assert/strict";
import test from "node:test";

import { ReviewNoteFinalizer } from "../../src/core/finalizer.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { Step5ValidationInterrogationStep } from "../../src/core/steps/step5-validation-interrogation.ts";
import { Step6CognitiveSimulationStep } from "../../src/core/steps/step6-cognitive-simulation.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import {
  createReviewSessionFactory,
  createStepRunnerContext,
  diffHunkTraceability,
  FINAL_FINDING,
  INITIAL_FINDING,
  lineRangeTraceability,
  NICE_FINAL_FINDING,
  seedStep4Context
} from "../helpers/step-runner-contract-fixture.ts";

// Steps 5-6 use StructuredOutputValidator (deterministic JSON schema check)
// instead of JudgeService; judgeCalls === 0 asserts judge is never invoked.
// The validator also filters out findings below the confidence threshold.
test("StepRunner validates Step 5 structured output and applies filtered findings without using judge", async () => {
  const context = createStepRunnerContext();
  seedStep4Context(context);
  let judgeCalls = 0;

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return JSON.stringify({
          findings: [
            {
              type: "must",
              title: "保留 must",
              traceability: lineRangeTraceability(10, 12),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 80
            },
            {
              type: "nice",
              title: "被過濾的 nice",
              traceability: lineRangeTraceability(20, 20),
              context: "具體情境",
              deviation: "可改善",
              impact: "影響可維護性",
              suggestion: "補上整理",
              confidence: 89
            }
          ]
        });
      }
    }),
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
        traceability: lineRangeTraceability(10, 12),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 80
      }
    ]
  });
});

// Malformed JSON from the model triggers a deterministic validation failure
// which retries with the same prompt (both prompts must be identical).
test("StepRunner retries the whole Step 5 structured step when deterministic validation fails first", async () => {
  const context = createStepRunnerContext();
  seedStep4Context(context);
  const prompts: string[] = [];
  let reviewAttempts = 0;

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        prompts.push(prompt);
        reviewAttempts += 1;

        if (reviewAttempts === 1) {
          return "{\"findings\":[}";
        }

        return JSON.stringify({
          findings: [
            {
              type: "must",
              title: "成功結果",
              traceability: lineRangeTraceability(14, 18),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 guard",
              confidence: 85
            }
          ]
        });
      }
    }),
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
        traceability: lineRangeTraceability(14, 18),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 85
      }
    ]
  });
});

// Step 6 replaces Step 5's findings entirely; the prior non-empty set is
// discarded after applyTo() is called with the Step 6 result.
const STEP6_REPLACEMENT_CASES = [
  {
    label: "non-empty Step 5 findings with final findings",
    initialFindings: [INITIAL_FINDING],
    responseFindings: [FINAL_FINDING],
    expectedFindings: [FINAL_FINDING],
    assertBeforeApply: true
  },
  {
    label: "non-empty Step 5 findings with empty final findings",
    initialFindings: [INITIAL_FINDING],
    responseFindings: [],
    expectedFindings: [],
    assertBeforeApply: false
  },
  {
    label: "empty Step 5 findings with final findings",
    initialFindings: [],
    responseFindings: [NICE_FINAL_FINDING],
    expectedFindings: [NICE_FINAL_FINDING],
    assertBeforeApply: false
  }
] as const;

for (const testCase of STEP6_REPLACEMENT_CASES) {
  test(`StepRunner applies Step 6 structured output by replacing ${testCase.label}`, async () => {
    const context = createStepRunnerContext();
    seedStep4Context(context);
    context.setFindings([...testCase.initialFindings]);

    const runner = new StepRunner({
      reviewSessionFactory: createReviewSessionFactory({
        onSendAndWait() {
          return JSON.stringify({ findings: testCase.responseFindings });
        }
      }),
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

    if (testCase.assertBeforeApply) {
      assert.deepEqual(context.getStructuredState(), {
        findings: testCase.initialFindings
      });
    }

    result.applyTo(context);

    assert.deepEqual(context.getStructuredState(), {
      findings: testCase.expectedFindings
    });
  });
}

test("StepRunner retries the whole Step 6 structured step when deterministic validation fails first without mutating Step 5 findings", async () => {
  const context = createStepRunnerContext();
  seedStep4Context(context);
  context.setFindings([INITIAL_FINDING]);
  const prompts: string[] = [];
  let reviewAttempts = 0;

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        prompts.push(prompt);
        reviewAttempts += 1;

        if (reviewAttempts === 1) {
          return "{\"findings\":[}";
        }

        return JSON.stringify({
          findings: [
            {
              type: "must",
              title: "成功結果",
              traceability: lineRangeTraceability(16, 18),
              context: "具體情境",
              deviation: "預期與實際有落差",
              impact: "會造成 correctness 問題",
              suggestion: "補上 final guard",
              confidence: 91
            }
          ]
        });
      }
    }),
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
  assert.deepEqual(context.getStructuredState(), { findings: [INITIAL_FINDING] });

  result.applyTo(context);

  assert.deepEqual(context.getStructuredState(), {
    findings: [
      {
        type: "must",
        title: "成功結果",
        traceability: lineRangeTraceability(16, 18),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
});
