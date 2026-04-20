import path from "node:path";

import { NIGHTOWL_DIR } from "./nightowl-namespace.ts";

/**
 * Returns true when the given repo-relative file path (using any path
 * separator) is the NightOwl namespace directory itself or any path
 * underneath it.
 *
 * Throws if given an absolute path. Callers that work with absolute paths
 * should use the absolute-path namespace helpers instead of this repo-relative
 * classifier.
 */
export function isNightOwlNamespacePath(filePath: string): boolean {
  if (isAbsolutePathLike(filePath)) {
    throw new Error(
      `isNightOwlNamespacePath requires a repo-relative path. Received ${JSON.stringify(filePath)}`
    );
  }

  const normalized = filePath.replace(/\\/gu, "/");
  return normalized === NIGHTOWL_DIR || normalized.startsWith(`${NIGHTOWL_DIR}/`);
}

function isAbsolutePathLike(filePath: string): boolean {
  const normalized = filePath.replace(/\\/gu, "/");

  return (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(filePath) ||
    path.win32.isAbsolute(normalized)
  );
}
