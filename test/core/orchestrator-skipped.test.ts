import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator, type ReviewOrchestratorOptions } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StructuredOutputValidator } from "../../src/core/structured-output-validator.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import type { ReviewSourceProvider } from "../../src/providers/review-source-provider.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { createReviewRepoFixture, type ReviewRepoFixture } from "../helpers/git-fixture.ts";
import {
  buildSimulationStep5JsonResponse,
  buildSimulationStep6JsonResponse,
  buildSummaryResponse,
  detectStepId,
  escapeRegExp
} from "../helpers/orchestrator-fixture.ts";
import { createStepResponseRouter } from "../helpers/orchestrator-step-contract-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";

const BASE_REF = "main";
const HEAD_REF = "feature-branch";
const RUN_TIMESTAMP = "03131430";
const REQUEST = {
  baseRef: BASE_REF,
  headRef: HEAD_REF,
  repoPath: "./packages/app",
  userContext: [],
  dryRun: false
};

type SkippableStepId =
  | "step1-overview"
  | "step2-dependencies-boundaries"
  | "step4-strategy-what-if-scenarios"
  | "step5-validation-interrogation"
  | "step6-cognitive-simulation"
  | "step7-summary";

type SkipCause =
  | "judge rejected"
  | "judge timeout"
  | "deterministic validation failed";

interface ReviewHarness {
  fixture: ReviewRepoFixture;
  repoRoot: string;
  reviewableFiles: string[];
  reviewFileFilter: LocalReviewFileFilter;
  sourceProvider: LocalGitProvider;
}

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
  await withReviewHarness(
    { commitMessage: "add third changed file for mixed-result run" },
    async (harness) => {
      const failedFile = harness.reviewableFiles[1];
      const laterFile = harness.reviewableFiles[2];

      const result = await runOrchestrator(harness, {
        stepRunner: createSkipAwareRunner({
          failedFile,
          failingStepId: "step6-cognitive-simulation",
          failingStepCause: "deterministic validation failed"
        })
      });

      const plannedNotes = planNoteFiles(result.outputTarget.filesPath, harness.reviewableFiles);
      const firstSuccessful = readFileSync(plannedNotes[0].noteFilePath, "utf8");
      const failedSkipped = readNoteForFile(plannedNotes, failedFile);
      const laterSuccessful = readNoteForFile(plannedNotes, laterFile);
      const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

      assert.equal(result.plannedFileCount, harness.reviewableFiles.length);
      assert.match(firstSuccessful, /^## Summary/mu);
      assert.match(laterSuccessful, /^## Summary/mu);
      assert.match(failedSkipped, /> \[!WARNING\] Review Interrupted/u);
      assert.match(skippedLog, new RegExp(`- \`${escapeRegExp(failedFile)}\``, "u"));
      assert.doesNotMatch(skippedLog, /aggregate|summary\.md|index\.md/u);
    }
  );
});

test("ReviewOrchestrator skips a file when getDiff fails with stepId diff-loading and original error as reason, while other files complete normally", async () => {
  await withReviewHarness(
    { commitMessage: "add third changed file for getDiff skip" },
    async (harness) => {
      const failedFile = harness.reviewableFiles[1];
      const laterFile = harness.reviewableFiles[2];
      const result = await runOrchestrator(harness, {
        sourceProvider: createDiffFailingSourceProvider(
          harness.sourceProvider,
          failedFile,
          "fatal: bad revision 'xyz'"
        ),
        stepRunner: createNeverFailingSkipAwareRunner()
      });

      const plannedNotes = planNoteFiles(result.outputTarget.filesPath, harness.reviewableFiles);
      const failedNote = readNoteForFile(plannedNotes, failedFile);
      const laterNote = readNoteForFile(plannedNotes, laterFile);
      const skippedLog = readFileSync(result.outputTarget.skippedPath, "utf8");

      assert.equal(result.skippedFileCount, 1);
      assert.equal(result.successfulFileCount, harness.reviewableFiles.length - 1);
      assert.match(failedNote, /> \[!WARNING\] Review Interrupted/u);
      assert.match(failedNote, /diff-loading/u);
      assert.match(failedNote, /fatal: bad revision 'xyz'/u);
      assert.match(skippedLog, /diff-loading/u);
      assert.match(skippedLog, /fatal: bad revision 'xyz'/u);
      assert.doesNotMatch(skippedLog, /step1-overview/u);
      assert.match(laterNote, /^## Summary/mu);
    }
  );
});

test("ReviewOrchestrator escalates to run abort when getDiff skip path encounters output publish error", async () => {
  await withReviewHarness(
    { commitMessage: "add third changed file for getDiff output error" },
    async (harness) => {
      const failedFile = harness.reviewableFiles[1];
      const failedNotePath = notePathFor(harness, failedFile);
      let publishFileReviewCallCount = 0;

      await assert.rejects(
        () =>
          runOrchestrator(harness, {
            sourceProvider: createDiffFailingSourceProvider(
              harness.sourceProvider,
              failedFile,
              "git diff failed"
            ),
            outputSink: defineOutputSinkDouble({
              initializeRun() {
                return this;
              },
              publishChangesetOverview() {},
              publishFileReview(fileResult) {
                publishFileReviewCallCount += 1;

                if (
                  fileResult.noteFilePath === failedNotePath &&
                  publishFileReviewCallCount > harness.reviewableFiles.length
                ) {
                  throw new Error("disk write failed");
                }
              },
              publishSkippedFile() {},
              publishRunSummary() {},
              publishReviewIndex() {},
              publishRunManifest() {}
            }),
            stepRunner: createNeverFailingSkipAwareRunner()
          }),
        /disk write failed/u
      );
    }
  );
});

async function assertSkipScenario(input: {
  title: string;
  failingStepId: SkippableStepId;
  failingStepCause: SkipCause;
  expectedFailedSnapshotPatterns: RegExp[];
  expectedFailedSnapshotAbsentPatterns: RegExp[];
}): Promise<void> {
  await withReviewHarness(
    { commitMessage: `add third changed file for ${input.title}` },
    async (harness) => {
      const failedFile = harness.reviewableFiles[1];
      const laterFile = harness.reviewableFiles[2];

      const result = await runOrchestrator(harness, {
        stepRunner: createSkipAwareRunner({
          failedFile,
          failingStepId: input.failingStepId,
          failingStepCause: input.failingStepCause
        })
      });

      const plannedNotes = planNoteFiles(result.outputTarget.filesPath, harness.reviewableFiles);
      const failedNote = readNoteForFile(plannedNotes, failedFile);
      const laterNote = readNoteForFile(plannedNotes, laterFile);
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
    }
  );
}

async function withReviewHarness(
  input: { commitMessage: string },
  run: (harness: ReviewHarness) => Promise<void>
): Promise<void> {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll(input.commitMessage);

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.repoDir);
    const reviewableFiles = reviewFileFilter.filterReviewableFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, BASE_REF, HEAD_REF)
    );

    await run({
      fixture,
      repoRoot,
      reviewableFiles,
      reviewFileFilter,
      sourceProvider
    });
  } finally {
    fixture.cleanup();
  }
}

