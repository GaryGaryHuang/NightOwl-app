import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
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
import { buildDependenciesResponse, buildKnowledgeResponse, buildOverviewResponse, buildSimulationStep5JsonResponse, buildSimulationStep6JsonResponse, buildStrategyResponse, buildSummaryResponse, detectStepId, escapeRegExp, lineRangeTraceability } from "../helpers/orchestrator-fixture.ts";
import { createStepResponseRouter } from "../helpers/orchestrator-step-contract-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";

test("ReviewOrchestrator skips a file after Step 1 exhaustion, publishes a bootstrap warning snapshot, records skipped.md, and continues later files", async () => {
  await assertSkipScenario({
    title: "step1 skip",
    failingStepId: "step1-overview",
    failingStepCause: "judge rejected",
    expectedFailedSnapshotPatterns: [
      /- Status: Review not yet generated\./u,
      /> \[!WARNING\] Review Interrupted/u,
      /step1-overview/u,
      /judge rejected/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Overview/mu]
  });
});

test("ReviewOrchestrator skips a file after Step 2 or Step 4 exhaustion and preserves the correct last successful snapshot", async () => {
  await assertSkipScenario({
    title: "step2 skip",
    failingStepId: "step2-dependencies-boundaries",
    failingStepCause: "judge timeout",
    expectedFailedSnapshotPatterns: [
      /^## Overview/mu,
      /> \[!WARNING\] Review Interrupted/u,
      /step2-dependencies-boundaries/u,
      /judge timeout/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Dependencies & Boundaries/mu]
  });

  await assertSkipScenario({
    title: "step4 skip",
    failingStepId: "step4-strategy-what-if-scenarios",
    failingStepCause: "judge rejected",
    expectedFailedSnapshotPatterns: [
      /^## Knowledge & Source of Truth/mu,
      /> \[!WARNING\] Review Interrupted/u,
      /step4-strategy-what-if-scenarios/u,
      /judge rejected/u
    ],
    expectedFailedSnapshotAbsentPatterns: [
      /^## Strategy & What-if Scenarios/mu,
      /^## Findings/mu
    ]
  });
});

test("ReviewOrchestrator skips a file after Step 5 or Step 6 exhaustion and preserves the correct last successful snapshot", async () => {
  await assertSkipScenario({
    title: "step5 skip",
    failingStepId: "step5-validation-interrogation",
    failingStepCause: "deterministic validation failed",
    expectedFailedSnapshotPatterns: [
      /^## Strategy & What-if Scenarios/mu,
      /> \[!WARNING\] Review Interrupted/u,
      /step5-validation-interrogation/u,
      /deterministic validation failed/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Findings/mu]
  });

  await assertSkipScenario({
    title: "step6 skip",
    failingStepId: "step6-cognitive-simulation",
    failingStepCause: "deterministic validation failed",
    expectedFailedSnapshotPatterns: [
      /^## Findings/mu,
      /\[must\] 初版 findings/u,
      /> \[!WARNING\] Review Interrupted/u,
      /step6-cognitive-simulation/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Summary/mu]
  });
});

