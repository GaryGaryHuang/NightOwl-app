import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { KnowledgeSvc } from "../../src/services/knowledge.ts";
import { ReviewSessionFactory } from "../../src/services/review-session-factory.ts";
import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";

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

// ---------------------------------------------------------------------------
// Tasks 4.1–4.3: Hook audit writer integration
// ---------------------------------------------------------------------------

function makeAuditSession(auditWriter: ToolAuditWriter) {
  const recordedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(recordedConfigs)
  });

  factory.setAuditWriter(auditWriter);

  return { factory, recordedConfigs };
}

function readAuditLines(auditPath: string): ReturnType<typeof JSON.parse>[] {
  const content = readFileSync(auditPath, "utf8");
  return content.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l));
}

const BASE_PROFILE = {
  model: "gpt-5.4-mini",
  outputBaseDir: "/workspace/repo/packages/app",
  repoRoot: "/workspace/repo",
  systemMessage: "system prompt",
  workingDirectory: "/workspace/repo"
};

// --- 4.1: onPreToolUse + audit writer ---

test("onPreToolUse hook appends allow record for allowed bash call", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const hook = recordedConfigs[0].hooks.onPreToolUse;

    await hook(
      { timestamp: Date.now(), cwd: "/workspace/repo", toolName: "bash", toolArgs: { command: "git log --oneline -5" } },
      { sessionId: "s1" }
    );

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "bash");
    assert.equal(record.decision, "allow");
    assert.equal(record.args.command, "git log --oneline -5");
    assert.equal("reason" in record, false);
    assert.ok(record.ts.endsWith("Z"));
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("onPreToolUse hook appends deny record for denied bash call", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const hook = recordedConfigs[0].hooks.onPreToolUse;

    const result = await hook(
      { timestamp: Date.now(), cwd: "/workspace/repo", toolName: "bash", toolArgs: { command: "git log; rm -rf /" } },
      { sessionId: "s1" }
    );

    assert.ok(result !== undefined && "permissionDecision" in result);
    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "bash");
    assert.equal(record.decision, "deny");
    assert.equal(record.args.command, "git log; rm -rf /");
    assert.ok(typeof record.reason === "string" && record.reason.length > 0);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("onPreToolUse hook appends allow record for allowed web_fetch call", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const hook = recordedConfigs[0].hooks.onPreToolUse;

    await hook(
      { timestamp: Date.now(), cwd: "/workspace/repo", toolName: "web_fetch", toolArgs: { url: "https://docs.example.com/guide" } },
      { sessionId: "s1" }
    );

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "web_fetch");
    assert.equal(record.decision, "allow");
    assert.equal(record.args.url, "https://docs.example.com/guide");
    assert.equal("reason" in record, false);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("onPreToolUse hook appends deny record for denied web_fetch call", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const hook = recordedConfigs[0].hooks.onPreToolUse;

    const result = await hook(
      { timestamp: Date.now(), cwd: "/workspace/repo", toolName: "web_fetch", toolArgs: { url: "http://localhost:8080" } },
      { sessionId: "s1" }
    );

    assert.ok(result !== undefined && "permissionDecision" in result);
    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "web_fetch");
    assert.equal(record.decision, "deny");
    assert.equal(record.args.url, "http://localhost:8080");
    assert.ok(typeof record.reason === "string" && record.reason.length > 0);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

// --- 4.2: onPermissionRequest + audit writer ---

