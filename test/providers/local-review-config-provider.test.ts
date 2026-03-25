import assert from "node:assert/strict";
import test from "node:test";

import { LocalReviewConfigProvider } from "../../src/providers/local-review-config-provider.ts";
import { createReviewRepoFixture } from "../helpers/git-fixture.ts";

test("LocalReviewConfigProvider falls back to the documented default review config when .reviewconfig.json is missing", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: {
        must: 80,
        nice: 90
      },
      mcpServers: {}
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider falls back to defaults when maxConcurrentFiles or confidenceThresholds are absent", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(".reviewconfig.json", JSON.stringify({}));
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: {
        must: 80,
        nice: 90
      },
      mcpServers: {}
    });

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 80,
        nice: 90
      },
      mcpServers: {}
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves maxConcurrentFiles and confidenceThresholds from the same config file", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2,
        confidenceThresholds: {
          must: 70,
          nice: 85
        },
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            tools: ["*"]
          }
        },
        webFetchAllowedHosts: [" Docs.Example.Com. ", "react.dev"]
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: {
        must: 70,
        nice: 85
      },
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          tools: ["*"]
        }
      },
      webFetchAllowedHosts: ["docs.example.com", "react.dev"]
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts boundary threshold values and a validated remote-compatible context7 override while keeping default maxConcurrentFiles", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            type: "http",
            tools: ["resolve-library-id"],
            timeout: 20000
          }
        },
        confidenceThresholds: {
          must: 0,
          nice: 100
        }
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: {
        must: 0,
        nice: 100
      },
      mcpServers: {
        context7: {
          type: "http",
          tools: ["resolve-library-id"],
          timeout: 20000
        }
      }
    });
  } finally {
    fixture.cleanup();
  }
});

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

