import type {
  MCPRemoteServerConfig,
  MCPLocalServerConfig,
  MCPServerConfig
} from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import type {
  ReviewContext7OverrideConfig,
  ReviewLocalMcpServerConfig,
  ReviewMcpServerConfig,
  ReviewRemoteMcpServerConfig,
  ReviewMcpServers
} from "../providers/review-config-provider.ts";

const CONTEXT7_REMOTE_URL = "https://mcp.context7.com/mcp";

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

    const context7: MCPRemoteServerConfig = {
      type: "http",
      url: CONTEXT7_REMOTE_URL,
      tools: ["*"]
    };
    let context7Config = context7;

    if (this.#context7ApiKey) {
      context7Config = {
        ...context7Config,
        headers: {
          CONTEXT7_API_KEY: this.#context7ApiKey
        }
      };
    }

    const merged: Record<string, MCPServerConfig> = {
      context7: context7Config
    };

    for (const [name, config] of Object.entries(this.#userMcpServers)) {
      if (name === "context7") {
        if (!isContext7OverrideConfig(config)) {
          throw new Error("context7 override must use the built-in remote override shape");
        }

        context7Config = mergeContext7Config(context7Config, config);
        merged.context7 = context7Config;
      } else if (isRemoteConfig(config)) {
        const remoteConfig: MCPRemoteServerConfig = {
          type: config.type,
          url: config.url,
          tools: config.tools === undefined ? ["*"] : [...config.tools],
          ...(config.headers === undefined ? {} : { headers: { ...config.headers } }),
          ...(config.timeout === undefined ? {} : { timeout: config.timeout })
        };
        merged[name] = remoteConfig;
      } else {
        if (!isLocalConfig(config)) {
          throw new Error(`custom MCP '${name}' must use a local or remote MCP shape`);
        }

        if (!config.command) {
          throw new Error(`custom MCP '${name}' is missing command`);
        }

        const resolvedConfig: MCPLocalServerConfig = {
          type: "local",
          command: config.command,
          args: config.args === undefined ? [] : [...config.args],
          tools: config.tools === undefined ? ["*"] : [...config.tools],
          ...(config.env === undefined ? {} : { env: { ...config.env } }),
          ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
          ...(config.timeout === undefined ? {} : { timeout: config.timeout })
        };

        merged[name] = resolvedConfig;
      }
    }

    return merged;
  }
}

function isRemoteConfig(
  config: ReviewMcpServerConfig
): config is ReviewRemoteMcpServerConfig {
  return (config.type === "http" || config.type === "sse") && "url" in config;
}

function isLocalConfig(
  config: ReviewMcpServerConfig
): config is ReviewLocalMcpServerConfig {
  return config.type === "local";
}

function isContext7OverrideConfig(
  config: ReviewMcpServerConfig
): config is ReviewContext7OverrideConfig {
  return config.type === "http" && !("url" in config);
}

function mergeContext7Config(
  base: MCPRemoteServerConfig,
  override: ReviewContext7OverrideConfig
): MCPRemoteServerConfig {
  const tools =
    override.tools === undefined
      ? [...base.tools]
      : [...override.tools];

  return {
    type: "http",
    url: base.url,
    tools,
    ...(base.headers === undefined ? {} : { headers: { ...base.headers } }),
    ...(override.timeout === undefined
      ? base.timeout === undefined
        ? {}
        : { timeout: base.timeout }
      : { timeout: override.timeout })
  };
}
