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

export interface ReviewOutputSink {
  initializeRun(outputTarget: OutputTarget): void;
  publishFileReview(fileResult: FileReviewResult): void;
  publishSkippedFile(skipRecord: SkipRecord): void;
}
