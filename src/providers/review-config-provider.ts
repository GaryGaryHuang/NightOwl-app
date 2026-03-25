import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";

export interface ReviewLocalMcpServerConfig {
  type: "local";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
  cwd?: string;
  timeout?: number;
}

export interface ReviewRemoteMcpServerConfig {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  tools?: string[];
  timeout?: number;
}

export type ReviewMcpServerConfig =
  | ReviewLocalMcpServerConfig
  | ReviewRemoteMcpServerConfig;

export type ReviewMcpServers = Record<string, ReviewMcpServerConfig>;

export interface ReviewConfig {
  maxConcurrentFiles: number;
  confidenceThresholds: ConfidenceThresholds;
  mcpServers: ReviewMcpServers;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
}

export interface ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): ReviewConfig;
}
