import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import { LocalSuccessfulSnapshotOutputHealthAssessor } from "../../src/providers/local-successful-snapshot-output-health-assessor.ts";
import { ReviewOutputBoundaryError } from "../../src/providers/review-output-sink.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

type WorkspaceFixture = ReturnType<typeof createWorkspaceProviderFixture>;

interface SnapshotHealthAssessorFixture {
  fixture: WorkspaceFixture;
  noteFilePath: string;
  assess(error: unknown): ReturnType<LocalSuccessfulSnapshotOutputHealthAssessor["assess"]>;
  cleanup(): void;
}

function createSnapshotHealthAssessorFixture(): SnapshotHealthAssessorFixture {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const assessor = new LocalSuccessfulSnapshotOutputHealthAssessor();

  fixture.provider.initializeRun(fixture.outputTarget);

  return {
    fixture,
    noteFilePath,
    assess(error: unknown) {
      return assessor.assess({
        outputTarget: fixture.outputTarget,
        noteFilePath,
        error
      });
    },
    cleanup() {
      fixture.cleanup();
    }
  };
}

test("LocalSuccessfulSnapshotOutputHealthAssessor classifies path-specific note write failures as single-file output faults when the shared files path remains healthy", () => {
  const assessorFixture = createSnapshotHealthAssessorFixture();

  try {
    assert.deepEqual(
      assessorFixture.assess(Object.assign(new Error("name too long"), {
        code: "ENAMETOOLONG",
        path: assessorFixture.noteFilePath
      })),
      { faultScope: "single-file-output-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor classifies disk-capacity write failures as shared output target faults", () => {
  const assessorFixture = createSnapshotHealthAssessorFixture();

  try {
    assert.deepEqual(
      assessorFixture.assess(Object.assign(new Error("disk full"), {
        code: "ENOSPC",
        path: assessorFixture.noteFilePath
      })),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor falls back to shared output target fault when classification is inconclusive", () => {
  const assessorFixture = createSnapshotHealthAssessorFixture();

  try {
    const inconclusiveErrors = [
      new Error("note write failed"),
      new ReviewOutputBoundaryError("publishFileReview", "note write failed", {
        outputPath: assessorFixture.noteFilePath
      })
    ];

    for (const error of inconclusiveErrors) {
      assert.deepEqual(
        assessorFixture.assess(error),
        { faultScope: "shared-output-target-fault" }
      );
    }
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor treats shared files-path corruption as a shared output target fault", () => {
  const assessorFixture = createSnapshotHealthAssessorFixture();

  try {
    rmSync(assessorFixture.fixture.outputTarget.filesPath, {
      recursive: true,
      force: true
    });
    writeFileSync(assessorFixture.fixture.outputTarget.filesPath, "not-a-directory");

    assert.deepEqual(
      assessorFixture.assess(Object.assign(new Error("path collision"), {
        code: "EEXIST",
        path: assessorFixture.fixture.outputTarget.filesPath
      })),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});
