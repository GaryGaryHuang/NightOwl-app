import type { ReviewOutputTarget } from "./review-output-sink.ts";

export type SuccessfulSnapshotFaultScope =
  | "single-file-output-fault"
  | "shared-output-target-fault";

export interface SuccessfulSnapshotFailureInput {
  outputTarget: ReviewOutputTarget;
  noteFilePath: string;
  error: unknown;
}

export interface SuccessfulSnapshotFailureAssessment {
  faultScope: SuccessfulSnapshotFaultScope;
}

export interface SuccessfulSnapshotOutputHealthAssessor {
  assess(input: SuccessfulSnapshotFailureInput): Promise<SuccessfulSnapshotFailureAssessment>;
}
