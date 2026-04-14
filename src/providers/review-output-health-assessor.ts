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

export async function resolveSuccessfulSnapshotFailureAssessment(
  assessor: SuccessfulSnapshotOutputHealthAssessor,
  input: SuccessfulSnapshotFailureInput
): Promise<SuccessfulSnapshotFailureAssessment> {
  try {
    // Default to the conservative shared-target classification unless the sink can prove a single-file fault.
    return (
      (await assessor.assess(input)) ?? { faultScope: "shared-output-target-fault" }
    );
  } catch {
    return { faultScope: "shared-output-target-fault" };
  }
}
