import assert from "node:assert/strict";
import test from "node:test";
import type { MCPServerConfig, SessionConfig } from "@github/copilot-sdk";

import {
  ReviewSessionFactory,
  type ReviewSessionFactoryOptions
} from "../../src/services/review-session-factory.ts";
import {
  ToolPolicyGuard,
  type ToolPolicyGuardOptions
} from "../../src/services/tool-policy-guard.ts";
import { ToolAuditWriter } from "../../src/services/tool-audit-writer.ts";
import type { ToolAuditSink } from "../../src/services/tool-audit-writer.ts";
import {
  BASE_REVIEW_PROFILE,
  createAuditFileFixture,
  createRecordedConfigs,
  createSessionRecordingClientManager
} from "../helpers/review-session-runtime-contract-fixture.ts";

const EXPECTED_REVIEW_AVAILABLE_TOOLS = [
  "bash",
  "web_fetch",
  "view",
  "grep",
  "glob"
] as const;

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

function createReviewSessionFactoryHarness(
  options: Partial<
    Pick<
      ReviewSessionFactoryOptions,
      "knowledgeSvc" | "toolPolicyGuard" | "auditWriterProvider"
    >
  > = {}
) {
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
    toolPolicyGuard: options.toolPolicyGuard ?? new SpyToolPolicyGuard(),
    ...(options.knowledgeSvc === undefined
      ? {}
      : { knowledgeSvc: options.knowledgeSvc }),
    ...(options.auditWriterProvider === undefined
      ? {}
      : { auditWriterProvider: options.auditWriterProvider })
  });

  return {
    factory,
    receivedConfigs
  };
}

function getRecordedConfig(
  receivedConfigs: RecordedReviewSessionConfig[],
  index = 0
): RecordedReviewSessionConfig {
  const config = receivedConfigs[index];

  assert.ok(config, `expected a recorded session config at index ${index}`);
  return config;
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
    auditWriter?: ToolAuditSink;
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">;
  }> = [];
  readonly permissionCalls: Array<{
    auditWriter?: ToolAuditSink;
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">;
  }> = [];

  constructor(options: ToolPolicyGuardOptions = {}) {
    super(options);
  }

  override buildPreToolUseHook(
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditSink
  ): PreToolUseHook {
    this.preToolUseCalls.push({ auditWriter, profile });
    return this.preToolUseHook;
  }

  override buildPermissionHandler(
    profile: Pick<typeof BASE_REVIEW_PROFILE, "repoRoot" | "outputBaseDir">,
    auditWriter?: ToolAuditSink
  ): PermissionHandler {
    this.permissionCalls.push({ auditWriter, profile });
    return this.permissionHandler;
  }
}

test("ReviewSessionFactory delegates hook construction to ToolPolicyGuard", async () => {
  const toolPolicyGuard = new SpyToolPolicyGuard();
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
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
  assert.equal(receivedConfigs.length, 1);

  const config = getRecordedConfig(receivedConfigs);
  assert.equal(config.hooks.onPreToolUse, toolPolicyGuard.preToolUseHook);
  assert.equal(config.onPermissionRequest, toolPolicyGuard.permissionHandler);
});

test("ReviewSessionFactory builds the base review session config from the profile", async () => {
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  const config = getRecordedConfig(receivedConfigs);
  assert.equal(config.model, "gpt-5.4-mini");
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.streaming, false);
  assert.equal(config.workingDirectory, "/workspace/repo");
  assert.equal(config.mcpServers, undefined);
});

test("ReviewSessionFactory injects MCP servers only when KnowledgeSvc returns them for the resolved knowledge mode", async () => {
  const knowledgeModeCalls: string[] = [];
  const builtInServers: Record<string, MCPServerConfig> = {
    context7: {
      type: "http",
      url: "https://mcp.context7.com/mcp",
      tools: ["*"]
    },
    demo: {
      type: "local",
      command: "node",
      args: ["server.js"],
      tools: ["search"]
    }
  };
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
    knowledgeSvc: {
      getMcpServers(knowledgeMode) {
        knowledgeModeCalls.push(knowledgeMode);
        return knowledgeMode === "built-in-context7" ? builtInServers : undefined;
      }
    },
    toolPolicyGuard: new ToolPolicyGuard({})
  });

  await factory.createSession(BASE_REVIEW_PROFILE);
  await factory.createSession({
    ...BASE_REVIEW_PROFILE,
    systemMessage: "disabled prompt",
    knowledgeMode: "disabled"
  });

  assert.deepEqual(knowledgeModeCalls, ["built-in-context7", "disabled"]);
  assert.deepEqual(getRecordedConfig(receivedConfigs, 0).mcpServers, builtInServers);
  assert.equal(getRecordedConfig(receivedConfigs, 1).mcpServers, undefined);
});

// auditWriterProvider is supplied at construction time; sessions created before the provider
// starts returning a writer receive undefined, and those after receive the writer.
test("ReviewSessionFactory threads audit writer via auditWriterProvider", async () => {
  const toolPolicyGuard = new SpyToolPolicyGuard();
  let capturedWriter: ToolAuditSink | undefined = undefined;
  const { factory } = createReviewSessionFactoryHarness({
    toolPolicyGuard,
    auditWriterProvider: () => capturedWriter
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  const auditFixture = createAuditFileFixture();
  try {
    const auditWriter = new ToolAuditWriter(auditFixture.auditPath);
    capturedWriter = auditWriter;

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
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
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
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  const availableTools = receivedConfigs[0]?.availableTools;
  assert.ok(availableTools !== undefined, "availableTools should be present in session config");
  assert.deepEqual(availableTools, [...EXPECTED_REVIEW_AVAILABLE_TOOLS]);
});
