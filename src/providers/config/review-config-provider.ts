import type { ReviewMcpServers } from "../../core/review-mcp-server-config.ts";

type ReviewConfigProviderOperation = "loadReviewConfig";

export type ReviewConfigModelProvider =
  | {
      kind: "copilot";
      model?: string;
    }
  | {
      kind: "byok";
      type: "openai" | "azure" | "anthropic";
      baseUrl: string;
      model: string;
      apiKeyEnv?: string;
      bearerTokenEnv?: string;
      wireApi?: "completions" | "responses";
      azure?: {
        apiVersion?: string;
      };
    };

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
  mcpServers: ReviewMcpServers;
  modelProvider?: ReviewConfigModelProvider;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
}

export interface ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): Promise<ReviewConfig>;
}
