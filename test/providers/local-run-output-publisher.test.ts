import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { LocalRunOutputPublisher } from "../../src/providers/local-run-output-publisher.ts";
import {
  ReviewOutputBoundaryError,
  type ReviewOutputPlan,
  type ReviewOutputTarget
} from "../../src/providers/review-output-sink.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

function createPublisher(outputPlan: ReviewOutputPlan): LocalRunOutputPublisher {
  const { outputTarget } = outputPlan;
  mkdirSync(outputTarget.basePath, { recursive: true });
  mkdirSync(outputTarget.filesPath, { recursive: true });
  return new LocalRunOutputPublisher(outputPlan);
}

function withPlannedNote(
  outputTarget: ReviewOutputTarget,
  filePath: string,
  noteFilePath: string
): ReviewOutputPlan {
  return {
    outputTarget,
    plannedNotes: [{ filePath, noteFilePath }]
  };
}

test("LocalRunOutputPublisher writes file reviews to the planned note path", async () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    const publisher = createPublisher(
      withPlannedNote(fixture.outputTarget, "src/app.ts", noteFilePath)
    );

    await publisher.publishFileReview({
      filePath: "src/app.ts",
      content: "# src/app.ts\n\nPending review.\n"
    });

    assert.equal(fixture.readFile(noteFilePath), "# src/app.ts\n\nPending review.\n");
  } finally {
    fixture.cleanup();
  }
});

test("LocalRunOutputPublisher preserves intact skipped.md records across concurrent appends", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = createPublisher(fixture.outputPlan);

    await Promise.all([
      publisher.publishSkippedFile({
        filePath: "src/app.ts",
        stepId: "candidate-findings",
        reason: "deterministic validation failed"
      }),
      publisher.publishSkippedFile({
        filePath: "src/other.ts",
        stepId: "review-summary",
        reason: "judge rejected"
      })
    ]);

    const lines = fixture.readFile(fixture.outputTarget.skippedPath).trimEnd().split("\n");
    assert.deepEqual(lines.sort(), [
      "- `src/app.ts` — candidate-findings — deterministic validation failed",
      "- `src/other.ts` — review-summary — judge rejected"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("LocalRunOutputPublisher writes each run-level artifact to its configured output path", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = createPublisher(fixture.outputPlan);

    await publisher.publishArtifact("changeset-overview", { content: "overview\n" });
    await publisher.publishArtifact("index", { content: "index\n" });

    assert.equal(fixture.readFile(fixture.outputTarget.changesetOverviewPath), "overview\n");
    assert.equal(fixture.readFile(fixture.outputTarget.indexPath), "index\n");
  } finally {
    fixture.cleanup();
  }
});

test("LocalRunOutputPublisher reports typed note-write failures with stable boundary metadata", async () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    const publisher = createPublisher(
      withPlannedNote(fixture.outputTarget, "src/app.ts", noteFilePath)
    );
    mkdirSync(path.dirname(noteFilePath), { recursive: true });
    mkdirSync(noteFilePath, { recursive: true });

    await assert.rejects(
      async () =>
        publisher.publishFileReview({
          filePath: "src/app.ts",
          content: "# src/app.ts\n"
        }),
      (error) => {
        assert.ok(error instanceof ReviewOutputBoundaryError);
        assert.equal(error.operation, "publishFileReview");
        assert.equal(error.outputPath, noteFilePath);
        assert.ok(error.cause instanceof Error);
        assert.equal(error.message, (error.cause as Error).message);
        return true;
      }
    );
  } finally {
    fixture.cleanup();
  }
});
