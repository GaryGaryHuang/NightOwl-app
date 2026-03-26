import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider preserves baseline web_fetch behavior when webFetchAllowedHosts is absent", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
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

test("LocalReviewConfigProvider accepts valid wildcard entries alongside exact-host entries", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      webFetchAllowedHosts: ["docs.example.com", "*.example.com"]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchAllowedHosts: ["docs.example.com", "*.example.com"]
      })
    );

    configFixture.writeReviewConfig({
      webFetchAllowedHosts: ["*.example.com"]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchAllowedHosts: ["*.example.com"]
      })
    );

    configFixture.writeReviewConfig({
      webFetchAllowedHosts: [" *.Example.Com. "]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchAllowedHosts: ["*.example.com"]
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid wildcard patterns before Step 0", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["*"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["*."] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["*.*.example.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["example.*"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["foo*bar.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["*example.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["*.example.com:8443"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["*.example.com/guide"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["*.192.168.1.10"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid exact-host webFetchAllowedHosts entries before Step 0", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({ webFetchAllowedHosts: "docs.example.com" });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: [123] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["   "] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["https://docs.example.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["docs.example.com:8443"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["docs.example.com/guide"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchAllowedHosts: ["192.168.1.10"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves webFetchDeniedHosts: missing returns no denylist, valid entries normalised, coexists with other fields", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2,
      webFetchAllowedHosts: ["docs.example.com"]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        maxConcurrentFiles: 2,
        webFetchAllowedHosts: ["docs.example.com"]
      })
    );

    configFixture.writeReviewConfig({
      webFetchDeniedHosts: [" Internal.Example.Com. "]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchDeniedHosts: ["internal.example.com"]
      })
    );

    configFixture.writeReviewConfig({
      webFetchDeniedHosts: [" *.Internal.Example.Com. "]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchDeniedHosts: ["*.internal.example.com"]
      })
    );

    configFixture.writeReviewConfig({
      maxConcurrentFiles: 2,
      webFetchAllowedHosts: ["*.example.com"],
      webFetchDeniedHosts: ["internal.example.com"]
    });
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        maxConcurrentFiles: 2,
        webFetchAllowedHosts: ["*.example.com"],
        webFetchDeniedHosts: ["internal.example.com"]
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid webFetchDeniedHosts config before Step 0", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({ webFetchDeniedHosts: "evil.com" });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: [123] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["   "] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["https://internal.example.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["internal.example.com:8443"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["internal.example.com/admin"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["192.168.1.10"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["*"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["*."] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["*.*.example.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["example.*"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["foo*bar.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["*example.com"] });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts empty webFetchDeniedHosts array and produces empty denylist", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({ webFetchDeniedHosts: [] });

    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchDeniedHosts: []
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves denylist-only config without error when webFetchAllowedHosts is absent", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({ webFetchDeniedHosts: ["evil.com"] });

    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        webFetchDeniedHosts: ["evil.com"]
      })
    );
  } finally {
    configFixture.cleanup();
  }
});
