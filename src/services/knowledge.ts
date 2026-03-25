import type {
  MCPLocalServerConfig,
  MCPRemoteServerConfig,
  MCPServerConfig
} from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import type {
  ReviewLocalMcpServerConfig,
  ReviewMcpServerConfig,
  ReviewRemoteMcpServerConfig,
  ReviewMcpServers
} from "../providers/review-config-provider.ts";

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

    const context7: MCPLocalServerConfig = {
      type: "local",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      tools: ["*"]
    };
    let context7Config = context7;

    if (this.#context7ApiKey) {
      context7Config = {
        ...context7Config,
        env: {
          CONTEXT7_API_KEY: this.#context7ApiKey
        }
      };
    }

    const merged: Record<string, MCPServerConfig> = {
      context7: context7Config
    };

    for (const [name, config] of Object.entries(this.#userMcpServers)) {
      if (isRemoteConfig(config)) {
        const remoteConfig: MCPRemoteServerConfig = {
          type: config.type,
          url: config.url,
          tools: config.tools === undefined ? ["*"] : [...config.tools],
          ...(config.headers === undefined ? {} : { headers: { ...config.headers } }),
          ...(config.timeout === undefined ? {} : { timeout: config.timeout })
        };
        merged[name] = remoteConfig;
      } else if (name === "context7") {
        context7Config = mergeContext7Config(context7Config, config);
        merged.context7 = context7Config;
      } else {
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
  return config.type === "http" || config.type === "sse";
}

function mergeContext7Config(
  base: MCPLocalServerConfig,
  override: ReviewLocalMcpServerConfig
): MCPLocalServerConfig {
  const env =
    override.env === undefined
      ? base.env === undefined
        ? undefined
        : { ...base.env }
      : {
          ...(base.env ?? {}),
          ...override.env
        };
  const tools =
    override.tools === undefined
      ? [...base.tools]
      : [...override.tools];

  return {
    type: "local",
    command: override.command ?? base.command,
    args: override.args === undefined ? [...base.args] : [...override.args],
    tools,
    ...(env === undefined ? {} : { env }),
    ...(override.cwd === undefined
      ? base.cwd === undefined
        ? {}
        : { cwd: base.cwd }
      : { cwd: override.cwd }),
    ...(override.timeout === undefined
      ? base.timeout === undefined
        ? {}
        : { timeout: base.timeout }
      : { timeout: override.timeout })
  };
}
