import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import type { OutputTarget } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { Finding } from "../../src/core/file-review-context.ts";
import { deriveFileRiskLevel } from "../../src/core/risk-level.ts";
import type { RunStepInput, StepResult, StepRunner } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import type { ReviewOutputSink } from "../../src/providers/review-output-sink.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { buildDependenciesResponse, buildKnowledgeResponse, buildOverviewResponse, buildStrategyResponse, escapeRegExp } from "../helpers/orchestrator-fixture.ts";

type OutputCall = [string, string];
type FileReviewPublishResult = Parameters<ReviewOutputSink["publishFileReview"]>[0];
type SkipRecord = Parameters<ReviewOutputSink["publishSkippedFile"]>[0];
type RunSummaryPublishResult = Parameters<ReviewOutputSink["publishRunSummary"]>[0];
type ReviewIndexPublishResult = Parameters<ReviewOutputSink["publishReviewIndex"]>[0];
type RunManifestPublishResult = Parameters<ReviewOutputSink["publishRunManifest"]>[0];
type Step7NarrativeRiskLevel = "High" | "Medium" | "Low" | "None";

interface SuccessfulStepOptions {
  findingsByFile?: ReadonlyMap<string, Finding[]>;
  narrativeRiskByFile?: ReadonlyMap<string, Step7NarrativeRiskLevel>;
}

