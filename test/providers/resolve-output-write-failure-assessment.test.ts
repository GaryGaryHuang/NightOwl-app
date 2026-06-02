import assert from "node:assert/strict";
import test from "node:test";

import { resolveOutputWriteFailureAssessment } from "../../src/providers/resolve-output-write-failure-assessment.ts";
import type {
  OutputWriteFailureAssessmentRequest,
  OutputWriteHealthAssessor
} from "../../src/providers/review-output-health-assessor.ts";
import { ReviewOutputBoundaryError } from "../../src/providers/review-output-sink.ts";

function createInput(): OutputWriteFailureAssessmentRequest {
  return {
    outputTarget: {
      basePath: "/tmp/review",
      changesetOverviewPath: "/tmp/review/changeset-overview.md",
      filesPath: "/tmp/review/files",
      indexPath: "/tmp/review/index.md",
      toolAuditPath: "/tmp/review/tool-audit.jsonl"
    },
    noteFilePath: "/tmp/review/files/src__app.ts.md",
    error: new Error("note write failed")
  };
}

test("resolveOutputWriteFailureAssessment normalizes ReviewOutputBoundaryError evidence before calling the assessor", async () => {
  let observedInput: Parameters<OutputWriteHealthAssessor["assess"]>[0] | undefined;
  const assessor: OutputWriteHealthAssessor = {
    async assess(input) {
      observedInput = input;
      return { faultScope: "single-file-output-fault" as const };
    }
  };

  const result = await resolveOutputWriteFailureAssessment(assessor, {
    ...createInput(),
    error: new ReviewOutputBoundaryError("publishFileReview", "note write failed", {
      cause: Object.assign(new Error("ENAMETOOLONG write failure"), {
        code: "ENAMETOOLONG",
        path: "/tmp/review/files/src__app.ts.md"
      }),
      outputPath: "/tmp/review/files/src__app.ts.md"
    })
  });

  assert.deepEqual(result, { faultScope: "single-file-output-fault" });
  assert.deepEqual(observedInput?.failureEvidence, {
    causeCode: "ENAMETOOLONG",
    causePath: "/tmp/review/files/src__app.ts.md"
  });
});

test("resolveOutputWriteFailureAssessment falls back conservatively when the assessor fails", async () => {
  const rejectingAssessor: OutputWriteHealthAssessor = {
    async assess() {
      throw new Error("assessment failed");
    }
  };

  assert.deepEqual(
    await resolveOutputWriteFailureAssessment(rejectingAssessor, createInput()),
    { faultScope: "shared-output-target-fault" }
  );
});
