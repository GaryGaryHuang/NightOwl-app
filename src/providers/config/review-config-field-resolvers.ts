import { DEFAULT_MAX_CONCURRENT_FILES } from "../../core/max-concurrent-files.ts";
import { readOptionalField, readPositiveInteger } from "./review-config-parse-helpers.ts";

export function resolveMaxConcurrentFilesFromConfigObject(
  config: Record<string, unknown>
): number {
  return readOptionalField(
    config,
    "maxConcurrentFiles",
    readPositiveInteger,
    "'maxConcurrentFiles' must be a positive integer"
  ) ?? DEFAULT_MAX_CONCURRENT_FILES;
}
