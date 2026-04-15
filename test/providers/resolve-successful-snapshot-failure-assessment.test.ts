import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSuccessfulSnapshotFailureAssessment,
} from "../../src/providers/resolve-successful-snapshot-failure-assessment.ts";
import {
  type SuccessfulSnapshotFailureInput,
  type SuccessfulSnapshotOutputHealthAssessor
} from "../../src/providers/review-output-health-assessor.ts";

function createInput(): SuccessfulSnapshotFailureInput {
  return {
    outputTarget: {
      basePath: "/tmp/review",
      changesetOverviewPath: "/tmp/review/changeset-overview.md",
      filesPath: "/tmp/review/files",
      skippedPath: "/tmp/review/skipped.md",
      summaryPath: "/tmp/review/summary.md",
      indexPath: "/tmp/review/index.md",
      manifestPath: "/tmp/review/manifest.json",
      toolAuditPath: "/tmp/review/tool-audit.jsonl"
    },
    noteFilePath: "/tmp/review/files/src__app.ts.md",
    error: new Error("note write failed")
  };
}

test("resolveSuccessfulSnapshotFailureAssessment returns the assessor result when assess resolves", async () => {
  const assessor: SuccessfulSnapshotOutputHealthAssessor = {
    async assess() {
      return { faultScope: "single-file-output-fault" as const };
    }
  };

  const result = await resolveSuccessfulSnapshotFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "single-file-output-fault" });
});

test("resolveSuccessfulSnapshotFailureAssessment falls back to shared-output-target-fault when assess rejects", async () => {
  const assessor: SuccessfulSnapshotOutputHealthAssessor = {
    async assess() {
      throw new Error("assessment failed");
    }
  };

  const result = await resolveSuccessfulSnapshotFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "shared-output-target-fault" });
});

test("resolveSuccessfulSnapshotFailureAssessment falls back to shared-output-target-fault when assess returns nullish", async () => {
  const assessor: SuccessfulSnapshotOutputHealthAssessor = {
    async assess() {
      return undefined as never;
    }
  };

  const result = await resolveSuccessfulSnapshotFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "shared-output-target-fault" });
});
