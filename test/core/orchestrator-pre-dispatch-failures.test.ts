import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOrchestrator } from "../../src/core/orchestrator.ts";
import { createRunContext } from "../../src/core/run-context.ts";
import { planNoteFiles } from "../../src/core/review-path-resolver.ts";
import type { RunStepInput, StepResult } from "../../src/core/step-runner.ts";
import { LocalGitProvider } from "../../src/providers/local-git-provider.ts";
import { LocalReviewFileFilter } from "../../src/providers/local-review-file-filter.ts";
import { ReviewFileFilterError } from "../../src/providers/review-file-filter.ts";
import { stubChangeMap } from "../helpers/change-map-stub.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";
import { defineOutputSinkDouble } from "../helpers/output-sink-double.ts";
import {
  REQUEST,
  RUN_TIMESTAMP,
  bootstrapReviewHarness,
  createDefaultChangesetOverviewRunner
} from "../helpers/orchestrator-harness.ts";

type StepEvent = [string, string];
type OutputCall = [string, string];

test("ReviewOrchestrator aborts when Step 0 fails before initializing local output and dispatching any per-file step", async () => {
  const calls: string[] = [];
  const fixture = createReviewRepoFixture();

  try {
    const outputTarget = path.join(realpathSync(fixture.repoDir), ".nightowl", "review");
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          calls.push("initializeRun");
          return this;
        },
        async publishFileReview() {
          calls.push("publishFileReview");
        },
        async publishSkippedFile() {
          calls.push("publishSkippedFile");
        },
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run() {
          throw new Error("should not reach step 1");
        }
      },
      changesetOverviewRunner: {
        async run() {
          throw new Error("Step 0 failed");
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
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
      /Step 0 failed/u
    );

    assert.deepEqual(calls, []);
    assert.equal(existsSync(outputTarget), false);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when publishChangesetOverview fails and does not proceed to per-file processing", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for publishChangesetOverview failure");

    const calls: string[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: new LocalGitProvider(),
      reviewFileFilter: new LocalReviewFileFilter(),
      outputSink: defineOutputSinkDouble({
        async initializeRun() {
          calls.push("initializeRun");
          return this;
        },
        async publishFileReview() {
          calls.push("publishFileReview");
        },
        async publishSkippedFile() {},
        async publishRunSummary() {},
        async publishReviewIndex() {},
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {
          calls.push("publishChangesetOverview");
          throw new Error("changeset overview write failed");
        }
      }),
      stepRunner: {
        async run(): Promise<StepResult> {
          throw new Error("should not start per-file steps");
        }
      },
      changesetOverviewRunner: {
        async run() {
          return createRunContext({
            changesetOverview: stubChangeMap("## Changeset Overview\n- 調整範圍：feature"),
            userContext: []
          });
        }
      },
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
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
      /changeset overview write failed/u
    );

    assert.ok(calls.includes("initializeRun"));
    assert.ok(calls.includes("publishChangesetOverview"));
    assert.equal(calls.filter((c) => c === "publishFileReview").length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts when initializeRun fails before any bootstrap note publish or step execution", async () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(".nightowl/reviewignore", "dist/**\n");
    fixture.writeFile("README.md", "# Demo feature change\n");
    fixture.commitAll("add third changed file for initializeRun failure");

    const harness = await bootstrapReviewHarness(fixture);
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
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
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);
          throw new Error("should not start steps");
        }
      },
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
      /initialize failed/u
    );

    assert.deepEqual(outputCalls, [["initializeRun", path.join(
      harness.repoRoot,
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

    const harness = await bootstrapReviewHarness(fixture);
    const outputCalls: OutputCall[] = [];
    const stepEvents: StepEvent[] = [];
    const orchestrator = new ReviewOrchestrator({
      sourceProvider: harness.sourceProvider,
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
        async publishVerifierReport() {},
        async publishRunManifest() {},
        async publishChangesetOverview() {}
      }),
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);
          throw new Error("should not start steps");
        }
      },
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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

    const harness = await bootstrapReviewHarness(fixture);
    const plannedNotes = planNoteFiles(
      path.join(harness.repoRoot, ".nightowl", "review", "feature-branch_03131430", "files"),
      harness.reviewableFiles
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
      sourceProvider: harness.sourceProvider,
      reviewFileFilter: harness.reviewFileFilter,
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
        async publishVerifierReport() {},
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
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
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

