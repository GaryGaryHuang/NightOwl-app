import type {
  SuccessfulSnapshotFailureAssessment,
  SuccessfulSnapshotFailureInput,
  SuccessfulSnapshotOutputHealthAssessor
} from "./review-output-health-assessor.ts";

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
