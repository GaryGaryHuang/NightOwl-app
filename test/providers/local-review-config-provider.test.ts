import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import test from "node:test";

import { reviewConfigPath } from "../../src/core/nightowl-namespace.ts";
import { ReviewConfigProviderError } from "../../src/providers/config/review-config-provider.ts";
import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

const requireFromTest = createRequire(import.meta.url);
const fsPromises = requireFromTest("node:fs/promises") as typeof import("node:fs/promises");

test("LocalReviewConfigProvider falls back to the documented default review config when repo-local config is missing", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    assert.deepEqual(await configFixture.loadReviewConfig(), buildExpectedReviewConfig());
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider falls back to the documented default review config when canonical config disappears during read", async () => {
  const configFixture = createReviewConfigProviderFixture();
  const configPath = reviewConfigPath(configFixture.fixture.repoDir);
  const originalReadFile = fsPromises.readFile;

  try {
    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2
    });
    fsPromises.readFile = (async (filePath: unknown, options?: unknown) => {
      if (filePath === configPath) {
        throw createErrnoError("ENOENT", "config disappeared during read");
      }

      return originalReadFile(filePath as never, options as never);
    }) as typeof fsPromises.readFile;
    syncBuiltinESMExports();

    assert.deepEqual(await configFixture.loadReviewConfig(), buildExpectedReviewConfig());
  } finally {
    fsPromises.readFile = originalReadFile;
    syncBuiltinESMExports();
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
      assert.match(
        error.configPath ?? "",
        /\.nightowl\/reviewconfig\.json$/u
      );
      assert.ok(error.cause instanceof Error);
      assert.equal(
        (error.cause as NodeJS.ErrnoException).code,
        "ENOTDIR"
      );
      return true;
    });
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider only reads the canonical .nightowl/reviewconfig.json path", async () => {
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

    assert.deepEqual(await configFixture.loadReviewConfig(), buildExpectedReviewConfig());

    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 70,
        nice: 85
      }
    });

    assert.deepEqual(
      await configFixture.loadReviewConfig(),
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

test("LocalReviewConfigProvider wraps invalid repo-local config with path-aware error context", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeRawReviewConfig("{");

    await assert.rejects(async () => await configFixture.loadReviewConfig(), (error) => {
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

function createErrnoError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;

  error.code = code;

  return error;
}
