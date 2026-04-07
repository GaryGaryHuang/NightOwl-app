import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  ReviewConfig,
  ReviewConfigProvider
} from "./review-config-provider.ts";
import {
  buildDefaultReviewConfig,
  parseReviewConfig
} from "./review-config-parser.ts";

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
      return parseReviewConfig(readFileSync(configPath, "utf8"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid review config";

      // Re-throw with the file path so invalid config errors point back to the source file.
      throw new Error(`${message} at ${configPath}`);
    }
  }
}
