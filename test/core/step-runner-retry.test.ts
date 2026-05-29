import assert from "node:assert/strict";
import test from "node:test";

import { StepRunner } from "../../src/core/step-runner.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../../src/core/review-runtime-contract.ts";
import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { ReviewBasisStep } from "../../src/core/steps/review-basis-step.ts";
import { createCandidateFindingsResolve } from "../../src/core/steps/step-resolve-helpers.ts";
import {
  createReviewSessionFactory,
  createSectionTestStep,
  createStepRunnerContext,
  DEFAULT_CHECKED_SECTION_RESOLVE,
  runDefaultCheckedSectionStep,
  runDefaultSectionStep
} from "../helpers/step-runner-contract-fixture.ts";

test("StepRunner retries the whole section-step when deterministic completion fails the first attempt and applies only the successful retry", async () => {
  const lifecycle: unknown[] = [];
  const prompts: string[] = [];
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onCreateSession(profile) {
        lifecycle.push(["review.createSession", profile]);
      },
      onSendAndWait({ prompt, timeoutMs }) {
        reviewAttempts += 1;
        prompts.push(prompt);
        lifecycle.push(["review.sendAndWait", prompt, timeoutMs, reviewAttempts]);
        return `## Summary\n- 整體理解：attempt ${reviewAttempts}`;
      },
      onDisconnect() {
        lifecycle.push(["review.disconnect", reviewAttempts]);
      }
    })
  });

  const result = await runner.run({
    step: createSectionTestStep({
      resolve: DEFAULT_CHECKED_SECTION_RESOLVE
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo",
    workingDirectory: "/workspace/repo"
  });

  assert.equal(context.getSection("summary"), undefined);
  result.applyTo(context);
  assert.equal(context.getSection("summary"), "## Summary\n- 整體理解：attempt 2");
  assert.equal(reviewAttempts, 2);
  assert.doesNotMatch(prompts[0] ?? "", /retry_repair_context/u);
  assert.match(prompts[1] ?? "", /<retry_repair_context>/u);
  assert.match(prompts[1] ?? "", /Failure reason: deterministic completion failed/u);
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

        return "## Summary\n- 整體理解：retry after empty response";
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
    context.getSection("summary"),
    "## Summary\n- 整體理解：retry after empty response"
  );
});

test("StepRunner fails after retry exhaustion on deterministic completion failure and does not apply provisional state", async () => {
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        reviewAttempts += 1;
        return `## Summary\n- 整體理解：attempt ${reviewAttempts}`;
      }
    })
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createSectionTestStep({
          resolve: async () => {
            throw new Error("deterministic completion failed");
          }
        }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step review-summary failed for src\/app\.ts: deterministic completion failed/u
  );

  assert.equal(reviewAttempts, 3);
  assert.equal(context.getSection("summary"), undefined);
});

