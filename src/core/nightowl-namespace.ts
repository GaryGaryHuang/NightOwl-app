import path from "node:path";

/** Canonical NightOwl namespace directory name under repo root. */
export const NIGHTOWL_DIR = ".nightowl";

/** Absolute path to the NightOwl namespace root: `<repoRoot>/.nightowl` */
export function nightowlRoot(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR);
}

/** Absolute path to the review config: `<repoRoot>/.nightowl/reviewconfig.json` */
export function reviewConfigPath(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR, "reviewconfig.json");
}

/** Absolute path to the review ignore rules: `<repoRoot>/.nightowl/reviewignore` */
export function reviewIgnorePath(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR, "reviewignore");
}

/** Absolute path to the review output root: `<repoRoot>/.nightowl/review` */
export function reviewOutputRoot(repoRoot: string): string {
  return path.join(repoRoot, NIGHTOWL_DIR, "review");
}

/**
 * Returns true when the given file path (using any path separator) is the
 * NightOwl namespace directory itself or any path underneath it.
 */
export function isNightOwlNamespacePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/gu, "/");
  return normalized === NIGHTOWL_DIR || normalized.startsWith(`${NIGHTOWL_DIR}/`);
}

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