test("ReviewOrchestrator publishes deterministic summary.md for an all-successful run", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSuccessfulSummaryRunner(),
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
      userContext: []
    });

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const manifestContent = readFileSync(result.outputTarget.manifestPath, "utf8");
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const manifest = JSON.parse(manifestContent) as {
      schemaVersion: number;
      successfulFileCount: number;
      artifacts: {
        manifestPath: string;
      };
    };
    const representativeNote = plannedNotes.find(
      (plannedNote) => plannedNote.filePath === "packages/app/index.ts"
    );
    assert.ok(representativeNote);
    const representativeLink = `./${path.relative(result.outputTarget.basePath, representativeNote.noteFilePath).replace(/\\/gu, "/")}`;

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.equal(result.successfulFileCount, reviewableFiles.length);
    assert.equal(result.skippedFileCount, 0);
    assert.deepEqual(
      result.outputTarget,
      createExpectedOutputTarget(fixture.appDir, "feature-branch_03131430")
    );
    assert.equal(existsSync(result.outputTarget.summaryPath), true);
    assert.equal(existsSync(result.outputTarget.indexPath), true);
    assert.equal(existsSync(result.outputTarget.manifestPath), true);
    assert.match(summaryContent, /^# Review Summary$/mu);
    assert.match(summaryContent, new RegExp(`- Planned files: ${reviewableFiles.length}`, "u"));
    assert.match(summaryContent, new RegExp(`- Successful files: ${reviewableFiles.length}`, "u"));
    assert.match(summaryContent, /## Successful Files/u);
    assert.equal(
      summaryContent.includes(`- [High] \`${representativeNote.filePath}\` — must=1, nice=0`),
      true
    );
    assert.match(indexContent, /^# Review Index$/mu);
    assert.match(indexContent, /## Run Artifacts/u);
    assert.match(indexContent, /\[changeset-overview\.md\]\(\.\/changeset-overview\.md\)/u);
    assert.equal(
      indexContent.includes(`[\`${representativeNote.filePath}\`](${representativeLink})`),
      true
    );
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.successfulFileCount, reviewableFiles.length);
    assert.equal(manifest.artifacts.manifestPath, result.outputTarget.manifestPath);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator derives High, Medium, Low, and None from formal findings and ignores stale Step 7 narrative risk text", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.writeFile("docs/notes.md", "- additional notes\n");
    fixture.commitAll("add files for derived risk coverage");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const findingsByFile = new Map<string, Finding[]>([
      [
        "src/app.ts",
        [createFinding("must", "threshold must", 90)]
      ],
      [
        "packages/app/index.ts",
        [createFinding("must", "below-threshold must", 89)]
      ],
      [
        "README.md",
        [createFinding("nice", "nice-only finding", 80)]
      ],
      ["docs/notes.md", []]
    ]);
    const narrativeRiskByFile = new Map<string, Step7NarrativeRiskLevel>(
      reviewableFiles.map((filePath) => [filePath, "Low"])
    );
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createSuccessfulSummaryRunner({
        findingsByFile,
        narrativeRiskByFile
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
      userContext: []
    });

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const noneNotePath = plannedNotes.find(
      (plannedNote) => plannedNote.filePath === "docs/notes.md"
    )?.noteFilePath;
    assert.ok(reviewableFiles.includes("src/app.ts"));
    assert.ok(reviewableFiles.includes("packages/app/index.ts"));
    assert.ok(reviewableFiles.includes("README.md"));
    assert.ok(reviewableFiles.includes("docs/notes.md"));
    assert.ok(noneNotePath);
    assert.match(readFileSync(noneNotePath, "utf8"), /- 整體風險等級：Low/u);
    assert.match(summaryContent, /- \[High\] `src\/app\.ts` — must=1, nice=0/u);
    assert.match(summaryContent, /- \[None\] `docs\/notes\.md` — must=0, nice=0/u);
    assert.match(indexContent, /- \[High\] \[`src\/app\.ts`\]/u);
    assert.match(indexContent, /- \[None\] \[`docs\/notes\.md`\]/u);
    assert.doesNotMatch(summaryContent, /\[Critical\]/u);
    assert.doesNotMatch(indexContent, /\[Critical\]/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator publishes summary.md for a mixed-result run from formal in-memory outcomes rather than disk notes", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for mixed aggregate summary");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const skippedFile = "README.md";
    const outputSink = new CorruptingSummaryOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createMixedResultRunner(skippedFile),
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
      userContext: []
    });

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const manifestContent = readFileSync(result.outputTarget.manifestPath, "utf8");
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const corruptedSuccessfulNote = readFileSync(plannedNotes[0].noteFilePath, "utf8");
    const manifest = JSON.parse(manifestContent) as {
      skippedFileCount: number;
      files: Array<{
        filePath: string;
        status: string;
        failedStepId?: string;
      }>;
    };
    const skippedManifestEntry = manifest.files.find(
      (fileEntry) => fileEntry.filePath === skippedFile
    );

    assert.match(corruptedSuccessfulNote, /CORRUPTED NOTE/u);
    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.equal(result.successfulFileCount, reviewableFiles.length - 1);
    assert.equal(result.skippedFileCount, 1);
    assert.deepEqual(
      result.outputTarget,
      createExpectedOutputTarget(fixture.appDir, "feature-branch_03131430")
    );
    assert.match(
      summaryContent,
      new RegExp(`- Successful files: ${reviewableFiles.length - 1}`, "u")
    );
    assert.match(summaryContent, /- Skipped files: 1/u);
    assert.doesNotMatch(summaryContent, /CORRUPTED NOTE/u);
    assert.match(
      summaryContent,
      new RegExp(`- \`${escapeRegExp(skippedFile)}\` — step5-validation-interrogation — deterministic validation failed`, "u")
    );
    assert.equal(manifest.skippedFileCount, 1);
    assert.equal(skippedManifestEntry?.status, "skipped");
    assert.equal(skippedManifestEntry?.failedStepId, "step5-validation-interrogation");
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator publishes summary.md for zero planned files with explicit empty sections", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "**\n");

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: {
        async run() {
          throw new Error("should not start steps");
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：無",
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
      userContext: []
    });

    assert.equal(result.plannedFileCount, 0);
    assert.equal(result.successfulFileCount, 0);
    assert.equal(result.skippedFileCount, 0);
    assert.deepEqual(
      result.outputTarget,
      createExpectedOutputTarget(fixture.appDir, "feature-branch_03131430")
    );
    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const manifest = JSON.parse(readFileSync(result.outputTarget.manifestPath, "utf8")) as {
      schemaVersion: number;
      plannedFileCount: number;
      successfulFileCount: number;
      skippedFileCount: number;
      artifacts: {
        summaryPath: string;
      };
      files: unknown[];
    };

    assert.match(summaryContent, /- Planned files: 0/u);
    assert.match(summaryContent, /- Successful files: 0/u);
    assert.match(summaryContent, /- Skipped files: 0/u);
    assert.match(summaryContent, /## Successful Files\n- 無/u);
    assert.match(summaryContent, /## Skipped Files\n- 無/u);
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.plannedFileCount, 0);
    assert.equal(manifest.successfulFileCount, 0);
    assert.equal(manifest.skippedFileCount, 0);
    assert.equal(manifest.artifacts.summaryPath, result.outputTarget.summaryPath);
    assert.equal(manifest.files.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator treats an all-skipped run as a completed run with zero successful files", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const outputSink = new CorruptingSummaryOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createAllSkippedRunner(new Set(reviewableFiles)),
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
      userContext: []
    });

    const summaryContent = readFileSync(result.outputTarget.summaryPath, "utf8");
    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const manifestContent = readFileSync(result.outputTarget.manifestPath, "utf8");
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const manifest = JSON.parse(manifestContent) as {
      successfulFileCount: number;
      skippedFileCount: number;
    };

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.equal(result.successfulFileCount, 0);
    assert.equal(result.skippedFileCount, reviewableFiles.length);
    assert.deepEqual(
      result.outputTarget,
      createExpectedOutputTarget(fixture.appDir, "feature-branch_03131430")
    );
    assert.match(summaryContent, new RegExp(`- Planned files: ${reviewableFiles.length}`, "u"));
    assert.match(summaryContent, /- Successful files: 0/u);
    assert.match(summaryContent, new RegExp(`- Skipped files: ${reviewableFiles.length}`, "u"));
    assert.match(indexContent, /^# Review Index$/mu);
    assert.match(indexContent, /## File Notes/u);
    for (const plannedNote of plannedNotes) {
      const noteLink = `./${path.relative(result.outputTarget.basePath, plannedNote.noteFilePath).replace(/\\/gu, "/")}`;
      assert.equal(
        indexContent.includes(`[Skipped] [\`${plannedNote.filePath}\`](${noteLink})`),
        true
      );
    }
    assert.equal(manifest.successfulFileCount, 0);
    assert.equal(manifest.skippedFileCount, reviewableFiles.length);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator publishes deterministic index.md for a mixed-result run from formal completed-run data rather than disk artifacts", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for review index");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const skippedFile = "README.md";
    const outputSink = new CorruptingIndexOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createMixedResultRunner(skippedFile),
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
      userContext: []
    });

    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");
    const manifestContent = readFileSync(result.outputTarget.manifestPath, "utf8");
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const successfulNote = plannedNotes.find(
      (plannedNote) => plannedNote.filePath === "packages/app/index.ts"
    );
    const skippedNote = plannedNotes.find((plannedNote) => plannedNote.filePath === skippedFile);

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.equal(result.successfulFileCount, reviewableFiles.length - 1);
    assert.equal(result.skippedFileCount, 1);
    assert.deepEqual(
      result.outputTarget,
      createExpectedOutputTarget(fixture.appDir, "feature-branch_03131430")
    );
    assert.equal(existsSync(result.outputTarget.indexPath), true);
    assert.ok(successfulNote);
    assert.ok(skippedNote);
    assert.match(indexContent, /^# Review Index$/mu);
    assert.match(indexContent, /## Run Artifacts/u);
    assert.match(indexContent, /\[summary\.md\]\(\.\/summary\.md\)/u);
    assert.equal(indexContent.includes(`[High] [\`${successfulNote.filePath}\`]`), true);
    assert.equal(indexContent.includes(`[Skipped] [\`${skippedNote.filePath}\`]`), true);
    assert.doesNotMatch(indexContent, /CORRUPTED SUMMARY/u);
    assert.doesNotMatch(indexContent, /EXTRA DISK FILE/u);
    assert.doesNotMatch(manifestContent, /CORRUPTED/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator publishes index.md for zero planned files with explicit empty file notes", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "**\n");

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: {
        async run() {
          throw new Error("should not start steps");
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: "## Changeset Overview\n- 調整範圍：無",
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
      userContext: []
    });

    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");

    assert.match(indexContent, /^# Review Index$/mu);
    assert.match(indexContent, /- Planned files: 0/u);
    assert.match(indexContent, /- Successful files: 0/u);
    assert.match(indexContent, /- Skipped files: 0/u);
    assert.match(indexContent, /## File Notes\n- 無/u);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not publish summary.md when applyTo fails after bootstrap", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const outputCalls: OutputCall[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: {
        initializeRun(outputTarget: OutputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult: FileReviewPublishResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord: SkipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary(summaryResult: RunSummaryPublishResult) {
          outputCalls.push(["publishRunSummary", summaryResult.content]);
        },
        publishReviewIndex(indexResult: ReviewIndexPublishResult) {
          outputCalls.push(["publishReviewIndex", indexResult.content]);
        },
        publishRunManifest(manifestResult: RunManifestPublishResult) {
          outputCalls.push(["publishRunManifest", manifestResult.content]);
        },
        publishChangesetOverview() {}
      },
      stepRunner: {
        async run({ step }) {
          if (step.stepId !== "step1-overview") {
            throw new Error(`should not reach ${step.stepId}`);
          }

          return {
            stepId: step.stepId,
            applyTo() {
              throw new Error("apply failed");
            }
          };
        }
      },
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
          userContext: []
        }),
      /apply failed/u
    );

    assert.equal(
      outputCalls.some(([callType]) => callType === "publishRunSummary"),
      false
    );
    assert.equal(
      outputCalls.some(([callType]) => callType === "publishReviewIndex"),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not publish summary.md when Step 0 fails before output initialization", async () => {
  const fixture = createReviewRepoFixture();

  try {
    const outputCalls: OutputCall[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: {
        initializeRun(outputTarget: OutputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult: FileReviewPublishResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord: SkipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary(summaryResult: RunSummaryPublishResult) {
          outputCalls.push(["publishRunSummary", summaryResult.content]);
        },
        publishReviewIndex(indexResult: ReviewIndexPublishResult) {
          outputCalls.push(["publishReviewIndex", indexResult.content]);
        },
        publishRunManifest(manifestResult: RunManifestPublishResult) {
          outputCalls.push(["publishRunManifest", manifestResult.content]);
        },
        publishChangesetOverview() {}
      },
      stepRunner: {
        async run() {
          throw new Error("should not start steps");
        }
      },
      changesetOverviewRunner: {
        async run() {
          throw new Error("Step 0 failed");
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
          userContext: []
        }),
      /Step 0 failed/u
    );

    assert.equal(outputCalls.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not publish summary.md when getDiff fails after bootstrap", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for getDiff no-summary");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const outputCalls: OutputCall[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: {
        resolveRepoRoot(startPath) {
          return sourceProvider.resolveRepoRoot(startPath);
        },
        getChangedFiles(repoRootArg, baseRef, headRef) {
          return sourceProvider.getChangedFiles(repoRootArg, baseRef, headRef);
        },
        getChangesetEntries(repoRootArg, baseRef, headRef) {
          return sourceProvider.getChangesetEntries(repoRootArg, baseRef, headRef);
        },
        getDiff(repoRootArg, baseRef, headRef, filePath) {
          if (filePath === failedFile) {
            throw new Error("git diff failed");
          }

          return sourceProvider.getDiff(repoRootArg, baseRef, headRef, filePath);
        },
        getCurrentBranch(repoRootArg) {
          return sourceProvider.getCurrentBranch(repoRootArg);
        },
        filterIgnoredFiles(repoRootArg, files) {
          return sourceProvider.filterIgnoredFiles(repoRootArg, files);
        }
      },
      outputSink: {
        initializeRun(outputTarget: OutputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult: FileReviewPublishResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord: SkipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary(summaryResult: RunSummaryPublishResult) {
          outputCalls.push(["publishRunSummary", summaryResult.content]);
        },
        publishReviewIndex(indexResult: ReviewIndexPublishResult) {
          outputCalls.push(["publishReviewIndex", indexResult.content]);
        },
        publishRunManifest(manifestResult: RunManifestPublishResult) {
          outputCalls.push(["publishRunManifest", manifestResult.content]);
        },
        publishChangesetOverview() {}
      },
      stepRunner: createSuccessfulSummaryRunner(),
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
          userContext: []
        }),
      /git diff failed/u
    );

    assert.equal(
      outputCalls.some(([callType]) => callType === "publishRunSummary"),
      false
    );
    assert.equal(
      outputCalls.some(([callType]) => callType === "publishReviewIndex"),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when publishRunSummary fails and preserves per-file artifacts", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const outputSink = new SummaryFailingOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink,
      stepRunner: createSuccessfulSummaryRunner(),
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
          userContext: []
        }),
      /summary write failed/u
    );

    assert.equal(outputSink.writtenFileReviews.length > 0, true);
    assert.equal(outputSink.publishRunSummaryCalls, 1);
    assert.equal(existsSync(outputSink.summaryPath ?? ""), false);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when publishReviewIndex fails after summary.md is written and preserves completed artifacts", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const outputSink = new IndexFailingOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink,
      stepRunner: createSuccessfulSummaryRunner(),
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
          userContext: []
        }),
      /index write failed/u
    );

    assert.equal(outputSink.publishRunSummaryCalls, 1);
    assert.equal(outputSink.publishReviewIndexCalls, 1);
    assert.equal(existsSync(outputSink.summaryPath ?? ""), true);
    assert.equal(existsSync(outputSink.indexPath ?? ""), false);
    assert.ok(outputSink.writtenFileReviews.length > 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when publishRunManifest fails after summary.md and index.md are written and preserves completed artifacts", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const outputSink = new ManifestFailingOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink,
      stepRunner: createSuccessfulSummaryRunner(),
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
          userContext: []
        }),
      /manifest write failed/u
    );

    assert.equal(outputSink.publishRunSummaryCalls, 1);
    assert.equal(outputSink.publishReviewIndexCalls, 1);
    assert.equal(outputSink.publishRunManifestCalls, 1);
    assert.equal(existsSync(outputSink.summaryPath ?? ""), true);
    assert.equal(existsSync(outputSink.indexPath ?? ""), true);
    assert.equal(existsSync(outputSink.manifestPath ?? ""), false);
    assert.ok(outputSink.writtenFileReviews.length > 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator publishes summary.md, index.md, and manifest.json only after per-file notes and skipped artifacts are finalized", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for summary publish ordering");

    const sourceProvider = new LocalGitProvider();
    const repoRoot = sourceProvider.resolveRepoRoot(fixture.appDir);
    const reviewableFiles = sourceProvider.filterIgnoredFiles(
      repoRoot,
      sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const skippedFile = reviewableFiles[1];
    const outputSink = new RecordingOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      outputSink,
      stepRunner: createMixedResultRunner(skippedFile),
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

    await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(outputSink.calls.at(-1), "publishRunManifest");
    assert.ok(outputSink.calls.includes("publishSkippedFile"));
    assert.ok(
      outputSink.calls.lastIndexOf("publishRunSummary") >
        outputSink.calls.lastIndexOf("publishSkippedFile")
    );
    assert.ok(
      outputSink.calls.lastIndexOf("publishRunSummary") >
        outputSink.calls.lastIndexOf("publishFileReview")
    );
    assert.ok(
      outputSink.calls.lastIndexOf("publishReviewIndex") >
        outputSink.calls.lastIndexOf("publishRunSummary")
    );
    assert.ok(
      outputSink.calls.lastIndexOf("publishRunManifest") >
        outputSink.calls.lastIndexOf("publishReviewIndex")
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator publishes manifest.json only after publishReviewIndex and does not rewrite finalized artifacts", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for index ordering");

    const outputSink = new IndexRecordingOutputSink();
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink,
      stepRunner: createMixedResultRunner("README.md"),
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

    await orchestrator.run({
      baseRef: "main",
      headRef: "feature-branch",
      repoPath: "./packages/app",
      userContext: []
    });

    assert.equal(outputSink.calls.at(-1), "publishRunManifest");
    assert.ok(
      outputSink.calls.lastIndexOf("publishReviewIndex") >
        outputSink.calls.lastIndexOf("publishRunSummary")
    );
    assert.ok(
      outputSink.calls.lastIndexOf("publishReviewIndex") >
        outputSink.calls.lastIndexOf("publishSkippedFile")
    );
    assert.ok(
      outputSink.calls.lastIndexOf("publishReviewIndex") >
        outputSink.calls.lastIndexOf("publishFileReview")
    );
    assert.ok(
      outputSink.calls.lastIndexOf("publishRunManifest") >
        outputSink.calls.lastIndexOf("publishReviewIndex")
    );
    assert.equal(outputSink.publishFileReviewCallsAfterManifest, 0);
    assert.equal(outputSink.publishRunSummaryCallsAfterManifest, 0);
    assert.equal(outputSink.publishReviewIndexCallsAfterManifest, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator wires successfulFiles and skippedFiles arrays to ReviewIndexFinalizer and renders risk indicators in index.md", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for risk wiring verification");

    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: new LocalWorkspaceProvider(),
      stepRunner: createMixedResultRunner("README.md"),
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
      userContext: []
    });

    const indexContent = readFileSync(result.outputTarget.indexPath, "utf8");

    assert.match(indexContent, /\[High\]/u);
    assert.match(indexContent, /\[Skipped\]/u);
  } finally {
    fixture.cleanup();
  }
});

