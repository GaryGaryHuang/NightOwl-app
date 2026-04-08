import { existsSync, readFileSync } from "node:fs";

import { reviewConfigPath } from "../core/nightowl-namespace.ts";
import type {
  ReviewConfig,
  ReviewConfigProvider
} from "./review-config-provider.ts";
import { ReviewConfigProviderError } from "./review-config-provider.ts";
import {
  buildDefaultReviewConfig,
  parseReviewConfig
} from "./review-config-parser.ts";

/**
 * Load repo-local review config and normalize the supported overrides.
 */
export class LocalReviewConfigProvider implements ReviewConfigProvider {
  loadReviewConfig(repoRoot: string): ReviewConfig {
    const configPath = reviewConfigPath(repoRoot);

    if (!existsSync(configPath)) {
      return buildDefaultReviewConfig();
    }

    try {
      return parseReviewConfig(readFileSync(configPath, "utf8"));
    } catch (error) {
      // Re-throw with the file path so invalid config errors point back to the source file.
      // The enriched inner error is preserved via `cause` for diagnostic access.
      throw new ReviewConfigProviderError(
        "loadReviewConfig",
        `invalid review config at ${configPath}`,
        {
          cause: error,
          configPath
        }
      );
    }
  }
}
