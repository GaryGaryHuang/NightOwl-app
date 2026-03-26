import type { ConfidenceThresholds } from "../../src/core/confidence-thresholds.ts";
import { LocalReviewConfigProvider } from "../../src/providers/local-review-config-provider.ts";
import type {
  ReviewConfig,
  ReviewMcpServers
} from "../../src/providers/review-config-provider.ts";
import { createReviewRepoFixture } from "./git-fixture.ts";

export function createReviewConfigProviderFixture() {
  const fixture = createReviewRepoFixture();
  const provider = new LocalReviewConfigProvider();

  return {
    fixture,
    provider,
    writeReviewConfig(config: unknown) {
      fixture.writeFile(".reviewconfig.json", JSON.stringify(config));
    },
    writeRawReviewConfig(configText: string) {
      fixture.writeFile(".reviewconfig.json", configText);
    },
    loadReviewConfig() {
      return provider.loadReviewConfig(fixture.repoDir);
    },
    cleanup() {
      fixture.cleanup();
    }
  };
}

export function buildExpectedReviewConfig(input: {
  maxConcurrentFiles?: number;
  confidenceThresholds?: Partial<ConfidenceThresholds>;
  mcpServers?: ReviewMcpServers;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
} = {}): ReviewConfig {
  return {
    maxConcurrentFiles: input.maxConcurrentFiles ?? 5,
    confidenceThresholds: {
      must: input.confidenceThresholds?.must ?? 80,
      nice: input.confidenceThresholds?.nice ?? 90
    },
    mcpServers: input.mcpServers ?? {},
    ...(input.webFetchAllowedHosts === undefined
      ? {}
      : { webFetchAllowedHosts: input.webFetchAllowedHosts }),
    ...(input.webFetchDeniedHosts === undefined
      ? {}
      : { webFetchDeniedHosts: input.webFetchDeniedHosts })
  };
}
