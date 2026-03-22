import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeSvc } from "../../src/services/knowledge.ts";
import { ReviewSessionFactory } from "../../src/services/review-session-factory.ts";

test("ReviewSessionFactory creates a non-streaming review session with a replaced system message and web_fetch enabled", async () => {
  const receivedConfigs = [];
  const factory = new ReviewSessionFactory({
    clientManager: {
      getClient() {
        return {
          async createSession(config) {
            receivedConfigs.push(config);
            return {
              async sendAndWait() {
                return {
                  type: "assistant.message",
                  data: { content: "ok" }
                };
              },
              async disconnect() {}
            };
          }
        };
      }
    }
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

  assert.deepEqual(receivedConfigs, [
    {
      hooks: receivedConfigs[0].hooks,
      model: "gpt-5.4-mini",
      streaming: false,
      onPermissionRequest: receivedConfigs[0].onPermissionRequest,
      systemMessage: {
        mode: "replace",
        content: "system prompt"
      },
      workingDirectory: "/workspace/repo"
    }
  ]);

  const permissionHandler = receivedConfigs[0].onPermissionRequest;

  assert.deepEqual(
    await permissionHandler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "session-1" }
    ),
    { kind: "approved" }
  );
  assert.deepEqual(
    await permissionHandler(
      { kind: "read", path: "/workspace/repo/packages/app/review/run/files/a.md" },
      { sessionId: "session-1" }
    ),
    { kind: "approved" }
  );
  assert.deepEqual(
    await permissionHandler(
      { kind: "read", path: "/tmp/secret.txt" },
      { sessionId: "session-1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );
  assert.deepEqual(
    await permissionHandler(
      { kind: "write", fileName: "/workspace/repo/src/app.ts" },
      { sessionId: "session-1" }
    ),
    { kind: "denied-no-approval-rule-and-could-not-request-from-user" }
  );

  const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://example.com/spec" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "/internal/path" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://[::ffff:127.0.0.1]/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://[::ffff:192.168.1.10]/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "example.com/docs" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "file:///etc/passwd" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://localhost:3000" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://192.168.1.10/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "http://[::1]/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for absolute public http(s) URLs."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git diff main...feature-branch --name-status" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "curl https://example.com" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "cat ../secret.txt" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "cat /etc/passwd" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "find / -name '*.ts'" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git checkout main" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git diff --output=/tmp/out main...feature-branch" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "bash",
        toolArgs: { command: "git show --output=/tmp/out HEAD" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason: "Review sessions only allow repo-local read-only bash analysis commands."
    }
  );
});

test("ReviewSessionFactory injects built-in Context7 by default for review sessions and still allows explicit disable", async () => {
  const receivedConfigs = [];
  const factory = new ReviewSessionFactory({
    clientManager: {
      getClient() {
        return {
          async createSession(config) {
            receivedConfigs.push(config);
            return {
              async sendAndWait() {
                return {
                  type: "assistant.message",
                  data: { content: "ok" }
                };
              },
              async disconnect() {}
            };
          }
        };
      }
    },
    knowledgeSvc: new KnowledgeSvc({
      context7ApiKey: "test-api-key",
      userMcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          tools: ["*"]
        },
        context7: {
          type: "local",
          env: {
            CUSTOM_FLAG: "1"
          },
          tools: ["resolve-library-id"]
        }
      }
    })
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "step0 system prompt",
    workingDirectory: "/workspace/repo"
  });
  await factory.createSession({
    model: "gpt-5-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "step1 system prompt",
    workingDirectory: "/workspace/repo"
  });
  await factory.createSession({
    model: "gpt-5-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "step3 system prompt",
    knowledgeMode: "built-in-context7",
    workingDirectory: "/workspace/repo"
  });
  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "step5 system prompt",
    workingDirectory: "/workspace/repo"
  });
  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "explicitly disabled system prompt",
    knowledgeMode: "disabled",
    workingDirectory: "/workspace/repo"
  });

  for (const config of receivedConfigs.slice(0, 4)) {
    assert.deepEqual(config?.mcpServers, {
      context7: {
        type: "local",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp"],
        env: {
          CONTEXT7_API_KEY: "test-api-key",
          CUSTOM_FLAG: "1"
        },
        tools: ["resolve-library-id"]
      },
      demo: {
        type: "local",
        command: "npx",
        args: ["-y", "@example/demo-mcp"],
        tools: ["*"]
      }
    });
  }

  assert.equal(receivedConfigs[4]?.mcpServers, undefined);
  assert.ok(receivedConfigs.every((config) => config.excludedTools === undefined));
});
