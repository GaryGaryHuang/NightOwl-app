import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";

export interface ReviewLocalMcpServerConfig {
  type: "local" | "stdio";
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

export interface ReviewContext7OverrideConfig {
  type: "http";
  tools?: string[];
  timeout?: number;
}

export type ReviewMcpServerConfig =
  | ReviewLocalMcpServerConfig
  | ReviewRemoteMcpServerConfig
  | ReviewContext7OverrideConfig;

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
