import {
  DEFAULT_MAX_CONCURRENT_FILES
} from "../../core/max-concurrent-files.ts";
import { canonicalizeHostnameForComparison } from "../../core/web-fetch-hostname-normalization.ts";
import type { ReviewConfig } from "./review-config-provider.ts";
import {
  invalidReviewConfigError,
  isPlainObject,
  readOptionalField,
  readPositiveInteger
} from "./review-config-parse-helpers.ts";
import { resolveModelProviderFromConfigObject } from "./review-config-model-provider-parser.ts";
import { resolveMcpServersFromConfigObject } from "./review-config-mcp-parser.ts";

// Compile-time exhaustiveness: every key of ReviewConfig must appear here.
// Adding a field to ReviewConfig without listing it here causes a type error.
const RECOGNIZED_CONFIG_KEYS: { [K in keyof Required<ReviewConfig>]: true } = {
  maxConcurrentFiles: true,
  mcpServers: true,
  modelProvider: true,
  webFetchAllowedHosts: true,
  webFetchDeniedHosts: true
};

const RECOGNIZED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(
  Object.keys(RECOGNIZED_CONFIG_KEYS)
);

export function parseReviewConfig(configText: string): ReviewConfig {
  return resolveTopLevelReviewConfig(parseReviewConfigObject(configText));
}

export function buildDefaultReviewConfig(): ReviewConfig {
  return {
    maxConcurrentFiles: DEFAULT_MAX_CONCURRENT_FILES,
    mcpServers: {}
  };
}

function parseReviewConfigObject(
  configText: string
): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(configText);
  } catch {
    throw invalidReviewConfigError();
  }

  if (!isPlainObject(parsed)) {
    throw invalidReviewConfigError();
  }

  return parsed;
}

function resolveTopLevelReviewConfig(
  configObject: Record<string, unknown>
): ReviewConfig {
  for (const key of Object.keys(configObject)) {
    if (!RECOGNIZED_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`unknown config key '${key}'`);
    }
  }

  const webFetchAllowedHosts =
    resolveWebFetchHostsFromConfigObject(configObject, "webFetchAllowedHosts");
  const webFetchDeniedHosts =
    resolveWebFetchHostsFromConfigObject(configObject, "webFetchDeniedHosts");
  const modelProvider = resolveModelProviderFromConfigObject(configObject);

  return {
    maxConcurrentFiles: resolveMaxConcurrentFilesFromConfigObject(configObject),
    mcpServers: resolveMcpServersFromConfigObject(configObject),
    ...(modelProvider === undefined
      ? {}
      : { modelProvider }),
    ...(webFetchAllowedHosts === undefined
      ? {}
      : { webFetchAllowedHosts }),
    ...(webFetchDeniedHosts === undefined
      ? {}
      : { webFetchDeniedHosts })
  };
}

function resolveMaxConcurrentFilesFromConfigObject(
  config: Record<string, unknown>
): number {
  return readOptionalField(
    config,
    "maxConcurrentFiles",
    readPositiveInteger,
    "'maxConcurrentFiles' must be a positive integer"
  ) ?? DEFAULT_MAX_CONCURRENT_FILES;
}

function resolveWebFetchHostsFromConfigObject(
  config: Record<string, unknown>,
  key: "webFetchAllowedHosts" | "webFetchDeniedHosts"
): string[] | undefined {
  const rawHosts = config[key];

  if (rawHosts === undefined) {
    return undefined;
  }

  if (!Array.isArray(rawHosts)) {
    throw new Error(`'${key}' must be an array`);
  }

  return rawHosts.map((value, index) => readWebFetchHostEntry(value, key, index));
}

function readWebFetchHostEntry(
  value: unknown,
  key: string,
  index: number
): string {
  if (typeof value !== "string") {
    throw new Error(`'${key}[${index}]' must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`'${key}[${index}]' must not be empty`);
  }

  if (trimmed.includes("*")) {
    return readWildcardWebFetchHostEntry(trimmed, key, index);
  }

  if (/[:/?#\[\]]/u.test(trimmed)) {
    throw new Error(`'${key}[${index}]' contains invalid characters`);
  }

  const canonical = canonicalizeHostnameForComparison(trimmed);

  if (
    canonical.length === 0 ||
    isIpLiteral(canonical) ||
    !HOSTNAME_PATTERN.test(canonical)
  ) {
    throw new Error(`'${key}[${index}]' is not a valid hostname`);
  }

  return canonical;
}

function readWildcardWebFetchHostEntry(
  trimmed: string,
  key: string,
  index: number
): string {
  if (!trimmed.startsWith("*.")) {
    throw new Error(`'${key}[${index}]' wildcard must use '*.domain' format`);
  }

  const base = trimmed.slice(2);

  if (base.length === 0 || base.includes("*") || /[:/?#\[\]]/u.test(base)) {
    throw new Error(`'${key}[${index}]' contains invalid wildcard base`);
  }

  const canonicalBase = canonicalizeHostnameForComparison(base);

  if (
    canonicalBase.length === 0 ||
    isIpLiteral(canonicalBase) ||
    !HOSTNAME_PATTERN.test(canonicalBase)
  ) {
    throw new Error(`'${key}[${index}]' is not a valid wildcard hostname`);
  }

  return `*.${canonicalBase}`;
}

function isIpLiteral(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/u.test(value) || value.includes(":");
}

const HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/u;
