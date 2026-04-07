import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import { LocalSuccessfulSnapshotOutputHealthAssessor } from "../../src/providers/local-successful-snapshot-output-health-assessor.ts";
import { ReviewOutputBoundaryError } from "../../src/providers/review-output-sink.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

test("LocalSuccessfulSnapshotOutputHealthAssessor classifies path-specific note write failures as single-file output faults when the shared files path remains healthy", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const error = Object.assign(new Error("name too long"), {
    code: "ENAMETOOLONG",
    path: noteFilePath
  });

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    const assessor = new LocalSuccessfulSnapshotOutputHealthAssessor();

    assert.deepEqual(
      assessor.assess({
        outputTarget: fixture.outputTarget,
        noteFilePath,
        error
      }),
      { faultScope: "single-file-output-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor classifies disk-capacity write failures as shared output target faults", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const error = Object.assign(new Error("disk full"), {
    code: "ENOSPC",
    path: noteFilePath
  });

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    const assessor = new LocalSuccessfulSnapshotOutputHealthAssessor();

    assert.deepEqual(
      assessor.assess({
        outputTarget: fixture.outputTarget,
        noteFilePath,
        error
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor falls back to shared output target fault when classification is inconclusive", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    const assessor = new LocalSuccessfulSnapshotOutputHealthAssessor();

    assert.deepEqual(
      assessor.assess({
        outputTarget: fixture.outputTarget,
        noteFilePath,
        error: new Error("note write failed")
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor treats shared files-path corruption as a shared output target fault", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const error = Object.assign(new Error("path collision"), {
    code: "EEXIST",
    path: fixture.outputTarget.filesPath
  });

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    rmSync(fixture.outputTarget.filesPath, { recursive: true, force: true });
    writeFileSync(fixture.outputTarget.filesPath, "not-a-directory");
    const assessor = new LocalSuccessfulSnapshotOutputHealthAssessor();

    assert.deepEqual(
      assessor.assess({
        outputTarget: fixture.outputTarget,
        noteFilePath,
        error
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor falls back to shared output target fault when ReviewOutputBoundaryError has no preserved cause", () => {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");

  try {
    fixture.provider.initializeRun(fixture.outputTarget);
    const assessor = new LocalSuccessfulSnapshotOutputHealthAssessor();

    assert.deepEqual(
      assessor.assess({
        outputTarget: fixture.outputTarget,
        noteFilePath,
        error: new ReviewOutputBoundaryError("publishFileReview", "note write failed", {
          outputPath: noteFilePath
        })
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    fixture.cleanup();
  }
});
