import { stat, readFile } from "node:fs/promises";

import ignore from "ignore";

import {
  isNightOwlNamespacePath,
  reviewIgnorePath
} from "../core/nightowl-namespace.ts";
import {
  ReviewFileFilterError,
  type ReviewFileFilter
} from "./review-file-filter.ts";
import { wrapBoundaryError } from "./boundary-error-helper.ts";

/**
 * Local review file filter backed by canonical `.nightowl/reviewignore` rules.
 */
export class LocalReviewFileFilter implements ReviewFileFilter {
  async filterReviewableFiles(repoRoot: string, files: string[]): Promise<string[]> {
    const reviewIgnoreFilePath = reviewIgnorePath(repoRoot);
    const sourceFiles = files.filter((filePath) => !isNightOwlNamespacePath(filePath));

    try {
      await stat(reviewIgnoreFilePath);
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return [...sourceFiles];
      }
      throw error;
    }

    return wrapBoundaryError(
      async () => {
        const matcher = ignore().add(await readFile(reviewIgnoreFilePath, "utf8"));

        // `reviewignore` follows gitignore-style matching, so normalize separators before evaluation.
        return sourceFiles.filter((filePath) => !matcher.ignores(normalizeFilePath(filePath)));
      },
      (cause) => new ReviewFileFilterError(
        "filterReviewableFiles",
        "Review file filter failed during filterReviewableFiles.",
        { cause }
      )
    );
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
