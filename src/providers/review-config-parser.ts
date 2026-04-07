import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  resolveConfidenceThresholdsFromConfigObject
} from "../core/confidence-thresholds.ts";
import {
  DEFAULT_MAX_CONCURRENT_FILES,
  resolveMaxConcurrentFilesFromConfigObject
} from "../core/max-concurrent-files.ts";
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

