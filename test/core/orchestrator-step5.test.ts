import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  collectReviewableFiles,
  createObservedStepRunner,
  createStepResponseRouter,
  loadPlannedNoteContents,
  type StepId
} from "../helpers/orchestrator-step-contract-fixture.ts";
import {
  buildStandardStep6JsonResponse,
  buildStandardStep7SummaryResponse,
  detectStepId,
  escapeRegExp,
  extractDiffPath,
  lineRangeTraceability
} from "../helpers/orchestrator-fixture.ts";
import {
  addThirdChangedFile,
  countStepAttempts,
  createStructuredStepTestOrchestrator,
  STRUCTURED_STEP_RUN_REQUEST,
  type ReviewStepFailureResponse
} from "../helpers/orchestrator-structured-step-fixture.ts";

const buildStepResponse = createStepResponseRouter({
  step5Response() {
    return JSON.stringify({
      findings: [
        {
          type: "must",
          title: "問題標題",
          traceability: lineRangeTraceability(14, 18),
          context: "具體情境",
          deviation: "預期與實際有落差",
          impact: "會造成 correctness 問題",
          suggestion: "補上 guard",
          confidence: 88
        }
      ]
    });
  },
  step6Response() {
    return buildStandardStep6JsonResponse();
  },
  step7Response(filePath: string) {
    return buildStandardStep7SummaryResponse(filePath);
  }
});

const STEP5_RETRY_EXHAUSTION_CASES = [
  {
    label: "malformed JSON",
    title: "step5 malformed json",
    expectedReason: "deterministic validation failed",
    step5ReviewFailure() {
      return { data: { content: '{"findings":[}' } };
    }
  },
  {
    label: "schema-invalid JSON",
    title: "step5 schema invalid",
    expectedReason: "deterministic validation failed",
    step5ReviewFailure() {
      return {
        data: {
          content: JSON.stringify({
            findings: [
              {
                type: "must",
                title: "",
                traceability: lineRangeTraceability(14, 18),
                context: "具體情境",
                deviation: "預期與實際有落差",
                impact: "會造成 correctness 問題",
                suggestion: "補上 guard",
                confidence: 88
              }
            ]
          })
        }
      };
    }
  },
  {
    label: "empty review response",
    title: "step5 empty response",
    expectedReason: "empty review response",
    step5ReviewFailure() {
      return { data: { content: "   " } };
    }
  },
  {
    label: "review timeout",
    title: "step5 review timeout",
    expectedReason: "review timeout",
    step5ReviewFailure(): ReviewStepFailureResponse {
      throw new Error("review timeout");
    }
  }
] satisfies ReadonlyArray<{
  label: string;
  title: string;
  expectedReason: string;
  step5ReviewFailure(): ReviewStepFailureResponse | never;
}>;