test("LocalReviewConfigProvider rejects malformed or invalid review config", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(".reviewconfig.json", "{");
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(".reviewconfig.json", JSON.stringify([]));
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 0
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: -1
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2.5
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: "2"
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: []
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          musst: 70
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          must: 101
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        confidenceThresholds: {
          nice: "85"
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: []
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "remote",
            command: "https://example.com/mcp"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: "--bad"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            headers: {
              Authorization: "Bearer repo-token"
            }
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            url: "https://context7.example.com/mcp"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            command: "npx"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: "docs.example.com"
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: [123]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["   "]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["https://docs.example.com"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["docs.example.com:8443"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["docs.example.com/guide"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        webFetchAllowedHosts: ["192.168.1.10"]
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );
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

// ── MCP transport expansion TDD (tasks 1.1–1.6) ───────────────────────────────

test("LocalReviewConfigProvider resolves validated remote http and sse MCP entries alongside local entries and run-level settings", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 2,
        confidenceThresholds: { must: 70, nice: 85 },
        mcpServers: {
          "my-remote": {
            type: "http",
            url: "https://mcp.example.com/v1",
            tools: ["*"]
          },
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            tools: ["*"]
          }
        }
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 2,
      confidenceThresholds: { must: 70, nice: 85 },
      mcpServers: {
        "my-remote": {
          type: "http",
          url: "https://mcp.example.com/v1",
          tools: ["*"]
        },
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          tools: ["*"]
        }
      }
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves validated remote sse MCP entry with headers and timeout", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          "legacy-sse": {
            type: "sse",
            url: "https://sse.example.com/mcp",
            headers: { Authorization: "Bearer tok123" },
            tools: ["search"],
            timeout: 30000
          }
        }
      })
    );

    const provider = new LocalReviewConfigProvider();

    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {
        "legacy-sse": {
          type: "sse",
          url: "https://sse.example.com/mcp",
          headers: { Authorization: "Bearer tok123" },
          tools: ["search"],
          timeout: 30000
        }
      }
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves valid mixed local and remote mcpServers coexisting with run-level settings", () => {
  const fixture = createReviewRepoFixture();

  try {
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        maxConcurrentFiles: 3,
        mcpServers: {
          "local-tool": {
            type: "local",
            command: "npx",
            args: ["-y", "@example/local-mcp"],
            cwd: "/opt/tools",
            timeout: 10000
          },
          "remote-tool": {
            type: "http",
            url: "https://mcp.example.com/v1",
            headers: { "X-Api-Key": "key123" },
            timeout: 30000
          }
        }
      })
    );

    const provider = new LocalReviewConfigProvider();
    const config = provider.loadReviewConfig(fixture.repoDir);

    assert.equal(config.maxConcurrentFiles, 3);
    assert.deepEqual(config.mcpServers["local-tool"], {
      type: "local",
      command: "npx",
      args: ["-y", "@example/local-mcp"],
      cwd: "/opt/tools",
      timeout: 10000
    });
    assert.deepEqual(config.mcpServers["remote-tool"], {
      type: "http",
      url: "https://mcp.example.com/v1",
      headers: { "X-Api-Key": "key123" },
      timeout: 30000
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid remote MCP shapes before Step 0", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    // missing url
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: { bad: { type: "http", tools: ["*"] } }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // empty url
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: { bad: { type: "http", url: "", tools: ["*"] } }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // unparseable url
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: { bad: { type: "http", url: "not a url" } }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // non-http(s) protocol url
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: { bad: { type: "http", url: "ftp://mcp.example.com/v1" } }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // non-object headers (array)
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          bad: {
            type: "http",
            url: "https://mcp.example.com/v1",
            headers: ["Bearer tok"]
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // non-string headers value
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          bad: {
            type: "http",
            url: "https://mcp.example.com/v1",
            headers: { Auth: 123 }
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // string timeout
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          bad: {
            type: "http",
            url: "https://mcp.example.com/v1",
            timeout: "30000"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // non-integer timeout (float)
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          bad: { type: "http", url: "https://mcp.example.com/v1", timeout: 1.5 }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // zero timeout
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          bad: { type: "http", url: "https://mcp.example.com/v1", timeout: 0 }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // negative timeout
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          bad: {
            type: "http",
            url: "https://mcp.example.com/v1",
            timeout: -1000
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves local MCP entries with cwd and timeout and rejects invalid shapes", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    // valid local entry with cwd and timeout
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "node",
            args: ["server.js"],
            cwd: "/opt/mcp-servers/demo",
            timeout: 15000
          }
        }
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir), {
      maxConcurrentFiles: 5,
      confidenceThresholds: { must: 80, nice: 90 },
      mcpServers: {
        demo: {
          type: "local",
          command: "node",
          args: ["server.js"],
          cwd: "/opt/mcp-servers/demo",
          timeout: 15000
        }
      }
    });

    // valid local entry without cwd/timeout: those fields are absent
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"]
          }
        }
      })
    );
    const config = provider.loadReviewConfig(fixture.repoDir);
    assert.equal("cwd" in config.mcpServers.demo, false);
    assert.equal("timeout" in config.mcpServers.demo, false);

    // empty cwd
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            cwd: ""
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // non-string cwd
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            cwd: 123
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // string timeout
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            timeout: "15000"
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // non-integer timeout (float)
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            timeout: 1.5
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // zero timeout
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            timeout: 0
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // negative timeout
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "local",
            command: "npx",
            args: ["-y", "@example/demo-mcp"],
            timeout: -1000
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider normalizes type stdio to local for non-built-in entries", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    // non-built-in entry with type:stdio → resolved type is "local"
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          demo: {
            type: "stdio",
            command: "npx",
            args: ["-y", "@example/demo-mcp"]
          }
        }
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir).mcpServers, {
      demo: {
        type: "local",
        command: "npx",
        args: ["-y", "@example/demo-mcp"]
      }
    });
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider accepts same-name context7 override with type http or omitted and rejects unsupported types before Step 0", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            type: "http",
            tools: ["resolve-library-id"]
          }
        }
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir).mcpServers, {
      context7: {
        type: "http",
        tools: ["resolve-library-id"]
      }
    });

    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            timeout: 20000
          }
        }
      })
    );
    assert.deepEqual(provider.loadReviewConfig(fixture.repoDir).mcpServers, {
      context7: {
        type: "http",
        timeout: 20000
      }
    });

    // context7 with type:local
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            type: "local",
            tools: ["resolve-library-id"]
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // context7 with type:stdio
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            type: "stdio",
            tools: ["resolve-library-id"]
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );

    // context7 with type:sse
    fixture.writeFile(
      ".reviewconfig.json",
      JSON.stringify({
        mcpServers: {
          context7: {
            type: "sse",
            tools: ["resolve-library-id"]
          }
        }
      })
    );
    assert.throws(
      () => provider.loadReviewConfig(fixture.repoDir),
      /invalid review config/u
    );
  } finally {
    fixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects unrecognized MCP type values before Step 0", () => {
  const fixture = createReviewRepoFixture();

  try {
    const provider = new LocalReviewConfigProvider();

    for (const badType of ["remote", "memory", "grpc"]) {
      fixture.writeFile(
        ".reviewconfig.json",
        JSON.stringify({
          mcpServers: {
            demo: {
              type: badType,
              command: "npx",
              args: ["-y", "@example/demo-mcp"]
            }
          }
        })
      );
      assert.throws(
        () => provider.loadReviewConfig(fixture.repoDir),
        /invalid review config/u
      );
    }
  } finally {
    fixture.cleanup();
  }
});
