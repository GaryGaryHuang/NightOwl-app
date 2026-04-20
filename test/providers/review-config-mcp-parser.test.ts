import assert from "node:assert/strict";
import test from "node:test";

import { resolveMcpServersFromConfigObject } from "../../src/providers/config/review-config-mcp-parser.ts";

function assertMcpConfigError(input: {
  config: Record<string, unknown>;
  fieldOrValue?: string;
  serverName?: string;
}): void {
  assert.throws(
    () => resolveMcpServersFromConfigObject(input.config),
    (err: unknown) => {
      assert.ok(err instanceof Error);

      if (input.serverName) {
        assert.match(err.message, new RegExp(`mcpServers\\.${input.serverName}:`, "u"));
        assert.ok(err.cause instanceof Error);
      } else {
        assert.ok(err.message.includes("mcpServers"));
        assert.ok(!err.message.startsWith("mcpServers."));
      }

      if (input.fieldOrValue) {
        assert.ok(err.message.includes(input.fieldOrValue));
        if (err.cause instanceof Error) {
          assert.ok(err.cause.message.includes(input.fieldOrValue));
        }
      }

      return true;
    }
  );
}

test("resolveMcpServersFromConfigObject preserves current local and remote MCP parsing behavior", () => {
  const config = {
    mcpServers: {
      demo: {
        type: "local",
        command: "npx",
        args: ["-y", "@example/demo-mcp"],
        cwd: "/opt/tools",
        timeout: 10000
      },
      "legacy-stdio": {
        type: "stdio",
        command: "node",
        args: ["server.js"]
      },
      "remote-http": {
        type: "http",
        url: "https://mcp.example.com/v1",
        headers: { Authorization: "Bearer tok123" },
        tools: ["search"],
        timeout: 30000
      },
      "legacy-sse": {
        type: "sse",
        url: "https://sse.example.com/mcp",
        headers: { Authorization: "Bearer tok456" }
      }
    }
  } satisfies Record<string, unknown>;

  assert.deepEqual(resolveMcpServersFromConfigObject(config), {
    demo: {
      type: "local",
      command: "npx",
      args: ["-y", "@example/demo-mcp"],
      cwd: "/opt/tools",
      timeout: 10000
    },
    "legacy-stdio": {
      type: "stdio",
      command: "node",
      args: ["server.js"]
    },
    "remote-http": {
      type: "http",
      url: "https://mcp.example.com/v1",
      headers: { Authorization: "Bearer tok123" },
      tools: ["search"],
      timeout: 30000
    },
    "legacy-sse": {
      type: "sse",
      url: "https://sse.example.com/mcp",
      headers: { Authorization: "Bearer tok456" }
    }
  });
});

test("resolveMcpServersFromConfigObject preserves context7 override and omission semantics", () => {
  assert.deepEqual(
    resolveMcpServersFromConfigObject({
      mcpServers: {
        context7: {
          timeout: 20000
        }
      }
    }),
    {
      context7: {
        type: "context7",
        timeout: 20000
      }
    }
  );

  // type: "http" explicitly provided in config — must be accepted and normalized to "context7"
  assert.deepEqual(
    resolveMcpServersFromConfigObject({
      mcpServers: {
        context7: {
          type: "http",
          tools: ["resolve-library-id"],
          timeout: 10000
        }
      }
    }),
    {
      context7: {
        type: "context7",
        tools: ["resolve-library-id"],
        timeout: 10000
      }
    }
  );

  // type: "context7" explicitly provided in config — must also be accepted and normalized identically
  assert.deepEqual(
    resolveMcpServersFromConfigObject({
      mcpServers: {
        context7: {
          type: "context7",
          tools: ["resolve-library-id"]
        }
      }
    }),
    {
      context7: {
        type: "context7",
        tools: ["resolve-library-id"]
      }
    }
  );

  const resolved = resolveMcpServersFromConfigObject({
    mcpServers: {
      demo: {
        type: "local",
        command: "npx",
        args: ["-y", "@example/demo-mcp"]
      }
    }
  });

  assert.equal("cwd" in resolved.demo, false);
  assert.equal("timeout" in resolved.demo, false);
  assert.equal("tools" in resolved.demo, false);
});

