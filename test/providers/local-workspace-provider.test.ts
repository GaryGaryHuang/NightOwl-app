import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  ReviewOutputBoundaryError,
  type ReviewOutputPlan,
  type ReviewOutputTarget
} from "../../src/providers/review-output-sink.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

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

test("LocalWorkspaceProvider bootstraps run directories and truncates append-only artifacts on reinitialization", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = await fixture.provider.initializeRun(fixture.outputPlan);

    assert.ok(publisher, "initializeRun should yield a run-scoped output publisher");
    assert.equal(existsSync(fixture.outputTarget.basePath), true);
    assert.equal(existsSync(fixture.outputTarget.filesPath), true);
    assert.equal(fixture.readFile(fixture.outputTarget.toolAuditPath), "");
    assert.equal(existsSync(fixture.outputTarget.indexPath), false);
    assert.equal(existsSync(fixture.outputTarget.changesetOverviewPath), false);

    writeFileSync(fixture.outputTarget.toolAuditPath, "{\"stale\":true}\n");

    await fixture.provider.initializeRun(fixture.outputPlan);

    assert.equal(fixture.readFile(fixture.outputTarget.toolAuditPath), "");
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider wraps filesystem bootstrap failures in ReviewOutputBoundaryError", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    mkdirSync(path.dirname(fixture.outputTarget.basePath), { recursive: true });
    writeFileSync(fixture.outputTarget.basePath, "not-a-directory");

    await assert.rejects(
      async () => fixture.provider.initializeRun(fixture.outputPlan),
      (error: unknown) => {
        assert.ok(error instanceof ReviewOutputBoundaryError);
        assert.equal(error.operation, "initializeRun");
        assert.equal(error.outputPath, fixture.outputTarget.basePath);
        assert.ok(error.cause instanceof Error);
        return true;
      }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider publisher writes file reviews to the planned note path", async () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    const publisher = await fixture.provider.initializeRun(
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

test("LocalWorkspaceProvider publisher writes each run-level artifact to its configured output path", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = await fixture.provider.initializeRun(fixture.outputPlan);

    await publisher.publishArtifact("changeset-overview", { content: "overview\n" });
    await publisher.publishArtifact("index", { content: "index\n" });

    assert.equal(fixture.readFile(fixture.outputTarget.changesetOverviewPath), "overview\n");
    assert.equal(fixture.readFile(fixture.outputTarget.indexPath), "index\n");
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider publisher reports typed note-write failures with stable boundary metadata", async () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    const publisher = await fixture.provider.initializeRun(
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
