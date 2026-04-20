import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import type { SuccessfulSnapshotFailureEvidence } from "../../src/providers/review-output-health-assessor.ts";
import { LocalSuccessfulSnapshotOutputHealthAssessor } from "../../src/providers/local-successful-snapshot-output-health-assessor.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

type WorkspaceFixture = ReturnType<typeof createWorkspaceProviderFixture>;

interface SnapshotHealthAssessorFixture {
  fixture: WorkspaceFixture;
  noteFilePath: string;
  assess(
    failureEvidence: SuccessfulSnapshotFailureEvidence
  ): ReturnType<LocalSuccessfulSnapshotOutputHealthAssessor["assess"]>;
  cleanup(): void;
}

async function createSnapshotHealthAssessorFixture(): Promise<SnapshotHealthAssessorFixture> {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const assessor = new LocalSuccessfulSnapshotOutputHealthAssessor();

  await fixture.provider.initializeRun(fixture.outputPlan);

  return {
    fixture,
    noteFilePath,
    assess(failureEvidence: SuccessfulSnapshotFailureEvidence) {
      return assessor.assess({
        outputTarget: fixture.outputTarget,
        noteFilePath,
        failureEvidence
      });
    },
    cleanup() {
      fixture.cleanup();
    }
  };
}

test("LocalSuccessfulSnapshotOutputHealthAssessor classifies path-specific note write failures as single-file output faults when the shared files path remains healthy", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    for (const code of ["ENAMETOOLONG", "EISDIR"]) {
      assert.deepEqual(
        await assessorFixture.assess({
          kind: "review-output-boundary-error",
          message: `${code} write failure`,
          causeCode: code,
          causePath: assessorFixture.noteFilePath,
          outputPath: assessorFixture.noteFilePath
        }),
        { faultScope: "single-file-output-fault" },
        `expected ${code} on the note path to be single-file-output-fault`
      );
    }
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor classifies disk-capacity write failures as shared output target faults", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    assert.deepEqual(
      await assessorFixture.assess({
        kind: "review-output-boundary-error",
        message: "disk full",
        causeCode: "ENOSPC",
        causePath: assessorFixture.noteFilePath,
        outputPath: assessorFixture.noteFilePath
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor falls back to shared output target fault when classification is inconclusive", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    const inconclusiveErrors: SuccessfulSnapshotFailureEvidence[] = [
      {
        kind: "error",
        message: "note write failed"
      },
      {
        kind: "review-output-boundary-error",
        message: "note write failed",
        causeCode: "ENAMETOOLONG",
        causePath: assessorFixture.fixture.outputTarget.filesPath,
        outputPath: assessorFixture.fixture.outputTarget.filesPath
      }
    ];

    for (const failure of inconclusiveErrors) {
      assert.deepEqual(
        await assessorFixture.assess(failure),
        { faultScope: "shared-output-target-fault" }
      );
    }
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor treats shared files-path corruption as a shared output target fault", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    rmSync(assessorFixture.fixture.outputTarget.filesPath, {
      recursive: true,
      force: true
    });
    writeFileSync(assessorFixture.fixture.outputTarget.filesPath, "not-a-directory");

    assert.deepEqual(
      await assessorFixture.assess({
        kind: "review-output-boundary-error",
        message: "path collision",
        causeCode: "EEXIST",
        causePath: assessorFixture.fixture.outputTarget.filesPath,
        outputPath: assessorFixture.fixture.outputTarget.filesPath
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalSuccessfulSnapshotOutputHealthAssessor falls back to shared output target fault when the run base path is not writable directory health", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    rmSync(assessorFixture.fixture.outputTarget.basePath, {
      recursive: true,
      force: true
    });
    writeFileSync(assessorFixture.fixture.outputTarget.basePath, "not-a-directory");

    assert.deepEqual(
      await assessorFixture.assess({
        kind: "review-output-boundary-error",
        message: "path collision",
        causeCode: "ENAMETOOLONG",
        causePath: assessorFixture.noteFilePath,
        outputPath: assessorFixture.noteFilePath
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});
