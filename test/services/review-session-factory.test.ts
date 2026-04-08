import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfig } from "@github/copilot-sdk";

import { KnowledgeSvc } from "../../src/services/knowledge.ts";
import { ReviewSessionFactory } from "../../src/services/review-session-factory.ts";
import {
  ToolPolicyGuard,
  type ToolPolicyGuardOptions
} from "../../src/services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import {
  BASE_REVIEW_PROFILE,
  createAuditFileFixture,
  createLocalMcpServer,
  createRecordedConfigs,
  createRemoteMcpServer,
  createSessionRecordingClientManager,
  EXPECTED_REVIEW_AVAILABLE_TOOLS
} from "../helpers/review-session-runtime-contract-fixture.ts";

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

function assertRecordedReviewSessionConfig(
  config: SessionConfig
): asserts config is RecordedReviewSessionConfig {
  assert.ok(config.hooks);
  assert.ok(config.hooks.onPreToolUse);
  assert.ok(config.onPermissionRequest);
}

// Subclassing ToolPolicyGuard lets the test record which auditWriter and profile
// were passed to each build call without coupling to the internal hook/handler
// implementation details.
class SpyToolPolicyGuard extends ToolPolicyGuard {
  readonly preToolUseHook: PreToolUseHook = async () => undefined;
  readonly permissionHandler: PermissionHandler = async () => ({
    kind: "denied-no-approval-rule-and-could-not-request-from-user"
  });
  readonly preToolUseCalls: Array<{
    auditWriter?: ToolAuditWriter;
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">;
  }> = [];
  readonly permissionCalls: Array<{
    auditWriter?: ToolAuditWriter;
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">;
  }> = [];

  constructor(options: ToolPolicyGuardOptions = {}) {
    super(options);
  }

