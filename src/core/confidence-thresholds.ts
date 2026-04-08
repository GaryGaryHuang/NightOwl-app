export interface ConfidenceThresholds {
  must: number;
  nice: number;
}

// Baseline thresholds: must findings require 80%+ confidence; nice findings require 90%+ to reduce noise.
// Overridable per-repo via .nightowl/reviewconfig.json confidenceThresholds.
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = Object.freeze({
  must: 80,
  nice: 90
});