async function runOrchestrator(
  harness: ReviewHarness,
  overrides: {
    outputSink?: ReviewOrchestratorOptions["outputSink"];
    sourceProvider?: ReviewSourceProvider;
    stepRunner: ReviewOrchestratorOptions["stepRunner"];
  }
) {
  const orchestrator = new ReviewOrchestrator({
    sourceProvider: overrides.sourceProvider ?? harness.sourceProvider,
    reviewFileFilter: harness.reviewFileFilter,
    outputSink: overrides.outputSink ?? new LocalWorkspaceProvider(),
    stepRunner: overrides.stepRunner,
    changesetOverviewRunner: {
      async run() {
        return createRunContext({
          changesetOverview: "## Changeset Overview\n- 調整範圍：feature",
          userContext: []
        });
      }
    },
    workingDirectory: harness.fixture.repoDir,
    timestampProvider: () => RUN_TIMESTAMP
  });

  return await orchestrator.run(REQUEST);
}

function createSkipAwareRunner(input: {
  failedFile: string;
  failingStepId: SkippableStepId;
  failingStepCause: SkipCause;
}): StepRunner {
  return new StepRunner({
    reviewSessionFactory: {
      async createSession(profile) {
        const stepId = detectStepId(profile.systemMessage);

        return new SessionExecutor({
          async sendAndWait(options) {
            const filePath = extractPromptFilePath(options.prompt);

            if (
              filePath === input.failedFile &&
              stepId === input.failingStepId &&
              input.failingStepCause === "deterministic validation failed"
            ) {
              return { data: { content: "{\"findings\":[}" } };
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

function createNeverFailingSkipAwareRunner(): StepRunner {
  return createSkipAwareRunner({
    failedFile: "__none__",
    failingStepId: "step1-overview",
    failingStepCause: "judge rejected"
  });
}

function createDiffFailingSourceProvider(
  sourceProvider: LocalGitProvider,
  failedFile: string,
  message: string
): ReviewSourceProvider {
  return {
    resolveRepoRoot(startPath) {
      return sourceProvider.resolveRepoRoot(startPath);
    },
    getChangedFiles(repoRoot, baseRef, headRef) {
      return sourceProvider.getChangedFiles(repoRoot, baseRef, headRef);
    },
    getChangesetEntries(repoRoot, baseRef, headRef) {
      return sourceProvider.getChangesetEntries(repoRoot, baseRef, headRef);
    },
    getDiff(repoRoot, baseRef, headRef, filePath) {
      if (filePath === failedFile) {
        throw new Error(message);
      }

      return sourceProvider.getDiff(repoRoot, baseRef, headRef, filePath);
    },
    getCurrentBranch(repoRoot) {
      return sourceProvider.getCurrentBranch(repoRoot);
    }
  };
}

const buildStepResponse = createStepResponseRouter({
  step5Response: () => buildSimulationStep5JsonResponse(),
  step6Response: () => buildSimulationStep6JsonResponse(),
  step7Response: (filePath) => buildSummaryResponse(filePath)
});

function readNoteForFile(
  plannedNotes: Array<{ filePath: string; noteFilePath: string }>,
  filePath: string
): string {
  return readFileSync(
    plannedNotes.find((plannedNote) => plannedNote.filePath === filePath)!.noteFilePath,
    "utf8"
  );
}

function notePathFor(harness: ReviewHarness, filePath: string): string {
  return planNoteFiles(expectedFilesPath(harness.repoRoot), harness.reviewableFiles).find(
    (plannedNote) => plannedNote.filePath === filePath
  )!.noteFilePath;
}

function expectedFilesPath(repoRoot: string): string {
  return path.join(
    repoRoot,
    ".nightowl",
    "review",
    `feature-branch_${RUN_TIMESTAMP}`,
    "files"
  );
}

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
