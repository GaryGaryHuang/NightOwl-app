import assert from "node:assert/strict";
import test from "node:test";

import { resolveMcpServersFromConfigObject } from "../../src/providers/config/review-config-mcp-parser.ts";

function assertMcpConfigError(input: {
  config: Record<string, unknown>;
  expectedMessage: string;
  serverName?: string;
}): void {
  assert.throws(
    () => resolveMcpServersFromConfigObject(input.config),
    (error: unknown) => {
      assert.ok(error instanceof Error);

      if (input.serverName) {
        assert.match(error.message, new RegExp(`mcpServers\\.${input.serverName}:`, "u"));
        assert.ok(error.cause instanceof Error);
      } else {
        assert.ok(error.message.includes("mcpServers"));
      }

      assert.match(error.message, new RegExp(input.expectedMessage, "u"));
      return true;
    }
  );
}

test("resolveMcpServersFromConfigObject preserves representative local, remote, and context7 behavior", () => {
  assert.deepEqual(
    resolveMcpServersFromConfigObject({
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"]
        },
        "legacy-stdio": {
          type: "stdio",
          command: "node",
          args: ["server.js"]
        },
        remote: {
          type: "http",
          url: "https://mcp.example.com/v1",
          headers: { Authorization: "Bearer tok123" },
          tools: ["search"]
        },
        "legacy-sse": {
          type: "sse",
          url: "https://sse.example.com/mcp",
          headers: { Authorization: "Bearer tok456" }
        },
        context7: {
          type: "http",
          tools: ["resolve-library-id"],
          timeout: 10000
        }
      }
    }),
    {
      demo: {
        type: "local",
        command: "npx",
        args: ["-y", "@example/demo-mcp"]
      },
      "legacy-stdio": {
        type: "stdio",
        command: "node",
        args: ["server.js"]
      },
      remote: {
        type: "http",
        url: "https://mcp.example.com/v1",
        headers: { Authorization: "Bearer tok123" },
        tools: ["search"]
      },
      "legacy-sse": {
        type: "sse",
        url: "https://sse.example.com/mcp",
        headers: { Authorization: "Bearer tok456" }
      },
      context7: {
        type: "context7",
        tools: ["resolve-library-id"],
        timeout: 10000
      }
    }
  );
});

test("resolveMcpServersFromConfigObject rejects invalid container shapes with the correct context", () => {
  assertMcpConfigError({
    config: { mcpServers: "not-an-object" },
    expectedMessage: "mcpServers"
  });
  assertMcpConfigError({
    config: { mcpServers: { demo: "invalid" } },
    expectedMessage: "entry definition must be a plain object",
    serverName: "demo"
  });
});

test("resolveMcpServersFromConfigObject rejects invalid local entries with server-scoped context", () => {
  assertMcpConfigError({
    config: {
      mcpServers: {
        demo: {
          type: "local",
          command: "",
          timeout: 1000
        }
      }
    },
    expectedMessage: "command",
    serverName: "demo"
  });
  assertMcpConfigError({
    config: {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          timeOut: 1000
        }
      }
    },
    expectedMessage: "timeOut",
    serverName: "demo"
  });
});

test("resolveMcpServersFromConfigObject rejects invalid remote entries with server-scoped context", () => {
  assertMcpConfigError({
    config: {
      mcpServers: {
        demo: {
          type: "http",
          url: "ftp://mcp.example.com/v1"
        }
      }
    },
    expectedMessage: "url",
    serverName: "demo"
  });
  assertMcpConfigError({
    config: {
      mcpServers: {
        demo: {
          type: "sse",
          url: "https://mcp.example.com/v1",
          command: "npx"
        }
      }
    },
    expectedMessage: "command",
    serverName: "demo"
  });
});

test("resolveMcpServersFromConfigObject rejects invalid context7 overrides with server-scoped context", () => {
  assertMcpConfigError({
    config: {
      mcpServers: {
        context7: {
          type: "sse",
          tools: ["resolve-library-id"]
        }
      }
    },
    expectedMessage: "type",
    serverName: "context7"
  });
  assertMcpConfigError({
    config: {
      mcpServers: {
        context7: {
          url: "https://context7.example.com/mcp"
        }
      }
    },
    expectedMessage: "url",
    serverName: "context7"
  });
});
