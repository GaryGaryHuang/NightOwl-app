import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";
import type { ReviewMcpServers } from "../core/review-mcp-server-config.ts";

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

export interface ReviewConfig {
  maxConcurrentFiles: number;
  confidenceThresholds: ConfidenceThresholds;
  mcpServers: ReviewMcpServers;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
}

export interface ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): Promise<ReviewConfig>;
}