test("ReviewOrchestrator executes Step 1 then Step 2 then Step 3 then Step 4 then Step 5 then Step 6 then Step 7 in filtered changed-file order and passes current review into Step 5", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedStepEvents: Array<[StepId, string]> = [];
    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const { orchestrator, sourceProvider, reviewFileFilter } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        observedPrompts,
        observedStepEvents,
        buildStepResponse
      })
    );

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    const { repoRoot, reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });

    assert.equal(result.repoRoot, repoRoot);
    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.deepEqual(
      observedStepEvents,
      reviewableFiles.flatMap((filePath) => [
        ["step1-overview", filePath],
        ["step2-dependencies-boundaries", filePath],
        ["step3-knowledge-source-of-truth", filePath],
        ["step4-strategy-what-if-scenarios", filePath],
        ["step5-validation-interrogation", filePath],
        ["step6-cognitive-simulation", filePath],
        ["step7-summary", filePath]
      ])
    );

    const step5Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step5-validation-interrogation"
    );

    assert.match(
      step5Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Strategy & What-if Scenarios/u
    );
    assert.doesNotMatch(step5Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.doesNotMatch(step5Prompt?.prompt ?? "", /^## Findings/mu);
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      const noteContent = plannedNote.content;

      assert.match(noteContent, /^## Strategy & What-if Scenarios/mu);
      assert.match(noteContent, /^## Findings/mu);
      assert.match(
        noteContent,
        /## Strategy & What-if Scenarios[\s\S]*## Findings/u
      );
      assert.doesNotMatch(noteContent, /confidence/u);
      assert.match(noteContent, /^## Summary/mu);
      assert.match(noteContent, /## Findings[\s\S]*## Summary/u);
      assert.doesNotMatch(noteContent, /pending/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 5 for a failed Step 4 file and continues later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    addThirdChangedFile(fixture, "add third changed file for step4 gating");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const failedFile = reviewableFiles[1];
    const observedStepEvents: Array<[StepId, string]> = [];
    const { orchestrator } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        observedStepEvents,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step4-strategy-what-if-scenarios" && filePath === failedFile) {
            return "   ";
          }

          return buildStepResponse(stepId, filePath);
        }
      }),
      { sourceProvider, reviewFileFilter }
    );

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    assert.equal(result.plannedFileCount, reviewableFiles.length);

    assert.equal(
      observedStepEvents.some(([s, f]) => s === "step5-validation-interrogation" && f === failedFile),
      false
    );
    assert.equal(
      observedStepEvents.some(([s, f]) => s === "step6-cognitive-simulation" && f === failedFile),
      false
    );
    assert.equal(
      observedStepEvents.some(([s, f]) => s === "step7-summary" && f === failedFile),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator renders `## Findings` with `- 無` when Step 5 returns an empty findings array", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const { orchestrator, sourceProvider, reviewFileFilter } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        buildStepResponse(stepId, filePath) {
          if (
            stepId === "step5-validation-interrogation" ||
            stepId === "step6-cognitive-simulation"
          ) {
            return JSON.stringify({ findings: [] });
          }

          return buildStepResponse(stepId, filePath);
        }
      })
    );

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      assert.match(plannedNote.content, /^## Findings/mu);
      assert.match(plannedNote.content, /## Findings\n- 無/u);
      assert.doesNotMatch(plannedNote.content, /無 findings\./u);
      assert.doesNotMatch(plannedNote.content, /confidence/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator treats confidence-filtered empty findings as a successful Step 5 outcome", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const { orchestrator, sourceProvider, reviewFileFilter } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        buildStepResponse(stepId, filePath) {
          if (stepId === "step5-validation-interrogation") {
            return JSON.stringify({
              findings: [
                {
                  type: "must",
                  title: "低信心 must",
                  traceability: lineRangeTraceability(14, 18),
                  context: "具體情境",
                  deviation: "預期與實際有落差",
                  impact: "會造成 correctness 問題",
                  suggestion: "補上 guard",
                  confidence: 79
                },
                {
                  type: "nice",
                  title: "低信心 nice",
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

          if (stepId === "step6-cognitive-simulation") {
            return JSON.stringify({ findings: [] });
          }

          return buildStepResponse(stepId, filePath);
        }
      })
    );

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      assert.match(plannedNote.content, /^## Findings/mu);
      assert.match(plannedNote.content, /## Findings\n- 無/u);
      assert.doesNotMatch(plannedNote.content, /無 findings\./u);
      assert.doesNotMatch(plannedNote.content, /低信心 must|低信心 nice/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator uses configured thresholds when Step 5 filters findings into the Step 6 prompt", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const { orchestrator } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        observedPrompts,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step5-validation-interrogation") {
            return JSON.stringify({
              findings: [
                {
                  type: "must",
                  title: "低門檻 must",
                  traceability: lineRangeTraceability(14, 18),
                  context: "具體情境",
                  deviation: "預期與實際有落差",
                  impact: "影響 correctness",
                  suggestion: "補上 guard",
                  confidence: 75
                },
                {
                  type: "nice",
                  title: "低門檻 nice",
                  traceability: lineRangeTraceability(20, 20),
                  context: "具體情境",
                  deviation: "可改善",
                  impact: "影響可維護性",
                  suggestion: "補上整理",
                  confidence: 88
                }
              ]
            });
          }

          if (stepId === "step6-cognitive-simulation") {
            return JSON.stringify({
              findings: [
                {
                  type: "must",
                  title: `Step6 must ${filePath}`,
                  traceability: lineRangeTraceability(30, 32),
                  context: "模擬路徑重新確認",
                  deviation: "最終偏差確認",
                  impact: "會造成 correctness 問題",
                  suggestion: "補上 final guard",
                  confidence: 91
                }
              ]
            });
          }

          return buildStepResponse(stepId, filePath);
        },
        structuredOutputValidator: new StructuredOutputValidator({
          confidenceThresholds: {
            must: 70,
            nice: 85
          }
        })
      })
    );

    await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    const step6Prompts = observedPrompts.filter(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );

    assert.ok(step6Prompts.length > 0);
    for (const prompt of step6Prompts) {
      assert.match(prompt.prompt, /\[must\] 低門檻 must/u);
      assert.match(prompt.prompt, /\[nice\] 低門檻 nice/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 5 after deterministic validation failure and publishes only the successful retry snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedStepEvents: Array<[StepId, string]> = [];
    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const retryFile = reviewableFiles[1];
    const { orchestrator } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        observedStepEvents,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step5-validation-interrogation" && filePath === retryFile) {
            const attempt = countStepAttempts(observedStepEvents, stepId, filePath);

            if (attempt === 1) {
              return '{"findings":[}';
            }
          }

          return buildStepResponse(stepId, filePath);
        }
      }),
      { sourceProvider, reviewFileFilter }
    );

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    const retriedNote = loadPlannedNoteContents(result.outputTarget, reviewableFiles)
      .find(({ filePath }) => filePath === retryFile)!;

    const step5Attempts = countStepAttempts(
      observedStepEvents,
      "step5-validation-interrogation",
      retryFile
    );
    assert.equal(step5Attempts, 2);
    assert.match(retriedNote.content, /^## Findings/mu);
    assert.doesNotMatch(retriedNote.content, /Review Interrupted/u);
  } finally {
    fixture.cleanup();
  }
});

