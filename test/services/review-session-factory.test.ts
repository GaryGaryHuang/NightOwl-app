import assert from "node:assert/strict";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { KnowledgeSvc } from "../../src/services/knowledge.ts";
import { ReviewSessionFactory } from "../../src/services/review-session-factory.ts";
import {
  ToolPolicyGuard,
  type ToolPolicyGuardOptions
} from "../../src/services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";

type PreToolUseHook = NonNullable<
  NonNullable<SessionConfig["hooks"]>["onPreToolUse"]
>;
type PermissionHandler = NonNullable<SessionConfig["onPermissionRequest"]>;
type RecordedReviewSessionConfig = SessionConfig & {
  hooks: NonNullable<SessionConfig["hooks"]> & {
    onPreToolUse: PreToolUseHook;
  };
  onPermissionRequest: PermissionHandler;
};

const BASE_PROFILE = {
  model: "gpt-5.4-mini",
  outputBaseDir: "/workspace/repo/packages/app",
  repoRoot: "/workspace/repo",
  systemMessage: "system prompt",
  workingDirectory: "/workspace/repo"
};

function createRecordedConfigs(): RecordedReviewSessionConfig[] {
  return [];
}

function assertRecordedReviewSessionConfig(
  config: SessionConfig
): asserts config is RecordedReviewSessionConfig {
  assert.ok(config.hooks);
  assert.ok(config.hooks.onPreToolUse);
  assert.ok(config.onPermissionRequest);
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

class SpyToolPolicyGuard extends ToolPolicyGuard {
  readonly preToolUseHook: PreToolUseHook = async () => undefined;
  readonly permissionHandler: PermissionHandler = async () => ({
    kind: "denied-no-approval-rule-and-could-not-request-from-user"
  });
  readonly preToolUseCalls: Array<{
    auditWriter?: ToolAuditWriter;
    profile: Pick<typeof BASE_PROFILE, "repoRoot" | "outputBaseDir">;
  }> = [];
  readonly permissionCalls: Array<{
    auditWriter?: ToolAuditWriter;
    profile: Pick<typeof BASE_PROFILE, "repoRoot" | "outputBaseDir">;
  }> = [];

  constructor(options: ToolPolicyGuardOptions = {}) {
    super(options);
  }

  override buildPreToolUseHook(
    profile: Pick<typeof BASE_PROFILE, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PreToolUseHook {
    this.preToolUseCalls.push({ auditWriter, profile });

    return this.preToolUseHook;
  }

  override buildPermissionHandler(
    profile: Pick<typeof BASE_PROFILE, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PermissionHandler {
    this.permissionCalls.push({ auditWriter, profile });

    return this.permissionHandler;
  }
}

test("ReviewSessionFactory creates a non-streaming review session and delegates hook construction to ToolPolicyGuard", async () => {
  const receivedConfigs = createRecordedConfigs();
  const toolPolicyGuard = new SpyToolPolicyGuard();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    toolPolicyGuard
  });

  await factory.createSession(BASE_PROFILE);

  assert.deepEqual(toolPolicyGuard.preToolUseCalls, [
    {
      auditWriter: undefined,
      profile: BASE_PROFILE
    }
  ]);
  assert.deepEqual(toolPolicyGuard.permissionCalls, [
    {
      auditWriter: undefined,
      profile: BASE_PROFILE
    }
  ]);
  assert.deepEqual(receivedConfigs, [
    {
      hooks: {
        onPreToolUse: toolPolicyGuard.preToolUseHook
      },
      model: "gpt-5.4-mini",
      streaming: false,
      onPermissionRequest: toolPolicyGuard.permissionHandler,
      systemMessage: {
        mode: "replace",
        content: "system prompt"
      },
      workingDirectory: "/workspace/repo"
    }
  ]);
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
          type: "http",
          tools: ["resolve-library-id"],
          timeout: 20000
        }
      }
    }),
    toolPolicyGuard: new ToolPolicyGuard({})
  });

  await factory.createSession(BASE_PROFILE);
  await factory.createSession({
    ...BASE_PROFILE,
    model: "gpt-5-mini",
    systemMessage: "step1 system prompt"
  });
  await factory.createSession({
    ...BASE_PROFILE,
    model: "gpt-5-mini",
    systemMessage: "step3 system prompt",
    knowledgeMode: "built-in-context7"
  });
  await factory.createSession({
    ...BASE_PROFILE,
    systemMessage: "step5 system prompt"
  });
  await factory.createSession({
    ...BASE_PROFILE,
    systemMessage: "explicitly disabled system prompt",
    knowledgeMode: "disabled"
  });

  for (const config of receivedConfigs.slice(0, 4)) {
    assert.deepEqual(config.mcpServers, {
      context7: {
        type: "http",
        url: "https://mcp.context7.com/mcp",
        headers: {
          CONTEXT7_API_KEY: "test-api-key"
        },
        tools: ["resolve-library-id"],
        timeout: 20000
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

test("ReviewSessionFactory injects mixed local and remote MCP entries for review sessions and keeps judge sessions MCP-free", async () => {
  const receivedConfigs = createRecordedConfigs();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    knowledgeSvc: new KnowledgeSvc({
      userMcpServers: {
        demo: {
          type: "local",
          command: "npx",
          args: ["-y", "@example/demo-mcp"],
          tools: ["*"]
        },
        "my-remote": {
          type: "http",
          url: "https://mcp.example.com/v1",
          tools: ["*"]
        },
        "auth-sse": {
          type: "sse",
          url: "https://sse.example.com/mcp",
          headers: { Authorization: "Bearer tok" },
          timeout: 30000
        }
      }
    }),
    toolPolicyGuard: new ToolPolicyGuard({})
  });

  // review session: should include all MCP
  await factory.createSession(BASE_PROFILE);
  // explicitly disabled: no MCP
  await factory.createSession({
    ...BASE_PROFILE,
    systemMessage: "disabled prompt",
    knowledgeMode: "disabled"
  });

  const reviewMcp = receivedConfigs[0]?.mcpServers;
  assert.ok(reviewMcp);
  assert.equal(reviewMcp.context7?.type, "http");
  assert.equal(
    (reviewMcp.context7 as { url?: string }).url,
    "https://mcp.context7.com/mcp"
  );
  assert.equal(reviewMcp.demo?.type, "local");
  assert.equal((reviewMcp["my-remote"] as { type: string }).type, "http");
  assert.equal(
    (reviewMcp["my-remote"] as { url: string }).url,
    "https://mcp.example.com/v1"
  );
  assert.equal((reviewMcp["auth-sse"] as { type: string }).type, "sse");
  assert.equal(
    (reviewMcp["auth-sse"] as { timeout?: number }).timeout,
    30000
  );

  // disabled session: no MCP
  assert.equal(receivedConfigs[1]?.mcpServers, undefined);
});

test("ReviewSessionFactory only passes audit writer to sessions created after setAuditWriter", async () => {
  const receivedConfigs = createRecordedConfigs();
  const toolPolicyGuard = new SpyToolPolicyGuard();
  const factory = new ReviewSessionFactory({
    clientManager: createRecordingClientManager(receivedConfigs),
    toolPolicyGuard
  });

  await factory.createSession(BASE_PROFILE);

  const auditWriter = new ToolAuditWriter(
    path.join(tmpdir(), `nightowl-audit-${Date.now()}.jsonl`)
  );
  factory.setAuditWriter(auditWriter);

  await factory.createSession(BASE_PROFILE);

  assert.equal(toolPolicyGuard.preToolUseCalls[0]?.auditWriter, undefined);
  assert.equal(toolPolicyGuard.permissionCalls[0]?.auditWriter, undefined);
  assert.equal(toolPolicyGuard.preToolUseCalls[1]?.auditWriter, auditWriter);
  assert.equal(toolPolicyGuard.permissionCalls[1]?.auditWriter, auditWriter);
});