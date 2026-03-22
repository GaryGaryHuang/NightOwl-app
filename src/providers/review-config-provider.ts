import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";

export interface ReviewMcpServerConfig {
  type: "local";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
}

export type ReviewMcpServers = Record<string, ReviewMcpServerConfig>;

export interface ReviewConfig {
  maxConcurrentFiles: number;
  confidenceThresholds: ConfidenceThresholds;
  mcpServers: ReviewMcpServers;
}

export interface ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): ReviewConfig;
}
