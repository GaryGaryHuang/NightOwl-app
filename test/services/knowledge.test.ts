import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeSvc } from "../../src/services/knowledge.ts";

test("KnowledgeSvc returns built-in Context7 MCP config for the broader review-session knowledge mode", () => {
  const service = new KnowledgeSvc();

  assert.equal(service.getMcpServers("disabled"), undefined);
  assert.deepEqual(service.getMcpServers("built-in-context7"), {
    context7: {
      type: "http",
      url: "https://mcp.context7.com/mcp",
      tools: ["*"]
    }
  });
});

test("KnowledgeSvc appends non-built-in custom MCP entries alongside built-in context7", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      demo: {
        type: "local",
        command: "npx",
        args: ["-y", "@example/demo-mcp"],
        tools: ["*"]
      }
    }
  });

  assert.deepEqual(service.getMcpServers("built-in-context7"), {
    context7: {
      type: "http",
      url: "https://mcp.context7.com/mcp",
      tools: ["*"]
    },
    demo: {
      type: "local",
      command: "npx",
      args: ["-y", "@example/demo-mcp"],
      tools: ["*"]
    }
  });
});

test("KnowledgeSvc merges supported partial context7 overrides and replaces array-valued fields", () => {
  const service = new KnowledgeSvc({
    context7ApiKey: "built-in-key",
    userMcpServers: {
      context7: {
        type: "http",
        tools: ["resolve-library-id"],
        timeout: 20000
      }
    }
  });

  assert.deepEqual(service.getMcpServers("built-in-context7"), {
    context7: {
      type: "http",
      url: "https://mcp.context7.com/mcp",
      headers: {
        CONTEXT7_API_KEY: "built-in-key",
      },
      tools: ["resolve-library-id"],
      timeout: 20000
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
      type: "http",
      url: "https://mcp.context7.com/mcp",
      headers: {
        CONTEXT7_API_KEY: "test-api-key"
      },
      tools: ["*"]
    }
  });
  assert.deepEqual(withoutApiKey.getMcpServers("built-in-context7"), {
    context7: {
      type: "http",
      url: "https://mcp.context7.com/mcp",
      tools: ["*"]
    }
  });
});

test("KnowledgeSvc appends remote MCP entries as independent MCPRemoteServerConfig alongside built-in context7", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      "my-remote": {
        type: "http",
        url: "https://mcp.example.com/v1",
        tools: ["*"]
      },
      "auth-mcp": {
        type: "sse",
        url: "https://sse.example.com/mcp",
        headers: { Authorization: "Bearer tok" },
        tools: ["search"],
        timeout: 60000
      },
      demo: {
        type: "local",
        command: "npx",
        args: ["-y", "@example/demo-mcp"],
        tools: ["*"]
      }
    }
  });

  const merged = service.getMcpServers("built-in-context7");

  assert.ok(merged);
  assert.deepEqual(merged.context7, {
    type: "http",
    url: "https://mcp.context7.com/mcp",
    tools: ["*"]
  });
  assert.deepEqual(merged["my-remote"], {
    type: "http",
    url: "https://mcp.example.com/v1",
    tools: ["*"]
  });
  assert.deepEqual(merged["auth-mcp"], {
    type: "sse",
    url: "https://sse.example.com/mcp",
    headers: { Authorization: "Bearer tok" },
    tools: ["search"],
    timeout: 60000
  });
  assert.deepEqual(merged.demo, {
    type: "local",
    command: "npx",
    args: ["-y", "@example/demo-mcp"],
    tools: ["*"]
  });
});

test("KnowledgeSvc defaults tools to [\"*\"] for remote entries without tools", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      "no-tools": {
        type: "http",
        url: "https://mcp.example.com/v1"
      }
    }
  });

  const merged = service.getMcpServers("built-in-context7");

  assert.ok(merged);
  assert.deepEqual(merged["no-tools"], {
    type: "http",
    url: "https://mcp.example.com/v1",
    tools: ["*"]
  });
});

test("KnowledgeSvc merges context7 timeout override onto the built-in remote base while preserving the fixed URL", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      context7: {
        type: "http",
        timeout: 20000
      }
    }
  });

  const merged = service.getMcpServers("built-in-context7");

  assert.ok(merged);
  assert.deepEqual(merged.context7, {
    type: "http",
    url: "https://mcp.context7.com/mcp",
    tools: ["*"],
    timeout: 20000
  });
});

test("KnowledgeSvc passes through cwd and timeout for local custom entries", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      demo: {
        type: "local",
        command: "node",
        args: ["server.js"],
        cwd: "/opt/mcp-servers/demo",
        timeout: 15000
      }
    }
  });

  const merged = service.getMcpServers("built-in-context7");

  assert.ok(merged);
  assert.deepEqual(merged.demo, {
    type: "local",
    command: "node",
    args: ["server.js"],
    tools: ["*"],
    cwd: "/opt/mcp-servers/demo",
    timeout: 15000
  });
});

test("KnowledgeSvc passes through type stdio for local custom entries without normalization", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      demo: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@example/demo-mcp"],
        tools: ["*"]
      }
    }
  });

  const merged = service.getMcpServers("built-in-context7");

  assert.ok(merged);
  assert.deepEqual(merged.demo, {
    type: "stdio",
    command: "npx",
    args: ["-y", "@example/demo-mcp"],
    tools: ["*"]
  });
});

test("KnowledgeSvc passes through type stdio with cwd and timeout for local custom entries", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      demo: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        cwd: "/opt/mcp-servers/demo",
        timeout: 15000,
        tools: ["*"]
      }
    }
  });

  const merged = service.getMcpServers("built-in-context7");

  assert.ok(merged);
  assert.deepEqual(merged.demo, {
    type: "stdio",
    command: "node",
    args: ["server.js"],
    tools: ["*"],
    cwd: "/opt/mcp-servers/demo",
    timeout: 15000
  });
});

test("KnowledgeSvc returns undefined for disabled mode even with remote entries", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      "my-remote": {
        type: "http",
        url: "https://mcp.example.com/v1"
      }
    }
  });

  assert.equal(service.getMcpServers("disabled"), undefined);
});
