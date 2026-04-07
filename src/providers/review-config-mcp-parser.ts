import type {
  ReviewMcpServerConfig,
  ReviewMcpServers
} from "./review-config-provider.ts";
import {
  invalidReviewConfigError,
  isPlainObject,
  readNonBlankString,
  readNonEmptyString,
  readPositiveInteger,
  readStringArray,
  readStringRecord
} from "./review-config-parse-helpers.ts";

export function resolveMcpServersFromConfigObject(
  config: Record<string, unknown>
): ReviewMcpServers {
  const rawMcpServers = config.mcpServers;

  if (rawMcpServers === undefined) {
    return {};
  }

  if (!isPlainObject(rawMcpServers)) {
    throw invalidReviewConfigError();
  }

  const resolved: ReviewMcpServers = {};

  for (const [name, rawDefinition] of Object.entries(rawMcpServers)) {
    if (!isPlainObject(rawDefinition)) {
      throw invalidReviewConfigError();
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
      throw invalidReviewConfigError();
    }

    if (resolvedType === "http" || resolvedType === "sse") {
      resolved[name] = resolveRemoteMcpEntry(rawDefinition, resolvedType);
    } else {
      resolved[name] = resolveLocalMcpEntry(rawDefinition, resolvedType);
    }
  }

  return resolved;
}

function resolveContext7OverrideEntry(
  rawDefinition: Record<string, unknown>
): ReviewMcpServerConfig {
  const rawType = rawDefinition.type;

  if (rawType !== undefined && rawType !== "http") {
    throw invalidReviewConfigError();
  }

  for (const forbiddenField of [
    "url",
    "headers",
    "command",
    "args",
    "env",
    "cwd"
  ]) {
    if (rawDefinition[forbiddenField] !== undefined) {
      throw invalidReviewConfigError();
    }
  }

  return {
    type: "http",
    ...(rawDefinition.tools === undefined
      ? {}
      : { tools: readStringArray(rawDefinition.tools) }),
    ...(rawDefinition.timeout === undefined
      ? {}
      : { timeout: readPositiveInteger(rawDefinition.timeout) })
  };
}

function resolveRemoteMcpEntry(
  rawDefinition: Record<string, unknown>,
  type: "http" | "sse"
): ReviewMcpServerConfig {
  const url = readNonEmptyString(rawDefinition.url);

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw invalidReviewConfigError();
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw invalidReviewConfigError();
  }

  return {
    type,
    url,
    ...(rawDefinition.headers === undefined
      ? {}
      : { headers: readStringRecord(rawDefinition.headers) }),
    ...(rawDefinition.tools === undefined
      ? {}
      : { tools: readStringArray(rawDefinition.tools) }),
    ...(rawDefinition.timeout === undefined
      ? {}
      : { timeout: readPositiveInteger(rawDefinition.timeout) })
  };
}

function resolveLocalMcpEntry(
  rawDefinition: Record<string, unknown>,
  type: "local" | "stdio"
): ReviewMcpServerConfig {
  const command = readNonBlankString(rawDefinition.command);

  return {
    type,
    command,
    ...(rawDefinition.args === undefined
      ? {}
      : { args: readStringArray(rawDefinition.args) }),
    ...(rawDefinition.env === undefined
      ? {}
      : { env: readStringRecord(rawDefinition.env) }),
    ...(rawDefinition.tools === undefined
      ? {}
      : { tools: readStringArray(rawDefinition.tools) }),
    ...(rawDefinition.cwd === undefined
      ? {}
      : { cwd: readNonEmptyString(rawDefinition.cwd) }),
    ...(rawDefinition.timeout === undefined
      ? {}
      : { timeout: readPositiveInteger(rawDefinition.timeout) })
  };
}
