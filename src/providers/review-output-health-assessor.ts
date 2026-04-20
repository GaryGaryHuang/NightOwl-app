import type { ReviewOutputBoundaryOperation, ReviewOutputTarget } from "./review-output-sink.ts";

export type SuccessfulSnapshotFaultScope =
  | "single-file-output-fault"
  | "shared-output-target-fault";

export type SuccessfulSnapshotFailureEvidenceKind =
  | "review-output-boundary-error"
  | "error"
  | "non-error";

export interface SuccessfulSnapshotFailureEvidence {
  kind: SuccessfulSnapshotFailureEvidenceKind;
  message: string;
  operation?: ReviewOutputBoundaryOperation;
  outputPath?: string;
  causeCode?: string;
  causePath?: string;
}

export interface SuccessfulSnapshotFailureAssessmentRequest {
  outputTarget: ReviewOutputTarget;
  noteFilePath: string;
  error: unknown;
}

export interface SuccessfulSnapshotFailureInput {
  outputTarget: ReviewOutputTarget;
  noteFilePath: string;
  failureEvidence: SuccessfulSnapshotFailureEvidence;
}

export interface SuccessfulSnapshotFailureAssessment {
  faultScope: SuccessfulSnapshotFaultScope;
}

export interface SuccessfulSnapshotOutputHealthAssessor {
  assess(input: SuccessfulSnapshotFailureInput): Promise<SuccessfulSnapshotFailureAssessment>;
}
