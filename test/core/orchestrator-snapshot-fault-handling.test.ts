import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import type { StepRunner } from "../../src/core/step-runner.ts";
import type { RunStepInput, StepResult } from "../../src/core/step-runner.ts";
import { StepExecutionError } from "../../src/core/step-execution-error.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import { buildSuccessfulStepResult } from "../helpers/orchestrator-fixture.ts";
import {
  REQUEST,
  RUN_TIMESTAMP,
  bootstrapReviewHarness,
  createDefaultChangesetOverviewRunner
} from "../helpers/orchestrator-harness.ts";

type StepEvent = [string, string];
type OutputCall = [string, string];

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

function buildNotePathLookup(
  plannedNotes: Array<{ filePath: string; noteFilePath: string }>
): Map<string, string> {
  return new Map(
    plannedNotes.map((plannedNote) => [plannedNote.filePath, plannedNote.noteFilePath])
  );
}

function requireNotePath(
  notePathLookup: Map<string, string>,
  filePath: string
): string {
  const noteFilePath = notePathLookup.get(filePath);

  if (!noteFilePath) {
    throw new Error(`Missing planned note path for ${filePath}`);
  }

  return noteFilePath;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}

test("ReviewOrchestrator aborts when a successful snapshot write is classified as a shared output target fault and later files do not continue", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for shared-target successful snapshot failure");

    const harness = await bootstrapReviewHarness(fixture);
    const failedFile = harness.reviewableFiles[1];
    const laterFile = harness.reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      harness.reviewableFiles
    );
    const notePathLookup = buildNotePathLookup(plannedNotes);
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
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          const noteFilePath = requireNotePath(notePathLookup, fileResult.filePath);
          outputCalls.push(["publishFileReview", noteFilePath]);

          if (
            noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("disk full");
          }

          writtenNotes.set(noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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

test("ReviewOrchestrator waits for successful snapshot assessment before writing an interrupted snapshot or skipped record", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for deferred successful snapshot assessment");

    const harness = await bootstrapReviewHarness(fixture);
    const failedFile = harness.reviewableFiles[1];
    const laterFile = harness.reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      harness.reviewableFiles
    );
    const notePathLookup = buildNotePathLookup(plannedNotes);
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const assessmentStarted = createDeferred<void>();
    const assessment = createDeferred<{
      faultScope: "single-file-output-fault";
    }>();
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        assessmentStarted.resolve();
        return assessment.promise;
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          const noteFilePath = requireNotePath(notePathLookup, fileResult.filePath);

          if (
            noteFilePath === failedNotePath &&
            /> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            outputCalls.push(["publishInterruptedSnapshot", noteFilePath]);
            return;
          }

          outputCalls.push(["publishFileReview", noteFilePath]);

          if (
            noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    const runPromise = orchestrator.run(REQUEST);

    await assessmentStarted.promise;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(
      outputCalls.some(([callType]) => callType === "publishInterruptedSnapshot"),
      false
    );
    assert.equal(
      outputCalls.some(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      false
    );
    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );

    assessment.resolve({ faultScope: "single-file-output-fault" });
    const result = await runPromise;

    assert.equal(result.skippedFileCount, 1);
    assert.equal(
      outputCalls.some(([callType, filePath]) =>
        callType === "publishInterruptedSnapshot" && filePath === failedNotePath
      ),
      true
    );
    assert.deepEqual(
      outputCalls.filter(([callType, filePath]) =>
        callType === "publishSkippedFile" && filePath === failedFile
      ),
      [["publishSkippedFile", failedFile]]
    );
    assert.ok(stepEvents.some(([, filePath]) => filePath === laterFile));
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

    const harness = await bootstrapReviewHarness(fixture);
    const failedFile = harness.reviewableFiles[1];
    const laterFile = harness.reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      harness.reviewableFiles
    );
    const notePathLookup = buildNotePathLookup(plannedNotes);
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
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          const noteFilePath = requireNotePath(notePathLookup, fileResult.filePath);
          outputCalls.push(["publishFileReview", noteFilePath]);

          if (
            noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          if (
            noteFilePath === failedNotePath &&
            /> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("interrupted snapshot write failed");
          }

          writtenNotes.set(noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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

    const harness = await bootstrapReviewHarness(fixture);
    const failedFile = harness.reviewableFiles[1];
    const laterFile = harness.reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      harness.reviewableFiles
    );
    const notePathLookup = buildNotePathLookup(plannedNotes);
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
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          const noteFilePath = requireNotePath(notePathLookup, fileResult.filePath);
          outputCalls.push(["publishFileReview", noteFilePath]);
          writtenNotes.set(noteFilePath, fileResult.content);

          if (
            noteFilePath === failedNotePath &&
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
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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

    const harness = await bootstrapReviewHarness(fixture);
    const reviewableFiles = harness.reviewableFiles;
    const failedFile = reviewableFiles[1];
    const laterFile = reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      reviewableFiles
    );
    const notePathLookup = buildNotePathLookup(plannedNotes);
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const firstNotePath = plannedNotes[0].noteFilePath;
    const laterNotePath = plannedNotes.find(
      ({ filePath }) => filePath === laterFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const successfulSnapshotOutputHealthAssessor = {
      async assess() {
        return { faultScope: "single-file-output-fault" as const };
      }
    };
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          const noteFilePath = requireNotePath(notePathLookup, fileResult.filePath);
          outputCalls.push(["publishFileReview", noteFilePath]);

          if (
            noteFilePath === failedNotePath &&
            /^# .*[\s\S]*^## Overview/mu.test(fileResult.content) &&
            !/> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      successfulSnapshotOutputHealthAssessor,
      stepRunner: createAlwaysSuccessfulStepRunner(stepEvents),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    const result = await orchestrator.run(REQUEST);

    assert.equal(result.skippedFileCount, 1);
    assert.match(writtenNotes.get(firstNotePath) ?? "", /^# [\s\S]*^## Summary/mu);
    assert.match(writtenNotes.get(failedNotePath) ?? "", /> \[!WARNING\] Review Interrupted/u);
    assert.match(writtenNotes.get(failedNotePath) ?? "", /^# [\s\S]*^## Overview/mu);
    assert.match(writtenNotes.get(laterNotePath) ?? "", /^# [\s\S]*^## Summary/mu);
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

    const harness = await bootstrapReviewHarness(fixture);
    const reviewableFiles = harness.reviewableFiles;
    const stepEvents: StepEvent[] = [];
    const outputCalls: OutputCall[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          outputCalls.push(["publishFileReview", fileResult.filePath]);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
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
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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

    const harness = await bootstrapReviewHarness(fixture);
    const failedFile = harness.reviewableFiles[1];
    const laterFile = harness.reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      harness.reviewableFiles
    );
    const notePathLookup = buildNotePathLookup(plannedNotes);
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          const noteFilePath = requireNotePath(notePathLookup, fileResult.filePath);
          outputCalls.push(["publishFileReview", noteFilePath]);

          if (
            noteFilePath === failedNotePath &&
            /> \[!WARNING\] Review Interrupted/u.test(fileResult.content)
          ) {
            throw new Error("note write failed");
          }

          writtenNotes.set(noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: createStepFailureRunner({
        stepEvents,
        failedFile,
        failedStepId: "step5-validation-interrogation",
        failureCause: "deterministic validation failed"
      }),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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

    const harness = await bootstrapReviewHarness(fixture);
    const failedFile = harness.reviewableFiles[1];
    const laterFile = harness.reviewableFiles[2];
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      harness.reviewableFiles
    );
    const notePathLookup = buildNotePathLookup(plannedNotes);
    const failedNotePath = plannedNotes.find(
      ({ filePath }) => filePath === failedFile
    )!.noteFilePath;
    const writtenNotes = new Map<string, string>();
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
      outputSink: defineOutputSinkDouble({
        async initializeRun(outputPlan) {
          outputCalls.push(["initializeRun", outputPlan.outputTarget.basePath]);
          return this;
        },
        async publishFileReview(fileResult) {
          const noteFilePath = requireNotePath(notePathLookup, fileResult.filePath);
          outputCalls.push(["publishFileReview", noteFilePath]);
          writtenNotes.set(noteFilePath, fileResult.content);
        },
        async publishSkippedFile(skipRecord) {
          outputCalls.push(["publishSkippedFile", skipRecord.filePath]);

          if (skipRecord.filePath === failedFile) {
            throw new Error("skipped log write failed");
          }
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: createStepFailureRunner({
        stepEvents,
        failedFile,
        failedStepId: "step7-summary",
        failureCause: "judge rejected"
      }),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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
        throw new StepExecutionError({
          stepId: step.stepId,
          filePath: context.filePath,
          cause: input.failureCause
        });
      }

      return buildSuccessfulStepResult(step.stepId, context.filePath);
    }
  };
}
