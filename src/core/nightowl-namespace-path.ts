import { NIGHTOWL_DIR } from "./nightowl-namespace.ts";

/**
 * Returns true when the given file path (using any path separator) is the
 * NightOwl namespace directory itself or any path underneath it.
 */
export function isNightOwlNamespacePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/gu, "/");
  return normalized === NIGHTOWL_DIR || normalized.startsWith(`${NIGHTOWL_DIR}/`);
}
