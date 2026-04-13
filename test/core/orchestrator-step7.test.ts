import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  assertObservedProfilesUseExpectedModels,
  collectReviewableFiles,
  createObservedStepRunner,
  createStepResponseRouter,
  loadPlannedNoteContents,
  type StepId
} from "../helpers/orchestrator-step-contract-fixture.ts";
import { buildSimulationStep5JsonResponse, buildSimulationStep6JsonResponse, buildSummaryResponse, detectStepId, escapeRegExp, extractDiffPath } from "../helpers/orchestrator-fixture.ts";

test("ReviewOrchestrator executes Step 1 then Step 2 then Step 3 then Step 4 then Step 5 then Step 6 then Step 7 in filtered changed-file order and passes current review into Step 7", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedProfiles: Array<Record<string, string>> = [];
    const observedStepEvents: Array<[StepId, string]> = [];
    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const observedDisconnects: string[] = [];
    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const stepRunner = createObservedStepRunner({
      observedDisconnects,
      observedProfiles,
      observedPrompts,
      observedStepEvents,
      buildStepResponse
    });
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner,
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    const outputBaseDir = realpathSync(fixture.repoDir);
    const { repoRoot, reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);

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
    assert.equal(observedDisconnects.length, reviewableFiles.length * 7);
    assert.equal(observedProfiles.length, reviewableFiles.length * 7);

    assertObservedProfilesUseExpectedModels(observedProfiles, outputBaseDir, repoRoot);

    const step7Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step7-summary"
    );

    assert.match(
      step7Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Findings[\s\S]*\[must\] 最終 findings/u
    );
    assert.doesNotMatch(step7Prompt?.prompt ?? "", /<diff/u);
    assert.doesNotMatch(step7Prompt?.prompt ?? "", /<changeset_context>/u);
    assert.doesNotMatch(step7Prompt?.prompt ?? "", /Review not yet generated/u);
    assert.equal(existsSync(result.outputTarget.basePath), true);
    assert.equal(existsSync(result.outputTarget.filesPath), true);
    assert.equal(existsSync(result.outputTarget.skippedPath), true);

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      const noteContent = plannedNote.content;

      assert.match(noteContent, /^## Summary/mu);
      assert.match(noteContent, /## Findings[\s\S]*## Summary/u);
      assert.match(noteContent, /### 審查基礎/u);
      assert.match(noteContent, /### 行為變更提醒/u);
      assert.match(noteContent, /### 風險評估/u);
      assert.match(noteContent, /\[must\] 最終 findings/u);
      assert.doesNotMatch(noteContent, /Step 8|aggregate summary|pending/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator passes explicit empty Step 6 findings into Step 7 and still publishes Summary", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createObservedStepRunner({
        observedDisconnects: [],
        observedProfiles: [],
        observedPrompts,
        observedStepEvents: [],
        buildStepResponse(stepId, filePath) {
          if (stepId === "step6-cognitive-simulation") {
            return JSON.stringify({ findings: [] });
          }

          return buildStepResponse(stepId, filePath);
        }
      }),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const step7Prompts = observedPrompts.filter(({ stepId }) => stepId === "step7-summary");

    assert.ok(step7Prompts.length > 0);
    for (const prompt of step7Prompts) {
      assert.match(prompt.prompt, /<current_review>[\s\S]*## Findings\n- 無/u);
      assert.doesNotMatch(prompt.prompt, /無 findings\./u);
      assert.doesNotMatch(prompt.prompt, /<diff/u);
      assert.doesNotMatch(prompt.prompt, /<changeset_context>/u);
    }

    for (const plannedNote of loadPlannedNoteContents(result.outputTarget, reviewableFiles)) {
      assert.match(plannedNote.content, /## Findings\n- 無[\s\S]*## Summary/u);
      assert.doesNotMatch(plannedNote.content, /無 findings\./u);
      assert.match(plannedNote.content, /### 風險評估/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not start Step 7 for a failed Step 6 file and continues later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step6 gating");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const failedFile = reviewableFiles[1];
    const observedStepEvents: Array<[StepId, string]> = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createObservedStepRunner({
        observedDisconnects: [],
        observedProfiles: [],
        observedPrompts: [],
        observedStepEvents,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step6-cognitive-simulation" && filePath === failedFile) {
            return "{\"findings\":[}";
          }

          return buildStepResponse(stepId, filePath);
        }
      }),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.equal(result.plannedFileCount, reviewableFiles.length);

    assert.equal(
      observedStepEvents.filter(
        ([s, f]) => s === "step6-cognitive-simulation" && f === failedFile
      ).length,
      2
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

test("ReviewOrchestrator retries Step 7 after judge rejection and publishes only the successful retry snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedStepEvents: Array<[StepId, string]> = [];
    const judgeAttempts = new Map();
    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const { reviewableFiles } = collectReviewableFiles({
      sourceProvider,
      reviewFileFilter,
      repoDir: fixture.repoDir
    });
    const retryFile = reviewableFiles[1];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createObservedStepRunner({
        observedDisconnects: [],
        observedProfiles: [],
        observedPrompts: [],
        observedStepEvents,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step7-summary") {
            const attempt = observedStepEvents.filter(
              ([s, f]) => s === stepId && f === filePath
            ).length;

            return buildSummaryResponse(filePath, { label: `${filePath} attempt ${attempt}` });
          }

          return buildStepResponse(stepId, filePath);
        },
        judgeService: {
          async evaluate(judgeInput) {
            const key = `${judgeInput.stepId}:${judgeInput.filePath}`;
            const attempt = (judgeAttempts.get(key) ?? 0) + 1;

            judgeAttempts.set(key, attempt);

            if (
              judgeInput.stepId === "step7-summary" &&
              judgeInput.filePath === retryFile &&
              attempt === 1
            ) {
              return { passed: false, cause: "judge rejected" };
            }

            return { passed: true };
          }
        }
      }),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    const retriedNote = loadPlannedNoteContents(result.outputTarget, reviewableFiles)
      .find(({ filePath }) => filePath === retryFile)!;

    const step7Attempts = observedStepEvents.filter(
      ([s, f]) => s === "step7-summary" && f === retryFile
    ).length;

    assert.equal(step7Attempts, 2);
    assert.equal(judgeAttempts.get(`step7-summary:${retryFile}`), 2);
    assert.match(retriedNote.content, /attempt 2/u);
    assert.doesNotMatch(retriedNote.content, /attempt 1/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator skips Step 7 after judge rejection retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 judge rejection",
    expectedErrorPattern:
      /step7-summary.*judge rejected|judge rejected.*step7-summary/u,
    expectedReason: "judge rejected",
    judgeFailureCause: "judge rejected"
  });
});

test("ReviewOrchestrator skips Step 7 after judge timeout retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 judge timeout",
    expectedErrorPattern:
      /step7-summary.*judge timeout|judge timeout.*step7-summary/u,
    expectedReason: "judge timeout",
    judgeFailureCause: "judge timeout"
  });
});

