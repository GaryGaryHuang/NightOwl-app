import assert from "node:assert/strict";
import test from "node:test";

import { ReviewConfigProviderError } from "../../src/providers/config/review-config-provider.ts";
import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider loads web_fetch host policy from repo-local config", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 70,
        nice: 85
      },
      webFetchAllowedHosts: [" Docs.Example.Com. ", "*.Example.Com. "],
      webFetchDeniedHosts: [" Internal.Example.Com. ", "*.Secret.Example.Com. "]
    });

    assert.deepEqual(
      await configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        maxConcurrentFiles: 2,
        confidenceThresholds: {
          must: 70,
          nice: 85
        },
        webFetchAllowedHosts: ["docs.example.com", "*.example.com"],
        webFetchDeniedHosts: ["internal.example.com", "*.secret.example.com"]
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid repo-local web_fetch host config before Step 0", async () => {
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
