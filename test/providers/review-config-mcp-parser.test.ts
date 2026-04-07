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
        type: "http",
        timeout: 20000
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

test("resolveMcpServersFromConfigObject rejects invalid local MCP shapes with the stable error surface", () => {
  const invalidConfigs: Array<Record<string, unknown>> = [
    {
      mcpServers: {
        demo: {
          type: "local"
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: ""
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "   "
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: "--bad"
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          cwd: ""
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          cwd: 123
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          timeout: "15000"
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          timeout: 1.5
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          timeout: 0
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "local",
          command: "npx",
          timeout: -1000
        }
      }
    }
  ];

  for (const config of invalidConfigs) {
    assert.throws(
      () => resolveMcpServersFromConfigObject(config),
      /invalid review config/u
    );
  }
});

test("resolveMcpServersFromConfigObject rejects invalid remote MCP shapes with the stable error surface", () => {
  const invalidConfigs: Array<Record<string, unknown>> = [
    {
      mcpServers: {
        demo: {
          type: "remote",
          command: "npx"
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          tools: ["*"]
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: ""
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "not a url"
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "ftp://mcp.example.com/v1"
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "https://mcp.example.com/v1",
          headers: ["Bearer tok"]
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "https://mcp.example.com/v1",
          headers: {
            Authorization: 123
          }
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "https://mcp.example.com/v1",
          timeout: "30000"
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "https://mcp.example.com/v1",
          timeout: 1.5
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "https://mcp.example.com/v1",
          timeout: 0
        }
      }
    },
    {
      mcpServers: {
        demo: {
          type: "http",
          url: "https://mcp.example.com/v1",
          timeout: -1000
        }
      }
    }
  ];

  for (const config of invalidConfigs) {
    assert.throws(
      () => resolveMcpServersFromConfigObject(config),
      /invalid review config/u
    );
  }
});

test("resolveMcpServersFromConfigObject rejects invalid context7 override shapes with the stable error surface", () => {
  const invalidConfigs: Array<Record<string, unknown>> = [
    {
      mcpServers: {
        context7: {
          type: "sse",
          tools: ["resolve-library-id"]
        }
      }
    },
    {
      mcpServers: {
        context7: {
          headers: {
            Authorization: "Bearer repo-token"
          }
        }
      }
    },
    {
      mcpServers: {
        context7: {
          url: "https://context7.example.com/mcp"
        }
      }
    },
    {
      mcpServers: {
        context7: {
          command: "npx"
        }
      }
    }
  ];

  for (const config of invalidConfigs) {
    assert.throws(
      () => resolveMcpServersFromConfigObject(config),
      /invalid review config/u
    );
  }
});
