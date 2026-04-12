import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ReviewOutputBoundaryError } from "../../src/providers/review-output-sink.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

type WorkspaceFixture = ReturnType<typeof createWorkspaceProviderFixture>;
type RunScopedPublisher = ReturnType<WorkspaceFixture["provider"]["initializeRun"]>;

test("run-scoped output publisher publishes file review content to the target note path", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    const publisher = fixture.provider.initializeRun(fixture.outputTarget);
    publisher.publishFileReview({
      noteFilePath,
      content: "# src/app.ts\n\nPending review.\n"
    });

    assert.equal(fixture.readFile(noteFilePath), "# src/app.ts\n\nPending review.\n");
  } finally {
    fixture.cleanup();
  }
});

test("run-scoped output publisher appends deterministic skipped-file records to skipped.md", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = fixture.provider.initializeRun(fixture.outputTarget);
    publisher.publishSkippedFile({
      filePath: "src/app.ts",
      stepId: "step5-validation-interrogation",
      reason: "deterministic validation failed"
    });
    publisher.publishSkippedFile({
      filePath: "src/other.ts",
      stepId: "step7-summary",
      reason: "judge rejected"
    });

    assert.equal(
      fixture.readFile(fixture.outputTarget.skippedPath),
      [
        "- `src/app.ts` — step5-validation-interrogation — deterministic validation failed",
        "- `src/other.ts` — step7-summary — judge rejected",
        ""
      ].join("\n")
    );
  } finally {
    fixture.cleanup();
  }
});

test("run-scoped output publisher preserves intact skipped.md lines across multiple appends", async () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = fixture.provider.initializeRun(fixture.outputTarget);

    await Promise.all([
      Promise.resolve().then(() =>
        publisher.publishSkippedFile({
          filePath: "src/app.ts",
          stepId: "step5-validation-interrogation",
          reason: "deterministic validation failed"
        })
      ),
      Promise.resolve().then(() =>
        publisher.publishSkippedFile({
          filePath: "src/other.ts",
          stepId: "step7-summary",
          reason: "judge rejected"
        })
      )
    ]);

    const lines = fixture.readFile(fixture.outputTarget.skippedPath).trimEnd().split("\n");
    assert.deepEqual(lines.sort(), [
      "- `src/app.ts` — step5-validation-interrogation — deterministic validation failed",
      "- `src/other.ts` — step7-summary — judge rejected"
    ]);
  } finally {
    fixture.cleanup();
  }
});

test("run-scoped output publisher publishes run-level artifact content to the configured paths", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    const publisher = fixture.provider.initializeRun(fixture.outputTarget);
    const cases: Array<{
      publish(publisher: RunScopedPublisher, content: string): void;
      outputPath: string;
      content: string;
    }> = [
      {
        publish(targetPublisher, content) {
          targetPublisher.publishRunSummary({ content });
        },
        outputPath: fixture.outputTarget.summaryPath,
        content: [
          "# Review Summary",
          "",
          "- Planned files: 1",
          "- Successful files: 1",
          "- Skipped files: 0"
        ].join("\n")
      },
      {
        publish(targetPublisher, content) {
          targetPublisher.publishReviewIndex({ content });
        },
        outputPath: fixture.outputTarget.indexPath,
        content: [
          "# Review Index",
          "",
          "- Planned files: 1",
          "",
          "## Run Artifacts",
          "- [summary.md](./summary.md)"
        ].join("\n")
      },
      {
        publish(targetPublisher, content) {
          targetPublisher.publishRunManifest({ content });
        },
        outputPath: fixture.outputTarget.manifestPath,
        content: '{\n  "schemaVersion": 1\n}'
      },
      {
        publish(targetPublisher, content) {
          targetPublisher.publishChangesetOverview({ content });
        },
        outputPath: fixture.outputTarget.changesetOverviewPath,
        content: "## Changeset Overview\n\n- Modified `src/app.ts`\n"
      }
    ];

    for (const { publish, outputPath, content } of cases) {
      publish(publisher, content);
      assert.equal(fixture.readFile(outputPath), content);
    }
  } finally {
    fixture.cleanup();
  }
});

test("run-scoped output publishers do not share output state across runs", () => {
  const fixtureA = createWorkspaceProviderFixture();
  const fixtureB = createWorkspaceProviderFixture();

  try {
    const publisherA = fixtureA.provider.initializeRun(fixtureA.outputTarget);
    const publisherB = fixtureB.provider.initializeRun(fixtureB.outputTarget);

    publisherA.publishRunSummary({ content: "summary A\n" });
    publisherB.publishRunSummary({ content: "summary B\n" });

    assert.equal(fixtureA.readFile(fixtureA.outputTarget.summaryPath), "summary A\n");
    assert.equal(fixtureB.readFile(fixtureB.outputTarget.summaryPath), "summary B\n");
  } finally {
    fixtureA.cleanup();
    fixtureB.cleanup();
  }
});

test("run-scoped output publisher reports typed file-review write failures with stable operation metadata", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    const publisher = fixture.provider.initializeRun(fixture.outputTarget);
    mkdirSync(path.dirname(noteFilePath), { recursive: true });
    mkdirSync(noteFilePath, { recursive: true });

    assert.throws(
      () =>
        publisher.publishFileReview({
          noteFilePath,
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