test("resolveMcpServersFromConfigObject rejects invalid local MCP shapes with enriched error context", () => {
  const cases: Array<{ definition: Record<string, unknown>; fieldOrValue: string }> = [
    { definition: { type: "local" }, fieldOrValue: "command" },
    { definition: { type: "local", command: "" }, fieldOrValue: "command" },
    { definition: { type: "local", command: "   " }, fieldOrValue: "command" },
    {
      definition: { type: "local", command: "npx", args: "--bad" },
      fieldOrValue: "args"
    },
    {
      definition: { type: "local", command: "npx", env: ["not-a-record"] },
      fieldOrValue: "env"
    },
    {
      definition: { type: "local", command: "npx", tools: "single-string" },
      fieldOrValue: "tools"
    },
    { definition: { type: "local", command: "npx", cwd: "" }, fieldOrValue: "cwd" },
    { definition: { type: "local", command: "npx", cwd: 123 }, fieldOrValue: "cwd" },
    {
      definition: { type: "local", command: "npx", timeout: "15000" },
      fieldOrValue: "timeout"
    },
    { definition: { type: "local", command: "npx", timeout: 1.5 }, fieldOrValue: "timeout" },
    { definition: { type: "local", command: "npx", timeout: 0 }, fieldOrValue: "timeout" },
    { definition: { type: "local", command: "npx", timeout: -1000 }, fieldOrValue: "timeout" }
  ];

  for (const { definition, fieldOrValue } of cases) {
    assertMcpConfigError({
      config: { mcpServers: { demo: definition } },
      fieldOrValue,
      serverName: "demo"
    });
  }
});

test("resolveMcpServersFromConfigObject rejects invalid remote MCP shapes with enriched error context", () => {
  const cases: Array<{ definition: Record<string, unknown>; fieldOrValue: string }> = [
    { definition: { type: "remote", command: "npx" }, fieldOrValue: "remote" },
    { definition: { type: "http", tools: ["*"] }, fieldOrValue: "url" },
    { definition: { type: "http", url: "" }, fieldOrValue: "url" },
    { definition: { type: "http", url: "not a url" }, fieldOrValue: "url" },
    {
      definition: { type: "http", url: "ftp://mcp.example.com/v1" },
      fieldOrValue: "url"
    },
    {
      definition: {
        type: "http",
        url: "https://mcp.example.com/v1",
        headers: ["Bearer tok"]
      },
      fieldOrValue: "headers"
    },
    {
      definition: {
        type: "http",
        url: "https://mcp.example.com/v1",
        headers: { Authorization: 123 }
      },
      fieldOrValue: "headers"
    },
    {
      definition: { type: "http", url: "https://mcp.example.com/v1", timeout: "30000" },
      fieldOrValue: "timeout"
    },
    {
      definition: { type: "http", url: "https://mcp.example.com/v1", timeout: 1.5 },
      fieldOrValue: "timeout"
    },
    {
      definition: { type: "http", url: "https://mcp.example.com/v1", timeout: 0 },
      fieldOrValue: "timeout"
    },
    {
      definition: { type: "http", url: "https://mcp.example.com/v1", timeout: -1000 },
      fieldOrValue: "timeout"
    }
  ];

  for (const { definition, fieldOrValue } of cases) {
    assertMcpConfigError({
      config: { mcpServers: { demo: definition } },
      fieldOrValue,
      serverName: "demo"
    });
  }
});

test("resolveMcpServersFromConfigObject rejects invalid context7 override boundaries with enriched error context", () => {
  const cases: Array<{ definition: Record<string, unknown>; fieldOrValue: string }> = [
    { definition: { type: "sse", tools: ["resolve-library-id"] }, fieldOrValue: "type" },
    { definition: { headers: { Authorization: "Bearer repo-token" } }, fieldOrValue: "headers" },
    { definition: { url: "https://context7.example.com/mcp" }, fieldOrValue: "url" },
    { definition: { command: "npx" }, fieldOrValue: "command" },
    { definition: { authToken: "secret" }, fieldOrValue: "authToken" },
    { definition: { tools: ["valid", 123] }, fieldOrValue: "tools" },
    { definition: { timeout: "20000" }, fieldOrValue: "timeout" }
  ];

  for (const { definition, fieldOrValue } of cases) {
    assertMcpConfigError({
      config: { mcpServers: { context7: definition } },
      fieldOrValue,
      serverName: "context7"
    });
  }
});

test("resolveMcpServersFromConfigObject rejects shape-level errors with appropriate context", () => {
  assertMcpConfigError({
    config: { mcpServers: "not-an-object" }
  });
  assertMcpConfigError({
    config: { mcpServers: { demo: "invalid" } },
    serverName: "demo"
  });
});
