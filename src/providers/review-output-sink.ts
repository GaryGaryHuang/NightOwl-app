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

export interface ContentResult {
  content: string;
}

export type RunSummaryResult = ContentResult;
export type ReviewIndexResult = ContentResult;
export type RunManifestResult = ContentResult;
export type ChangesetOverviewResult = ContentResult;

export interface RunOutputPublisher {
  publishFileReview(fileResult: FileReviewResult): Promise<void>;
  publishSkippedFile(skipRecord: SkipRecord): Promise<void>;
  publishRunSummary(summaryResult: RunSummaryResult): Promise<void>;
  publishReviewIndex(indexResult: ReviewIndexResult): Promise<void>;
  publishRunManifest(manifestResult: RunManifestResult): Promise<void>;
  publishChangesetOverview(result: ChangesetOverviewResult): Promise<void>;
}

export interface ReviewOutputSink {
  initializeRun(outputTarget: ReviewOutputTarget): Promise<RunOutputPublisher>;
}
