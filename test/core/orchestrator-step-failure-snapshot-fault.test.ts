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

function createStepFailureRunner(input: {
  stepEvents: StepEvent[];
  failedFile: string;
  failedStepId:
    | "review-basis"
    | "candidate-findings"
    | "semantic-validation"
    | "review-summary";
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
        async publishArtifact() {}
      }),
      stepRunner: {
        async run({ context, step }: RunStepInput): Promise<StepResult> {
          stepEvents.push([step.stepId, context.filePath]);

          if (step.stepId !== "review-basis") {
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
      timestampProvider: () => RUN_TIMESTAMP,
      maxConcurrentFiles: 1
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
      /apply failed/u
    );

    assert.deepEqual(stepEvents, [["review-basis", reviewableFiles[0]]]);
  } finally {
    fixture.cleanup();
  }
});

test("ReviewOrchestrator aborts with the output error when interrupted snapshot publication fails", async () => {
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
        async publishArtifact() {}
      }),
      stepRunner: createStepFailureRunner({
        stepEvents,
        failedFile,
        failedStepId: "semantic-validation",
        failureCause: "deterministic validation failed"
      }),
      changesetOverviewRunner: createDefaultChangesetOverviewRunner(),
      workingDirectory: fixture.repoDir,
      timestampProvider: () => RUN_TIMESTAMP,
      maxConcurrentFiles: 1
    });

    await assert.rejects(
      () => orchestrator.run(REQUEST),
      /note write failed/u
    );

    assert.equal(
      stepEvents.some(([, filePath]) => filePath === laterFile),
      false
    );
    assert.match(
      writtenNotes.get(failedNotePath) ?? "",
      /^# [\s\S]*^- Status: Review not yet generated\./mu
    );
    assert.doesNotMatch(
      writtenNotes.get(failedNotePath) ?? "",
      /> \[!WARNING\] Review Interrupted/u
    );
  } finally {
    fixture.cleanup();
  }
});
