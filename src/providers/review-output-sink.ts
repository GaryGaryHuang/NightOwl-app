import type { OutputTarget } from "../core/review-path-resolver.ts";

export interface FileReviewResult {
  noteFilePath: string;
  content: string;
}

export interface SkipRecord {
  filePath: string;
  stepId: string;
  reason: string;
}

export interface RunSummaryResult {
  content: string;
}

export interface ReviewIndexResult {
  content: string;
}

export interface RunManifestResult {
  content: string;
}

export interface ChangesetOverviewResult {
  content: string;
}

export type SuccessfulSnapshotFaultScope =
  | "single-file-output-fault"
  | "shared-output-target-fault";

export interface SuccessfulSnapshotFailureInput {
  noteFilePath: string;
  error: unknown;
}

export interface SuccessfulSnapshotFailureAssessment {
  faultScope: SuccessfulSnapshotFaultScope;
}

export interface ReviewOutputSink {
  initializeRun(outputTarget: OutputTarget): void;
  publishFileReview(fileResult: FileReviewResult): void;
  assessSuccessfulSnapshotFailure?(
    input: SuccessfulSnapshotFailureInput
  ): SuccessfulSnapshotFailureAssessment;
  publishSkippedFile(skipRecord: SkipRecord): void;
  publishRunSummary(summaryResult: RunSummaryResult): void;
  publishReviewIndex(indexResult: ReviewIndexResult): void;
  publishRunManifest(manifestResult: RunManifestResult): void;
  publishChangesetOverview(result: ChangesetOverviewResult): void;
}

export function resolveSuccessfulSnapshotFailureAssessment(
  outputSink: ReviewOutputSink,
  input: SuccessfulSnapshotFailureInput
): SuccessfulSnapshotFailureAssessment {
  try {
    return (
      outputSink.assessSuccessfulSnapshotFailure?.(input) ?? {
        faultScope: "shared-output-target-fault"
      }
    );
  } catch {
    return { faultScope: "shared-output-target-fault" };
  }
}
