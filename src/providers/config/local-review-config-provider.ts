import { readFile } from "node:fs/promises";

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

    return wrapBoundaryErrorUnlessEnoent(
      async () => parseReviewConfig(await readFile(configPath, "utf8")),
      () => buildDefaultReviewConfig(),
      toBoundaryError
    );
  }
}
