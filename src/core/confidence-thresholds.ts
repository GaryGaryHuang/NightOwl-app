export interface ConfidenceThresholds {
  must: number;
  nice: number;
}

// Legacy compatibility thresholds accepted via .nightowl/reviewconfig.json.
// They remain part of the parsed config surface but do not affect canonical acceptance filtering.
export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = Object.freeze({
  must: 80,
  nice: 90
});