test("ReviewOrchestrator skips a file after Step 7 exhaustion, preserves the Step 6 snapshot plus warning block, and continues later files", async () => {
  await assertSkipScenario({
    title: "step7 skip",
    failingStepId: "step7-summary",
    failingStepCause: "judge rejected",
    expectedFailedSnapshotPatterns: [
      /^## Findings/mu,
      /\[must\] 最終 findings/u,
      /> \[!WARNING\] Review Interrupted/u,
      /step7-summary/u,
      /judge rejected/u
    ],
    expectedFailedSnapshotAbsentPatterns: [/^## Summary/mu]
  });
});

test("ReviewOrchestrator can complete a run with both successful and skipped files without introducing aggregate output artifacts", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for mixed-result run");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const outputBaseDir = realpathSync(fixture.repoDir);
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSkipAwareRunner({
        failedFile,
        failingStepId: "step6-cognitive-simulation",
        failingStepCause: "deterministic validation failed"
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

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const firstSuccessful = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    const failedSkipped = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    const laterSuccessful = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === laterFile)!.noteFilePath,
      "utf8"
    );
    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.match(firstSuccessful, /^## Summary/mu);
    assert.match(laterSuccessful, /^## Summary/mu);
    assert.match(failedSkipped, /> \[!WARNING\] Review Interrupted/u);
    assert.match(skippedLog, new RegExp(`- \`${escapeRegExp(failedFile)}\``, "u"));
    assert.doesNotMatch(skippedLog, /aggregate|summary\.md|index\.md/u);
  } finally {
    fixture.cleanup();
  }
});

async function assertSkipScenario(input: {
  title: string;
  failingStepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation"
    | "step7-summary";
  failingStepCause:
    | "judge rejected"
    | "judge timeout"
    | "deterministic validation failed";
  expectedFailedSnapshotPatterns: RegExp[];
  expectedFailedSnapshotAbsentPatterns: RegExp[];
}): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll(`add third changed file for ${input.title}`);

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSkipAwareRunner({
        failedFile,
        failingStepId: input.failingStepId,
        failingStepCause: input.failingStepCause
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

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const failedNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    const laterNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === laterFile)!.noteFilePath,
      "utf8"
    );
    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

    for (const pattern of input.expectedFailedSnapshotPatterns) {
      assert.match(failedNote, pattern);
    }

    for (const pattern of input.expectedFailedSnapshotAbsentPatterns) {
      assert.doesNotMatch(failedNote, pattern);
    }

    assert.match(
      skippedLog,
      new RegExp(
        `- \`${escapeRegExp(failedFile)}\` — ${escapeRegExp(input.failingStepId)} — ${escapeRegExp(input.failingStepCause)}`,
        "u"
      )
    );
    assert.match(laterNote, /^## Summary/mu);
    assert.doesNotMatch(failedNote, /provisional step|attempt 1|attempt 2/u);
  } finally {
    fixture.cleanup();
  }
}

function createSkipAwareRunner(input: {
  failedFile: string;
  failingStepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation"
    | "step7-summary";
  failingStepCause:
    | "judge rejected"
    | "judge timeout"
    | "deterministic validation failed";
}): StepRunner {
  const reviewAttempts = new Map<string, number>();

  return new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        const stepId = detectStepId(profile.systemMessage);

        return new SessionExecutor({
          async sendAndWait(options) {
            const filePath = extractPromptFilePath(options.prompt);
            const key = `${stepId}:${filePath}`;
            const attempt = (reviewAttempts.get(key) ?? 0) + 1;
            reviewAttempts.set(key, attempt);

            if (filePath === input.failedFile && stepId === input.failingStepId) {
              if (input.failingStepCause === "deterministic validation failed") {
                return { data: { content: "{\"findings\":[}" } };
              }

              return {
                data: {
                  content: buildStepResponse(stepId, filePath)
                }
              };
            }

            return {
              data: {
                content: buildStepResponse(stepId, filePath)
              }
            };
          },
          async disconnect() {}
        });
      }
    },
    structuredOutputValidator: new StructuredOutputValidator(),
    judgeService: {
      async evaluate(inputJudge) {
        if (
          inputJudge.filePath === input.failedFile &&
          inputJudge.stepId === input.failingStepId &&
          (input.failingStepCause === "judge rejected" ||
            input.failingStepCause === "judge timeout")
        ) {
          return { passed: false, cause: input.failingStepCause };
        }

        return { passed: true };
      }
    }
  });
}

const buildStepResponse = createStepResponseRouter({
  step5Response: () => buildSimulationStep5JsonResponse(),
  step6Response: () => buildSimulationStep6JsonResponse(),
  step7Response: (fp) => buildSummaryResponse(fp)
});

// ---------------------------------------------------------------------------
// getDiff failure → skip degradation (diff-loading)
// ---------------------------------------------------------------------------