test("ReviewOrchestrator skips Step 7 after review timeout retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 review timeout",
    expectedErrorPattern:
      /step7-summary.*review timeout|review timeout.*step7-summary/u,
    expectedReason: "review timeout",
    reviewFailure() {
      throw new Error("review timeout");
    }
  });
});

test("ReviewOrchestrator skips Step 7 after empty review response retry exhaustion and preserves the Step 6 snapshot", async () => {
  await assertStep7Failure({
    title: "step7 empty response",
    expectedErrorPattern:
      /step7-summary.*empty review response|empty review response.*step7-summary/u,
    expectedReason: "empty review response",
    reviewFailure() {
      return { data: { content: "   " } };
    }
  });
});

test("ReviewOrchestrator skips Step 7 after review startup failure retry exhaustion and preserves the Step 6 snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step7 startup failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    let step7SessionCount = 0;
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: new StepRunner({
        reviewSessionFactory: {
          async createSession(profile) {
            if (/## Current Step: Summary/u.test(profile.systemMessage)) {
              step7SessionCount += 1;

              // 2nd and 3rd step7 sessions are for failedFile (initial + retry)
              if (step7SessionCount === 2 || step7SessionCount === 3) {
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
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.equal(step7SessionCount, reviewableFiles.length + 1);

    const plannedNotes = loadPlannedNoteContents(result.outputTarget, reviewableFiles);
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === reviewableFiles[2])!;

    assert.match(failedNote.content, /step7-summary/u);
    assert.match(failedNote.content, /review startup failed/u);
    assert.match(laterNote.content, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

async function assertStep7Failure(input: {
  title: string;
  expectedErrorPattern: RegExp;
  expectedReason: string;
  judgeFailureCause?: "judge rejected" | "judge timeout";
  reviewFailure?: () => { data?: { content?: string } } | never;
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll(`add third changed file for ${input.title}`);

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
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createObservedStepRunner({
        observedDisconnects: [],
        observedProfiles: [],
        observedPrompts: [],
        observedStepEvents,
        buildStepResponse(stepId, filePath) {
          if (stepId === "step7-summary" && filePath === failedFile) {
            if (input.reviewFailure) {
              const failureResult = input.reviewFailure();
              return failureResult?.data?.content ?? "";
            }

            return buildSummaryResponse(filePath);
          }

          return buildStepResponse(stepId, filePath);
        },
        judgeService: input.judgeFailureCause
          ? {
              async evaluate(judgeInput) {
                if (
                  judgeInput.stepId === "step7-summary" &&
                  judgeInput.filePath === failedFile
                ) {
                  return { passed: false, cause: input.judgeFailureCause! };
                }

                return { passed: true };
              }
            }
          : undefined
      }),
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => "03131430"
    });

    const result = await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: [],
      dryRun: false
    });

    assert.equal(
      observedStepEvents.filter(([s, f]) => s === "step7-summary" && f === failedFile).length,
      2
    );
    assert.equal(
      observedStepEvents.filter(([s, f]) => s === "step7-summary" && f === laterFile).length,
      1
    );

    const plannedNotes = loadPlannedNoteContents(result.outputTarget, reviewableFiles);
    const successfulNote = plannedNotes.find(({ filePath }) => filePath === successfulFile)!;
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === laterFile)!;

    assert.match(successfulNote.content, /^## Summary/mu);

    assert.match(failedNote.content, /^## Findings/mu);
    assert.doesNotMatch(failedNote.content, /^## Summary/mu);
    assert.doesNotMatch(failedNote.content, /Review not yet generated/u);
    assert.match(failedNote.content, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNote.content, /step7-summary/u);
    assert.match(failedNote.content, new RegExp(escapeRegExp(input.expectedReason), "u"));

    assert.match(laterNote.content, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
}

const buildStepResponse = createStepResponseRouter({
  step5Response() {
    return buildSimulationStep5JsonResponse();
  },
  step6Response() {
    return buildSimulationStep6JsonResponse();
  },
  step7Response(filePath: string) {
    return buildSummaryResponse(filePath);
  }
});
