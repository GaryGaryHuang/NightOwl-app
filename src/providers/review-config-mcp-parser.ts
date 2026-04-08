import type {
  ReviewMcpServerConfig,
  ReviewMcpServers
} from "./review-config-provider.ts";
import {
  isPlainObject,
  readNonBlankString,
  readNonEmptyString,
  readPositiveInteger,
  readStringArray,
  readStringRecord
} from "./review-config-parse-helpers.ts";

const CONTEXT7_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "type",
  "tools",
  "timeout"
]);

export function resolveMcpServersFromConfigObject(
  config: Record<string, unknown>
): ReviewMcpServers {
  const rawMcpServers = config.mcpServers;

  if (rawMcpServers === undefined) {
    return {};
  }

  if (!isPlainObject(rawMcpServers)) {
    throw new Error("mcpServers must be a plain object");
  }

  const resolved: ReviewMcpServers = {};

  for (const [name, rawDefinition] of Object.entries(rawMcpServers)) {
    try {
      if (!isPlainObject(rawDefinition)) {
        throw new Error("entry definition must be a plain object");
      }

      if (name === "context7") {
        resolved[name] = resolveContext7OverrideEntry(rawDefinition);
        continue;
      }

      const rawType = rawDefinition.type;
      const resolvedType = rawType === undefined ? "local" : rawType;

      if (
        resolvedType !== "local" &&
        resolvedType !== "stdio" &&
        resolvedType !== "http" &&
        resolvedType !== "sse"
      ) {
        throw new Error(`'${resolvedType}' is not a valid MCP type`);
      }

      if (resolvedType === "http" || resolvedType === "sse") {
        resolved[name] = resolveRemoteMcpEntry(rawDefinition, resolvedType);
      } else {
        resolved[name] = resolveLocalMcpEntry(rawDefinition, resolvedType);
      }
    } catch (error) {
      throw new Error(
        `mcpServers.${name}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      );
    }
  }

  return resolved;
}

function resolveContext7OverrideEntry(
  rawDefinition: Record<string, unknown>
): ReviewMcpServerConfig {
  const rawType = rawDefinition.type;

  if (rawType !== undefined && rawType !== "http") {
    throw new Error("'type' must be \"http\" if provided");
  }

  for (const key of Object.keys(rawDefinition)) {
    if (!CONTEXT7_ALLOWED_KEYS.has(key)) {
      throw new Error(`'${key}' is not a supported field`);
    }
  }

  let tools: string[] | undefined;
  if (rawDefinition.tools !== undefined) {
    try {
      tools = readStringArray(rawDefinition.tools);
    } catch {
      throw new Error("'tools' must be an array of strings");
    }
  }

  let timeout: number | undefined;
  if (rawDefinition.timeout !== undefined) {
    try {
      timeout = readPositiveInteger(rawDefinition.timeout);
    } catch {
      throw new Error("'timeout' must be a positive integer");
    }
  }

  return {
    type: "http",
    ...(tools === undefined ? {} : { tools }),
    ...(timeout === undefined ? {} : { timeout })
  };
}

function resolveRemoteMcpEntry(
  rawDefinition: Record<string, unknown>,
  type: "http" | "sse"
): ReviewMcpServerConfig {
  let url: string;
  try {
    url = readNonEmptyString(rawDefinition.url);
  } catch {
    throw new Error("'url' must be a non-empty string");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("'url' is not a valid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("'url' must use http or https protocol");
  }

  let headers: Record<string, string> | undefined;
  if (rawDefinition.headers !== undefined) {
    try {
      headers = readStringRecord(rawDefinition.headers);
    } catch {
      throw new Error("'headers' must be a string record");
    }
  }

  let tools: string[] | undefined;
  if (rawDefinition.tools !== undefined) {
    try {
      tools = readStringArray(rawDefinition.tools);
    } catch {
      throw new Error("'tools' must be an array of strings");
    }
  }

  let timeout: number | undefined;
  if (rawDefinition.timeout !== undefined) {
    try {
      timeout = readPositiveInteger(rawDefinition.timeout);
    } catch {
      throw new Error("'timeout' must be a positive integer");
    }
  }

  return {
    type,
    url,
    ...(headers === undefined ? {} : { headers }),
    ...(tools === undefined ? {} : { tools }),
    ...(timeout === undefined ? {} : { timeout })
  };
}

function resolveLocalMcpEntry(
  rawDefinition: Record<string, unknown>,
  type: "local" | "stdio"
): ReviewMcpServerConfig {
  let command: string;
  try {
    command = readNonBlankString(rawDefinition.command);
  } catch {
    throw new Error("'command' must be a non-blank string");
  }

  let args: string[] | undefined;
  if (rawDefinition.args !== undefined) {
    try {
      args = readStringArray(rawDefinition.args);
    } catch {
      throw new Error("'args' must be an array of strings");
    }
  }

  let env: Record<string, string> | undefined;
  if (rawDefinition.env !== undefined) {
    try {
      env = readStringRecord(rawDefinition.env);
    } catch {
      throw new Error("'env' must be a string record");
    }
  }

  let tools: string[] | undefined;
  if (rawDefinition.tools !== undefined) {
    try {
      tools = readStringArray(rawDefinition.tools);
    } catch {
      throw new Error("'tools' must be an array of strings");
    }
  }

  let cwd: string | undefined;
  if (rawDefinition.cwd !== undefined) {
    try {
      cwd = readNonEmptyString(rawDefinition.cwd);
    } catch {
      throw new Error("'cwd' must be a non-empty string");
    }
  }

  let timeout: number | undefined;
  if (rawDefinition.timeout !== undefined) {
    try {
      timeout = readPositiveInteger(rawDefinition.timeout);
    } catch {
      throw new Error("'timeout' must be a positive integer");
    }
  }

  return {
    type,
    command,
    ...(args === undefined ? {} : { args }),
    ...(env === undefined ? {} : { env }),
    ...(tools === undefined ? {} : { tools }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(timeout === undefined ? {} : { timeout })
  };
}
