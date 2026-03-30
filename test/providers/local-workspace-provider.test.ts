import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

import { LocalWorkspaceProvider } from "../../src/providers/local-workspace-provider.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

test("LocalWorkspaceProvider initializes the run directories and skipped.md", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);

    assert.equal(existsSync(fixture.outputTarget.basePath), true);
    assert.equal(existsSync(fixture.outputTarget.filesPath), true);
    // skipped.md and tool-audit.jsonl are created as empty files eagerly so
    // append operations during the run never need to create them first.
    assert.equal(existsSync(fixture.outputTarget.skippedPath), true);
    assert.equal(existsSync(fixture.outputTarget.toolAuditPath), true);
    // summary, index, manifest, and changeset-overview are written lazily
    // only when the corresponding publish method is called.
    assert.equal(existsSync(fixture.outputTarget.summaryPath), false);
    assert.equal(existsSync(fixture.outputTarget.indexPath), false);
    assert.equal(existsSync(fixture.outputTarget.manifestPath), false);
    assert.equal(existsSync(fixture.outputTarget.changesetOverviewPath), false);
    assert.equal(
      existsSync(path.join(fixture.tempDir, ".nightowl", "reviewconfig.json")),
      false
    );
    assert.equal(
      existsSync(path.join(fixture.tempDir, ".nightowl", "reviewignore")),
      false
    );
    assert.equal(fixture.readFile(fixture.outputTarget.skippedPath), "");
    assert.equal(fixture.readFile(fixture.outputTarget.toolAuditPath), "");
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider publishes file review content to the target note path", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishFileReview({
      noteFilePath,
      content: "# src/app.ts\n\nPending review.\n"
    });

    assert.equal(fixture.readFile(noteFilePath), "# src/app.ts\n\nPending review.\n");
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider appends deterministic skipped-file records to skipped.md", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishSkippedFile({
      filePath: "src/app.ts",
      stepId: "step5-validation-interrogation",
      reason: "deterministic validation failed"
    });
    fixture.provider.publishSkippedFile({
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

test("LocalWorkspaceProvider publishes run summary content to summary.md", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishRunSummary({
      content: [
        "# Review Summary",
        "",
        "- Planned files: 1",
        "- Successful files: 1",
        "- Skipped files: 0"
      ].join("\n")
    });

    assert.equal(
      fixture.readFile(fixture.outputTarget.summaryPath),
      ["# Review Summary", "", "- Planned files: 1", "- Successful files: 1", "- Skipped files: 0"].join("\n")
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider publishes review index content to index.md", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishReviewIndex({
      content: [
        "# Review Index",
        "",
        "- Planned files: 1",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)"
      ].join("\n")
    });

    assert.equal(
      fixture.readFile(fixture.outputTarget.indexPath),
      [
        "# Review Index",
        "",
        "- Planned files: 1",
        "",
        "## Run Artifacts",
        "- [summary.md](./summary.md)"
      ].join("\n")
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider publishes run manifest content to manifest.json", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishRunManifest({
      content: '{\n  "schemaVersion": 1\n}'
    });

    assert.equal(
      fixture.readFile(fixture.outputTarget.manifestPath),
      '{\n  "schemaVersion": 1\n}'
    );
  } finally {
    fixture.cleanup();
  }
});

// assessSuccessfulSnapshotFailure classifies write failures so the orchestrator
// can decide whether to skip only the affected file or abort the entire run:
//   - single-file-output-fault: the error is scoped to one note file (e.g.
//     ENAMETOOLONG with a note-file path); other files can still be written.
//   - shared-output-target-fault: the error affects the shared output directory
//     (e.g. ENOSPC, or EEXIST on the shared files path); the run should stop.
//   Conservative fallback: any unrecognised error is treated as shared-fault.
test("LocalWorkspaceProvider classifies path-specific successful snapshot write failures as single-file output faults when the shared files path remains healthy", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const error = Object.assign(new Error("name too long"), {
    code: "ENAMETOOLONG",
    path: noteFilePath
  });

  try {
    fixture.provider.initializeRun(fixture.outputTarget);

    assert.deepEqual(
      fixture.provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error
      }),
      { faultScope: "single-file-output-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider classifies disk-capacity successful snapshot write failures as shared output target faults", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const error = Object.assign(new Error("disk full"), {
    code: "ENOSPC",
    path: noteFilePath
  });

  try {
    fixture.provider.initializeRun(fixture.outputTarget);

    assert.deepEqual(
      fixture.provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider falls back to shared output target fault when successful snapshot classification is inconclusive", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    fixture.provider.initializeRun(fixture.outputTarget);

    assert.deepEqual(
      fixture.provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error: new Error("note write failed")
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider treats shared files-path corruption as a shared output target fault", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const error = Object.assign(new Error("path collision"), {
    code: "EEXIST",
    path: fixture.outputTarget.filesPath
  });

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    // Replace the files directory with a regular file to simulate corruption
    // of the shared output path; the error's `path` points to filesPath, not
    // to an individual note file, so it must be classified as shared-fault.
    rmSync(fixture.outputTarget.filesPath, { recursive: true, force: true });
    writeFileSync(fixture.outputTarget.filesPath, "not-a-directory");

    assert.deepEqual(
      fixture.provider.assessSuccessfulSnapshotFailure({
        noteFilePath,
        error
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider publishes changeset overview content to changeset-overview.md", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishChangesetOverview({
      content: "## Changeset Overview\n\n- Modified `src/app.ts`\n"
    });

    assert.equal(
      fixture.readFile(fixture.outputTarget.changesetOverviewPath),
      "## Changeset Overview\n\n- Modified `src/app.ts`\n"
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider appends trailing newline when changeset overview content does not end with one", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishChangesetOverview({
      content: "## Changeset Overview\n\n- Modified `src/app.ts`"
    });

    assert.equal(
      fixture.readFile(fixture.outputTarget.changesetOverviewPath),
      "## Changeset Overview\n\n- Modified `src/app.ts`\n"
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalWorkspaceProvider writes changeset overview to the correct path under basePath", () => {
  const fixture = createWorkspaceProviderFixture();

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    fixture.provider.publishChangesetOverview({ content: "overview content" });

    assert.equal(existsSync(fixture.outputTarget.changesetOverviewPath), true);
    assert.ok(
      fixture.outputTarget.changesetOverviewPath.startsWith(fixture.outputTarget.basePath),
      "changesetOverviewPath must be under basePath"
    );
    assert.ok(
      fixture.outputTarget.changesetOverviewPath.endsWith("changeset-overview.md"),
      "changesetOverviewPath must end with changeset-overview.md"
    );
  } finally {
    fixture.cleanup();
  }
});
