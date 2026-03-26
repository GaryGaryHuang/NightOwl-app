import assert from "node:assert/strict";
import test from "node:test";

import { LocalReviewConfigProvider } from "../../src/providers/local-review-config-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalReviewConfigProvider preserves baseline web_fetch behavior when webFetchAllowedHosts is absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2,
        confidenceThresholds: {
          must: 70,
          nice: 85
        }
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 70,
        nice: 85
      },
      mcpServers: {}
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts valid wildcard entries alongside exact-host entries", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["docs.example.com", "*.example.com"]
      })
    );

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchAllowedHosts: ["docs.example.com", "*.example.com"]
    });

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["*.example.com"]
      })
    );

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchAllowedHosts: ["*.example.com"]
    });

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: [" *.Example.Com. "]
      })
    );

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchAllowedHosts: ["*.example.com"]
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid wildcard patterns before Step 0", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["*"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["*."] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["*.*.example.com"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["example.*"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["foo*bar.com"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["*example.com"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["*.example.com:8443"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["*.example.com/guide"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchAllowedHosts: ["*.192.168.1.10"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );
  } finally {
    fixture.cleanup();
  }
});

// ── Denylist config validation TDD (tasks 1.1–1.4) ────────────────────────────

test("LocalReviewConfigProvider resolves webFetchDeniedHosts: missing returns no denylist, valid entries normalised, coexists with other fields", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    // missing field → no denylist, other fields unaffected
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2,
        webFetchAllowedHosts: ["docs.example.com"]
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchAllowedHosts: ["docs.example.com"]
    });

    // valid exact-host: trimmed, lowercased, trailing dot removed
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchDeniedHosts: [" Internal.Example.Com. "]
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchDeniedHosts: ["internal.example.com"]
    });

    // valid wildcard: base normalised to *.lowercase-base
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchDeniedHosts: [" *.Internal.Example.Com. "]
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchDeniedHosts: ["*.internal.example.com"]
    });

    // coexists with webFetchAllowedHosts and other fields
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2,
        webFetchAllowedHosts: ["*.example.com"],
        webFetchDeniedHosts: ["internal.example.com"]
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchAllowedHosts: ["*.example.com"],
      webFetchDeniedHosts: ["internal.example.com"]
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid webFetchDeniedHosts config before Step 0", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    // non-array value
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: "evil.com" })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // non-string element
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: [123] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // empty/whitespace-only entry
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["   "] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // URL-formatted entry (scheme)
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["https://internal.example.com"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // URL-formatted entry (port)
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["internal.example.com:8443"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // URL-formatted entry (path)
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["internal.example.com/admin"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // IP literal
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["192.168.1.10"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // bare wildcard *
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["*"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // wildcard prefix without base
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["*."] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // multi-label wildcard
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["*.*.example.com"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // trailing wildcard
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["example.*"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // embedded wildcard
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["foo*bar.com"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // wildcard without dot separator
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["*example.com"] })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts empty webFetchDeniedHosts array and produces empty denylist", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: [] })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchDeniedHosts: []
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves denylist-only config without error when webFetchAllowedHosts is absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({ webFetchDeniedHosts: ["evil.com"] })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {},
      webFetchDeniedHosts: ["evil.com"]
    });
  } finally {
    fixture.cleanup();
  }
});
