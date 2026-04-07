export type ReviewFileFilterOperation = "filterReviewableFiles";

export class ReviewFileFilterError extends Error {
  readonly operation: ReviewFileFilterOperation;

  constructor(
    operation: ReviewFileFilterOperation,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ReviewFileFilterError";
    this.operation = operation;
  }
}

export interface ReviewFileFilter {
  filterReviewableFiles(repoRoot: string, files: string[]): string[];
}
