import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";

export type ReviewConfigProviderOperation = "loadReviewConfig";

export class ReviewConfigProviderError extends Error {
  readonly operation: ReviewConfigProviderOperation;
  readonly configPath?: string;

  constructor(
    operation: ReviewConfigProviderOperation,
    message: string,
    options?: { cause?: unknown; configPath?: string }
  ) {
    super(message, options);
    this.name = "ReviewConfigProviderError";
    this.operation = operation;
    this.configPath = options?.configPath;
  }
}

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
