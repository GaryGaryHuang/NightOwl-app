import ignore from "ignore";

import { isNightOwlNamespacePath } from "../core/nightowl-namespace-path.ts";

/**
 * Applies reviewable-file policy to repo-relative file paths.
 *
 * Files under `.nightowl/` are never reviewable. When canonical
 * `.nightowl/reviewignore` rules are provided, remaining files are filtered
 * using gitignore-style matching with normalized separators.
 */
export function selectReviewableFiles(
  files: readonly string[],
  reviewIgnoreRules?: string
): string[] {
  const sourceFiles = files.filter((filePath) => !isNightOwlNamespacePath(filePath));

  if (reviewIgnoreRules === undefined) {
    return [...sourceFiles];
  }

  const matcher = ignore().add(reviewIgnoreRules);

  return sourceFiles.filter(
    (filePath) => !matcher.ignores(normalizeFilePath(filePath))
  );
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/gu, "/");
}