  override buildPreToolUseHook(
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PreToolUseHook {
    this.preToolUseCalls.push({ auditWriter, profile });
    return this.preToolUseHook;
  }

  override buildPermissionHandler(
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditWriter
  ): PermissionHandler {
    this.permissionCalls.push({ auditWriter, profile });
    return this.permissionHandler;
  }
}

test("ReviewSessionFactory creates a non-streaming review session and delegates hook construction to ToolPolicyGuard", async () => {
  const receivedConfigs = createRecordedConfigs<RecordedReviewSessionConfig>();
  const toolPolicyGuard = new SpyToolPolicyGuard();
  const factory = new ReviewSessionFactory({
    clientManager: createSessionRecordingClientManager(receivedConfigs, (config) => {
      assertRecordedReviewSessionConfig(config);
      return {
        async sendAndWait() {
          return {
            type: "assistant.message",
            data: { content: "ok" }
          };
        },
        async disconnect() {}
      };
    }),
    toolPolicyGuard
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  assert.deepEqual(toolPolicyGuard.preToolUseCalls, [
    {
      auditWriter: undefined,
      profile: BASE_REVIEW_PROFILE
    }
  ]);
  assert.deepEqual(toolPolicyGuard.permissionCalls, [
    {
      auditWriter: undefined,
      profile: BASE_REVIEW_PROFILE
    }
  ]);
  assert.deepEqual(receivedConfigs, [
    {
      availableTools: EXPECTED_REVIEW_AVAILABLE_TOOLS,
      hooks: {
        onPreToolUse: toolPolicyGuard.preToolUseHook
      },
      model: "gpt-5.4-mini",
      reasoningEffort: "high",
      streaming: false,
      onPermissionRequest: toolPolicyGuard.permissionHandler,
      systemMessage: {
        mode: "customize",
        sections: {
          identity: { action: "remove" },
          tone: { action: "remove" },
          tool_efficiency: { action: "remove" },
          code_change_rules: { action: "remove" },
          guidelines: { action: "remove" },
          tool_instructions: { action: "remove" },
          custom_instructions: { action: "remove" },
          last_instructions: { action: "remove" }
        },
        content: "system prompt"
      },
      workingDirectory: "/workspace/repo"
    }
  ]);
  assert.equal(receivedConfigs[0]?.excludedTools, undefined);
});

test("ReviewSessionFactory injects mixed local and remote MCP entries for review sessions and keeps judge sessions MCP-free", async () => {
  const receivedConfigs = createRecordedConfigs<RecordedReviewSessionConfig>();
  const factory = new ReviewSessionFactory({
    clientManager: createSessionRecordingClientManager(receivedConfigs, (config) => {
      assertRecordedReviewSessionConfig(config);
      return {
        async sendAndWait() {
          return {
            type: "assistant.message",
            data: { content: "ok" }
          };
        },
        async disconnect() {}
      };
    }),
    knowledgeSvc: new KnowledgeSvc({
      userMcpServers: {
        demo: createLocalMcpServer(),
        "my-remote": createRemoteMcpServer(),
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

  // review session (default knowledgeMode) → MCP servers are injected
  await factory.createSession(BASE_REVIEW_PROFILE);
  // disabled knowledgeMode → no MCP servers; verifies knowledge mode controls injection
  await factory.createSession({
    ...BASE_REVIEW_PROFILE,
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
  assert.equal(receivedConfigs[1]?.mcpServers, undefined);
});

// setAuditWriter is called mid-run (after the run output path is known);
// only sessions created after the call should receive the writer.
test("ReviewSessionFactory only passes audit writer to sessions created after setAuditWriter", async () => {
  const receivedConfigs = createRecordedConfigs<RecordedReviewSessionConfig>();
  const toolPolicyGuard = new SpyToolPolicyGuard();
  const factory = new ReviewSessionFactory({
    clientManager: createSessionRecordingClientManager(receivedConfigs, (config) => {
      assertRecordedReviewSessionConfig(config);
      return {
        async sendAndWait() {
          return {
            type: "assistant.message",
            data: { content: "ok" }
          };
        },
        async disconnect() {}
      };
    }),
    toolPolicyGuard
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  const auditFixture = createAuditFileFixture();
  try {
    const auditWriter = new ToolAuditWriter(auditFixture.auditPath);
    factory.setAuditWriter(auditWriter);

    await factory.createSession(BASE_REVIEW_PROFILE);

    assert.equal(toolPolicyGuard.preToolUseCalls[0]?.auditWriter, undefined);
    assert.equal(toolPolicyGuard.permissionCalls[0]?.auditWriter, undefined);
    assert.equal(toolPolicyGuard.preToolUseCalls[1]?.auditWriter, auditWriter);
    assert.equal(toolPolicyGuard.permissionCalls[1]?.auditWriter, auditWriter);
  } finally {
    auditFixture.cleanup();
  }
});

test("ReviewSessionFactory system prompt uses customize mode and does not inject repoRoot", async () => {
  const receivedConfigs = createRecordedConfigs<RecordedReviewSessionConfig>();
  const factory = new ReviewSessionFactory({
    clientManager: createSessionRecordingClientManager(receivedConfigs, (config) => {
      assertRecordedReviewSessionConfig(config);
      return {
        async sendAndWait() {
          return {
            type: "assistant.message",
            data: { content: "ok" }
          };
        },
        async disconnect() {}
      };
    }),
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession({
    ...BASE_REVIEW_PROFILE,
    repoRoot: "/Users/dev/my-project",
    systemMessage: "base prompt"
  });

  const systemMessage = receivedConfigs[0]?.systemMessage as {
    mode: string;
    content: string;
    sections: Record<string, { action: string }>;
  };
  assert.equal(systemMessage.mode, "customize");
  assert.equal(systemMessage.content, "base prompt");
  assert.ok(!systemMessage.content.includes("/Users/dev/my-project"));
  assert.deepEqual(
    Object.keys(systemMessage.sections).sort(),
    ["code_change_rules", "custom_instructions", "guidelines", "identity", "last_instructions", "tone", "tool_efficiency", "tool_instructions"]
  );
});

test("ReviewSessionFactory sets availableTools to exactly the SOP tool set", async () => {
  const receivedConfigs = createRecordedConfigs<RecordedReviewSessionConfig>();
  const factory = new ReviewSessionFactory({
    clientManager: createSessionRecordingClientManager(receivedConfigs, (config) => {
      assertRecordedReviewSessionConfig(config);
      return {
        async sendAndWait() {
          return { type: "assistant.message", data: { content: "ok" } };
        },
        async disconnect() {}
      };
    }),
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  const availableTools = receivedConfigs[0]?.availableTools;
  assert.ok(availableTools !== undefined, "availableTools should be present in session config");
  assert.deepEqual(
    new Set(availableTools),
    new Set(EXPECTED_REVIEW_AVAILABLE_TOOLS)
  );
});
