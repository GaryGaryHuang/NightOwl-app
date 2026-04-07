export type ReviewSourceProviderOperation =
  | "resolveRepoRoot"
  | "getChangedFiles"
  | "getChangesetEntries"
  | "getDiff"
  | "getCurrentBranch";

export class ReviewSourceProviderError extends Error {
  readonly operation: ReviewSourceProviderOperation;

  constructor(
    operation: ReviewSourceProviderOperation,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ReviewSourceProviderError";
    this.operation = operation;
  }
}

export interface ReviewSourceProvider {
  resolveRepoRoot(startPath: string): string;
  getChangedFiles(repoRoot: string, baseRef: string, headRef: string): string[];
  getChangesetEntries(repoRoot: string, baseRef: string, headRef: string): string[];
  getDiff(
    repoRoot: string,
    baseRef: string,
    headRef: string,
    filePath: string
  ): string;
  getCurrentBranch(repoRoot: string): string | undefined;
}
