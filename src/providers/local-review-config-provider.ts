import { stat, readFile } from "node:fs/promises";

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
import { wrapBoundaryError } from "./boundary-error-helper.ts";

/**
 * Load repo-local review config and normalize the supported overrides.
 */
export class LocalReviewConfigProvider implements ReviewConfigProvider {
  async loadReviewConfig(repoRoot: string): Promise<ReviewConfig> {
    const configPath = reviewConfigPath(repoRoot);

    try {
      await stat(configPath);
    } catch (error: unknown) {
      if (isEnoent(error)) {
        return buildDefaultReviewConfig();
      }
      throw error;
    }

    return wrapBoundaryError(
      async () => parseReviewConfig(await readFile(configPath, "utf8")),
      (cause) => new ReviewConfigProviderError(
        "loadReviewConfig",
        `invalid review config at ${configPath}`,
        { cause, configPath }
      )
    );
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
