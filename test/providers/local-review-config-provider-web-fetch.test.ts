import assert from "node:assert/strict";
import test from "node:test";

import { ReviewConfigProviderError } from "../../src/providers/config/review-config-provider.ts";
import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider applies the web-fetch host parser to the repo-local config and merges the result", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      webFetchAllowedHosts: ["docs.example.com"],
      webFetchDeniedHosts: ["internal.example.com"]
    });

    assert.deepEqual(
      await configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchAllowedHosts: ["docs.example.com"],
        webFetchDeniedHosts: ["internal.example.com"]
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider wraps web-fetch host parser errors in ReviewConfigProviderError tagged with the canonical config path", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      webFetchAllowedHosts: ["https://docs.example.com"]
    });

    await assert.rejects(
      async () => await configFixture.loadReviewConfig(),
      (error: unknown) =>
        error instanceof ReviewConfigProviderError &&
        error.message.includes("invalid review config") &&
        typeof error.configPath === "string" &&
        error.configPath.endsWith(".nightowl/reviewconfig.json")
    );
  } finally {
    configFixture.cleanup();
  }
});
