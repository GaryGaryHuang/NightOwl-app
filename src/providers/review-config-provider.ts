import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";

export interface ReviewConfigProvider {
  loadConfidenceThresholds(repoRoot: string): ConfidenceThresholds;
}
