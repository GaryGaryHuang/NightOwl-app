import type { ReviewOutputTarget } from "./review-output-sink.ts";

export type OutputWriteFaultScope =
  | "single-file-output-fault"
  | "shared-output-target-fault";

export interface OutputWriteFailureEvidence {
  causeCode?: string;
  causePath?: string;
}

export interface OutputWriteFailureAssessmentRequest {
  outputTarget: ReviewOutputTarget;
  noteFilePath: string;
  error: unknown;
}

export interface OutputWriteFailureInput {
  outputTarget: ReviewOutputTarget;
  noteFilePath: string;
  failureEvidence: OutputWriteFailureEvidence;
}

export interface OutputWriteFailureAssessment {
  faultScope: OutputWriteFaultScope;
}

export interface OutputWriteHealthAssessor {
  assess(input: OutputWriteFailureInput): Promise<OutputWriteFailureAssessment>;
}
