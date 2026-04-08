import { existsSync, readFileSync } from "node:fs";

import ignore from "ignore";

import {
  isNightOwlNamespacePath,
  reviewIgnorePath
} from "../core/nightowl-namespace.ts";
import {
  ReviewFileFilterError,
  type ReviewFileFilter
} from "./review-file-filter.ts";

/**
 * Local review file filter backed by canonical `.nightowl/reviewignore` rules.
 */
export class LocalReviewFileFilter implements ReviewFileFilter {
  filterReviewableFiles(repoRoot: string, files: string[]): string[] {
    const reviewIgnoreFilePath = reviewIgnorePath(repoRoot);
    const sourceFiles = files.filter((filePath) => !isNightOwlNamespacePath(filePath));

    if (!existsSync(reviewIgnoreFilePath)) {
      return [...sourceFiles];
    }

    try {
      const matcher = ignore().add(readFileSync(reviewIgnoreFilePath, "utf8"));

      // `reviewignore` follows gitignore-style matching, so normalize separators before evaluation.
      return sourceFiles.filter((filePath) => !matcher.ignores(normalizeFilePath(filePath)));
    } catch (error) {
      throw new ReviewFileFilterError(
        "filterReviewableFiles",
        "Review file filter failed during filterReviewableFiles.",
        { cause: error }
      );
    }
  }
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}
