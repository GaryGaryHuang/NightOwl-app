export type ReviewSourceProviderOperation =
  | "resolveRepoRoot"
  | "getChangedFiles"
  | "getChangesetEntries"
  | "getDiff"
  | "getCurrentBranch";

export type ReviewChangesetStatus = "A" | "M" | "D" | "R" | "C";

/**
 * Stable changeset entry contract exposed to the core review pipeline.
 *
 * - `path` is always the head-side path for rename/copy entries.
 * - `previousPath` is populated only for rename/copy entries.
 * - `similarityScore` preserves Git's optional numeric suffix for rename/copy
 *   detection (for example `R100` / `C75`) when available.
 */
export interface ReviewChangesetEntry {
  readonly status: ReviewChangesetStatus;
  readonly path: string;
  readonly previousPath?: string;
  readonly similarityScore?: number;
}

export function formatReviewChangesetEntry(entry: ReviewChangesetEntry): string {
  const statusToken =
    entry.similarityScore === undefined
      ? entry.status
      : `${entry.status}${entry.similarityScore}`;

  if (entry.previousPath !== undefined) {
    return `${statusToken}\t${entry.previousPath}\t${entry.path}`;
  }

  return `${statusToken}\t${entry.path}`;
}

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
  getChangesetEntries(
    repoRoot: string,
    baseRef: string,
    headRef: string
  ): Promise<ReviewChangesetEntry[]>;
  getDiff(
    repoRoot: string,
    baseRef: string,
    headRef: string,
    filePath: string
  ): Promise<string>;
  getCurrentBranch(repoRoot: string): Promise<string | undefined>;
}
