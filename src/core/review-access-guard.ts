import { realpathSync } from "node:fs";
import path from "node:path";

import { nightowlRoot, reviewOutputRoot as buildReviewOutputRoot } from "./nightowl-namespace.ts";

export interface ReviewReadBoundary {
  repoRoot: string;
  reviewOutputRoot?: string;
}

/**
 * Returns true when the given path is within the allowed read boundary for a
 * review session: either (1) inside the repo source tree but not under
 * `.nightowl/`, or (2) inside `repo_root/.nightowl/review/`.
 *
 * Both arguments must be absolute paths. Throws if either is relative, to
 * prevent silent mis-resolution against `process.cwd()`.
 */
export function isAllowedReviewReadPath(
  requestedPath: string,
  boundary: string | ReviewReadBoundary
): boolean {
  const sourceRoot =
    typeof boundary === "string" ? boundary : boundary.repoRoot;
  const outputRoot =
    typeof boundary === "string"
      ? buildReviewOutputRoot(sourceRoot)
      : boundary.reviewOutputRoot ?? buildReviewOutputRoot(sourceRoot);

  if (
    !path.isAbsolute(requestedPath) ||
    !path.isAbsolute(sourceRoot) ||
    !path.isAbsolute(outputRoot)
  ) {
    throw new Error(
      "isAllowedReviewReadPath requires absolute paths. " +
        `Received requestedPath=${JSON.stringify(requestedPath)}, ` +
        `repoRoot=${JSON.stringify(sourceRoot)}, ` +
        `reviewOutputRoot=${JSON.stringify(outputRoot)}`
    );
  }

  const resolvedPath = path.resolve(requestedPath);
  const resolvedRoot = path.resolve(sourceRoot);
  const nightowlRootPath = path.resolve(nightowlRoot(resolvedRoot));
  const reviewRoot = path.resolve(outputRoot);

  const isWithinLexicalRepo = isPathInsideOrEqual(resolvedPath, resolvedRoot);
  const isWithinLexicalReview = isPathInsideOrEqual(resolvedPath, reviewRoot);

  if (!isWithinLexicalRepo && !isWithinLexicalReview) {
    return false;
  }

  const canonicalRoot = canonicalizeBoundaryPath(resolvedRoot);
  const canonicalNightowlRoot = canonicalizeBoundaryPath(nightowlRootPath);
  const canonicalReviewRoot = canonicalizeBoundaryPath(reviewRoot);
  const canonicalRequested = canonicalizeBoundaryPath(resolvedPath);
  const canonicalOutputRepoRoot = canonicalizeBoundaryPath(
    path.dirname(path.dirname(reviewRoot))
  );
  const canonicalOutputNightowlRoot = canonicalizeBoundaryPath(
    path.dirname(reviewRoot)
  );

  const hasValidCanonicalReviewBoundary =
    typeof boundary === "string"
      ? isPathInsideOrEqual(canonicalReviewRoot, canonicalRoot) &&
        isPathInsideOrEqual(canonicalReviewRoot, canonicalNightowlRoot)
      : isPathInsideOrEqual(canonicalReviewRoot, canonicalOutputRepoRoot) &&
        isPathInsideOrEqual(canonicalReviewRoot, canonicalOutputNightowlRoot);

  if (
    hasValidCanonicalReviewBoundary &&
    isPathInsideOrEqual(canonicalRequested, canonicalReviewRoot)
  ) {
    return true;
  }

  return (
    isPathInsideOrEqual(canonicalRequested, canonicalRoot) &&
    !isPathInsideOrEqual(canonicalRequested, canonicalNightowlRoot)
  );
}

function isPathInsideOrEqual(candidate: string, boundary: string): boolean {
  return (
    candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`)
  );
}

function canonicalizeBoundaryPath(absolutePath: string): string {
  let current = absolutePath;
  const missingSuffixSegments: string[] = [];

  while (true) {
    try {
      const canonical = realpathSync.native(current);

      return missingSuffixSegments.length === 0
        ? canonical
        : path.join(canonical, ...missingSuffixSegments.reverse());
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;

      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }

      const parent = path.dirname(current);

      if (parent === current) {
        throw error;
      }

      missingSuffixSegments.push(path.basename(current));
      current = parent;
    }
  }
}
