import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeSvc } from "../../src/services/knowledge.ts";

test("KnowledgeSvc returns built-in Context7 MCP config for the broader review-session knowledge mode", () => {
  const service = new KnowledgeSvc();

  assert.equal(service.getMcpServers("disabled"), undefined);
  assert.deepEqual(service.getMcpServers("built-in-context7"), {
    context7: {
      type: "local",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      tools: ["*"]
    }
  });
});

test("KnowledgeSvc passes through CONTEXT7_API_KEY only when configured", () => {
  const withApiKey = new KnowledgeSvc({
    context7ApiKey: "test-api-key"
  });
  const withoutApiKey = new KnowledgeSvc({
    context7ApiKey: undefined
  });

  assert.deepEqual(withApiKey.getMcpServers("built-in-context7"), {
    context7: {
      type: "local",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: {
        CONTEXT7_API_KEY: "test-api-key"
      },
      tools: ["*"]
    }
  });
  assert.deepEqual(withoutApiKey.getMcpServers("built-in-context7"), {
    context7: {
      type: "local",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      tools: ["*"]
    }
  });
});
