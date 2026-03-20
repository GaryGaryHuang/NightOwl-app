export interface ConfidenceThresholds {
  must: number;
  nice: number;
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = Object.freeze({
  must: 80,
  nice: 90
});

export function parseConfidenceThresholdsConfig(
  configText: string
): ConfidenceThresholds {
  let parsed: unknown;

  try {
    parsed = JSON.parse(configText);
  } catch {
    throw new Error("invalid review config");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid review config");
  }

  return resolveConfidenceThresholdsFromConfigObject(
    parsed as Record<string, unknown>
  );
}

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
