import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider resolves validated remote http and sse MCP entries alongside local entries and run-level settings", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
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

    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
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
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves validated remote sse MCP entry with headers and timeout", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
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

    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
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
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves valid mixed local and remote mcpServers coexisting with run-level settings", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
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
    });

    const config = configFixture.loadReviewConfig();

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
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid remote MCP shapes before Step 0", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      mcpServers: { bad: { type: "http", tools: ["*"] } }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: { bad: { type: "http", url: "", tools: ["*"] } }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: { bad: { type: "http", url: "not a url" } }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: { bad: { type: "http", url: "ftp://mcp.example.com/v1" } }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        bad: {
          type: "http",
          url: "https://mcp.example.com/v1",
          headers: ["Bearer tok"]
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        bad: {
          type: "http",
          url: "https://mcp.example.com/v1",
          headers: { Auth: 123 }
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        bad: {
          type: "http",
          url: "https://mcp.example.com/v1",
          timeout: "30000"
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        bad: { type: "http", url: "https://mcp.example.com/v1", timeout: 1.5 }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        bad: { type: "http", url: "https://mcp.example.com/v1", timeout: 0 }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        bad: { type: "http", url: "https://mcp.example.com/v1", timeout: -1000 }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects local MCP entry with command absent or blank before Step 0", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      mcpServers: { demo: { type: "local" } }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: { demo: { type: "local", command: "   " } }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider resolves local MCP entries with cwd and timeout and rejects invalid shapes", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
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
    assert.deepEqual(
      configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
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

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"]
        }
      }
    });
    const config = configFixture.loadReviewConfig();
    // Optional fields must be completely absent from the output object when
    // not specified — not present as undefined — to avoid surprising consumers.
    assert.equal("cwd" in config.mcpServers.demo, false);
    assert.equal("timeout" in config.mcpServers.demo, false);

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          cwd: ""
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          cwd: 123
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          timeout: "15000"
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          timeout: 1.5
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          timeout: 0
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          timeout: -1000
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
  } finally {
    configFixture.cleanup();
  }
});

// `stdio` is not in the recognised built-in set, so the provider passes it
// through as-is without applying type-specific validation. This allows
// forward-compatibility with SDK transports added after the parser was written.
test("LocalReviewConfigProvider passes through type stdio for non-built-in entries without normalization", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      mcpServers: {
        demo: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@example/demo-mcp"]
        }
      }
    });
    assert.deepEqual(configFixture.loadReviewConfig().mcpServers, {
      demo: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@example/demo-mcp"]
      }
    });
  } finally {
    configFixture.cleanup();
  }
});

// `context7` is the only built-in MCP server name. The provider treats it as
// an override config: type must be "http" or "context7" or omitted (defaults to "context7");
// local and sse types are rejected because the built-in Context7 integration
// only supports the HTTP transport.
test("LocalReviewConfigProvider accepts same-name context7 override with type http, context7, or omitted and rejects unsupported types before Step 0", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          type: "http",
          tools: ["resolve-library-id"]
        }
      }
    });
    assert.deepEqual(configFixture.loadReviewConfig().mcpServers, {
      context7: {
        type: "context7",
        tools: ["resolve-library-id"]
      }
    });

    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          timeout: 20000
        }
      }
    });
    assert.deepEqual(configFixture.loadReviewConfig().mcpServers, {
      context7: {
        type: "context7",
        timeout: 20000
      }
    });

    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          type: "local",
          tools: ["resolve-library-id"]
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          type: "stdio",
          tools: ["resolve-library-id"]
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);

    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          type: "sse",
          tools: ["resolve-library-id"]
        }
      }
    });
    assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects unrecognized MCP type values before Step 0", () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    for (const badType of ["remote", "memory", "grpc"]) {
      configFixture.writeReviewConfig({
        mcpServers: {
          demo: {
            type: badType,
            command: "npx",
            args: ["-y", "@example/demo-mcp"]
          }
        }
      });
      assert.throws(() => configFixture.loadReviewConfig(), /invalid review config/u);
    }
  } finally {
    configFixture.cleanup();
  }
});
