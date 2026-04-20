import path from "node:path";

import { nightowlRoot, reviewOutputRoot } from "./nightowl-namespace.ts";
export { isNightOwlNamespacePath } from "./nightowl-namespace-path.ts";

/**
 * Returns true when the given path is within the allowed read boundary for a
 * review session: either (1) inside the repo source tree but not under
 * `.nightowl/`, or (2) inside `repo_root/.nightowl/review/`.
 *
 * Both arguments are resolved to absolute paths before comparison.
 */
export function isAllowedReviewReadPath(
  requestedPath: string,
  repoRoot: string
): boolean {
  const resolvedPath = path.resolve(requestedPath);
  const resolvedRoot = path.resolve(repoRoot);
  const nightowlRootPath = nightowlRoot(resolvedRoot);
  const reviewRoot = reviewOutputRoot(resolvedRoot);

  const isWithinRepoSourceTree =
    resolvedPath === resolvedRoot ||
    (resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) &&
      resolvedPath !== nightowlRootPath &&
      !resolvedPath.startsWith(`${nightowlRootPath}${path.sep}`));

  return (
    isWithinRepoSourceTree ||
    resolvedPath === reviewRoot ||
    resolvedPath.startsWith(`${reviewRoot}${path.sep}`)
  );
}