test("StepRunner records structured validation reports without committing partial candidate state", async () => {
  const context = createStepRunnerContext();
  const prompts: string[] = [];
  let reviewAttempts = 0;
  const reviewBasis = createReviewBasis();
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        prompts.push(prompt);
        reviewAttempts += 1;
        if (reviewAttempts === 1) {
          return JSON.stringify(createCandidatePayload("F2", {
            classification: "unsupported_claim"
          }));
        }

        return JSON.stringify(createCandidatePayload("F3"));
      }
    })
  });

  const result = await runner.run({
    step: {
      stepId: "candidate-findings",
      prepare(stepContext) {
        return {
          stepId: "candidate-findings",
          prompt: { systemMessage: "system prompt", userMessage: "user prompt" },
          reviewProfile: {
            knowledgeMode: "disabled",
            model: "gpt-5.4-mini",
            timeoutMs: REVIEW_TURN_TIMEOUT_MS
          },
          resolve: createCandidateFindingsResolve({
            filePath: stepContext.filePath,
            diffContent: stepContext.diffContent,
            reviewBasis
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
  assert.match(prompts[1] ?? "", /findingId=<payload>/u);
  assert.match(prompts[1] ?? "", /taxonomy=SEMANTIC/u);
  assert.match(prompts[1] ?? "", /classification/u);
  assert.equal(context.getFindings(), undefined);

  result.applyTo(context);

  assert.deepEqual(
    context.getCandidateFindings()?.findings.map((finding) => finding.findingId),
    ["F1"]
  );
  assert.deepEqual(context.getCandidateFindings()?.findingOrigins, [
    {
      findingIndex: 1,
      kind: "hypothesis",
      hypothesisIds: ["H1"],
      evidenceIds: ["E1"],
      rationale: "F3 validates the hypothesis."
    }
  ]);
  assert.equal(context.getFindings(), undefined);
});

test("StepRunner fails ReviewBasisStep after three parse failures without fallback", async () => {
  const prompts: string[] = [];
  const context = createStepRunnerContext({
    filePath: "ExampleApp/src/main/java/com/example/recognition/viewmodel/MusicRecognitionViewModel.kt",
    diffContent: "@@ -10,2 +10,2 @@\n-oldUi()\n+newUi()\n"
  });
  const runContext = createRunContext({
    userContext: [],
    changesetOverview: {
      reviewObjective: {
        summary: "Update MusicRecognitionViewModel to use the new UseCase flow.",
        requestedFocus: [],
        expectedBehaviorSummary: []
      },
      userContext: [],
      userBehavior: [],
      missingInformation: [],
      overviewMarkdown: "## Changeset Overview\n- Update MusicRecognitionViewModel to use the new UseCase flow.",
      behaviorChanges: [
        {
          description: "Update MusicRecognitionViewModel to use the new UseCase flow.",
          files: [
            "ExampleApp/src/main/java/com/example/recognition/viewmodel/MusicRecognitionViewModel.kt"
          ]
        }
      ],
      unresolvedUnknowns: []
    }
  });
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        prompts.push(prompt);
        return "{ invalid json";
      }
    })
  });

  await assert.rejects(
    () =>
      runner.run({
        step: new ReviewBasisStep({ runContext }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step review-basis failed for ExampleApp\/src\/main\/java\/com\/example\/recognition\/viewmodel\/MusicRecognitionViewModel\.kt: ReviewBasis validation failed: response is not valid JSON/u
  );

  assert.equal(prompts.length, 3);
  assert.doesNotMatch(prompts[0] ?? "", /retry_repair_context/u);
  assert.match(prompts[1] ?? "", /ReviewBasis validation failed: response is not valid JSON/u);
  assert.match(prompts[2] ?? "", /ReviewBasis validation failed: response is not valid JSON/u);
  assert.equal(context.getReviewBasis(), undefined);
});

test("StepRunner retries the whole step when resolve throws after a review response", async () => {
  const context = createStepRunnerContext();
  let reviewAttempts = 0;
  let resolveAttempts = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        reviewAttempts += 1;
        return `## Summary\n- 整體理解：attempt ${reviewAttempts}`;
      }
    })
  });

  const result = await runner.run({
    step: createSectionTestStep({
      resolve: async (response: string) => {
        resolveAttempts += 1;

        if (resolveAttempts === 1) {
          throw new Error("deterministic completion timed out");
        }

        return (targetContext) => {
          targetContext.setSection("summary", response);
        };
      }
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);
  assert.equal(reviewAttempts, 2);
  assert.equal(resolveAttempts, 2);
  assert.equal(context.getSection("summary"), "## Summary\n- 整體理解：attempt 2");
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
            return "## Summary\n- 整體理解：attempt 2";
          }
        }).createSession({
          knowledgeMode: "built-in-context7",
          model: "gpt-5-mini",
          outputBaseDir: "/workspace/output",
          repoRoot: "/workspace/repo",
          systemMessage: "system prompt"
        });
      }
    }
  });

  const result = await runner.run({
    step: createSectionTestStep({
      resolve: DEFAULT_CHECKED_SECTION_RESOLVE
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  result.applyTo(context);
  assert.equal(createAttempts, 2);
  assert.equal(context.getSection("summary"), "## Summary\n- 整體理解：attempt 2");
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
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createSectionTestStep({
          resolve: DEFAULT_CHECKED_SECTION_RESOLVE
        }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step review-summary failed for src\/app\.ts: review startup failed/u
  );

  assert.equal(createAttempts, 3);
});

test("StepRunner invokes onStepRetry with stepId, filePath, attempt 0, and cause when the first attempt fails", async () => {
  const context = createStepRunnerContext();
  const retryInfos: unknown[] = [];
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ sessionIndex }) {
        return `## Summary\n- 整體理解：attempt ${sessionIndex}`;
      }
    }),
    onStepRetry(info) {
      retryInfos.push({ ...info });
    }
  });

  const result = await runDefaultCheckedSectionStep(runner, context);

  result.applyTo(context);

  assert.equal(retryInfos.length, 1);
  assert.deepEqual(
    {
      ...(retryInfos[0] as Record<string, unknown>),
      promptHash: "<stable-hash>"
    },
    {
      stepId: "review-summary",
      filePath: "src/app.ts",
      attempt: 0,
      cause: "deterministic completion failed",
      model: "gpt-5-mini",
      promptHash: "<stable-hash>",
      schemaId: "ReviewSummaryMarkdown",
      outputBaseDir: "/workspace/output"
    }
  );
  assert.match(
    (retryInfos[0] as { promptHash?: string }).promptHash ?? "",
    /^[0-9a-f]{8}$/u
  );
});

