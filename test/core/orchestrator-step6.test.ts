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
  buildSimulationStep5JsonResponse,
  buildSimulationStep6JsonResponse,
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
    return buildSimulationStep5JsonResponse();
  },
  step6Response() {
    return buildSimulationStep6JsonResponse();
  },
  step7Response(filePath: string) {
    return buildStandardStep7SummaryResponse(filePath);
  }
});

const STEP6_RETRY_EXHAUSTION_CASES = [
  {
    label: "malformed JSON",
    title: "step6 malformed json",
    expectedReason: "deterministic validation failed",
    step6ReviewFailure() {
      return { data: { content: '{"findings":[}' } };
    }
  },
  {
    label: "extra trailing text",
    title: "step6 extra trailing text",
    expectedReason: "deterministic validation failed",
    step6ReviewFailure() {
      return {
        data: {
          content: '{"findings": []}\nextra trailing text'
        }
      };
    }
  },
  {
    label: "schema-invalid JSON",
    title: "step6 schema invalid",
    expectedReason: "deterministic validation failed",
    step6ReviewFailure() {
      return {
        data: {
          content: JSON.stringify({
            findings: [
              {
                type: "must",
                title: "",
                traceability: lineRangeTraceability(30, 32),
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
    title: "step6 empty response",
    expectedReason: "empty review response",
    step6ReviewFailure() {
      return { data: { content: "   " } };
    }
  },
  {
    label: "review timeout",
    title: "step6 review timeout",
    expectedReason: "review timeout",
    step6ReviewFailure(): ReviewStepFailureResponse {
      throw new Error("review timeout");
    }
  }
] satisfies ReadonlyArray<{
  label: string;
  title: string;
  expectedReason: string;
  step6ReviewFailure(): ReviewStepFailureResponse | never;
}>;

test("ReviewOrchestrator executes Step 1 then Step 2 then Step 3 then Step 4 then Step 5 then Step 6 then Step 7 in filtered changed-file order and passes current review into Step 6", async () => {
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

    const step6Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );

    assert.match(
      step6Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Findings[\s\S]*\[must\] 初版 findings/u
    );
    assert.doesNotMatch(step6Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      const noteContent = plannedNote.content;

      assert.match(noteContent, /^## Findings/mu);
      assert.match(
        noteContent,
        /## Strategy & What-if Scenarios[\s\S]*## Findings/u
      );
      assert.match(noteContent, /\[must\] 最終 findings/u);
      assert.doesNotMatch(noteContent, /\[must\] 初版 findings/u);
      assert.doesNotMatch(noteContent, /confidence/u);
      assert.match(noteContent, /^## Summary/mu);
      assert.match(noteContent, /## Findings[\s\S]*## Summary/u);
      assert.doesNotMatch(noteContent, /pending/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator passes explicit empty Step 5 findings into Step 6 and allows Step 6 to replace them with final findings", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const { orchestrator, sourceProvider, reviewFileFilter } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        observedPrompts,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step5-validation-interrogation") {
            return JSON.stringify({ findings: [] });
          }

          if (stepId === "step6-cognitive-simulation") {
            return JSON.stringify({
              findings: [
                {
                  type: "must",
                  title: `Step6 restored ${filePath}`,
                  traceability: lineRangeTraceability(30, 32),
                  context: "模擬路徑重新確認",
                  deviation: "first-pass 未涵蓋最終偏差",
                  impact: "會造成 correctness 問題",
                  suggestion: "補上 final guard",
                  confidence: 91
                }
              ]
            });
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
    const step6Prompts = observedPrompts.filter(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );

    assert.ok(step6Prompts.length > 0);
    for (const prompt of step6Prompts) {
      assert.match(prompt.prompt, /<current_review>[\s\S]*## Findings\n- 無/u);
      assert.doesNotMatch(prompt.prompt, /無 findings\./u);
    }

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      assert.match(plannedNote.content, /^## Findings/mu);
      assert.match(plannedNote.content, /\[must\] Step6 restored/u);
      assert.doesNotMatch(plannedNote.content, /## Findings\n- 無/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator uses the same configured thresholds for Step 5 and Step 6", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const { orchestrator, sourceProvider, reviewFileFilter } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        observedPrompts,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step5-validation-interrogation") {
            return JSON.stringify({
              findings: [
                {
                  type: "must",
                  title: "低門檻 step5 must",
                  traceability: lineRangeTraceability(14, 18),
                  context: "具體情境",
                  deviation: "預期與實際有落差",
                  impact: "影響 correctness",
                  suggestion: "補上 guard",
                  confidence: 75
                },
                {
                  type: "nice",
                  title: "低門檻 step5 nice",
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
                  title: "低門檻 step6 must",
                  traceability: lineRangeTraceability(30, 32),
                  context: "模擬路徑重新確認",
                  deviation: "最終偏差確認",
                  impact: "會造成 correctness 問題",
                  suggestion: "補上 final guard",
                  confidence: 75
                },
                {
                  type: "nice",
                  title: "低門檻 step6 nice",
                  traceability: lineRangeTraceability(34, 35),
                  context: "模擬路徑重新確認",
                  deviation: "最終偏差確認",
                  impact: "影響可維護性",
                  suggestion: "補上整理",
                  confidence: 88
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

    const result = await orchestrator.run(STRUCTURED_STEP_RUN_REQUEST);

    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const step6Prompts = observedPrompts.filter(
      ({ stepId }) => stepId === "step6-cognitive-simulation"
    );

    assert.ok(step6Prompts.length > 0);
    for (const prompt of step6Prompts) {
      assert.match(prompt.prompt, /\[must\] 低門檻 step5 must/u);
      assert.match(prompt.prompt, /\[nice\] 低門檻 step5 nice/u);
    }

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      assert.match(plannedNote.content, /\[must\] 低門檻 step6 must/u);
      assert.match(plannedNote.content, /\[nice\] 低門檻 step6 nice/u);
      assert.doesNotMatch(plannedNote.content, /confidence/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator renders `## Findings` with `- 無` when Step 6 clears prior Step 5 findings", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const { orchestrator, sourceProvider, reviewFileFilter } = createStructuredStepTestOrchestrator(
      fixture,
      createObservedStepRunner({
        buildStepResponse(stepId, filePath) {
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
      assert.doesNotMatch(plannedNote.content, /初版 findings/u);
      assert.doesNotMatch(plannedNote.content, /confidence/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 6 for a failed Step 5 file and continues later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    addThirdChangedFile(fixture, "add third changed file for step5 gating");

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
          if (stepId === "step5-validation-interrogation" && filePath === failedFile) {
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
      observedStepEvents.some(([s, f]) => s === "step6-cognitive-simulation" && f === failedFile),
      false
    );
    assert.equal(
      observedStepEvents.some(([s, f]) => s === "step7-summary" && f === failedFile),
      false
    );

    const laterNote = loadPlannedNoteContents(result.outputTarget, reviewableFiles)
      .find(({ filePath }) => filePath === reviewableFiles[2])!;
    assert.match(laterNote.content, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 6 after deterministic validation failure and publishes only the successful retry snapshot", async () => {
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
          if (stepId === "step6-cognitive-simulation" && filePath === retryFile) {
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

    const step6Attempts = countStepAttempts(
      observedStepEvents,
      "step6-cognitive-simulation",
      retryFile
    );
    assert.equal(step6Attempts, 2);
    assert.match(retriedNote.content, /^## Findings/mu);
    assert.doesNotMatch(retriedNote.content, /Review Interrupted/u);
    assert.doesNotMatch(retriedNote.content, /初版 findings/u);
  } finally {
    fixture.cleanup();
  }
});

for (const testCase of STEP6_RETRY_EXHAUSTION_CASES) {
  test(`ReviewOrchestrator aborts Step 6 after ${testCase.label} retry exhaustion and preserves the Step 5 snapshot`, async () => {
    await assertStep6Failure(testCase);
  });
}

test("ReviewOrchestrator skips Step 6 after review startup failure retry exhaustion and preserves the Step 5 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    addThirdChangedFile(fixture, "add third changed file for step6 startup failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const failedFile = reviewableFiles[1];
    let step6SessionCount = 0;
    const { orchestrator } = createStructuredStepTestOrchestrator(
      fixture,
      new StepRunner({
        reviewSessionFactory: {
          async createSession(profile) {
            if (/## Current Step: Cognitive Simulation/u.test(profile.systemMessage)) {
              step6SessionCount += 1;

              // 2nd and 3rd step6 sessions are for failedFile (initial + retry)
              if (step6SessionCount === 2 || step6SessionCount === 3) {
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

    const plannedNotes = loadPlannedNoteContents(result.outputTarget, reviewableFiles);
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === reviewableFiles[2])!;

    assert.match(failedNote.content, /step6-cognitive-simulation/u);
    assert.match(failedNote.content, /review startup failed/u);
    assert.match(laterNote.content, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

async function assertStep6Failure(input: {
  title: string;
  expectedReason: string;
  step6ReviewFailure(): ReviewStepFailureResponse | never;
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
          if (stepId === "step6-cognitive-simulation" && filePath === failedFile) {
            const failureResult = input.step6ReviewFailure();
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
        "step6-cognitive-simulation",
        failedFile
      ),
      2
    );

    const plannedNotes = loadPlannedNoteContents(result.outputTarget, reviewableFiles);
    const successfulNote = plannedNotes.find(({ filePath }) => filePath === successfulFile)!;
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile)!;

    assert.match(successfulNote.content, /^## Summary/mu);

    assert.match(failedNote.content, /^## Findings/mu);
    assert.match(failedNote.content, /初版 findings/u);
    assert.doesNotMatch(failedNote.content, /最終 findings/u);
    assert.doesNotMatch(failedNote.content, /Review not yet generated/u);
    assert.match(failedNote.content, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNote.content, /step6-cognitive-simulation/u);
    assert.match(failedNote.content, new RegExp(escapeRegExp(input.expectedReason), "u"));

    assert.match(laterNote.content, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
}
