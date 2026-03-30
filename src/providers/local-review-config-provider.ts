import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  resolveConfidenceThresholdsFromConfigObject
} from "../core/confidence-thresholds.ts";
import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";
import {
  DEFAULT_MAX_CONCURRENT_FILES,
  resolveMaxConcurrentFilesFromConfigObject
} from "../core/max-concurrent-files.ts";
import type {
  ReviewConfig,
  ReviewMcpServerConfig,
  ReviewMcpServers,
  ReviewConfigProvider
} from "./review-config-provider.ts";

/**
 * Load repo-local review config and normalize the supported overrides.
 */
export class LocalReviewConfigProvider implements ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): ReviewConfig {
    const configPath = path.join(repoRoot, ".nightowl", "reviewconfig.json");

    if (!existsSync(configPath)) {
      return buildDefaultReviewConfig();
    }

    try {
      const config = parseReviewConfigObject(readFileSync(configPath, "utf8"));
      const webFetchAllowedHosts =
        resolveWebFetchAllowedHostsFromConfigObject(config);
      const webFetchDeniedHosts =
        resolveWebFetchDeniedHostsFromConfigObject(config);

      return {
        maxConcurrentFiles: resolveMaxConcurrentFilesFromConfigObject(config),
        confidenceThresholds: resolveConfidenceThresholdsFromConfigObject(config),
        mcpServers: resolveMcpServersFromConfigObject(config),
        ...(webFetchAllowedHosts === undefined
          ? {}
          : { webFetchAllowedHosts }),
        ...(webFetchDeniedHosts === undefined
          ? {}
          : { webFetchDeniedHosts })
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid review config";

      // Re-throw with the file path so invalid config errors point back to the source file.
      throw new Error(`${message} at ${configPath}`);
    }
  }
}

function buildDefaultReviewConfig(): ReviewConfig {
  return {
    maxConcurrentFiles: DEFAULT_MAX_CONCURRENT_FILES,
    confidenceThresholds: { ...DEFAULT_CONFIDENCE_THRESHOLDS },
    mcpServers: {}
  };
}

function parseReviewConfigObject(configText: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(configText);
  } catch {
    throw new Error("invalid review config");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid review config");
  }

  return parsed as Record<string, unknown>;
}

function resolveMcpServersFromConfigObject(
  config: Record<string, unknown>
): ReviewMcpServers {
  const rawMcpServers = config.mcpServers;

  if (rawMcpServers === undefined) {
    return {};
  }

  if (!isPlainObject(rawMcpServers)) {
    throw new Error("invalid review config");
  }

  const resolved: ReviewMcpServers = {};

  for (const [name, rawDefinition] of Object.entries(rawMcpServers)) {
    if (!isPlainObject(rawDefinition)) {
      throw new Error("invalid review config");
    }

    if (name === "context7") {
      // Keep the built-in Context7 endpoint fixed; repo-local config may only adjust tools and timeout.
      resolved[name] = resolveContext7OverrideEntry(rawDefinition);
      continue;
    }

    const rawType = rawDefinition.type;
    const resolvedType =
      rawType === undefined
        ? "local"
        : rawType;

    if (
      resolvedType !== "local" &&
      resolvedType !== "stdio" &&
      resolvedType !== "http" &&
      resolvedType !== "sse"
    ) {
      throw new Error("invalid review config");
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
    throw new Error("invalid review config");
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
      throw new Error("invalid review config");
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
  const url = rawDefinition.url;

  if (typeof url !== "string" || url.length === 0) {
    throw new Error("invalid review config");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("invalid review config");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("invalid review config");
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
  const command = rawDefinition.command;

  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("invalid review config");
  }

  return {
    type,
    ...(command === undefined ? {} : { command }),
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

function resolveWebFetchAllowedHostsFromConfigObject(
  config: Record<string, unknown>
): string[] | undefined {
  const rawWebFetchAllowedHosts = config.webFetchAllowedHosts;

  if (rawWebFetchAllowedHosts === undefined) {
    return undefined;
  }

  if (!Array.isArray(rawWebFetchAllowedHosts)) {
    throw new Error("invalid review config");
  }

  return rawWebFetchAllowedHosts.map((value) =>
    readWebFetchHostEntry(value)
  );
}

function resolveWebFetchDeniedHostsFromConfigObject(
  config: Record<string, unknown>
): string[] | undefined {
  const rawWebFetchDeniedHosts = config.webFetchDeniedHosts;

  if (rawWebFetchDeniedHosts === undefined) {
    return undefined;
  }

  if (!Array.isArray(rawWebFetchDeniedHosts)) {
    throw new Error("invalid review config");
  }

  return rawWebFetchDeniedHosts.map((value) =>
    readWebFetchHostEntry(value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("invalid review config");
  }

  return [...value];
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error("invalid review config");
  }

  const entries = Object.entries(value);
  const result: Record<string, string> = {};

  for (const [key, item] of entries) {
    if (typeof item !== "string") {
      throw new Error("invalid review config");
    }

    result[key] = item;
  }

  return result;
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("invalid review config");
  }

  return value;
}

function readNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid review config");
  }

  return value;
}

function readWebFetchHostEntry(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("invalid review config");
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error("invalid review config");
  }

  if (trimmed.includes("*")) {
    return readWildcardWebFetchHostEntry(trimmed);
  }

  if (/[:/?#\[\]]/u.test(trimmed)) {
    throw new Error("invalid review config");
  }

  const canonical = canonicalizeHostname(trimmed);

  if (
    canonical.length === 0 ||
    isIpLiteral(canonical) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u.test(
      canonical
    )
  ) {
    throw new Error("invalid review config");
  }

  return canonical;
}

function readWildcardWebFetchHostEntry(trimmed: string): string {
  if (!trimmed.startsWith("*.")) {
    throw new Error("invalid review config");
  }

  const base = trimmed.slice(2);

  if (base.length === 0 || base.includes("*") || /[:/?#\[\]]/u.test(base)) {
    throw new Error("invalid review config");
  }

  const canonicalBase = canonicalizeHostname(base);

  if (
    canonicalBase.length === 0 ||
    isIpLiteral(canonicalBase) ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u.test(
      canonicalBase
    )
  ) {
    throw new Error("invalid review config");
  }

  return `*.${canonicalBase}`;
}

function canonicalizeHostname(value: string): string {
  return value.toLowerCase().replace(/\.$/u, "");
}

function isIpLiteral(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/u.test(value) || value.includes(":");
}
