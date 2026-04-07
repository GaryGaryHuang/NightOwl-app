export interface ReviewOutputTarget {
  basePath: string;
  changesetOverviewPath: string;
  filesPath: string;
  skippedPath: string;
  summaryPath: string;
  indexPath: string;
  manifestPath: string;
  toolAuditPath: string;
}

export type ReviewOutputBoundaryOperation =
  | "initializeRun"
  | "publishFileReview"
  | "publishSkippedFile"
  | "publishRunSummary"
  | "publishReviewIndex"
  | "publishRunManifest"
  | "publishChangesetOverview";

export class ReviewOutputBoundaryError extends Error {
  readonly operation: ReviewOutputBoundaryOperation;
  readonly outputPath?: string;

  constructor(
    operation: ReviewOutputBoundaryOperation,
    message: string,
    options?: { cause?: unknown; outputPath?: string }
  ) {
    super(message, options);
    this.name = "ReviewOutputBoundaryError";
    this.operation = operation;
    this.outputPath = options?.outputPath;
  }
}

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

export interface RunOutputPublisher {
  publishFileReview(fileResult: FileReviewResult): void;
  publishSkippedFile(skipRecord: SkipRecord): void;
  publishRunSummary(summaryResult: RunSummaryResult): void;
  publishReviewIndex(indexResult: ReviewIndexResult): void;
  publishRunManifest(manifestResult: RunManifestResult): void;
  publishChangesetOverview(result: ChangesetOverviewResult): void;
}

export interface SuccessfulSnapshotFailureInput {
  outputTarget: ReviewOutputTarget;
  noteFilePath: string;
  error: unknown;
}

export interface SuccessfulSnapshotFailureAssessment {
  faultScope: SuccessfulSnapshotFaultScope;
}

export interface SuccessfulSnapshotOutputHealthAssessor {
  assess(input: SuccessfulSnapshotFailureInput): SuccessfulSnapshotFailureAssessment;
}

export interface ReviewOutputSink {
  initializeRun(outputTarget: ReviewOutputTarget): RunOutputPublisher;
}

export type ReviewOutputBootstrapAndPublisher =
  ReviewOutputSink & RunOutputPublisher;

export function resolveSuccessfulSnapshotFailureAssessment(
  assessor: SuccessfulSnapshotOutputHealthAssessor,
  input: SuccessfulSnapshotFailureInput
): SuccessfulSnapshotFailureAssessment {
  try {
    // Default to the conservative shared-target classification unless the sink can prove a single-file fault.
    return (
      assessor.assess(input) ?? { faultScope: "shared-output-target-fault" }
    );
  } catch {
    return { faultScope: "shared-output-target-fault" };
  }
}