test("ReviewOrchestrator skips a file when getDiff fails with stepId diff-loading and original error as reason, while other files complete normally", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for getDiff skip");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: {
        resolveRepoRoot(startPath) { return sourceProvider.resolveRepoRoot(startPath); },
        getChangedFiles(r, b, h) { return sourceProvider.getChangedFiles(r, b, h); },
        getChangesetEntries(r, b, h) { return sourceProvider.getChangesetEntries(r, b, h); },
        getDiff(r, b, h, filePath) {
          if (filePath === failedFile) {
            throw new Error("fatal: bad revision 'xyz'");
          }

          return sourceProvider.getDiff(r, b, h, filePath);
        },
        getCurrentBranch(r) { return sourceProvider.getCurrentBranch(r); }
      },
      reviewFileFilter,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSkipAwareRunner({
        failedFile: "__none__",
        failingStepId: "step1-overview",
        failingStepCause: "judge rejected"
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

    assert.equal(result.skippedFileCount, 1);
    assert.equal(result.successfulFileCount, reviewableFiles.length - 1);

    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const failedNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === failedFile)!.noteFilePath,
      "utf8"
    );
    const laterNote = readFileSync(
      plannedNotes.find(({ filePath }) => filePath === laterFile)!.noteFilePath,
      "utf8"
    );
    const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

    // Interrupted snapshot with diff-loading warning
    assert.match(failedNote, /> \[!WARNING\] Review Interrupted/u);
    assert.match(failedNote, /diff-loading/u);
    assert.match(failedNote, /fatal: bad revision 'xyz'/u);

    // Skip record uses "diff-loading", NOT "step1-overview"
    assert.match(skippedLog, /diff-loading/u);
    assert.match(skippedLog, /fatal: bad revision 'xyz'/u);
    assert.doesNotMatch(skippedLog, /step1-overview/u);

    // Later files complete normally
    assert.match(laterNote, /^## Summary/mu);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator escalates to run abort when getDiff skip path encounters output publish error", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for getDiff output error");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    let publishFileReviewCallCount = 0;
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: {
        resolveRepoRoot(startPath) { return sourceProvider.resolveRepoRoot(startPath); },
        getChangedFiles(r, b, h) { return sourceProvider.getChangedFiles(r, b, h); },
        getChangesetEntries(r, b, h) { return sourceProvider.getChangesetEntries(r, b, h); },
        getDiff(r, b, h, filePath) {
          if (filePath === failedFile) {
            throw new Error("git diff failed");
          }

          return sourceProvider.getDiff(r, b, h, filePath);
        },
        getCurrentBranch(r) { return sourceProvider.getCurrentBranch(r); }
      },
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        initializeRun() { return this; },
        publishChangesetOverview() {},
        publishFileReview(fileResult) {
          publishFileReviewCallCount += 1;

          // Let bootstrap snapshots pass, but fail the interrupted snapshot for the failed file.
          if (
            fileResult.noteFilePath === failedNotePath &&
            publishFileReviewCallCount > reviewableFiles.length
          ) {
            throw new Error("disk write failed");
          }
        },
        publishSkippedFile() {},
        publishRunSummary() {},
        publishReviewIndex() {},
        publishRunManifest() {}
      }),
      stepRunner: createSkipAwareRunner({
        failedFile: "__none__",
        failingStepId: "step1-overview",
        failingStepCause: "judge rejected"
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

    await assert.rejects(
      () =>
        orchestrator.run({
          baseRef: "main",
          headRef: "feature-branch",
          repoPath: "./packages/app",
          userContext: [],
          dryRun: false
        }),
      /disk write failed/u
    );
  } finally {
    fixture.cleanup();
  }
});

function extractPromptFilePath(prompt: string): string {
  const diffMatch = prompt.match(/<diff path="([^"]+)"/u);

  if (diffMatch) {
    return diffMatch[1];
  }

  const sourceMatch = prompt.match(/- Source file: `([^`]+)`/u);

  if (sourceMatch) {
    return sourceMatch[1];
  }

  throw new Error(`Unable to determine file path from prompt: ${prompt}`);
}
