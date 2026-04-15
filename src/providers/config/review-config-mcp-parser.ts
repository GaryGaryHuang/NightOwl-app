import type {
  ReviewMcpServerConfig,
  ReviewMcpServers
} from "../../core/review-mcp-server-config.ts";
import {
  isPlainObject,
  readNonBlankString,
  readNonEmptyString,
  readOptionalField,
  readPositiveInteger,
  readRequiredField,
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

  if (rawType !== undefined && rawType !== "http" && rawType !== "context7") {
    throw new Error("'type' must be \"http\" or \"context7\" if provided");
  }

  for (const key of Object.keys(rawDefinition)) {
    if (!CONTEXT7_ALLOWED_KEYS.has(key)) {
      throw new Error(`'${key}' is not a supported field`);
    }
  }

  const tools = readOptionalField(rawDefinition, "tools", readStringArray, "'tools' must be an array of strings");
  const timeout = readOptionalField(rawDefinition, "timeout", readPositiveInteger, "'timeout' must be a positive integer");

  return {
    type: "context7",
    ...(tools === undefined ? {} : { tools }),
    ...(timeout === undefined ? {} : { timeout })
  };
}

function resolveRemoteMcpEntry(
  rawDefinition: Record<string, unknown>,
  type: "http" | "sse"
): ReviewMcpServerConfig {
  const url = readRequiredField(rawDefinition, "url", readNonEmptyString, "'url' must be a non-empty string");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("'url' is not a valid URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("'url' must use http or https protocol");
  }

  const headers = readOptionalField(rawDefinition, "headers", readStringRecord, "'headers' must be a string record");
  const tools = readOptionalField(rawDefinition, "tools", readStringArray, "'tools' must be an array of strings");
  const timeout = readOptionalField(rawDefinition, "timeout", readPositiveInteger, "'timeout' must be a positive integer");

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
  const command = readRequiredField(rawDefinition, "command", readNonBlankString, "'command' must be a non-blank string");
  const args = readOptionalField(rawDefinition, "args", readStringArray, "'args' must be an array of strings");
  const env = readOptionalField(rawDefinition, "env", readStringRecord, "'env' must be a string record");
  const tools = readOptionalField(rawDefinition, "tools", readStringArray, "'tools' must be an array of strings");
  const cwd = readOptionalField(rawDefinition, "cwd", readNonEmptyString, "'cwd' must be a non-empty string");
  const timeout = readOptionalField(rawDefinition, "timeout", readPositiveInteger, "'timeout' must be a positive integer");

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
