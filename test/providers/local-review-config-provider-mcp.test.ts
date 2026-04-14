import assert from "node:assert/strict";
import test from "node:test";

import { ReviewConfigProviderError } from "../../src/providers/review-config-provider.ts";
import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider loads supported MCP transport variants from repo-local config", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      maxConcurrentFiles: 3,
      confidenceThresholds: { must: 70, nice: 85 },
      mcpServers: {
        context7: {
          type: "http",
          tools: ["resolve-library-id"],
          timeout: 20000
        },
        "local-tool": {
          type: "local",
          command: "npx",
          args: ["-y", "@example/local-mcp"],
          env: { MCP_MODE: "test" },
          tools: ["*"],
          cwd: "/opt/tools",
          timeout: 10000
        },
        "stdio-tool": {
          type: "stdio",
          command: "node",
          args: ["server.js"]
        },
        "remote-http": {
          type: "http",
          url: "https://mcp.example.com/v1",
          headers: { "X-Api-Key": "key123" },
          tools: ["search"],
          timeout: 30000
        },
        "legacy-sse": {
          type: "sse",
          url: "https://sse.example.com/mcp",
          headers: { Authorization: "Bearer tok123" }
        }
      }
    });

    assert.deepEqual(
      await configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        maxConcurrentFiles: 3,
        confidenceThresholds: { must: 70, nice: 85 },
        mcpServers: {
          context7: {
            type: "context7",
            tools: ["resolve-library-id"],
            timeout: 20000
          },
          "local-tool": {
            type: "local",
            command: "npx",
            args: ["-y", "@example/local-mcp"],
            env: { MCP_MODE: "test" },
            tools: ["*"],
            cwd: "/opt/tools",
            timeout: 10000
          },
          "stdio-tool": {
            type: "stdio",
            command: "node",
            args: ["server.js"]
          },
          "remote-http": {
            type: "http",
            url: "https://mcp.example.com/v1",
            headers: { "X-Api-Key": "key123" },
            tools: ["search"],
            timeout: 30000
          },
          "legacy-sse": {
            type: "sse",
            url: "https://sse.example.com/mcp",
            headers: { Authorization: "Bearer tok123" }
          }
        }
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider rejects invalid repo-local MCP config before Step 0", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          url: "https://context7.example.com/mcp"
        }
      }
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
