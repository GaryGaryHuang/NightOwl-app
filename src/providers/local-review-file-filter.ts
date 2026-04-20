import { readFile } from "node:fs/promises";

import { reviewIgnorePath } from "../core/nightowl-namespace.ts";
import {
  ReviewFileFilterError,
  type ReviewFileFilter
} from "./review-file-filter.ts";
import {
  wrapBoundaryErrorUnlessEnoent
} from "./boundary-error-helper.ts";
import { selectReviewableFiles } from "./reviewable-file-policy.ts";

/**
 * Local review file filter backed by canonical `.nightowl/reviewignore` rules.
 */
export class LocalReviewFileFilter implements ReviewFileFilter {
  async filterReviewableFiles(repoRoot: string, files: string[]): Promise<string[]> {
    const reviewIgnoreFilePath = reviewIgnorePath(repoRoot);
    const toBoundaryError = (cause: unknown) => new ReviewFileFilterError(
      "filterReviewableFiles",
      "Review file filter failed during filterReviewableFiles.",
      { cause }
    );

    return wrapBoundaryErrorUnlessEnoent(
      async () => {
        return selectReviewableFiles(
          files,
          await readFile(reviewIgnoreFilePath, "utf8")
        );
      },
      () => selectReviewableFiles(files),
      toBoundaryError
    );
  }
}
