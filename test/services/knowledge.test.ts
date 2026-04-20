import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeConfigError, KnowledgeSvc } from "../../src/services/knowledge.ts";
import {
  createContext7Override,
  createLocalMcpServer,
  createRemoteMcpServer
} from "../helpers/review-session-runtime-contract-fixture.ts";

const BUILT_IN_CONTEXT7_BASE = {
  type: "http",
  url: "https://mcp.context7.com/mcp",
  tools: ["*"]
} as const;

function getBuiltInContext7Servers(service: KnowledgeSvc) {
  const merged = service.getMcpServers("built-in-context7");

  assert.ok(merged);
  return merged;
}

test("KnowledgeSvc disables MCP injection outside built-in-context7 mode regardless of configured servers", () => {
  const emptyService = new KnowledgeSvc();
  const configuredService = new KnowledgeSvc({
    userMcpServers: {
      demo: createLocalMcpServer(),
      "my-remote": createRemoteMcpServer({ tools: undefined })
    }
  });

  assert.deepEqual(emptyService.getMcpServers("disabled"), {});
  assert.deepEqual(configuredService.getMcpServers("disabled"), {});
});

test("KnowledgeSvc returns the built-in Context7 base and appends non-context7 custom entries", () => {
  const withCustomLocal = new KnowledgeSvc({
    userMcpServers: {
      demo: createLocalMcpServer()
    }
  });

  const merged = getBuiltInContext7Servers(withCustomLocal);
  assert.deepEqual(merged.context7, BUILT_IN_CONTEXT7_BASE);
  assert.deepEqual(merged.demo, createLocalMcpServer());
});

// When a user provides a context7 key in mcpServers, it is treated as a
// partial override: scalar fields merge onto the built-in base config, but
// array-valued fields (like `tools`) replace the built-in default entirely.
test("KnowledgeSvc applies supported Context7 constructor and repo-local overrides onto the fixed built-in base", () => {
  const cases = [
    {
      name: "keeps the default built-in base when no overrides are configured",
      service: new KnowledgeSvc({ context7ApiKey: undefined }),
      expected: BUILT_IN_CONTEXT7_BASE
    },
    {
      name: "injects CONTEXT7_API_KEY only when configured",
      service: new KnowledgeSvc({
        context7ApiKey: "test-api-key"
      }),
      expected: {
        ...BUILT_IN_CONTEXT7_BASE,
        headers: {
          CONTEXT7_API_KEY: "test-api-key"
        }
      }
    },
    {
      name: "replaces tools and merges timeout for a supported context7 override",
      service: new KnowledgeSvc({
        context7ApiKey: "built-in-key",
        userMcpServers: {
          context7: createContext7Override({
            tools: ["resolve-library-id"],
            timeout: 20000
          })
        }
      }),
      expected: {
        ...BUILT_IN_CONTEXT7_BASE,
        headers: {
          CONTEXT7_API_KEY: "built-in-key"
        },
        tools: ["resolve-library-id"],
        timeout: 20000
      }
    },
    {
      name: "preserves the fixed built-in URL when only timeout is overridden",
      service: new KnowledgeSvc({
        userMcpServers: {
          context7: createContext7Override({
            timeout: 20000
          })
        }
      }),
      expected: {
        ...BUILT_IN_CONTEXT7_BASE,
        timeout: 20000
      }
    }
  ] as const;

  for (const testCase of cases) {
    const merged = getBuiltInContext7Servers(testCase.service);
    assert.deepEqual(merged.context7, testCase.expected, testCase.name);
  }
});

test("KnowledgeSvc normalizes remote custom entries independently of the built-in Context7 server", () => {
  const service = new KnowledgeSvc({
    userMcpServers: {
      "my-remote": createRemoteMcpServer(),
      "auth-mcp": {
        type: "sse",
        url: "https://sse.example.com/mcp",
        headers: { Authorization: "Bearer tok" },
        tools: ["search"],
        timeout: 60000
      },
      "no-tools": createRemoteMcpServer({ tools: undefined }),
      demo: createLocalMcpServer()
    }
  });

  const merged = getBuiltInContext7Servers(service);

  assert.deepEqual(merged["my-remote"], createRemoteMcpServer());
  assert.deepEqual(merged["auth-mcp"], {
    type: "sse",
    url: "https://sse.example.com/mcp",
    headers: { Authorization: "Bearer tok" },
    tools: ["search"],
    timeout: 60000
  });
  assert.deepEqual(merged["no-tools"], {
    type: "http",
    url: "https://mcp.example.com/v1",
    tools: ["*"]
  });
  assert.deepEqual(merged.demo, createLocalMcpServer());
});

test("KnowledgeSvc preserves supported local custom entry fields across local and stdio variants", () => {
  const cases = [
    {
      name: "local with cwd and timeout",
      input: createLocalMcpServer({
        command: "node",
        args: ["server.js"],
        cwd: "/opt/mcp-servers/demo",
        timeout: 15000
      }),
      expected: {
        type: "local",
        command: "node",
        args: ["server.js"],
        tools: ["*"],
        cwd: "/opt/mcp-servers/demo",
        timeout: 15000
      }
    },
    {
      name: "stdio without additional normalization",
      input: createLocalMcpServer({
        type: "stdio"
      }),
      expected: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@example/demo-mcp"],
        tools: ["*"]
      }
    },
    {
      name: "stdio with cwd and timeout",
      input: createLocalMcpServer({
        type: "stdio",
        command: "node",
        args: ["server.js"],
        cwd: "/opt/mcp-servers/demo",
        timeout: 15000
      }),
      expected: {
        type: "stdio",
        command: "node",
        args: ["server.js"],
        tools: ["*"],
        cwd: "/opt/mcp-servers/demo",
        timeout: 15000
      }
    }
  ] as const;

  for (const testCase of cases) {
    const service = new KnowledgeSvc({
      userMcpServers: {
        demo: testCase.input
      }
    });
    const merged = getBuiltInContext7Servers(service);

    assert.deepEqual(merged.demo, testCase.expected, testCase.name);
  }
});

// --- Early validation (fail-fast at construction time) ---

test("KnowledgeSvc constructor throws KnowledgeConfigError for invalid context7 override shape", () => {
  assert.throws(
    () =>
      new KnowledgeSvc({
        userMcpServers: {
          context7: createRemoteMcpServer() as never
        }
      }),
    (err: unknown) => {
      assert.ok(err instanceof KnowledgeConfigError);
      assert.equal(err.name, "KnowledgeConfigError");
      assert.match(err.message, /context7 override must use the built-in remote override shape/);
      return true;
    }
  );
});

test("KnowledgeSvc constructor throws KnowledgeConfigError for invalid custom MCP shape", () => {
  const invalidConfig = { type: "unknown", command: "nope" } as never;

  assert.throws(
    () =>
      new KnowledgeSvc({
        userMcpServers: {
          "bad-mcp": invalidConfig
        }
      }),
    (err: unknown) => {
      assert.ok(err instanceof KnowledgeConfigError);
      assert.equal(err.name, "KnowledgeConfigError");
      assert.match(err.message, /custom MCP 'bad-mcp' must use a local or remote MCP shape/);
      return true;
    }
  );
});
