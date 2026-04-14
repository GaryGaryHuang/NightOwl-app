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
  resolveRepoRoot(startPath: string): Promise<string>;
  getChangedFiles(repoRoot: string, baseRef: string, headRef: string): Promise<string[]>;
  getChangesetEntries(repoRoot: string, baseRef: string, headRef: string): Promise<string[]>;
  getDiff(
    repoRoot: string,
    baseRef: string,
    headRef: string,
    filePath: string
  ): Promise<string>;
  getCurrentBranch(repoRoot: string): Promise<string | undefined>;
}
