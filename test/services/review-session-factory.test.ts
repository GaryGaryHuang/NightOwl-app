import assert from "node:assert/strict";
import test from "node:test";
import type { MCPServerConfig, SessionConfig } from "@github/copilot-sdk";

import {
  ReviewSessionFactory,
  type ReviewSessionFactoryOptions
} from "../../src/services/review-session-factory.ts";
import { SessionTurnAbortedError } from "../../src/services/session-executor.ts";
import type {
  ResolvedReviewSessionModelProvider
} from "../../src/services/review-model-provider-resolver.ts";
import {
  ToolPolicyGuard,
  type ToolPolicyGuardOptions
} from "../../src/services/tool-policy/tool-policy-guard.ts";
import type { ToolPolicyBoundaryContext } from "../../src/services/tool-policy/tool-policy-types.ts";
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
  "list_bash",
  "read_bash",
  "stop_bash",
  "web_fetch",
  "view",
  "grep",
  "rg",
  "glob",
  "list_agents",
  "read_agent"
] as const;

const DEFAULT_CONTEXT7_SERVERS: Record<string, MCPServerConfig> = {
  context7: {
    type: "http",
    url: "https://mcp.context7.com/mcp",
    tools: ["*"]
  }
};

type PreToolUseHook = NonNullable<
  NonNullable<SessionConfig["hooks"]>["onPreToolUse"]
>;
type PostToolUseFailureHook = NonNullable<
  NonNullable<SessionConfig["hooks"]>["onPostToolUseFailure"]
>;
type PermissionHandler = NonNullable<SessionConfig["onPermissionRequest"]>;
type RecordedReviewSessionConfig = SessionConfig & {
  hooks: NonNullable<SessionConfig["hooks"]> & {
    onPreToolUse: PreToolUseHook;
    onPostToolUseFailure: PostToolUseFailureHook;
  };
  onPermissionRequest: PermissionHandler;
};

function assertRecordedReviewSessionConfig(
  config: SessionConfig
): asserts config is RecordedReviewSessionConfig {
  assert.ok(config.hooks);
  assert.ok(config.hooks.onPreToolUse);
  assert.ok(config.hooks.onPostToolUseFailure);
  assert.ok(config.onPermissionRequest);
}

