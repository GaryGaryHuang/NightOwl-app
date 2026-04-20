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
  /**
   * Filters repo-relative changed-file paths down to the subset that should
   * enter review planning.
   *
   * Implementations own repo-local reviewability policy, including canonical
   * `.nightowl/reviewignore` handling and the invariant that `.nightowl/**`
   * paths remain non-reviewable. Surviving paths must preserve their original
   * input order.
   */
  filterReviewableFiles(repoRoot: string, files: string[]): Promise<string[]>;
}
