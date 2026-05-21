import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

import { reviewOutputRoot as buildReviewOutputRoot } from "./nightowl-namespace.ts";

export interface ReviewReadBoundary {
  repoRoot: string;
  reviewOutputRoot?: string;
}

/**
 * Returns true when the given path is within the allowed read boundary for a
 * review session: inside the active repo source tree, including `.nightowl/`
 * non-review paths, but never under `.nightowl/review/`.
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
  if (
    !path.isAbsolute(requestedPath) ||
    !path.isAbsolute(sourceRoot)
  ) {
    throw new Error(
      "isAllowedReviewReadPath requires absolute paths. " +
        `Received requestedPath=${JSON.stringify(requestedPath)}, ` +
        `repoRoot=${JSON.stringify(sourceRoot)}`
    );
  }

  const resolvedPath = path.resolve(requestedPath);
  const resolvedRoot = path.resolve(sourceRoot);
  const sourceReviewRoot = path.resolve(buildReviewOutputRoot(resolvedRoot));

  const canonicalRoot = canonicalizeReviewBoundaryPath(resolvedRoot);
  const canonicalSourceReviewRoot = canonicalizeReviewBoundaryPath(sourceReviewRoot);
  const canonicalRequested = canonicalizeReviewBoundaryPath(requestedPath);

  if (!isPathInsideOrEqual(canonicalRequested, canonicalRoot)) {
    return false;
  }

  if (isPathInsideOrEqual(resolvedPath, sourceReviewRoot)) {
    return false;
  }

  return !isPathInsideOrEqual(canonicalRequested, canonicalSourceReviewRoot);
}

function isPathInsideOrEqual(candidate: string, boundary: string): boolean {
  return (
    candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`)
  );
}

export function canonicalizeReviewBoundaryPath(
  absolutePath: string,
  symlinkDepth = 0
): string {
  if (symlinkDepth > 40) {
    throw new Error(`Too many symbolic links while resolving ${absolutePath}`);
  }

  const parsedPath = path.parse(absolutePath);
  let current = realpathSync.native(parsedPath.root);
  const relativeSegments = absolutePath
    .slice(parsedPath.root.length)
    .split(path.sep)
    .filter((segment) => segment.length > 0);

  for (const segment of relativeSegments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      current = path.dirname(current);
      continue;
    }

    const candidate = path.join(current, segment);

    try {
      const stat = lstatSync(candidate);

      if (stat.isSymbolicLink()) {
        const linkTarget = readlinkSync(candidate);
        const absoluteTarget = path.isAbsolute(linkTarget)
          ? linkTarget
          : path.resolve(current, linkTarget);

        current = canonicalizeReviewBoundaryPath(
          absoluteTarget,
          symlinkDepth + 1
        );
        continue;
      }

      current = candidate;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;

      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }

      current = candidate;
    }
  }

  return current;
}
