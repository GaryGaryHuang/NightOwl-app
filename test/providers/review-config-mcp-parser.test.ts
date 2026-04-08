import assert from "node:assert/strict";
import test from "node:test";

import { resolveMcpServersFromConfigObject } from "../../src/providers/review-config-mcp-parser.ts";

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
  // missing command → field: command
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("command"));
      return true;
    }
  );

  // empty command → field: command
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("command"));
      return true;
    }
  );

  // blank command → field: command
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "   " } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("command"));
      return true;
    }
  );

  // invalid args type → field: args
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", args: "--bad" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("args"));
      return true;
    }
  );

  // invalid env type (array instead of record) → field: env
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", env: ["not-a-record"] } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("env"));
      return true;
    }
  );

  // invalid tools type (string instead of array) → field: tools
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", tools: "single-string" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("tools"));
      return true;
    }
  );

  // empty cwd → field: cwd
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", cwd: "" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("cwd"));
      return true;
    }
  );

  // non-string cwd → field: cwd
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", cwd: 123 } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("cwd"));
      return true;
    }
  );

  // string timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", timeout: "15000" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );

  // float timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", timeout: 1.5 } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );

  // zero timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", timeout: 0 } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );

  // negative timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "local", command: "npx", timeout: -1000 } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );
});

test("resolveMcpServersFromConfigObject rejects invalid remote MCP shapes with enriched error context", () => {
  // unknown type → type value in message
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "remote", command: "npx" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("remote"));
      return true;
    }
  );

  // missing url → field: url
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", tools: ["*"] } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("url"));
      return true;
    }
  );

  // empty url → field: url
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("url"));
      return true;
    }
  );

  // invalid url → field: url
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "not a url" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("url"));
      return true;
    }
  );

  // non-http protocol → field: url
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "ftp://mcp.example.com/v1" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("url"));
      return true;
    }
  );

  // invalid headers (array) → field: headers
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "https://mcp.example.com/v1", headers: ["Bearer tok"] } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("headers"));
      return true;
    }
  );

  // invalid headers value type → field: headers
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "https://mcp.example.com/v1", headers: { Authorization: 123 } } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("headers"));
      return true;
    }
  );

  // string timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "https://mcp.example.com/v1", timeout: "30000" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );

  // float timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "https://mcp.example.com/v1", timeout: 1.5 } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );

  // zero timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "https://mcp.example.com/v1", timeout: 0 } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );

  // negative timeout → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: { type: "http", url: "https://mcp.example.com/v1", timeout: -1000 } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );
});

test("resolveMcpServersFromConfigObject rejects invalid context7 override shapes with enriched error context", () => {
  // wrong type value
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { context7: { type: "sse", tools: ["resolve-library-id"] } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.context7:/u);
      assert.ok(err.message.includes("type"));
      return true;
    }
  );

  // unknown field: headers → rejected by allowlist, names the field
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { context7: { headers: { Authorization: "Bearer repo-token" } } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.context7:/u);
      assert.ok(err.message.includes("headers"));
      return true;
    }
  );

  // unknown field: url → rejected by allowlist, names the field
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { context7: { url: "https://context7.example.com/mcp" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.context7:/u);
      assert.ok(err.message.includes("url"));
      return true;
    }
  );

  // unknown field: command → rejected by allowlist, names the field
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { context7: { command: "npx" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.context7:/u);
      assert.ok(err.message.includes("command"));
      return true;
    }
  );
});

test("resolveMcpServersFromConfigObject rejects context7 allowlist boundary with enriched error context", () => {
  // unknown field: authToken → rejected by allowlist, names the field
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { context7: { authToken: "secret" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.context7:/u);
      assert.ok(err.message.includes("authToken"));
      return true;
    }
  );

  // invalid tools value → field: tools
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { context7: { tools: ["valid", 123] } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.context7:/u);
      assert.ok(err.message.includes("tools"));
      return true;
    }
  );

  // invalid timeout value → field: timeout
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { context7: { timeout: "20000" } } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.context7:/u);
      assert.ok(err.message.includes("timeout"));
      return true;
    }
  );
});

test("resolveMcpServersFromConfigObject rejects shape-level errors with appropriate context", () => {
  // mcpServers not a plain object → pre-loop, no server name
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: "not-an-object" }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("mcpServers"));
      assert.ok(!err.message.startsWith("mcpServers."));
      return true;
    }
  );

  // entry definition not a plain object → includes server name
  assert.throws(
    () => resolveMcpServersFromConfigObject({ mcpServers: { demo: "invalid" } }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /mcpServers\.demo:/u);
      return true;
    }
  );
});

