import assert from "node:assert/strict";
import test from "node:test";

import {
  createSuccessfulSnapshotFailureEvidence,
  resolveSuccessfulSnapshotFailureAssessment,
} from "../../src/providers/resolve-successful-snapshot-failure-assessment.ts";
import {
  type SuccessfulSnapshotFailureAssessmentRequest,
  type SuccessfulSnapshotOutputHealthAssessor
} from "../../src/providers/review-output-health-assessor.ts";
import { ReviewOutputBoundaryError } from "../../src/providers/review-output-sink.ts";

function createInput(): SuccessfulSnapshotFailureAssessmentRequest {
  return {
    outputTarget: {
      basePath: "/tmp/review",
      changesetOverviewPath: "/tmp/review/changeset-overview.md",
      filesPath: "/tmp/review/files",
      skippedPath: "/tmp/review/skipped.md",
      summaryPath: "/tmp/review/summary.md",
      indexPath: "/tmp/review/index.md",
      verifierReportPath: "/tmp/review/verifier-report.jsonl",
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

test("createSuccessfulSnapshotFailureEvidence normalizes boundary errors into structured evidence", () => {
  assert.deepEqual(
    createSuccessfulSnapshotFailureEvidence(
      new ReviewOutputBoundaryError("publishFileReview", "note write failed", {
        cause: Object.assign(new Error("ENAMETOOLONG write failure"), {
          code: "ENAMETOOLONG",
          path: "/tmp/review/files/src__app.ts.md"
        }),
        outputPath: "/tmp/review/files/src__app.ts.md"
      })
    ),
    {
      kind: "review-output-boundary-error",
      operation: "publishFileReview",
      message: "note write failed",
      outputPath: "/tmp/review/files/src__app.ts.md",
      causeCode: "ENAMETOOLONG",
      causePath: "/tmp/review/files/src__app.ts.md"
    }
  );
});

test("resolveSuccessfulSnapshotFailureAssessment passes structured failure evidence to the assessor", async () => {
  let observedInput: Parameters<SuccessfulSnapshotOutputHealthAssessor["assess"]>[0] | undefined;
  const assessor: SuccessfulSnapshotOutputHealthAssessor = {
    async assess(input) {
      observedInput = input;
      return { faultScope: "single-file-output-fault" as const };
    }
  };

  const result = await resolveSuccessfulSnapshotFailureAssessment(
    assessor,
    {
      ...createInput(),
      error: new ReviewOutputBoundaryError("publishFileReview", "note write failed", {
        cause: Object.assign(new Error("ENAMETOOLONG write failure"), {
          code: "ENAMETOOLONG",
          path: "/tmp/review/files/src__app.ts.md"
        }),
        outputPath: "/tmp/review/files/src__app.ts.md"
      })
    }
  );

  assert.deepEqual(result, { faultScope: "single-file-output-fault" });
  assert.deepEqual(observedInput?.failureEvidence, {
    kind: "review-output-boundary-error",
    operation: "publishFileReview",
    message: "note write failed",
    outputPath: "/tmp/review/files/src__app.ts.md",
    causeCode: "ENAMETOOLONG",
    causePath: "/tmp/review/files/src__app.ts.md"
  });
});

test("resolveSuccessfulSnapshotFailureAssessment passes through shared-output-target-fault from the assessor", async () => {
  const assessor: SuccessfulSnapshotOutputHealthAssessor = {
    async assess() {
      return { faultScope: "shared-output-target-fault" as const };
    }
  };

  const result = await resolveSuccessfulSnapshotFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "shared-output-target-fault" });
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

test("resolveSuccessfulSnapshotFailureAssessment falls back to shared-output-target-fault when failure evidence normalization throws", async () => {
  const assessor: SuccessfulSnapshotOutputHealthAssessor = {
    async assess() {
      return { faultScope: "single-file-output-fault" as const };
    }
  };
  const error = {
    toString() {
      throw new Error("cannot stringify");
    }
  };

  const result = await resolveSuccessfulSnapshotFailureAssessment(assessor, {
    ...createInput(),
    error
  });

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
