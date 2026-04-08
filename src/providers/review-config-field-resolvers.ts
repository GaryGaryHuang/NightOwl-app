import { type ConfidenceThresholds, DEFAULT_CONFIDENCE_THRESHOLDS } from "../core/confidence-thresholds.ts";
import { DEFAULT_MAX_CONCURRENT_FILES } from "../core/max-concurrent-files.ts";

export function resolveConfidenceThresholdsFromConfigObject(
  config: Record<string, unknown>
): ConfidenceThresholds {
  const rawThresholds = config.confidenceThresholds;

  if (rawThresholds === undefined) {
    return { ...DEFAULT_CONFIDENCE_THRESHOLDS };
  }

  if (!rawThresholds || typeof rawThresholds !== "object" || Array.isArray(rawThresholds)) {
    throw new Error("invalid review config");
  }

  const thresholds = rawThresholds as Record<string, unknown>;
  const keys = Object.keys(thresholds);

  if (keys.some((key) => key !== "must" && key !== "nice")) {
    throw new Error("invalid review config");
  }

  return {
    must:
      thresholds.must === undefined
        ? DEFAULT_CONFIDENCE_THRESHOLDS.must
        : validateThreshold(thresholds.must),
    nice:
      thresholds.nice === undefined
        ? DEFAULT_CONFIDENCE_THRESHOLDS.nice
        : validateThreshold(thresholds.nice)
  };
}

function validateThreshold(value: unknown): number {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error("invalid review config");
  }

  return value;
}

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