test("StepRunner does not invoke onStepRetry when the step succeeds on the first attempt", async () => {
  const context = createStepRunnerContext();
  let retryCallCount = 0;
  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Summary\n- 整體理解：成功一次完成";
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
        return `## Summary\n- 整體理解：attempt ${reviewAttempts}`;
      }
    }),
    onStepRetry() {
      throw new Error("onStepRetry exploded");
    }
  });

  // Should not throw despite onStepRetry throwing
  const result = await runDefaultCheckedSectionStep(runner, context);

  result.applyTo(context);

  assert.equal(reviewAttempts, 2);
  assert.match(context.getSection("summary") ?? "", /attempt 2/u);
});

test("StepRunner invokes onStepRetry when prepare itself throws on the first attempt", async () => {
  const context = createStepRunnerContext();
  const retryInfos: unknown[] = [];
  let prepareAttempts = 0;

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Summary\n- 整體理解：retry after prepare failure";
      }
    }),
    onStepRetry(info) {
      retryInfos.push({ ...info });
    }
  });

  const result = await runner.run({
    step: {
      stepId: "review-summary",
      prepare() {
        prepareAttempts += 1;

        if (prepareAttempts === 1) {
          throw new Error("prepare exploded");
        }

        return {
          stepId: "review-summary",
          prompt: { systemMessage: "system prompt", userMessage: "user prompt" },
          reviewProfile: {
            knowledgeMode: "disabled",
            model: "gpt-5-mini",
            timeoutMs: REVIEW_TURN_TIMEOUT_MS
          },
          async resolve(response: string) {
            return (targetContext: import("../../src/core/file-review-context.ts").FileReviewContext) => {
              targetContext.setSection("summary", response);
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
    stepId: "review-summary",
    filePath: "src/app.ts",
    attempt: 0,
    cause: "prepare exploded"
  });
  assert.match(context.getSection("summary") ?? "", /retry after prepare failure/u);
});

test("StepRunner does not invoke onStepRetry on the final attempt failure", async () => {
  const context = createStepRunnerContext();
  const retryInfos: unknown[] = [];

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait() {
        return "## Summary\n- 整體理解：always fails completion";
      }
    }),
    onStepRetry(info) {
      retryInfos.push({ ...info });
    }
  });

  await assert.rejects(
    () =>
      runner.run({
        step: createSectionTestStep({
          resolve: async () => {
            throw new Error("deterministic completion failed");
          }
        }),
        context,
        outputBaseDir: "/workspace/output",
        repoRoot: "/workspace/repo"
      }),
    /Step review-summary failed for src\/app\.ts: deterministic completion failed/u
  );

  // Called for attempts 0 and 1; NOT called for the final failure (attempt 2).
  assert.equal(retryInfos.length, 2);
  assert.equal((retryInfos[0] as { attempt: number }).attempt, 0);
  assert.equal((retryInfos[1] as { attempt: number }).attempt, 1);
});

function createReviewBasis(): ReviewBasisV1 {
  return {
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        before: "Candidate Findings consumed prose sections.",
        after: "Candidate Findings consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        statement: "ReviewBasis is emitted before Candidate Findings.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        statement: "Candidate Findings can validate source evidence IDs.",
        basedOnEvidenceIds: ["E1"],
        confidence: "high"
      }
    ],
    dependencyMap: {
      upstreamCallers: ["ReviewOrchestrator"],
      downstreamConsumers: ["CandidateFindingsStep"],
      externalContracts: [],
      sharedStateOrSideEffects: ["FileReviewContext"]
    },
    flowMap: {
      entryPoints: ["ReviewBasisStep.prepare"],
      stateTransitions: ["setReviewBasis"],
      asyncBoundaries: [],
      errorPaths: ["validator rejects missing evidence"]
    },
    testCoverage: {
      changedTests: ["test/core/step-runner-retry.test.ts"],
      observedCoverageSignals: ["retry test"],
      coverageGaps: []
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Evidence refs may be missing.",
        triggerCondition: "Candidate Findings cites absent evidence ID.",
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "src/app.ts:1",
        summary: "review basis state added"
      }
    ]
  };
}

function createCandidatePayload(
  findingId: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    findings: [
      {
        classification: "confirmed_problem",
        severity: "high",
        title: "guard moved after dereference",
        traceability: { kind: "line-range", lineStart: 1, lineEnd: 1 },
        evidence: "changed branch reads value before fallback at src/app.ts:1",
        triggerCondition: "nullable input reaches the changed branch",
        impact: "request fails before fallback can run",
        counterEvidence: ["fallback no longer precedes dereference"],
        ...overrides
      }
    ],
    findingOrigins: [
      {
        findingIndex: 1,
        kind: "hypothesis",
        hypothesisIds: ["H1"],
        evidenceIds: ["E1"],
        rationale: `${findingId} validates the hypothesis.`
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        rationale: `${findingId} validates the hypothesis.`
      }
    ],
    criticalMissingInformation: []
  };
}
