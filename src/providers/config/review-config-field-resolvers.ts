import { type ConfidenceThresholds, DEFAULT_CONFIDENCE_THRESHOLDS } from "../../core/confidence-thresholds.ts";
import { DEFAULT_MAX_CONCURRENT_FILES } from "../../core/max-concurrent-files.ts";
import { isPlainObject, readOptionalField, readPositiveInteger } from "./review-config-parse-helpers.ts";

export function resolveConfidenceThresholdsFromConfigObject(
  config: Record<string, unknown>
): ConfidenceThresholds {
  const rawThresholds = config.confidenceThresholds;

  if (rawThresholds === undefined) {
    return { ...DEFAULT_CONFIDENCE_THRESHOLDS };
  }

  if (!isPlainObject(rawThresholds)) {
    throw new Error("'confidenceThresholds' must be a plain object");
  }

  const keys = Object.keys(rawThresholds);
  const unknownKey = keys.find((key) => key !== "must" && key !== "nice");

  if (unknownKey !== undefined) {
    throw new Error(`'confidenceThresholds' contains unknown key '${unknownKey}'`);
  }

  return {
    must:
      rawThresholds.must === undefined
        ? DEFAULT_CONFIDENCE_THRESHOLDS.must
        : resolveThresholdValue(rawThresholds.must, "must"),
    nice:
      rawThresholds.nice === undefined
        ? DEFAULT_CONFIDENCE_THRESHOLDS.nice
        : resolveThresholdValue(rawThresholds.nice, "nice")
  };
}

function resolveThresholdValue(value: unknown, field: "must" | "nice"): number {
  if (
    typeof value !== "number" ||
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
  return readOptionalField(
    config,
    "maxConcurrentFiles",
    readPositiveInteger,
    "'maxConcurrentFiles' must be a positive integer"
  ) ?? DEFAULT_MAX_CONCURRENT_FILES;
}
