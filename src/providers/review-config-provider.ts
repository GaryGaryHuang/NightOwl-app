import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";

export interface ReviewConfig {
  maxConcurrentFiles: number;
  confidenceThresholds: ConfidenceThresholds;
}

export interface ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): ReviewConfig;
}
