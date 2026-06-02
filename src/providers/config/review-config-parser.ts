import {
  DEFAULT_MAX_CONCURRENT_FILES
} from "../../core/max-concurrent-files.ts";
import { resolveMaxConcurrentFilesFromConfigObject } from "./review-config-field-resolvers.ts";
import type { ReviewConfig } from "./review-config-provider.ts";
import {
  invalidReviewConfigError,
  isPlainObject
} from "./review-config-parse-helpers.ts";
import { resolveModelProviderFromConfigObject } from "./review-config-model-provider-parser.ts";
import { resolveMcpServersFromConfigObject } from "./review-config-mcp-parser.ts";
import {
  resolveWebFetchAllowedHostsFromConfigObject,
  resolveWebFetchDeniedHostsFromConfigObject
} from "./review-config-web-fetch-host-parser.ts";

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
    resolveWebFetchAllowedHostsFromConfigObject(configObject);
  const webFetchDeniedHosts =
    resolveWebFetchDeniedHostsFromConfigObject(configObject);
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
