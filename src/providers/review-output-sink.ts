// Mirrors the core OutputTarget/PlannedNoteFile surface at the provider boundary.
// Keeping a provider-local copy avoids coupling adapter contracts to core path-planning modules.
export interface ReviewOutputTarget {
  basePath: string;
  changesetOverviewPath: string;
  filesPath: string;
  indexPath: string;
  toolAuditPath: string;
}

export interface ReviewOutputPlannedNote {
  filePath: string;
  noteFilePath: string;
}

export interface ReviewOutputPlan {
  outputTarget: ReviewOutputTarget;
  plannedNotes: ReviewOutputPlannedNote[];
}

export type ReviewArtifactKind =
  | "changeset-overview"
  | "index";

export type ReviewOutputBoundaryOperation =
  | "initializeRun"
  | "publishFileReview"
  | `publishArtifact:${ReviewArtifactKind}`;

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
  filePath: string;
  content: string;
}

export interface ContentResult {
  content: string;
}

export interface RunOutputPublisher {
  publishFileReview(fileResult: FileReviewResult): Promise<void>;
  publishArtifact(kind: ReviewArtifactKind, result: ContentResult): Promise<void>;
}

export interface ReviewOutputSink {
  initializeRun(outputPlan: ReviewOutputPlan): Promise<RunOutputPublisher>;
}
