import type { ReviewMcpServers } from "../../src/core/review-mcp-server-config.ts";
import { LocalReviewConfigProvider } from "../../src/providers/config/local-review-config-provider.ts";
import type {
  ReviewConfig
} from "../../src/providers/config/review-config-provider.ts";
import type { ReviewConfigModelProvider } from "../../src/providers/config/review-config-model-provider-parser.ts";
import { createReviewRepoFixture } from "./git-fixture.ts";

export function createReviewConfigProviderFixture() {
  const fixture = createReviewRepoFixture();
  const provider = new LocalReviewConfigProvider();
  const nightowlDir = ".nightowl";

  return {
    fixture,
    provider,
    writeReviewConfig(config: unknown) {
      fixture.writeFile(`${nightowlDir}/reviewconfig.json`, JSON.stringify(config));
    },
    writeRawReviewConfig(configText: string) {
      fixture.writeFile(`${nightowlDir}/reviewconfig.json`, configText);
    },
    writeLegacyRootReviewConfig(config: unknown) {
      fixture.writeFile(".reviewconfig.json", JSON.stringify(config));
    },
    writeLegacyNamespaceReviewConfig(config: unknown) {
      fixture.writeFile(`${nightowlDir}/.reviewconfig.json`, JSON.stringify(config));
    },
    loadReviewConfig() {
      return provider.loadReviewConfig(fixture.repoDir);
    },
    cleanup() {
      fixture.cleanup();
    }
  };
}

// Builds the ReviewConfig the parser is expected to produce given the
// supplied overrides. webFetchAllowedHosts / webFetchDeniedHosts are only
// included in the returned object when explicitly provided — the config
// parser must omit these keys entirely when they are absent from the file
// (i.e. `undefined` must not appear in the output).
export function buildExpectedReviewConfig(input: {
  maxConcurrentFiles?: number;
  mcpServers?: ReviewMcpServers;
  modelProvider?: ReviewConfigModelProvider;
  webFetchAllowedHosts?: string[];
  webFetchDeniedHosts?: string[];
} = {}): ReviewConfig {
  return {
    maxConcurrentFiles: input.maxConcurrentFiles ?? 5,
    mcpServers: input.mcpServers ?? {},
    ...(input.modelProvider === undefined
      ? {}
      : { modelProvider: input.modelProvider }),
    ...(input.webFetchAllowedHosts === undefined
      ? {}
      : { webFetchAllowedHosts: input.webFetchAllowedHosts }),
    ...(input.webFetchDeniedHosts === undefined
      ? {}
      : { webFetchDeniedHosts: input.webFetchDeniedHosts })
  };
}
