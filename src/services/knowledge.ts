import type {
  MCPHTTPServerConfig,
  MCPServerConfig,
  MCPStdioServerConfig
} from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import type {
  ReviewContext7OverrideConfig,
  ReviewLocalMcpServerConfig,
  ReviewMcpServerConfig,
  ReviewRemoteMcpServerConfig,
  ReviewMcpServers
} from "../core/review-mcp-server-config.ts";

const CONTEXT7_REMOTE_URL = "https://mcp.context7.com/mcp";

export class KnowledgeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeConfigError";
  }
}

export interface KnowledgeSvcOptions {
  context7ApiKey?: string;
  userMcpServers?: ReviewMcpServers;
}

/**
 * Build the MCP server map for review sessions from the fixed Context7 base plus repo-local overrides.
 *
 * User MCP server shapes are validated eagerly at construction time so that
 * configuration errors surface before the first review session is created.
 */
export class KnowledgeSvc {
  readonly #context7ApiKey?: string;
  readonly #userMcpServers: ReviewMcpServers;

  constructor(options: KnowledgeSvcOptions = {}) {
    this.#context7ApiKey = options.context7ApiKey;
    this.#userMcpServers = options.userMcpServers ?? {};
    this.#validateUserMcpServers();
  }

  getMcpServers(
    knowledgeMode: ReviewKnowledgeMode
  ): Record<string, MCPServerConfig> {
    if (knowledgeMode !== "built-in-context7") {
      return {};
    }

    const context7: MCPHTTPServerConfig = {
      type: "http",
      url: CONTEXT7_REMOTE_URL,
      tools: ["*"]
    };
    let context7Config = context7;

    if (this.#context7ApiKey) {
      // API key is injected exclusively via the KnowledgeSvc constructor.
      // Repo-local context7 override config cannot supply or override the API key header.
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
        // Validated in constructor: context7 entry is always a Context7OverrideConfig.
        context7Config = mergeContext7Config(
          context7Config,
          config as ReviewContext7OverrideConfig
        );
        merged.context7 = context7Config;
      } else if (isRemoteConfig(config)) {
        // Clone remote entries so session setup cannot mutate the parsed repo config object.
        const remoteConfig: MCPHTTPServerConfig = {
          type: config.type,
          url: config.url,
          tools: config.tools === undefined ? ["*"] : [...config.tools],
          ...(config.headers === undefined ? {} : { headers: { ...config.headers } }),
          ...(config.timeout === undefined ? {} : { timeout: config.timeout })
        };
        merged[name] = remoteConfig;
      } else {
        // Validated in constructor: non-context7, non-remote entry is always local.
        const localConfig = config as ReviewLocalMcpServerConfig;
        const resolvedConfig: MCPStdioServerConfig = {
          type: localConfig.type,
          command: localConfig.command,
          args: localConfig.args === undefined ? [] : [...localConfig.args],
          tools: localConfig.tools === undefined ? ["*"] : [...localConfig.tools],
          ...(localConfig.env === undefined ? {} : { env: { ...localConfig.env } }),
          ...(localConfig.cwd === undefined ? {} : { cwd: localConfig.cwd }),
          ...(localConfig.timeout === undefined ? {} : { timeout: localConfig.timeout })
        };

        merged[name] = resolvedConfig;
      }
    }

    return merged;
  }

  #validateUserMcpServers(): void {
    for (const [name, config] of Object.entries(this.#userMcpServers)) {
      if (name === "context7") {
        if (!isContext7OverrideConfig(config)) {
          throw new KnowledgeConfigError(
            "context7 override must use the built-in remote override shape"
          );
        }
      } else if (!isRemoteConfig(config) && !isLocalConfig(config)) {
        throw new KnowledgeConfigError(
          `custom MCP '${name}' must use a local or remote MCP shape`
        );
      }
    }
  }
}

function isRemoteConfig(
  config: ReviewMcpServerConfig
): config is ReviewRemoteMcpServerConfig {
  return config.type === "http" || config.type === "sse";
}

function isLocalConfig(
  config: ReviewMcpServerConfig
): config is ReviewLocalMcpServerConfig {
  return config.type === "local" || config.type === "stdio";
}

function isContext7OverrideConfig(
  config: ReviewMcpServerConfig
): config is ReviewContext7OverrideConfig {
  return config.type === "context7";
}

function mergeContext7Config(
  base: MCPHTTPServerConfig,
  override: ReviewContext7OverrideConfig
): MCPHTTPServerConfig {
  // tools replacement: repo-local override fully replaces the built-in wildcard default,
  // rather than appending to it. If override.tools is absent, the built-in default is kept.
  const tools =
    override.tools === undefined
      ? [...base.tools]
      : [...override.tools];

  return {
    type: "http",
    // url is always taken from the built-in base; repo-local context7 override cannot change it.
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
