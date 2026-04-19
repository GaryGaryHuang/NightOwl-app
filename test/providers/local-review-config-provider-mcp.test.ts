import assert from "node:assert/strict";
import test from "node:test";

import { ReviewConfigProviderError } from "../../src/providers/config/review-config-provider.ts";
import {
  buildExpectedReviewConfig,
  createReviewConfigProviderFixture
} from "../helpers/review-config-provider-contract-fixture.ts";

test("LocalReviewConfigProvider applies the MCP parser to the repo-local mcpServers block and returns the merged config", async () => {
  const configFixture = createReviewConfigProviderFixture();

  try {
    configFixture.writeReviewConfig({
      mcpServers: {
        context7: {
          type: "http",
          tools: ["resolve-library-id"],
          timeout: 20000
        },
        "local-tool": {
          type: "local",
          command: "npx",
          args: ["-y", "@example/local-mcp"]
        }
      }
    });

    assert.deepEqual(
      await configFixture.loadReviewConfig(),
      buildExpectedReviewConfig({
        mcpServers: {
          context7: {
            type: "context7",
            tools: ["resolve-library-id"],
            timeout: 20000
          },
          "local-tool": {
            type: "local",
            command: "npx",
            args: ["-y", "@example/local-mcp"]
          }
        }
      })
    );
  } finally {
    configFixture.cleanup();
  }
});

test("LocalReviewConfigProvider wraps MCP parser errors in ReviewConfigProviderError tagged with the canonical config path", async () => {
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