function createSuccessfulSummaryRunner(
  options: SuccessfulStepOptions = {}
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      return buildSuccessfulStepResult(step.stepId, context.filePath, options);
    }
  };
}

function createMixedResultRunner(
  skippedFile: string,
  options: SuccessfulStepOptions = {}
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      if (
        context.filePath === skippedFile &&
        step.stepId === "step5-validation-interrogation"
      ) {
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: deterministic validation failed`
        );
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath, options);
    }
  };
}

function createAllSkippedRunner(
  skippedFiles: Set<string>,
  options: SuccessfulStepOptions = {}
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      if (skippedFiles.has(context.filePath) && step.stepId === "step1-overview") {
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: judge rejected`
        );
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath, options);
    }
  };
}

function buildSuccessfulStepResult(
  stepId: string,
  filePath: string,
  options: SuccessfulStepOptions = {}
): StepResult {
  if (stepId === "step1-overview") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection("overview", buildOverviewResponse(filePath));
      }
    };
  }

  if (stepId === "step2-dependencies-boundaries") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "dependencies-boundaries",
          buildDependenciesResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step3-knowledge-source-of-truth") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "knowledge-source-of-truth",
          buildKnowledgeResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step4-strategy-what-if-scenarios") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "strategy-what-if-scenarios",
          buildStrategyResponse(filePath, { whatIfStyle: "minimal" })
        );
      }
    };
  }

  if (stepId === "step5-validation-interrogation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.updateStructuredState({
          findings: getFindingsForFile(filePath, options)
        });
      }
    };
  }

  if (stepId === "step6-cognitive-simulation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.updateStructuredState({
          findings: getFindingsForFile(filePath, options)
        });
      }
    };
  }

  if (stepId === "step7-summary") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "summary",
          buildSummaryResponse(filePath, getNarrativeRiskLevel(filePath, options))
        );
      }
    };
  }

  throw new Error(`Unexpected step: ${stepId}`);
}

