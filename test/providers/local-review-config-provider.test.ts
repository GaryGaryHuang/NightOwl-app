import assert from "node:assert/strict";
import test from "node:test";

import { ReviewConfigProviderError } from "../../src/providers/review-config-provider.ts";
import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider falls back to the documented default review config when repo-local config is missing", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    assert.deepEqual(configFixture.loadReviewConfig(), buildExpectedReviewConfig());
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider only reads the canonical .nightowl/reviewconfig.json path", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeLegacyRootReviewConfig({
      maxConcurrentFiles: 2
    });
    configFixture.writeLegacyNamespaceReviewConfig({
      confidenceThresholds: {
        must: 70,
        nice: 85
      }
    });

    assert.deepEqual(configFixture.loadReviewConfig(), buildExpectedReviewConfig());

    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 70,
        nice: 85
      }
    });

    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        maxConcurrentFiles: 2,
        confidenceThresholds: {
          must: 70,
          nice: 85
        }
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider wraps invalid repo-local config with path-aware error context", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeRawReviewConfig("{");

    assert.throws(() => configFixture.loadReviewConfig(), (error) => {
      assert.ok(error instanceof ReviewConfigProviderError);
      assert.equal(error.operation, "loadReviewConfig");
      assert.match(
        error.configPath ?? "",
        /\.nightowl\/reviewconfig\.json$/u
      );
      assert.match(
        error.message,
        /invalid review config at .*\.nightowl\/reviewconfig\.json/u
      );
      assert.ok(error.cause instanceof Error);
      return true;
    });
  } finally {
    configFixture.cleanup();
  }
});
