import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import type { FileReviewContext } from "../../src/core/file-review-context.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { StepRunner } from "../../src/core/step-runner.ts";
import type { RunStepInput, StepResult } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { ReviewFileFilterError } from "../../src/providers/review-file-filter.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import {
  buildDependenciesResponse,
  buildKnowledgeResponse,
  buildOverviewResponse,
  buildStrategyResponse,
  buildSuccessfulStepResult
} from "../helpers/orchestrator-fixture.ts";

type StepEvent = [string, string];
type OutputCall = [string, string];

test("ReviewOrchestrator aborts when initializeRun fails before any bootstrap note publish or step execution", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for initializeRun failure");

    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          throw new Error("initialize failed");
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);
          throw new Error("should not start steps");
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
          userContext: [],
          dryRun: false
        }),
      /initialize failed/u
    );

    assert.deepEqual(outputCalls, [["initializeRun", path.join(
      realpathSync(fixture.repoDir),
      ".nightowl",
      "review",
      "feature-branch_03131430"
    )]]);
    assert.deepEqual(stepEvents, []);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts before output initialization and file dispatch when review file filtering fails during planning", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for review file filter failure");

    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: {
        async filterReviewableFiles() {
          throw new ReviewFileFilterError(
            "filterReviewableFiles",
            "Review file filter failed during filterReviewableFiles.",
            { cause: new Error("reviewignore read failed") }
          );
        }
      },
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);
          throw new Error("should not start steps");
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
          userContext: [],
          dryRun: false
        }),
      (error: unknown) =>
        error instanceof ReviewFileFilterError &&
        error.operation === "filterReviewableFiles" &&
        error.cause instanceof Error &&
        error.cause.message === "reviewignore read failed"
    );

    assert.deepEqual(outputCalls, []);
    assert.deepEqual(stepEvents, []);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when bootstrap note publication fails, preserves earlier bootstrap notes, and stops the bootstrap loop before Step 1", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for bootstrap publish failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const outputCalls: OutputCall[] = [];
    const writtenNotes = new Map<string, string>();
    const stepEvents: StepEvent[] = [];
    const failedNotePath = plannedNotes[1].noteFilePath;
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        return { faultScope: "single-file-output-fault" as const };
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (fileResult.noteFilePath === failedNotePath) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);
          throw new Error(`should not start ${step.stepId}`);
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
          userContext: [],
          dryRun: false
        }),
      /note write failed/u
    );

    assert.deepEqual(stepEvents, []);
    assert.deepEqual(
      outputCalls.filter(([callType]) => callType === "publishFileReview"),
      [
        ["publishFileReview", plannedNotes[0].noteFilePath],
        ["publishFileReview", plannedNotes[1].noteFilePath]
      ]
    );
    assert.match(
      writtenNotes.get(plannedNotes[0].noteFilePath) ?? "",
      /Review not yet generated/u
    );
    assert.equal(writtenNotes.has(plannedNotes[1].noteFilePath), false);
    assert.equal(writtenNotes.has(plannedNotes[2].noteFilePath), false);
    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator downgrades a file to skipped when a successful step snapshot write fails and later files can continue", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for successful snapshot skip downgrade");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const laterNotePath = plannedNotes.find(
      ({ filePath }) => filePath === laterFile
    )!.noteFilePath;
    const stepEvents: StepEvent[] = [];
    const outputCalls: OutputCall[] = [];
    const writtenNotes = new Map<string, string>();
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        return { faultScope: "single-file-output-fault" as const };
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
    assert.ok(
      stepEvents.some(([, filePath]) => filePath === laterFile)
    );
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
    assert.match(
      writtenNotes.get(laterNotePath) ?? "",
      /^# [\s\S]*^## Summary/mu
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when a successful snapshot write is classified as a shared output target fault and later files do not continue", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for shared-target successful snapshot failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const writtenNotes = new Map<string, string>();
    const stepEvents: StepEvent[] = [];
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        return { faultScope: "shared-output-target-fault" as const };
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("disk full");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /disk full/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.equal(
      outputCalls.some(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      false
    );
    assert.equal(
      writtenNotes.get(failedNotePath)?.includes("Review Interrupted") ?? false,
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts conservatively when successful snapshot assessment fails", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for failed successful snapshot assessment");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        throw new Error("classification unavailable");
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /note write failed/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.equal(
      outputCalls.some(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator reuses interrupted snapshot fatal handling when a single-file successful snapshot downgrade later fails to publish the interrupted snapshot", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for successful snapshot downgrade interrupted publish failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const writtenNotes = new Map<string, string>();
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        return { faultScope: "single-file-output-fault" as const };
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          if (
            fileResult.noteFilePath === failedNotePath &&
            /> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("interrupted snapshot write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /interrupted snapshot write failed/u
    );

    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.doesNotMatch(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator reuses skipped-record fatal handling when a single-file successful snapshot downgrade later fails to append skipped.md", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for successful snapshot downgrade skipped publish failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const writtenNotes = new Map<string, string>();
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        return { faultScope: "single-file-output-fault" as const };
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
          writtenNotes.set(fileResult.noteFilePath, fileResult.content);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);

          if (skipRecord.filePath === failedFile) {
            throw new Error("skipped log write failed");
          }
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
      /skipped log write failed/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator preserves earlier successful file snapshots when a later successful snapshot write downgrades that file to skipped", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for later successful snapshot failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const firstNotePath = plannedNotes[0].noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        return { faultScope: "single-file-output-fault" as const };
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
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
    assert.match(writtenNotes.get(firstNotePath) ?? "", /^# [\s\S]*^## Summary/mu);
    assert.match(writtenNotes.get(failedNotePath) ?? "", /> \[!WARNING\] Review Interrupted/u);
    assert.match(writtenNotes.get(failedNotePath) ?? "", /^# [\s\S]*^## Overview/mu);
    assert.deepEqual(stepEvents.slice(0, 8), [
      ["step1-overview", reviewableFiles[0]],
      ["step2-dependencies-boundaries", reviewableFiles[0]],
      ["step3-knowledge-source-of-truth", reviewableFiles[0]],
      ["step4-strategy-what-if-scenarios", reviewableFiles[0]],
      ["step5-validation-interrogation", reviewableFiles[0]],
      ["step6-cognitive-simulation", reviewableFiles[0]],
      ["step7-summary", reviewableFiles[0]],
      ["step1-overview", failedFile]
    ]);
    assert.ok(stepEvents.some(([, filePath]) => filePath === laterFile));
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator fails the run when applyTo throws and does not downgrade the file to skipped", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const stepEvents: StepEvent[] = [];
    const outputCalls: OutputCall[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);

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
          userContext: [],
          dryRun: false
        }),
      /apply failed/u
    );

    assert.deepEqual(stepEvents, [["step1-overview", reviewableFiles[0]]]);
    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts with the output error when interrupted snapshot publication fails and does not append a skipped record", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for interrupted snapshot publish failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);

          if (
            fileResult.noteFilePath === failedNotePath &&
            /> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: createStepFailureRunner({
        stepEvents,
        failedFile,
        failedStepId: "step5-validation-interrogation",
        failureCause: "deterministic validation failed"
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
      /note write failed/u
    );

    assert.equal(
      outputCalls.some(([callType]) => callType === "publishSkippedFile"),
      false
    );
    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /^# [\s\S]*^## Strategy & What-if Scenarios/mu
    );
    assert.doesNotMatch(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts with the output error when publishSkippedFile fails after the interrupted snapshot is written", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for skipped log publish failure");

    const sourceProvider = new LocalGitProvider();
    const reviewFileFilter = new LocalReviewFileFilter();
    const repoRoot = realpathSync(fixture.repoDir);
    const reviewableFiles = await reviewFileFilter.filterReviewableFiles(
      repoRoot,
      await sourceProvider.getChangedFiles(repoRoot, "main", "feature-branch")
    );
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider,
      reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputTarget) {
          outputCalls.push(["initializeRun", outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.noteFilePath]);
          writtenNotes.set(fileResult.noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);

          if (skipRecord.filePath === failedFile) {
            throw new Error("skipped log write failed");
          }
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: createStepFailureRunner({
        stepEvents,
        failedFile,
        failedStepId: "step7-summary",
        failureCause: "judge rejected"
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
      /skipped log write failed/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});

function createAlwaysSuccessfulStepRunner(
  stepEvents: StepEvent[]
): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      stepEvents.push([step.stepId, context.filePath]);

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}

function createStepFailureRunner(input: {
  stepEvents: StepEvent[];
  failedFile: string;
  failedStepId:
    | "step1-overview"
    | "step2-dependencies-boundaries"
    | "step3-knowledge-source-of-truth"
    | "step4-strategy-what-if-scenarios"
    | "step5-validation-interrogation"
    | "step6-cognitive-simulation"
    | "step7-summary";
  failureCause:
    | "judge rejected"
    | "judge timeout"
    | "deterministic validation failed";
}): Pick<StepRunner, "run"> {
  return {
    async run({ context, step }: RunStepInput): Promise<StepResult> {
      input.stepEvents.push([step.stepId, context.filePath]);

      if (
        context.filePath === input.failedFile &&
        step.stepId === input.failedStepId
      ) {
        throw new Error(
          `Step ${step.stepId} failed for ${context.filePath}: ${input.failureCause}`
        );
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}
