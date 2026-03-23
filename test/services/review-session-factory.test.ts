import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { KnowledgeSvc } from "../../src/services/knowledge.ts";
import { ReviewSessionFactory } from "../../src/services/review-session-factory.ts";

type RecordedReviewSessionConfig = SessionConfig & {
  hooks: NonNullable<SessionConfig["hooks"]> & {
    onPreToolUse: NonNullable<
      NonNullable<SessionConfig["hooks"]>["onPreToolUse"]
    >;
  };
};

function createRecordedConfigs(): RecordedReviewSessionConfig[] {
  return [];
}

function assertRecordedReviewSessionConfig(
  config: SessionConfig
): asserts config is RecordedReviewSessionConfig {
  assert.ok(config.hooks);
  assert.ok(config.hooks.onPreToolUse);
}

function createRecordingClientManager(
  recordedConfigs: RecordedReviewSessionConfig[]
) {
  return {
    getClient() {
      return {
        async createSession(config: SessionConfig) {
          assertRecordedReviewSessionConfig(config);
          recordedConfigs.push(config);

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
  };
}

test("ReviewSessionFactory creates a non-streaming review session with a replaced system message and web_fetch enabled", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs)
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

test("ReviewSessionFactory enforces exact-host web_fetch allowlist when configured", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchAllowedHosts: ["docs.example.com"]
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

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
        toolArgs: { url: "https://Docs.Example.Com/reference" }
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
        toolArgs: { url: "https://docs.example.com./guide" }
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
        toolArgs: { url: "https://docs.example.com:8443/guide" }
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
        toolArgs: { url: "https://react.dev/reference" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://sub.docs.example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("ReviewSessionFactory denies all web_fetch hosts when configured allowlist is empty", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchAllowedHosts: []
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

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
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("ReviewSessionFactory injects built-in Context7 by default for review sessions and still allows explicit disable", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
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

test("ReviewSessionFactory enforces wildcard subdomain web_fetch allowlist matching", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchAllowedHosts: ["*.example.com"]
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt"
  });

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
        toolArgs: { url: "https://api.docs.example.com/v2/ref" }
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
        toolArgs: { url: "https://example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://DOCS.example.com/guide" }
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
        toolArgs: { url: "https://docs.example.com./guide" }
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
        toolArgs: { url: "https://docs.example.com:8443/guide" }
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
        toolArgs: { url: "https://react.dev/reference" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("ReviewSessionFactory enforces mixed exact-host and wildcard web_fetch allowlist via OR logic", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchAllowedHosts: ["react.dev", "*.example.com"]
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo/packages/app",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt"
  });

  const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://react.dev/reference" }
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
        toolArgs: { url: "https://api.docs.example.com/v2/ref" }
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
        toolArgs: { url: "https://vuejs.org/guide" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://example.com/guide" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

// ── Denylist runtime semantics TDD (tasks 3.1–3.4) ────────────────────────────

test("ReviewSessionFactory enforces deny-over-allow semantics when denylist is configured", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com"]
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

  const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

  // exact-host deny blocks allowlisted host
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  // non-denied host under same wildcard is still allowed
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
});

test("ReviewSessionFactory enforces wildcard denylist blocking and bare-domain exclusion", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["*.internal.example.com"]
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

  const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

  // wildcard deny blocks matching subdomain
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://api.internal.example.com/v2" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  // wildcard deny blocks deep subdomain
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://deep.api.internal.example.com/v2" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  // wildcard deny does NOT block bare domain of denylist base
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com/page" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );
});

test("ReviewSessionFactory enforces denylist comparison rules: case-insensitive, trailing-dot, port exclusion", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchAllowedHosts: ["*.example.com"],
    webFetchDeniedHosts: ["internal.example.com"]
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

  const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

  // case-insensitive
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://INTERNAL.example.com/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  // trailing-dot canonicalization
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com./admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  // port exclusion from comparison
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://internal.example.com:8443/admin" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );
});

test("ReviewSessionFactory enforces denylist-only (no allowlist): denied host blocked, non-denied public host allowed", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    webFetchDeniedHosts: ["evil.com"]
  });

  await factory.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

  const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

  // denied host blocked (baseline space)
  assert.deepEqual(
    await preToolUse(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://evil.com/payload" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  // wildcard denylist-only blocks matching subdomain
  const receivedConfigs2 = createRecordedConfigs();
  const factory2 = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs2),
    webFetchDeniedHosts: ["*.evil.com"]
  });

  await factory2.createSession({
    model: "gpt-5.4-mini",
    outputBaseDir: "/workspace/repo",
    repoRoot: "/workspace/repo",
    systemMessage: "system prompt",
    workingDirectory: "/workspace/repo"
  });

  const preToolUse2 = receivedConfigs2[0].hooks.onPreToolUse;

  assert.deepEqual(
    await preToolUse2(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://sub.evil.com/payload" }
      },
      { sessionId: "session-1" }
    ),
    {
      permissionDecision: "deny",
      permissionDecisionReason:
        "Review sessions only allow web_fetch for configured public http(s) hosts."
    }
  );

  // wildcard denylist does NOT block bare domain of denylist base
  assert.deepEqual(
    await preToolUse2(
      {
        timestamp: Date.now(),
        cwd: "/workspace/repo",
        toolName: "web_fetch",
        toolArgs: { url: "https://evil.com/payload" }
      },
      { sessionId: "session-1" }
    ),
    undefined
  );

  // non-denied public host still allowed (baseline passthrough)
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
});