for (const testCase of STEP5_RETRY_EXHAUSTION_CASES) {
  test(`ReviewOrchestrator aborts Step 5 after ${testCase.label} retry exhaustion and preserves the Step 4 snapshot`, async () => {
    await assertStep5Failure(testCase);
  });
}

test("ReviewOrchestrator skips Step 5 after review startup failure retry exhaustion and preserves the Step 4 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    addThirdChangedFile(fixture, "add third changed file for step5 startup failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const failedFile = reviewableFiles[1];
    let step5SessionCount = 0;
    const { orchestrator } = createStructuredStepTestOrchestrator(
      fixture,
      new StepRunner({
        reviewSessionFactory: {
          async createSession(profile) {
            if (/## Current Step: Validation & Interrogation/u.test(profile.systemMessage)) {
              step5SessionCount += 1;

              // 2nd and 3rd step5 sessions are for failedFile (initial + retry)
              if (step5SessionCount === 2 || step5SessionCount === 3) {
                throw new Error("review startup failed");
              }
            }

            const stepId = detectStepId(profile.systemMessage);

            return new SessionExecutor({
              async sendAndWait(options) {
                const filePath = extractDiffPath(options.prompt);
                return { data: { content: buildStepResponse(stepId, filePath) } };
              },
              async disconnect() {}
            });
          }
        },
        structuredOutputValidator: new StructuredOutputValidator(),
        judgeService: {
          async evaluate() {
            return { passed: true };
          }
        }
      }),
      { sourceProvider, reviewFileFilter }
    );

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    const failedNote = loadPlannedNoteContents(result.outputTarget, reviewableFiles)
      .find(({ filePath }) => filePath === failedFile)!;

    assert.match(failedNote.content, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNote.content, /^## Findings/mu);
    assert.match(failedNote.content, /step5-validation-interrogation/u);
    assert.match(failedNote.content, /review startup failed/u);
  } finally {
    fixture.cleanup();
  }
});

async function assertStep5Failure(input: {
  title: string;
  expectedReason: string;
  step5ReviewFailure(): ReviewStepFailureResponse | never;
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    addThirdChangedFile(fixture, `add third changed file for ${input.title}`);

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const successfulFile = reviewableFiles[0];
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const observedStepEvents: Array<[StepId, string]> = [];
    const { orchestrator } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        observedStepEvents,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step5-validation-interrogation" && filePath === failedFile) {
            const failureResult = input.step5ReviewFailure();
            return failureResult?.data?.content ?? "";
          }

          return buildStepResponse(stepId, filePath);
        }
      }),
      { sourceProvider, reviewFileFilter }
    );

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    assert.equal(
      countStepAttempts(
        observedStepEvents,
        "step5-validation-interrogation",
        failedFile
      ),
      2
    );

    const plannedNotes = loadPlannedNoteContents(result.outputTarget, reviewableFiles);
    const successfulNote = plannedNotes.find(({ filePath }) => filePath === successfulFile)!;
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile)!;

    assert.match(successfulNote.content, /^## Summary/mu);

    assert.match(failedNote.content, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNote.content, /^## Findings/mu);
    assert.doesNotMatch(failedNote.content, /Review not yet generated/u);
    assert.match(failedNote.content, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNote.content, /step5-validation-interrogation/u);
    assert.match(failedNote.content, new RegExp(escapeRegExp(input.expectedReason), "u"));

    assert.match(laterNote.content, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
}