function buildFindingsForFile(filePath: string): Finding[] {
  if (filePath === "src/app.ts") {
    return [
      createFinding("must", "must finding"),
      createFinding("nice", "nice finding")
    ];
  }

  if (filePath === "packages/app/index.ts") {
    return [createFinding("must", "only must finding")];
  }

  return [];
}

function getFindingsForFile(
  filePath: string,
  options: SuccessfulStepOptions
): Finding[] {
  return options.findingsByFile?.get(filePath) ?? buildFindingsForFile(filePath);
}

function getNarrativeRiskLevel(
  filePath: string,
  options: SuccessfulStepOptions
): Step7NarrativeRiskLevel {
  return options.narrativeRiskByFile?.get(filePath) ?? "Medium";
}

function createFinding(
  type: "must" | "nice",
  title: string,
  confidence = 90
): Finding {
  return {
    type,
    title,
    traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    confidence
  };
}

function countFindings(filePath: string, type: "must" | "nice"): number {
  return buildFindingsForFile(filePath).filter((finding) => finding.type === type).length;
}

function buildSummaryResponse(
  filePath: string,
  riskLevel: Step7NarrativeRiskLevel = "Medium"
): string {
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${filePath} 這次改動主要調整執行流程。`,
    `- 依據規範：依 ${filePath} 的 repo source-of-truth 與版本假設審查。`,
    "- 審查假設：未擴張到外部知識查證。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    `- 整體風險等級：${riskLevel}`,
    "- 風險理由：final findings 仍需留意。"
  ].join("\n");
}

class CorruptingSummaryOutputSink {
  #outputTarget!: OutputTarget;

  initializeRun(outputTarget: OutputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: FileReviewPublishResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, "# CORRUPTED NOTE\n");
  }

  publishSkippedFile(skipRecord: SkipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: RunSummaryPublishResult) {
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult: ReviewIndexPublishResult) {
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
  }

  publishRunManifest(manifestResult: RunManifestPublishResult) {
    writeFileSync(this.#outputTarget.manifestPath, manifestResult.content);
  }

  publishChangesetOverview() {}
}

class CorruptingIndexOutputSink {
  #outputTarget!: OutputTarget;

  initializeRun(outputTarget: OutputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "# CORRUPTED SKIPPED LOG\n");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult: FileReviewPublishResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, "# CORRUPTED NOTE\n");
    writeFileSync(path.join(this.#outputTarget.filesPath, "EXTRA DISK FILE.md"), "# extra\n");
  }

  publishSkippedFile(skipRecord: SkipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `CORRUPTED SKIP: ${skipRecord.filePath} ${skipRecord.stepId} ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: RunSummaryPublishResult) {
    writeFileSync(this.#outputTarget.summaryPath, "# CORRUPTED SUMMARY\n");
  }

  publishReviewIndex(indexResult: ReviewIndexPublishResult) {
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
  }

  publishRunManifest(manifestResult: RunManifestPublishResult) {
    writeFileSync(this.#outputTarget.manifestPath, manifestResult.content);
  }

  publishChangesetOverview() {}
}

class SummaryFailingOutputSink {
  #outputTarget!: OutputTarget;
  writtenFileReviews: string[] = [];
  publishRunSummaryCalls = 0;
  summaryPath?: string;

  initializeRun(outputTarget: OutputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.summaryPath = outputTarget.summaryPath;
  }

  publishFileReview(fileResult: FileReviewPublishResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.writtenFileReviews.push(fileResult.noteFilePath);
  }

  publishSkippedFile(skipRecord: SkipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(_summaryResult: RunSummaryPublishResult) {
    this.publishRunSummaryCalls += 1;
    throw new Error("summary write failed");
  }

  publishReviewIndex(_indexResult: ReviewIndexPublishResult) {
    throw new Error("should not publish index after summary failure");
  }

  publishRunManifest(_manifestResult: RunManifestPublishResult) {
    throw new Error("should not publish manifest after summary failure");
  }

  publishChangesetOverview() {}
}

class IndexFailingOutputSink {
  #outputTarget!: OutputTarget;
  writtenFileReviews: string[] = [];
  publishRunSummaryCalls = 0;
  publishReviewIndexCalls = 0;
  summaryPath?: string;
  indexPath?: string;

  initializeRun(outputTarget: OutputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.summaryPath = outputTarget.summaryPath;
    this.indexPath = outputTarget.indexPath;
  }

  publishFileReview(fileResult: FileReviewPublishResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.writtenFileReviews.push(fileResult.noteFilePath);
  }

  publishSkippedFile(skipRecord: SkipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: RunSummaryPublishResult) {
    this.publishRunSummaryCalls += 1;
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
  }

  publishReviewIndex(_indexResult: ReviewIndexPublishResult) {
    this.publishReviewIndexCalls += 1;
    throw new Error("index write failed");
  }

  publishRunManifest(_manifestResult: RunManifestPublishResult) {
    throw new Error("should not publish manifest after index failure");
  }

  publishChangesetOverview() {}
}

class ManifestFailingOutputSink {
  #outputTarget!: OutputTarget;
  writtenFileReviews: string[] = [];
  publishRunSummaryCalls = 0;
  publishReviewIndexCalls = 0;
  publishRunManifestCalls = 0;
  summaryPath?: string;
  indexPath?: string;
  manifestPath?: string;

  initializeRun(outputTarget: OutputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.summaryPath = outputTarget.summaryPath;
    this.indexPath = outputTarget.indexPath;
    this.manifestPath = outputTarget.manifestPath;
  }

  publishFileReview(fileResult: FileReviewPublishResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.writtenFileReviews.push(fileResult.noteFilePath);
  }

  publishSkippedFile(skipRecord: SkipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult: RunSummaryPublishResult) {
    this.publishRunSummaryCalls += 1;
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult: ReviewIndexPublishResult) {
    this.publishReviewIndexCalls += 1;
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
  }

  publishRunManifest(_manifestResult: RunManifestPublishResult) {
    this.publishRunManifestCalls += 1;
    throw new Error("manifest write failed");
  }

  publishChangesetOverview() {}
}

class RecordingOutputSink {
  #outputTarget!: OutputTarget;
  calls: string[] = [];

  initializeRun(outputTarget: OutputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.calls.push("initializeRun");
  }

  publishFileReview(fileResult: FileReviewPublishResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.calls.push("publishFileReview");
  }

  publishSkippedFile(skipRecord: SkipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
    this.calls.push("publishSkippedFile");
  }

  publishRunSummary(summaryResult: RunSummaryPublishResult) {
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
    this.calls.push("publishRunSummary");
  }

  publishReviewIndex(indexResult: ReviewIndexPublishResult) {
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
    this.calls.push("publishReviewIndex");
  }

  publishRunManifest(manifestResult: RunManifestPublishResult) {
    writeFileSync(this.#outputTarget.manifestPath, manifestResult.content);
    this.calls.push("publishRunManifest");
  }

  publishChangesetOverview() {
    this.calls.push("publishChangesetOverview");
  }
}

class IndexRecordingOutputSink {
  #outputTarget!: OutputTarget;
  calls: string[] = [];
  publishFileReviewCallsAfterManifest = 0;
  publishRunSummaryCallsAfterManifest = 0;
  publishReviewIndexCallsAfterManifest = 0;
  #manifestPublished = false;

  initializeRun(outputTarget: OutputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.calls.push("initializeRun");
  }

  publishFileReview(fileResult: FileReviewPublishResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    if (this.#manifestPublished) {
      this.publishFileReviewCallsAfterManifest += 1;
    }
    this.calls.push("publishFileReview");
  }

  publishSkippedFile(skipRecord: SkipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
    this.calls.push("publishSkippedFile");
  }

  publishRunSummary(summaryResult: RunSummaryPublishResult) {
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
    if (this.#manifestPublished) {
      this.publishRunSummaryCallsAfterManifest += 1;
    }
    this.calls.push("publishRunSummary");
  }

  publishReviewIndex(indexResult: ReviewIndexPublishResult) {
    if (this.#manifestPublished) {
      this.publishReviewIndexCallsAfterManifest += 1;
    }
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
    this.calls.push("publishReviewIndex");
  }

  publishRunManifest(manifestResult: RunManifestPublishResult) {
    writeFileSync(this.#outputTarget.manifestPath, manifestResult.content);
    this.#manifestPublished = true;
    this.calls.push("publishRunManifest");
  }

  publishChangesetOverview() {
    this.calls.push("publishChangesetOverview");
  }
}

function createExpectedOutputTarget(outputBaseDir: string, sessionId: string) {
  const basePath = path.join(outputBaseDir, "review", sessionId);

  return {
    basePath,
    changesetOverviewPath: path.join(basePath, "changeset-overview.md"),
    filesPath: path.join(basePath, "files"),
    skippedPath: path.join(basePath, "skipped.md"),
    summaryPath: path.join(basePath, "summary.md"),
    indexPath: path.join(basePath, "index.md"),
    manifestPath: path.join(basePath, "manifest.json"),
    toolAuditPath: path.join(basePath, "tool-audit.jsonl")
  };
}
