import type { MCPServerConfig } from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import type { ReviewMcpServers } from "../providers/review-config-provider.ts";

export interface KnowledgeSvcOptions {
  context7ApiKey?: string;
  userMcpServers?: ReviewMcpServers;
}

export class KnowledgeSvc {
  readonly #context7ApiKey?: string;
  readonly #userMcpServers: ReviewMcpServers;

  constructor(options: KnowledgeSvcOptions = {}) {
    this.#context7ApiKey = options.context7ApiKey;
    this.#userMcpServers = options.userMcpServers ?? {};
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

    const merged: Record<string, MCPServerConfig> = {
      context7
    };

    for (const [name, config] of Object.entries(this.#userMcpServers)) {
      if (name === "context7") {
        merged.context7 = mergeContext7Config(merged.context7, config);
        continue;
      }

      if (!config.command) {
        throw new Error(`custom MCP '${name}' is missing command`);
      }

      merged[name] = {
        type: "local",
        command: config.command,
        ...(config.args === undefined ? {} : { args: [...config.args] }),
        ...(config.env === undefined ? {} : { env: { ...config.env } }),
        ...(config.tools === undefined ? {} : { tools: [...config.tools] })
      };
    }

    return merged;
  }
}

function mergeContext7Config(
  base: MCPServerConfig,
  override: ReviewMcpServers[string]
): MCPServerConfig {
  return {
    ...base,
    type: "local",
    ...(override.command === undefined ? {} : { command: override.command }),
    ...(override.args === undefined ? {} : { args: [...override.args] }),
    ...(override.tools === undefined ? {} : { tools: [...override.tools] }),
    ...(override.env === undefined
      ? {}
      : {
          env: {
            ...(base.env ?? {}),
            ...override.env
          }
        })
  };
}
