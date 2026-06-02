import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import test from "node:test";

import type { OutputWriteFailureEvidence } from "../../src/providers/review-output-health-assessor.ts";
import { LocalOutputWriteHealthAssessor } from "../../src/providers/local-output-write-health-assessor.ts";
import { createWorkspaceProviderFixture } from "../helpers/workspace-provider-contract-fixture.ts";

type WorkspaceFixture = ReturnType<typeof createWorkspaceProviderFixture>;

interface SnapshotHealthAssessorFixture {
  fixture: WorkspaceFixture;
  noteFilePath: string;
  assess(
    failureEvidence: OutputWriteFailureEvidence
  ): ReturnType<LocalOutputWriteHealthAssessor["assess"]>;
  cleanup(): void;
}

async function createSnapshotHealthAssessorFixture(): Promise<SnapshotHealthAssessorFixture> {
  const fixture = createWorkspaceProviderFixture();
  const noteFilePath = fixture.buildNoteFilePath("src__app.ts.md");
  const assessor = new LocalOutputWriteHealthAssessor();

  await fixture.provider.initializeRun(fixture.outputPlan);

  return {
    fixture,
    noteFilePath,
    assess(failureEvidence: OutputWriteFailureEvidence) {
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

test("LocalOutputWriteHealthAssessor classifies isolated note-path write failures as single-file output faults", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    assert.deepEqual(
      await assessorFixture.assess({
        causeCode: "ENAMETOOLONG",
        causePath: assessorFixture.noteFilePath
      }),
      { faultScope: "single-file-output-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalOutputWriteHealthAssessor refuses to downgrade single-file-like errors when they point at a shared path", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    assert.deepEqual(
      await assessorFixture.assess({
        causeCode: "ENAMETOOLONG",
        causePath: assessorFixture.fixture.outputTarget.filesPath
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalOutputWriteHealthAssessor classifies shared-target write failures conservatively", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    assert.deepEqual(
      await assessorFixture.assess({
        causeCode: "ENOSPC",
        causePath: assessorFixture.noteFilePath
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});

test("LocalOutputWriteHealthAssessor refuses to downgrade when shared output directories are unhealthy", async () => {
  const assessorFixture = await createSnapshotHealthAssessorFixture();

  try {
    rmSync(assessorFixture.fixture.outputTarget.basePath, {
      recursive: true,
      force: true
    });
    writeFileSync(assessorFixture.fixture.outputTarget.basePath, "not-a-directory");

    assert.deepEqual(
      await assessorFixture.assess({
        causeCode: "ENAMETOOLONG",
        causePath: assessorFixture.noteFilePath
      }),
      { faultScope: "shared-output-target-fault" }
    );
  } finally {
    assessorFixture.cleanup();
  }
});
