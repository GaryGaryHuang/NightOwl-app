import type {
  ReviewSessionCreationOptions,
  ReviewSessionFactoryLike,
  ReviewSessionProfileLike
} from "../core/session-factory-contracts.ts";
import { SessionTurnAbortedError } from "../core/errors.ts";
import type {
  CopilotClientLike,
  CopilotSessionConfig
} from "./copilot-client-manager.ts";
import {
  SessionExecutor,
  type SessionLike
} from "./session-executor.ts";
import type { KnowledgeSvc } from "./knowledge.ts";
import { buildRemoveAllSectionsConfig } from "./review-system-message-sections.ts";
import { ToolPolicyGuard } from "./tool-policy/tool-policy-guard.ts";
import type { ToolAuditSink } from "./tool-audit-writer.ts";
import type { ResolvedReviewSessionModelProvider } from "./review-model-provider-resolver.ts";
import {
  VALIDATE_JSON_AVAILABLE_TOOL,
  validateJsonTool
} from "./validate-json-tool.ts";

export type ReviewSessionProfile = ReviewSessionProfileLike;
// Treat supportedReasoningEfforts as a set; choose only known high-effort tiers.
const REVIEW_REASONING_EFFORT_PREFERENCE: readonly string[] = [
  "max",
  "xhigh",
  "high"
];

/**
 * The explicit set of tool names exposed to LLM in review sessions.
 * Matches the SOP tool capability set defined in tool-spec.md §3.1.
 */
export const REVIEW_AVAILABLE_TOOLS = [
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
  "read_agent",
  VALIDATE_JSON_AVAILABLE_TOOL
] as const;

export interface ReviewSessionFactoryOptions {
  clientManager: {
    getClient(): Pick<CopilotClientLike, "createSession" | "listModels">;
  };
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  modelProvider?: ResolvedReviewSessionModelProvider;
  toolPolicyGuard: ToolPolicyGuard;
  auditWriterProvider?: () => ToolAuditSink | undefined;
}

/**
 * Build review sessions with review-specific tool policy, knowledge injection, and optional audit wiring.
 */
export class ReviewSessionFactory implements ReviewSessionFactoryLike {
  readonly #clientManager: ReviewSessionFactoryOptions["clientManager"];
  readonly #knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  readonly #modelProvider?: ResolvedReviewSessionModelProvider;
  readonly #toolPolicyGuard: ToolPolicyGuard;
  readonly #auditWriterProvider?: () => ToolAuditSink | undefined;

  constructor(options: ReviewSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
    this.#knowledgeSvc = options.knowledgeSvc;
    this.#modelProvider = options.modelProvider;
    this.#toolPolicyGuard = options.toolPolicyGuard;
    this.#auditWriterProvider = options.auditWriterProvider;
  }

  async createSession(
    profile: ReviewSessionProfile,
    options?: ReviewSessionCreationOptions
  ): Promise<SessionExecutor> {
    throwIfSessionCreationAborted(options?.signal);
    const auditWriter = this.#auditWriterProvider?.();
    if (profile.knowledgeMode === undefined) {
      throw new Error(
        "ReviewSessionFactory requires callers to provide an explicit knowledgeMode."
      );
    }
    if (
      profile.knowledgeMode === "built-in-context7" &&
      this.#knowledgeSvc === undefined
    ) {
      throw new Error(
        "ReviewSessionFactory requires knowledgeSvc for built-in-context7 sessions."
      );
    }
    const client = this.#clientManager.getClient();
    const model = this.#modelProvider?.model ?? profile.model;
    const reasoningEffort = await resolveReviewReasoningEffort(
      client,
      this.#modelProvider,
      model
    );
    const sessionConfig: CopilotSessionConfig = {
      availableTools: [...REVIEW_AVAILABLE_TOOLS],
      tools: [validateJsonTool],
      hooks: {
        onPreToolUse: this.#toolPolicyGuard.buildPreToolUseHook(
          profile,
          auditWriter
        ),
        onPostToolUseFailure: this.#toolPolicyGuard.buildPostToolUseFailureHook(
          auditWriter
        )
      },
      model,
      ...(this.#modelProvider?.mode === "byok"
        ? { provider: this.#modelProvider.provider }
        : {}),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      streaming: false,
      systemMessage: {
        mode: "customize",
        sections: buildRemoveAllSectionsConfig(),
        content: profile.systemMessage
      },
      onPermissionRequest: this.#toolPolicyGuard.buildPermissionHandler(
        profile,
        auditWriter
      )
    };

    const mcpServers = this.#knowledgeSvc?.getMcpServers(profile.knowledgeMode);

    if (mcpServers && Object.keys(mcpServers).length > 0) {
      sessionConfig.mcpServers = mcpServers;
    }

    if (profile.workingDirectory) {
      sessionConfig.workingDirectory = profile.workingDirectory;
    }

    throwIfSessionCreationAborted(options?.signal);
    const sessionPromise = client.createSession(sessionConfig);
    const session = await waitForSessionCreation(sessionPromise, options?.signal);

    return new SessionExecutor(session);
  }
}

async function resolveReviewReasoningEffort(
  client: Pick<CopilotClientLike, "listModels">,
  modelProvider: ResolvedReviewSessionModelProvider | undefined,
  model: string
): Promise<string | undefined> {
  if (modelProvider?.reasoningEffort !== undefined) {
    return modelProvider.reasoningEffort;
  }

  if (modelProvider?.mode === "byok") {
    return undefined;
  }

  if (client.listModels === undefined) {
    return undefined;
  }

  const modelInfo = (await client.listModels()).find((availableModel) => (
    availableModel.id === model
  ));

  if (modelInfo?.capabilities.supports.reasoningEffort !== true) {
    return undefined;
  }

  return selectHighestSupportedReviewReasoningEffort(
    modelInfo.supportedReasoningEfforts
  );
}

function selectHighestSupportedReviewReasoningEffort(
  supportedReasoningEfforts: readonly string[] | undefined
): string | undefined {
  if (supportedReasoningEfforts === undefined) {
    return undefined;
  }

  return REVIEW_REASONING_EFFORT_PREFERENCE.find((reasoningEffort) => (
    supportedReasoningEfforts.includes(reasoningEffort)
  ));
}

function throwIfSessionCreationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SessionTurnAbortedError();
  }
}

async function waitForSessionCreation(
  sessionPromise: Promise<SessionLike>,
  signal: AbortSignal | undefined
): Promise<SessionLike> {
  if (!signal) {
    return await sessionPromise;
  }

  throwIfSessionCreationAborted(signal);

  let removeAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    const handleAbort = (): void => reject(new SessionTurnAbortedError());
    signal.addEventListener("abort", handleAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", handleAbort);
  });

  try {
    return await Promise.race([sessionPromise, abortPromise]);
  } catch (error) {
    if (error instanceof SessionTurnAbortedError) {
      void sessionPromise.then(disconnectSessionAfterAbortedCreation, () => {});
    }
    throw error;
  } finally {
    removeAbortListener?.();
  }
}

async function disconnectSessionAfterAbortedCreation(session: SessionLike): Promise<void> {
  try {
    await session.disconnect();
  } catch {
    // Best-effort cleanup for a session that arrived after the run was interrupted.
  }
}
