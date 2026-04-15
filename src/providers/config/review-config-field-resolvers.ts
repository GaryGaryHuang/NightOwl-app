import { type ConfidenceThresholds, DEFAULT_CONFIDENCE_THRESHOLDS } from "../../core/confidence-thresholds.ts";
import { DEFAULT_MAX_CONCURRENT_FILES } from "../../core/max-concurrent-files.ts";

export function resolveConfidenceThresholdsFromConfigObject(
  config: Record<string, unknown>
): ConfidenceThresholds {
  const rawThresholds = config.confidenceThresholds;

  if (rawThresholds === undefined) {
    return { ...DEFAULT_CONFIDENCE_THRESHOLDS };
  }

  if (!rawThresholds || typeof rawThresholds !== "object" || Array.isArray(rawThresholds)) {
    throw new Error("'confidenceThresholds' must be a plain object");
  }

  const thresholds = rawThresholds as Record<string, unknown>;
  const keys = Object.keys(thresholds);
  const unknownKey = keys.find((key) => key !== "must" && key !== "nice");

  if (unknownKey !== undefined) {
    throw new Error(`'confidenceThresholds' contains unknown key '${unknownKey}'`);
  }

  return {
    must:
      thresholds.must === undefined
        ? DEFAULT_CONFIDENCE_THRESHOLDS.must
        : resolveThresholdValue(thresholds.must, "must"),
    nice:
      thresholds.nice === undefined
        ? DEFAULT_CONFIDENCE_THRESHOLDS.nice
        : resolveThresholdValue(thresholds.nice, "nice")
  };
}

function resolveThresholdValue(value: unknown, field: "must" | "nice"): number {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new Error(`'confidenceThresholds.${field}' must be a number between 0 and 100`);
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
    throw new Error("'maxConcurrentFiles' must be a positive integer");
  }

  return rawValue;
}