test("ReviewSessionFactory: empty denylist blocks nothing; mixed exact+wildcard deny via OR logic; allow+deny same host is denied", async () => {

  // empty denylist: no additional blocking
  {
    const receivedConfigs = createRecordedConfigs();
    const factory = new ReviewSessionFactory({
      clientManager: createRecordingClientManager(receivedConfigs),
      webFetchAllowedHosts: ["*.example.com"],
      webFetchDeniedHosts: []
    });

    await factory.createSession({
      model: "gpt-5.4-mini",
      outputBaseDir: "/workspace/repo",
      repoRoot: "/workspace/repo",
      systemMessage: "system prompt",
      workingDirectory: "/workspace/repo"
    });

    const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

    assert.deepEqual(
      await preToolUse(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "web_fetch",
          toolArgs: { url: "https://internal.example.com/admin" }
        },
        { sessionId: "session-1" }
      ),
      undefined
    );
  }

  // mixed exact + wildcard denylist deny via OR logic
  {
    const receivedConfigs = createRecordedConfigs();
    const factory = new ReviewSessionFactory({
      clientManager: createRecordingClientManager(receivedConfigs),
      webFetchAllowedHosts: ["*.example.com", "evil.org"],
      webFetchDeniedHosts: ["internal.example.com", "*.secret.example.com"]
    });

    await factory.createSession({
      model: "gpt-5.4-mini",
      outputBaseDir: "/workspace/repo",
      repoRoot: "/workspace/repo",
      systemMessage: "system prompt",
      workingDirectory: "/workspace/repo"
    });

    const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

    assert.deepEqual(
      await preToolUse(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "web_fetch",
          toolArgs: { url: "https://api.secret.example.com/data" }
        },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow web_fetch for configured public http(s) hosts."
      }
    );
  }

  // host in both allow and deny is denied
  {
    const receivedConfigs = createRecordedConfigs();
    const factory = new ReviewSessionFactory({
      clientManager: createRecordingClientManager(receivedConfigs),
      webFetchAllowedHosts: ["internal.example.com"],
      webFetchDeniedHosts: ["internal.example.com"]
    });

    await factory.createSession({
      model: "gpt-5.4-mini",
      outputBaseDir: "/workspace/repo",
      repoRoot: "/workspace/repo",
      systemMessage: "system prompt",
      workingDirectory: "/workspace/repo"
    });

    const preToolUse = receivedConfigs[0].hooks.onPreToolUse;

    assert.deepEqual(
      await preToolUse(
        {
          timestamp: Date.now(),
          cwd: "/workspace/repo",
          toolName: "web_fetch",
          toolArgs: { url: "https://internal.example.com/admin" }
        },
        { sessionId: "session-1" }
      ),
      {
        permissionDecision: "deny",
        permissionDecisionReason:
          "Review sessions only allow web_fetch for configured public http(s) hosts."
      }
    );
  }
});