function createReviewSessionFactoryHarness(
  options: Partial<
    Pick<
      ReviewSessionFactoryOptions,
      "knowledgeSvc" | "toolPolicyGuard" | "auditWriterProvider" | "modelProvider"
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
    knowledgeSvc:
      options.knowledgeSvc ?? {
        getMcpServers(knowledgeMode) {
          return knowledgeMode === "built-in-context7"
            ? DEFAULT_CONTEXT7_SERVERS
            : {};
        }
      },
    ...(options.modelProvider === undefined
      ? {}
      : { modelProvider: options.modelProvider }),
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

async function assertRejectsWithAbortBeforeTimeout(
  promise: Promise<unknown>
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error("timed out waiting for session creation abort")),
      100
    );
  });

  try {
    await assert.rejects(
      () => Promise.race([promise, timeoutPromise]),
      (error: unknown) => error instanceof SessionTurnAbortedError
    );
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

// Subclassing ToolPolicyGuard lets the test record which auditWriter and profile
// were passed to each build call without coupling to the internal hook/handler
// implementation details.
class SpyToolPolicyGuard extends ToolPolicyGuard {
  readonly preToolUseHook: PreToolUseHook = async () => undefined;
  readonly postToolUseFailureHook: PostToolUseFailureHook = async () => undefined;
  readonly permissionHandler: PermissionHandler = async () => ({
    kind: "user-not-available"
  });
  readonly preToolUseCalls: Array<{
    auditWriter?: ToolAuditSink;
    profile: ToolPolicyBoundaryContext;
  }> = [];
  readonly postToolUseFailureCalls: Array<{
    auditWriter?: ToolAuditSink;
  }> = [];
  readonly permissionCalls: Array<{
    auditWriter?: ToolAuditSink;
    profile: ToolPolicyBoundaryContext;
  }> = [];

  constructor(options: ToolPolicyGuardOptions = {}) {
    super(options);
  }

  override buildPreToolUseHook(
    profile: ToolPolicyBoundaryContext,
    auditWriter?: ToolAuditSink
  ): PreToolUseHook {
    this.preToolUseCalls.push({ auditWriter, profile });
    return this.preToolUseHook;
  }

  override buildPostToolUseFailureHook(
    auditWriter?: ToolAuditSink
  ): PostToolUseFailureHook {
    this.postToolUseFailureCalls.push({ auditWriter });
    return this.postToolUseFailureHook;
  }

  override buildPermissionHandler(
    profile: ToolPolicyBoundaryContext,
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
  assert.deepEqual(toolPolicyGuard.postToolUseFailureCalls, [
    {
      auditWriter: undefined
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
  assert.equal(
    config.hooks.onPostToolUseFailure,
    toolPolicyGuard.postToolUseFailureHook
  );
  assert.equal(config.onPermissionRequest, toolPolicyGuard.permissionHandler);
});

test("ReviewSessionFactory passes separate source and review output roots to ToolPolicyGuard", async () => {
  const toolPolicyGuard = new SpyToolPolicyGuard();
  const { factory } = createReviewSessionFactoryHarness({
    toolPolicyGuard
  });
  const snapshotProfile = {
    ...BASE_REVIEW_PROFILE,
    repoRoot: "/tmp/nightowl-source-snapshot",
    reviewOutputRoot: "/workspace/repo/.nightowl/review",
    sourceBaseRef: "6e199e57ec5e101ba9bd0347a37e9508a9b15bcc",
    sourceHeadRef: "c1d76cc53b8ded1562c6f1064fb66f582841bd39",
    workingDirectory: "/tmp/nightowl-source-snapshot"
  };

  await factory.createSession(snapshotProfile);

  assert.deepEqual(toolPolicyGuard.preToolUseCalls.at(-1)?.profile, snapshotProfile);
  assert.deepEqual(toolPolicyGuard.permissionCalls.at(-1)?.profile, snapshotProfile);
});

test("ReviewSessionFactory builds the base review session config from the profile", async () => {
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession({
    ...BASE_REVIEW_PROFILE,
    knowledgeMode: "disabled"
  });

  const config = getRecordedConfig(receivedConfigs);
  assert.equal(config.model, "gpt-5.4-mini");
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.streaming, false);
  assert.equal(config.onEvent, undefined);
  assert.equal(config.workingDirectory, "/workspace/repo");
  assert.equal(config.provider, undefined);
});

test("ReviewSessionFactory applies explicit Copilot model override without SDK provider", async () => {
  const modelProvider: ResolvedReviewSessionModelProvider = {
    mode: "copilot",
    model: "gpt-4.1"
  };
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
    modelProvider,
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  const config = getRecordedConfig(receivedConfigs);
  assert.equal(config.model, "gpt-4.1");
  assert.equal(config.provider, undefined);
});

test("ReviewSessionFactory includes BYOK provider config and configured model", async () => {
  const modelProvider: ResolvedReviewSessionModelProvider = {
    mode: "byok",
    model: "company-review",
    provider: {
      type: "openai",
      baseUrl: "https://llm-gateway.example.com/v1",
      apiKey: "sk-test"
    }
  };
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
    modelProvider,
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession(BASE_REVIEW_PROFILE);

  const config = getRecordedConfig(receivedConfigs);
  assert.equal(config.model, "company-review");
  assert.deepEqual(config.provider, {
    type: "openai",
    baseUrl: "https://llm-gateway.example.com/v1",
    apiKey: "sk-test"
  });
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
        return knowledgeMode === "built-in-context7" ? builtInServers : {};
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

test("ReviewSessionFactory rejects runtime profiles that omit knowledgeMode", async () => {
  const { factory } = createReviewSessionFactoryHarness({
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  const profileWithoutKnowledgeMode = {
    ...BASE_REVIEW_PROFILE
  } as Omit<typeof BASE_REVIEW_PROFILE, "knowledgeMode">;
  delete (profileWithoutKnowledgeMode as { knowledgeMode?: string }).knowledgeMode;

  await assert.rejects(
    () =>
      factory.createSession(
        profileWithoutKnowledgeMode as typeof BASE_REVIEW_PROFILE
      ),
    /requires callers to provide an explicit knowledgeMode/u
  );
});

test("ReviewSessionFactory rejects built-in-context7 sessions when knowledgeSvc is missing", async () => {
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

  await assert.rejects(
    () => factory.createSession(BASE_REVIEW_PROFILE),
    /requires knowledgeSvc for built-in-context7 sessions/u
  );
  assert.equal(receivedConfigs.length, 0);
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
    assert.equal(
      toolPolicyGuard.postToolUseFailureCalls[0]?.auditWriter,
      undefined
    );
    assert.equal(toolPolicyGuard.permissionCalls[0]?.auditWriter, undefined);
    assert.equal(toolPolicyGuard.preToolUseCalls[1]?.auditWriter, auditWriter);
    assert.equal(
      toolPolicyGuard.postToolUseFailureCalls[1]?.auditWriter,
      auditWriter
    );
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
  assert.ok(Object.keys(systemMessage.sections).length > 0, "sections should not be empty");
});

test("ReviewSessionFactory does not inject snapshot root fields into the system prompt", async () => {
  const { factory, receivedConfigs } = createReviewSessionFactoryHarness({
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  await factory.createSession({
    ...BASE_REVIEW_PROFILE,
    repoRoot: "/tmp/nightowl-source-snapshot",
    reviewOutputRoot: "/Users/dev/my-project/.nightowl/review",
    sourceBaseRef: "6e199e57ec5e101ba9bd0347a37e9508a9b15bcc",
    sourceHeadRef: "c1d76cc53b8ded1562c6f1064fb66f582841bd39",
    systemMessage: "base prompt",
    workingDirectory: "/tmp/nightowl-source-snapshot"
  });

  const systemMessage = receivedConfigs[0]?.systemMessage as {
    mode: string;
    content: string;
  };

  assert.equal(systemMessage.content, "base prompt");
  assert.ok(!systemMessage.content.includes("/tmp/nightowl-source-snapshot"));
  assert.ok(!systemMessage.content.includes("/Users/dev/my-project/.nightowl/review"));
  assert.ok(!systemMessage.content.includes("6e199e57ec5e101ba9bd0347a37e9508a9b15bcc"));
  assert.ok(!systemMessage.content.includes("c1d76cc53b8ded1562c6f1064fb66f582841bd39"));
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

test("ReviewSessionFactory aborts while the SDK session creation is pending", async () => {
  const controller = new AbortController();
  let createCalls = 0;
  const factory = new ReviewSessionFactory({
    clientManager: {
      getClient() {
        return {
          async createSession() {
            createCalls += 1;
            return await new Promise<never>(() => {});
          }
        };
      }
    },
    toolPolicyGuard: new SpyToolPolicyGuard()
  });

  const pending = factory.createSession(
    {
      ...BASE_REVIEW_PROFILE,
      knowledgeMode: "disabled"
    },
    { signal: controller.signal }
  );
  controller.abort("SIGINT");

  await assertRejectsWithAbortBeforeTimeout(pending);
  assert.equal(createCalls, 1);
});
