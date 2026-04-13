import assert from "node:assert/strict";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  type StepId,
  collectReviewableFiles,
  createObservedStepRunner,
  createStepResponseRouter,
  loadPlannedNoteContents
} from "../helpers/orchestrator-step-contract-fixture.ts";
import {
  buildStandardStep5JsonResponse,
  buildStandardStep6JsonResponse,
  buildStandardStep7SummaryResponse,
  buildStrategyResponse
} from "../helpers/orchestrator-fixture.ts";

const buildStepResponse = createStepResponseRouter({
  step5Response() {
    return buildStandardStep5JsonResponse();
  },
  step6Response() {
    return buildStandardStep6JsonResponse();
  },
  step7Response(filePath: string) {
    return buildStandardStep7SummaryResponse(filePath);
  }
});

test("ReviewOrchestrator passes the Step 4 snapshot into Step 5 and publishes Findings afterwards", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const observedDisconnects: string[] = [];
    const observedProfiles: Array<Record<string, string>> = [];
    const observedStepEvents: Array<[StepId, string]> = [];
    const observedPrompts: Array<{ stepId: StepId; prompt: string }> = [];
    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createObservedStepRunner({
        observedDisconnects,
        observedProfiles,
        observedPrompts,
        observedStepEvents,
        buildStepResponse
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
    const step5Prompt = observedPrompts.find(
      ({ stepId }) => stepId === "step5-validation-interrogation"
    );

    assert.match(
      step5Prompt?.prompt ?? "",
      /<current_review>[\s\S]*## Strategy & What-if Scenarios/u
    );
    assert.doesNotMatch(step5Prompt?.prompt ?? "", /^## Findings/mu);

    for (const plannedNote of loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    )) {
      assert.match(plannedNote.content, /^## Strategy & What-if Scenarios/mu);
      assert.match(plannedNote.content, /^## Findings/mu);
      assert.match(
        plannedNote.content,
        /## Strategy & What-if Scenarios[\s\S]*## Findings/u
      );
      assert.doesNotMatch(plannedNote.content, /confidence/u);
    }
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves the Step 3 snapshot when Step 4 exhausts, skips the file, and continues later files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for step4 exhaustion");

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
          if (stepId === "step4-strategy-what-if-scenarios" && filePath === failedFile) {
            return "   ";
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
      observedStepEvents.some(([s, f]) => s === "step5-validation-interrogation" && f === failedFile),
      false
    );
    assert.equal(
      observedStepEvents.some(([s, f]) => s === "step6-cognitive-simulation" && f === failedFile),
      false
    );

    const plannedNotes = loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    );
    const successfulNote = plannedNotes.find(
      ({ filePath }) => filePath === reviewableFiles[0]
    )!;
    const failedNote = plannedNotes.find(({ filePath }) => filePath === failedFile)!;
    const laterNote = plannedNotes.find(({ filePath }) => filePath === reviewableFiles[2])!;

    assert.match(successfulNote.content, /^## Summary/mu);

    assert.match(failedNote.content, /^## Knowledge & Source of Truth/mu);
    assert.doesNotMatch(failedNote.content, /^## Strategy & What-if Scenarios/mu);
    assert.doesNotMatch(failedNote.content, /^## Findings/mu);
    assert.match(failedNote.content, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNote.content, /step4-strategy-what-if-scenarios/u);
    assert.match(failedNote.content, /empty review response/u);

    assert.match(laterNote.content, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator retries Step 4 after judge rejection and still finishes through Step 5", async () => {
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
          if (stepId === "step4-strategy-what-if-scenarios") {
            const attempt = observedStepEvents.filter(
              ([s, f]) => s === stepId && f === filePath
            ).length;

            return buildStrategyResponse(filePath, { label: `${filePath} attempt ${attempt}` });
          }

          return buildStepResponse(stepId, filePath);
        },
        judgeService: {
          async evaluate(input) {
            const key = `${input.stepId}:${input.filePath}`;
            const attempt = (judgeAttempts.get(key) ?? 0) + 1;

            judgeAttempts.set(key, attempt);

            if (
              input.stepId === "step4-strategy-what-if-scenarios" &&
              input.filePath === retryFile &&
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

    const plannedNotes = loadPlannedNoteContents(
      result.outputTarget,
      reviewableFiles
    );
    const retriedNote = plannedNotes.find(({ filePath }) => filePath === retryFile)!;

    const step4Attempts = observedStepEvents.filter(
      ([s, f]) => s === "step4-strategy-what-if-scenarios" && f === retryFile
    ).length;
    assert.equal(step4Attempts, 2);
    assert.equal(judgeAttempts.get(`step4-strategy-what-if-scenarios:${retryFile}`), 2);
    assert.match(retriedNote.content, /attempt 2/u);
    assert.doesNotMatch(retriedNote.content, /attempt 1/u);
    assert.match(retriedNote.content, /^## Findings/mu);
  } finally {
    fixture.cleanup();
  }
});
