export const DEFAULT_MAX_CONCURRENT_FILES = 5;

export function resolveMaxConcurrentFilesFromConfigObject(
  config: Record<string, unknown>
): number {
  const rawValue = config.maxConcurrentFiles;

  if (rawValue === undefined) {
    return DEFAULT_MAX_CONCURRENT_FILES;
  }

  if (
    typeof rawValue !== "number" ||
    Number.isNaN(rawValue) ||
    !Number.isFinite(rawValue) ||
    !Number.isInteger(rawValue) ||
    rawValue <= 0
  ) {
    throw new Error("invalid review config");
  }

  return rawValue;
}
