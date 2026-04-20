import assert from "node:assert/strict";
import test from "node:test";

import {
  createOutputWriteFailureEvidence,
  resolveOutputWriteFailureAssessment,
} from "../../src/providers/resolve-output-write-failure-assessment.ts";
import {
  type OutputWriteFailureAssessmentRequest,
  type OutputWriteHealthAssessor
} from "../../src/providers/review-output-health-assessor.ts";
import { ReviewOutputBoundaryError } from "../../src/providers/review-output-sink.ts";

function createInput(): OutputWriteFailureAssessmentRequest {
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

test("resolveOutputWriteFailureAssessment returns the assessor result when assess resolves", async () => {
  const assessor: OutputWriteHealthAssessor = {
    async assess() {
      return { faultScope: "single-file-output-fault" as const };
    }
  };

  const result = await resolveOutputWriteFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "single-file-output-fault" });
});

test("createOutputWriteFailureEvidence normalizes boundary errors into structured evidence", () => {
  assert.deepEqual(
    createOutputWriteFailureEvidence(
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

test("resolveOutputWriteFailureAssessment passes structured failure evidence to the assessor", async () => {
  let observedInput: Parameters<OutputWriteHealthAssessor["assess"]>[0] | undefined;
  const assessor: OutputWriteHealthAssessor = {
    async assess(input) {
      observedInput = input;
      return { faultScope: "single-file-output-fault" as const };
    }
  };

  const result = await resolveOutputWriteFailureAssessment(
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

test("resolveOutputWriteFailureAssessment passes through shared-output-target-fault from the assessor", async () => {
  const assessor: OutputWriteHealthAssessor = {
    async assess() {
      return { faultScope: "shared-output-target-fault" as const };
    }
  };

  const result = await resolveOutputWriteFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "shared-output-target-fault" });
});

test("resolveOutputWriteFailureAssessment falls back to shared-output-target-fault when assess rejects", async () => {
  const assessor: OutputWriteHealthAssessor = {
    async assess() {
      throw new Error("assessment failed");
    }
  };

  const result = await resolveOutputWriteFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "shared-output-target-fault" });
});

test("resolveOutputWriteFailureAssessment falls back to shared-output-target-fault when failure evidence normalization throws", async () => {
  const assessor: OutputWriteHealthAssessor = {
    async assess() {
      return { faultScope: "single-file-output-fault" as const };
    }
  };
  const error = {
    toString() {
      throw new Error("cannot stringify");
    }
  };

  const result = await resolveOutputWriteFailureAssessment(assessor, {
    ...createInput(),
    error
  });

  assert.deepEqual(result, { faultScope: "shared-output-target-fault" });
});

test("resolveOutputWriteFailureAssessment falls back to shared-output-target-fault when assess returns nullish", async () => {
  const assessor: OutputWriteHealthAssessor = {
    async assess() {
      return undefined as never;
    }
  };

  const result = await resolveOutputWriteFailureAssessment(assessor, createInput());

  assert.deepEqual(result, { faultScope: "shared-output-target-fault" });
});
