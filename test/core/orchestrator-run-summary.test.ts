import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import type { Finding } from "../../src/core/file-review-context.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

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
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const successfulLines = reviewableFiles.map(
      (filePath) =>
        `- \`${filePath}\` — must=${countFindings(filePath, "must")}, nice=${countFindings(filePath, "nice")}`
    );
    const expectedIndexFileNoteLines = plannedNotes.map(
      (plannedNote) =>
        `- [\`${plannedNote.filePath}\`](./${path.relative(result.outputTarget.basePath, plannedNote.noteFilePath).replace(/\\/gu, "/")})`
    );

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.equal(result.successfulFileCount, reviewableFiles.length);
    assert.equal(result.skippedFileCount, 0);
    assert.deepEqual(
      result.outputTarget,
      createExpectedOutputTarget(fixture.appDir, "feature-branch_03131430")
    );
    assert.equal(existsSync(result.outputTarget.summaryPath), true);
    assert.equal(existsSync(result.outputTarget.indexPath), true);
    assert.equal(
      summaryContent,
      [
        "# Review Summary",
        "",
        `- Repo root: \`${repoRoot}\``,
        "- Base ref: `main`",
        "- Head ref: `feature-branch`",
        "- Planned files: 2",
        "- Successful files: 2",
        "- Skipped files: 0",
        "- Final findings totals: must=2, nice=1",
        "",
        "## Successful Files",
        ...successfulLines,
        "",
        "## Skipped Files",
        "- 無"
      ].join("\n")
    );
    assert.equal(
      indexContent,
      [
        "# Review Index",
        "",
        `- Repo root: \`${repoRoot}\``,
        "- Base ref: `main`",
        "- Head ref: `feature-branch`",
        `- Planned files: ${reviewableFiles.length}`,
        `- Successful files: ${reviewableFiles.length}`,
        "- Skipped files: 0",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)",
        "- [skipped.md](./skipped.md)",
        "",
        "## File Notes",
        ...expectedIndexFileNoteLines
      ].join("\n")
    );
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
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const corruptedSuccessfulNote = readFileSync(plannedNotes[0].noteFilePath, "utf8");

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
    assert.match(summaryContent, /- Final findings totals: must=2, nice=1/u);
    assert.match(summaryContent, /- `src\/app.ts` — must=1, nice=1/u);
    assert.match(summaryContent, /- `packages\/app\/index.ts` — must=1, nice=0/u);
    assert.match(
      summaryContent,
      new RegExp(`- \`${escapeRegExp(skippedFile)}\` — step5-validation-interrogation — deterministic validation failed`, "u")
    );
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
    assert.equal(
      readFileSync(result.outputTarget.summaryPath, "utf8"),
      [
        "# Review Summary",
        "",
        `- Repo root: \`${result.repoRoot}\``,
        "- Base ref: `main`",
        "- Head ref: `feature-branch`",
        "- Planned files: 0",
        "- Successful files: 0",
        "- Skipped files: 0",
        "- Final findings totals: must=0, nice=0",
        "",
        "## Successful Files",
        "- 無",
        "",
        "## Skipped Files",
        "- 無"
      ].join("\n")
    );
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
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const expectedIndexFileNoteLines = plannedNotes.map(
      (plannedNote) =>
        `- [\`${plannedNote.filePath}\`](./${path.relative(result.outputTarget.basePath, plannedNote.noteFilePath).replace(/\\/gu, "/")})`
    );

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
    assert.equal(
      indexContent,
      [
        "# Review Index",
        "",
        `- Repo root: \`${repoRoot}\``,
        "- Base ref: `main`",
        "- Head ref: `feature-branch`",
        `- Planned files: ${reviewableFiles.length}`,
        "- Successful files: 0",
        `- Skipped files: ${reviewableFiles.length}`,
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)",
        "- [skipped.md](./skipped.md)",
        "",
        "## File Notes",
        ...expectedIndexFileNoteLines
      ].join("\n")
    );
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
    const plannedNotes = planNoteFiles(result.outputTarget.filesPath, reviewableFiles);
    const expectedFileNoteLines = plannedNotes.map(
      (plannedNote) =>
        `- [\`${plannedNote.filePath}\`](./${path.relative(result.outputTarget.basePath, plannedNote.noteFilePath).replace(/\\/gu, "/")})`
    );

    assert.equal(result.plannedFileCount, reviewableFiles.length);
    assert.equal(result.successfulFileCount, reviewableFiles.length - 1);
    assert.equal(result.skippedFileCount, 1);
    assert.deepEqual(
      result.outputTarget,
      createExpectedOutputTarget(fixture.appDir, "feature-branch_03131430")
    );
    assert.equal(existsSync(result.outputTarget.indexPath), true);
    assert.equal(
      indexContent,
      [
        "# Review Index",
        "",
        `- Repo root: \`${repoRoot}\``,
        "- Base ref: `main`",
        "- Head ref: `feature-branch`",
        `- Planned files: ${reviewableFiles.length}`,
        `- Successful files: ${reviewableFiles.length - 1}`,
        "- Skipped files: 1",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)",
        "- [skipped.md](./skipped.md)",
        "",
        "## File Notes",
        ...expectedFileNoteLines
      ].join("\n")
    );
    assert.doesNotMatch(indexContent, /CORRUPTED SUMMARY/u);
    assert.doesNotMatch(indexContent, /EXTRA DISK FILE/u);
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

    assert.equal(
      readFileSync(result.outputTarget.indexPath, "utf8"),
      [
        "# Review Index",
        "",
        `- Repo root: \`${result.repoRoot}\``,
        "- Base ref: `main`",
        "- Head ref: `feature-branch`",
        "- Planned files: 0",
        "- Successful files: 0",
        "- Skipped files: 0",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)",
        "- [skipped.md](./skipped.md)",
        "",
        "## File Notes",
        "- 無"
      ].join("\n")
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator does not publish summary.md when applyTo fails after bootstrap", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".reviewignore", "dist/**\n");

    const outputCalls = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary(summaryResult) {
          outputCalls.push(["publishRunSummary", summaryResult.content]);
        },
        publishReviewIndex(indexResult) {
          outputCalls.push(["publishReviewIndex", indexResult.content]);
        }
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
    const outputCalls = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      outputSink: {
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary(summaryResult) {
          outputCalls.push(["publishRunSummary", summaryResult.content]);
        },
        publishReviewIndex(indexResult) {
          outputCalls.push(["publishReviewIndex", indexResult.content]);
        }
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
    const outputCalls = [];
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
        initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
        },
        publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        publishRunSummary(summaryResult) {
          outputCalls.push(["publishRunSummary", summaryResult.content]);
        },
        publishReviewIndex(indexResult) {
          outputCalls.push(["publishReviewIndex", indexResult.content]);
        }
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

test("ReviewOrchestrator publishes summary.md only after per-file notes and skipped artifacts are finalized", async () => {
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

    assert.equal(outputSink.calls.at(-1), "publishReviewIndex");
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
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator publishes index.md only after publishRunSummary and does not rewrite finalized artifacts", async () => {
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

    assert.equal(outputSink.calls.at(-1), "publishReviewIndex");
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
    assert.equal(outputSink.publishFileReviewCallsAfterIndex, 0);
    assert.equal(outputSink.publishRunSummaryCallsAfterIndex, 0);
  } finally {
    fixture.cleanup();
  }
});

function createSuccessfulSummaryRunner() {
  return {
    async run({ context, step }) {
      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}

function createMixedResultRunner(skippedFile: string) {
  return {
    async run({ context, step }) {
      if (
        context.filePath === skippedFile &&
        step.stepId === "step5-validation-interrogation"
      ) {
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: deterministic validation failed`
        );
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}

function createAllSkippedRunner(skippedFiles: Set<string>) {
  return {
    async run({ context, step }) {
      if (skippedFiles.has(context.filePath) && step.stepId === "step1-overview") {
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: judge rejected`
        );
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}

function buildSuccessfulStepResult(stepId: string, filePath: string) {
  if (stepId === "step1-overview") {
    return {
      stepId,
      applyTo(targetContext) {
        targetContext.setSection("overview", buildOverviewResponse(filePath));
      }
    };
  }

  if (stepId === "step2-dependencies-boundaries") {
    return {
      stepId,
      applyTo(targetContext) {
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
      applyTo(targetContext) {
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
      applyTo(targetContext) {
        targetContext.setSection(
          "strategy-what-if-scenarios",
          buildStrategyResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step5-validation-interrogation") {
    return {
      stepId,
      applyTo(targetContext) {
        targetContext.updateStructuredState({
          findings: buildFindingsForFile(filePath)
        });
      }
    };
  }

  if (stepId === "step6-cognitive-simulation") {
    return {
      stepId,
      applyTo(targetContext) {
        targetContext.updateStructuredState({
          findings: buildFindingsForFile(filePath)
        });
      }
    };
  }

  if (stepId === "step7-summary") {
    return {
      stepId,
      applyTo(targetContext) {
        targetContext.setSection("summary", buildSummaryResponse(filePath));
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

function createFinding(type: "must" | "nice", title: string): Finding {
  return {
    type,
    title,
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    confidence: 90
  };
}

function countFindings(filePath: string, type: "must" | "nice"): number {
  return buildFindingsForFile(filePath).filter((finding) => finding.type === type).length;
}

function buildOverviewResponse(filePath: string): string {
  return [
    "## Overview",
    `- 整體理解：${filePath} 位於本次 changeset 中`,
    "- 行為變更：無行為變更",
    `- 檔案職責：負責 ${filePath}`,
    "- 改動目的：調整測試資料",
    `- 影響範圍：${filePath}`,
    "- 測試覆蓋觀察：未見對應測試異動"
  ].join("\n");
}

function buildDependenciesResponse(filePath: string): string {
  return [
    "## Dependencies & Boundaries",
    "- 相依清單：",
    `  - \`[${filePath}:valueService]\` → 提供 value 更新 → Consume`,
    "    - Contract：輸入 value 並回傳更新結果",
    "    - 評估：此 diff 維持既有 boundary",
    "- 隱含相依：",
    "  - 無"
  ].join("\n");
}

function buildKnowledgeResponse(filePath: string): string {
  return [
    "## Knowledge & Source of Truth",
    "- 版本／文件參考：",
    `  - ${filePath} package.json — repo-native source`,
    "- 採用規則與假設：",
    "  - 依 repo 內設定檔與版本檔推論行為約束",
    "- 排除範圍：",
    "  - 外部官方文件查證不在本次 foundation 範圍內"
  ].join("\n");
}

function buildStrategyResponse(filePath: string): string {
  return [
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    `  - state transition：${filePath} 這次改動調整了主要執行路徑，值得驗證狀態切換是否一致`,
    "- What-if 假設情境：",
    `  - W1: 觸發條件：${filePath} 輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程`
  ].join("\n");
}

function buildSummaryResponse(filePath: string): string {
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${filePath} 這次改動主要調整執行流程。`,
    `- 依據規範：依 ${filePath} 的 repo source-of-truth 與版本假設審查。`,
    "- 審查假設：未擴張到外部知識查證。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    "- 整體風險等級：Medium",
    "- 風險理由：final findings 仍需留意。"
  ].join("\n");
}

class CorruptingSummaryOutputSink {
  #outputTarget;

  initializeRun(outputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, "# CORRUPTED NOTE\n");
  }

  publishSkippedFile(skipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult) {
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
  }

  publishReviewIndex(indexResult) {
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
  }
}

class CorruptingIndexOutputSink {
  #outputTarget;

  initializeRun(outputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "# CORRUPTED SKIPPED LOG\n");
    this.#outputTarget = outputTarget;
  }

  publishFileReview(fileResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, "# CORRUPTED NOTE\n");
    writeFileSync(path.join(this.#outputTarget.filesPath, "EXTRA DISK FILE.md"), "# extra\n");
  }

  publishSkippedFile(skipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `CORRUPTED SKIP: ${skipRecord.filePath} ${skipRecord.stepId} ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult) {
    writeFileSync(this.#outputTarget.summaryPath, "# CORRUPTED SUMMARY\n");
  }

  publishReviewIndex(indexResult) {
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
  }
}

class SummaryFailingOutputSink {
  #outputTarget;
  writtenFileReviews = [];
  publishRunSummaryCalls = 0;
  summaryPath;

  initializeRun(outputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.summaryPath = outputTarget.summaryPath;
  }

  publishFileReview(fileResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.writtenFileReviews.push(fileResult.noteFilePath);
  }

  publishSkippedFile(skipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary() {
    this.publishRunSummaryCalls += 1;
    throw new Error("summary write failed");
  }

  publishReviewIndex() {
    throw new Error("should not publish index after summary failure");
  }
}

class IndexFailingOutputSink {
  #outputTarget;
  writtenFileReviews = [];
  publishRunSummaryCalls = 0;
  publishReviewIndexCalls = 0;
  summaryPath;
  indexPath;

  initializeRun(outputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.summaryPath = outputTarget.summaryPath;
    this.indexPath = outputTarget.indexPath;
  }

  publishFileReview(fileResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.writtenFileReviews.push(fileResult.noteFilePath);
  }

  publishSkippedFile(skipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
  }

  publishRunSummary(summaryResult) {
    this.publishRunSummaryCalls += 1;
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
  }

  publishReviewIndex() {
    this.publishReviewIndexCalls += 1;
    throw new Error("index write failed");
  }
}

class RecordingOutputSink {
  #outputTarget;
  calls = [];

  initializeRun(outputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.calls.push("initializeRun");
  }

  publishFileReview(fileResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    this.calls.push("publishFileReview");
  }

  publishSkippedFile(skipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
    this.calls.push("publishSkippedFile");
  }

  publishRunSummary(summaryResult) {
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
    this.calls.push("publishRunSummary");
  }

  publishReviewIndex(summaryResult) {
    writeFileSync(this.#outputTarget.indexPath, summaryResult.content);
    this.calls.push("publishReviewIndex");
  }
}

class IndexRecordingOutputSink {
  #outputTarget;
  calls = [];
  publishFileReviewCallsAfterIndex = 0;
  publishRunSummaryCallsAfterIndex = 0;
  #indexPublished = false;

  initializeRun(outputTarget) {
    mkdirSync(outputTarget.basePath, { recursive: true });
    mkdirSync(outputTarget.filesPath, { recursive: true });
    writeFileSync(outputTarget.skippedPath, "");
    this.#outputTarget = outputTarget;
    this.calls.push("initializeRun");
  }

  publishFileReview(fileResult) {
    mkdirSync(path.dirname(fileResult.noteFilePath), { recursive: true });
    writeFileSync(fileResult.noteFilePath, fileResult.content);
    if (this.#indexPublished) {
      this.publishFileReviewCallsAfterIndex += 1;
    }
    this.calls.push("publishFileReview");
  }

  publishSkippedFile(skipRecord) {
    appendFileSync(
      this.#outputTarget.skippedPath,
      `- \`${skipRecord.filePath}\` — ${skipRecord.stepId} — ${skipRecord.reason}\n`
    );
    this.calls.push("publishSkippedFile");
  }

  publishRunSummary(summaryResult) {
    writeFileSync(this.#outputTarget.summaryPath, summaryResult.content);
    if (this.#indexPublished) {
      this.publishRunSummaryCallsAfterIndex += 1;
    }
    this.calls.push("publishRunSummary");
  }

  publishReviewIndex(indexResult) {
    writeFileSync(this.#outputTarget.indexPath, indexResult.content);
    this.#indexPublished = true;
    this.calls.push("publishReviewIndex");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function createExpectedOutputTarget(outputBaseDir: string, sessionId: string) {
  const basePath = path.join(outputBaseDir, "review", sessionId);

  return {
    basePath,
    filesPath: path.join(basePath, "files"),
    skippedPath: path.join(basePath, "skipped.md"),
    summaryPath: path.join(basePath, "summary.md"),
    indexPath: path.join(basePath, "index.md")
  };
}
