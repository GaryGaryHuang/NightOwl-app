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
  ReviewConfigProvider
} from "./review-config-provider.ts";

export class LocalReviewConfigProvider implements ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): ReviewConfig {
    const configPath = path.join(repoRoot, ".reviewconfig.json");

    if (!existsSync(configPath)) {
      return buildDefaultReviewConfig();
    }

    try {
      const config = parseReviewConfigObject(readFileSync(configPath, "utf8"));

      return {
        maxConcurrentFiles: resolveMaxConcurrentFilesFromConfigObject(config),
        confidenceThresholds: resolveConfidenceThresholdsFromConfigObject(config)
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid review config";

      throw new Error(`${message} at ${configPath}`);
    }
  }
}

function buildDefaultReviewConfig(): ReviewConfig {
  return {
    maxConcurrentFiles: DEFAULT_MAX_CONCURRENT_FILES,
    confidenceThresholds: { ...DEFAULT_CONFIDENCE_THRESHOLDS }
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
