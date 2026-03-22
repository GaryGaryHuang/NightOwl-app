import type { MCPServerConfig } from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";

export interface KnowledgeSvcOptions {
  context7ApiKey?: string;
}

export class KnowledgeSvc {
  readonly #context7ApiKey?: string;

  constructor(options: KnowledgeSvcOptions = {}) {
    this.#context7ApiKey = options.context7ApiKey;
  }

  getMcpServers(
    knowledgeMode: ReviewKnowledgeMode
  ): Record<string, MCPServerConfig> | undefined {
    if (knowledgeMode !== "built-in-context7") {
      return undefined;
    }

    const context7: MCPServerConfig = {
      type: "local",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      tools: ["*"]
    };

    if (this.#context7ApiKey) {
      context7.env = {
        CONTEXT7_API_KEY: this.#context7ApiKey
      };
    }

    return { context7 };
  }
}