test("onPermissionRequest handler appends allow record for allowed read request", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const handler = recordedConfigs[0].onPermissionRequest;

    await handler(
      { kind: "read", path: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    );

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "read");
    assert.equal(record.decision, "allow");
    assert.equal(record.args.path, "/workspace/repo/src/app.ts");
    assert.equal("reason" in record, false);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("onPermissionRequest handler appends deny record with explicit reason for denied read request", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const handler = recordedConfigs[0].onPermissionRequest;

    await handler(
      { kind: "read", path: "/tmp/secret.txt" },
      { sessionId: "s1" }
    );

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "read");
    assert.equal(record.decision, "deny");
    assert.equal(record.reason, "Read path is outside the allowed boundary.");
    assert.equal(record.args.path, "/tmp/secret.txt");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("onPermissionRequest handler appends deny record with explicit reason for denied write request", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const handler = recordedConfigs[0].onPermissionRequest;

    await handler(
      { kind: "write", fileName: "/workspace/repo/src/app.ts" },
      { sessionId: "s1" }
    );

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "write");
    assert.equal(record.decision, "deny");
    assert.equal(record.reason, "Write operations are not permitted in review sessions.");
    assert.equal(record.args.path, "/workspace/repo/src/app.ts");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("onPermissionRequest handler appends deny record with empty args when write request.fileName is missing", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);
    const { factory, recordedConfigs } = makeAuditSession(writer);

    await factory.createSession(BASE_PROFILE);
    const handler = recordedConfigs[0].onPermissionRequest;

    // Simulate a write request without fileName
    await handler(
      { kind: "write" } as Parameters<typeof handler>[0],
      { sessionId: "s1" }
    );

    const [record] = readAuditLines(auditPath);

    assert.equal(record.tool, "write");
    assert.equal(record.decision, "deny");
    assert.deepEqual(record.args, {});
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

// --- 4.3: No audit writer provided ---

test("hooks behave normally and write no audit records when no audit writer is provided", async () => {
  const recordedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(recordedConfigs)
  });

  // Deliberately NOT calling setAuditWriter

  await factory.createSession(BASE_PROFILE);
  const hook = recordedConfigs[0].hooks.onPreToolUse;
  const handler = recordedConfigs[0].onPermissionRequest;

  // These should not throw
  const bashResult = await hook(
    { timestamp: Date.now(), cwd: "/workspace/repo", toolName: "bash", toolArgs: { command: "git log" } },
    { sessionId: "s1" }
  );
  const permResult = await handler(
    { kind: "read", path: "/workspace/repo/src/app.ts" },
    { sessionId: "s1" }
  );

  // Policy decisions must be unchanged
  assert.equal(bashResult, undefined); // allowed
  assert.deepEqual(permResult, { kind: "approved" }); // allowed
});

// --- Task 5.1: setAuditWriter() scoping ---

test("ReviewSessionFactory sessions created before setAuditWriter() do not write audit records", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);

    const recordedConfigs = createRecordedConfigs();
    const factory = new ReviewSessionFactory({
      clientManager: createRecordingClientManager(recordedConfigs)
    });

    // Create session BEFORE setAuditWriter (simulates Step 0)
    await factory.createSession(BASE_PROFILE);
    const hookBefore = recordedConfigs[0].hooks.onPreToolUse;

    // Now set the audit writer
    factory.setAuditWriter(writer);

    // Call the hook from the session created BEFORE setAuditWriter
    await hookBefore(
      { timestamp: Date.now(), cwd: "/workspace/repo", toolName: "bash", toolArgs: { command: "git log" } },
      { sessionId: "s1" }
    );

    // No audit record should have been written (writer was set after session creation)
    // ToolAuditWriter is lazy — the file is only created on first append.
    // Since the session had no writer, no file should exist.
    assert.equal(existsSync(auditPath), false, "audit file should not exist since no records were written before setAuditWriter");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("ReviewSessionFactory sessions created after setAuditWriter() write audit records", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));

  try {
    const auditPath = path.join(tempDir, "tool-audit.jsonl");
    const writer = new ToolAuditWriter(auditPath);

    const recordedConfigs = createRecordedConfigs();
    const factory = new ReviewSessionFactory({
      clientManager: createRecordingClientManager(recordedConfigs)
    });

    // Set audit writer FIRST, then create session (simulates Step 1-7)
    factory.setAuditWriter(writer);
    await factory.createSession(BASE_PROFILE);
    const hookAfter = recordedConfigs[0].hooks.onPreToolUse;

    await hookAfter(
      { timestamp: Date.now(), cwd: "/workspace/repo", toolName: "bash", toolArgs: { command: "git log" } },
      { sessionId: "s2" }
    );

    const lines = readAuditLines(auditPath);

    assert.equal(lines.length, 1);
    assert.equal(lines[0].tool, "bash");
    assert.equal(lines[0].decision, "allow");
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});
