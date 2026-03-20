import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_CONFIDENCE_THRESHOLDS,
  parseConfidenceThresholdsConfig
} from "../core/confidence-thresholds.ts";
import type { ConfidenceThresholds } from "../core/confidence-thresholds.ts";
import type { ReviewConfigProvider } from "./review-config-provider.ts";

export class LocalReviewConfigProvider implements ReviewConfigProvider {
  loadConfidenceThresholds(repoRoot: string): ConfidenceThresholds {
    const configPath = path.join(repoRoot, ".reviewconfig.json");

    if (!existsSync(configPath)) {
      return { ...DEFAULT_CONFIDENCE_THRESHOLDS };
    }

    try {
      return parseConfidenceThresholdsConfig(readFileSync(configPath, "utf8"));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "invalid review config";

      throw new Error(`${message} at ${configPath}`);
    }
  }
}
