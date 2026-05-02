import assert from "node:assert/strict";
import test from "node:test";

import { ReviewConfigProviderError } from "../../src/providers/config/review-config-provider.ts";
import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider falls back to the documented default review config when repo-local config is missing", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    assert.deepEqual(await configFixture.loadReviewConfig(), buildExpectedReviewConfig());
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider only reads the canonical .nightowl/reviewconfig.json path", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeLegacyRootReviewConfig({ maxConcurrentFiles: 2 });
    configFixture.writeLegacyNamespaceReviewConfig({ maxConcurrentFiles: 3 });

    assert.deepEqual(await configFixture.loadReviewConfig(), buildExpectedReviewConfig());

    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2,
      webFetchAllowedHosts: ["docs.example.com"]
    });

    assert.deepEqual(
      await configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        maxConcurrentFiles: 2,
        webFetchAllowedHosts: ["docs.example.com"]
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider wraps invalid repo-local config with path-aware error context", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeRawReviewConfig("{");

    await assert.rejects(async () => await configFixture.loadReviewConfig(), (error) => {
      assert.ok(error instanceof ReviewConfigProviderError);
      assert.equal(error.operation, "loadReviewConfig");
      assert.match(error.configPath ?? "", /\.nightowl\/reviewconfig\.json$/u);
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

test("LocalReviewConfigProvider wraps non-ENOENT config path filesystem failures in ReviewConfigProviderError", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.fixture.writeFile(".nightowl", "not a directory\n");

    await assert.rejects(async () => await configFixture.loadReviewConfig(), (error) => {
      assert.ok(error instanceof ReviewConfigProviderError);
      assert.equal(error.operation, "loadReviewConfig");
      assert.match(error.configPath ?? "", /\.nightowl\/reviewconfig\.json$/u);
      assert.ok(error.cause instanceof Error);
      assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOTDIR");
      return true;
    });
  } finally {
    configFixture.cleanup();
  }
});
