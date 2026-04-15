import {
  DEFAULT_CONFIDENCE_THRESHOLDS
} from "../../core/confidence-thresholds.ts";
import {
  DEFAULT_MAX_CONCURRENT_FILES
} from "../../core/max-concurrent-files.ts";
import {
  resolveConfidenceThresholdsFromConfigObject,
  resolveMaxConcurrentFilesFromConfigObject
} from "./review-config-field-resolvers.ts";
import type { ReviewConfig } from "./review-config-provider.ts";
import {
  invalidReviewConfigError,
  isPlainObject
} from "./review-config-parse-helpers.ts";
import { resolveMcpServersFromConfigObject } from "./review-config-mcp-parser.ts";
import {
  resolveWebFetchAllowedHostsFromConfigObject,
  resolveWebFetchDeniedHostsFromConfigObject
} from "./review-config-web-fetch-host-parser.ts";

const RECOGNIZED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "maxConcurrentFiles",
  "confidenceThresholds",
  "mcpServers",
  "webFetchAllowedHosts",
  "webFetchDeniedHosts"
]);

export function parseReviewConfig(configText: string): ReviewConfig {
  return resolveTopLevelReviewConfig(parseReviewConfigObject(configText));
}

export function buildDefaultReviewConfig(): ReviewConfig {
  return {
    maxConcurrentFiles: DEFAULT_MAX_CONCURRENT_FILES,
    confidenceThresholds: { ...DEFAULT_CONFIDENCE_THRESHOLDS },
    mcpServers: {}
  };
}

export function parseReviewConfigObject(
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

export function resolveTopLevelReviewConfig(
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

  return {
    maxConcurrentFiles: resolveMaxConcurrentFilesFromConfigObject(configObject),
    confidenceThresholds: resolveConfidenceThresholdsFromConfigObject(configObject),
    mcpServers: resolveMcpServersFromConfigObject(configObject),
    ...(webFetchAllowedHosts === undefined
      ? {}
      : { webFetchAllowedHosts }),
    ...(webFetchDeniedHosts === undefined
      ? {}
      : { webFetchDeniedHosts })
  };
}

