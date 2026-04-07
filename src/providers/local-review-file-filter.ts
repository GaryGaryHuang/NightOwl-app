import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import ignore from "ignore";

import {
  ReviewFileFilterError,
  type ReviewFileFilter
} from "./review-file-filter.ts";

/**
 * Local review file filter backed by canonical `.nightowl/reviewignore` rules.
 */
export class LocalReviewFileFilter implements ReviewFileFilter {
  filterReviewableFiles(repoRoot: string, files: string[]): string[] {
    const reviewIgnorePath = path.join(repoRoot, ".nightowl", "reviewignore");
    const sourceFiles = files.filter((filePath) => !isNightOwlNamespacePath(filePath));

    if (!existsSync(reviewIgnorePath)) {
      return [...sourceFiles];
    }

    try {
      const matcher = ignore().add(readFileSync(reviewIgnorePath, "utf8"));

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

function isNightOwlNamespacePath(filePath: string): boolean {
  const normalizedPath = normalizeFilePath(filePath);

  return normalizedPath === ".nightowl" || normalizedPath.startsWith(".nightowl/");
}
