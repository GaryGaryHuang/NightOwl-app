import { stat, readFile } from "node:fs/promises";

import { reviewConfigPath } from "../../core/nightowl-namespace.ts";
import type {
  ReviewConfig,
  ReviewConfigProvider
} from "./review-config-provider.ts";
import { ReviewConfigProviderError } from "./review-config-provider.ts";
import {
  buildDefaultReviewConfig,
  parseReviewConfig
} from "./review-config-parser.ts";
import {
  wrapBoundaryError,
  wrapBoundaryErrorUnlessEnoent
} from "../boundary-error-helper.ts";

/**
 * Load repo-local review config and normalize the supported overrides.
 */
export class LocalReviewConfigProvider implements ReviewConfigProvider {
  async loadReviewConfig(repoRoot: string): Promise<ReviewConfig> {
    const configPath = reviewConfigPath(repoRoot);
    const toBoundaryError = (cause: unknown) => new ReviewConfigProviderError(
      "loadReviewConfig",
      `invalid review config at ${configPath}`,
      { cause, configPath }
    );

    const configExists = await wrapBoundaryErrorUnlessEnoent(
      async () => {
        await stat(configPath);
        return true;
      },
      () => false,
      toBoundaryError
    );

    if (!configExists) {
      return buildDefaultReviewConfig();
    }

    return wrapBoundaryError(
      async () => parseReviewConfig(await readFile(configPath, "utf8")),
      toBoundaryError
    );
  }
}
