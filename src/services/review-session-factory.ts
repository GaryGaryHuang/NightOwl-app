import {
  type SessionConfig
} from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import {
  REVIEW_STREAMING_ENABLED
} from "../core/review-runtime-contract.ts";
import type { ReviewSessionFactoryLike } from "../core/session-factory-contracts.ts";
import type { CopilotClientLike } from "./copilot-client-manager.ts";
import { SessionExecutor } from "./session-executor.ts";
import type { KnowledgeSvc } from "./knowledge.ts";
import { buildRemoveAllSectionsConfig } from "./review-system-message-sections.ts";
import { ToolPolicyGuard } from "./tool-policy/tool-policy-guard.ts";
import type { ToolAuditSink } from "./tool-audit-writer.ts";
import type { ResolvedReviewSessionModelProvider } from "./review-model-provider-resolver.ts";

export interface ReviewSessionProfile {
  stepId?: string;
  knowledgeMode: ReviewKnowledgeMode;
  model: string;
  outputBaseDir: string;
  /** Review source boundary; snapshot-backed local runs use the detached source root. */
  repoRoot: string;
  /** Host output metadata location; not an Agent-readable boundary. */
  reviewOutputRoot?: string;
  /** Command-start resolved base ref used only by tool policy in snapshot-backed runs. */
  sourceBaseRef?: string;
  /** Command-start resolved head ref used only by tool policy in snapshot-backed runs. */
  sourceHeadRef?: string;
  systemMessage: string;
  workingDirectory?: string;
}

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
  "read_agent"
] as const;

export interface ReviewSessionFactoryOptions {
  clientManager: {
    getClient(): Pick<CopilotClientLike, "createSession">;
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

  async createSession(profile: ReviewSessionProfile): Promise<SessionExecutor> {
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
    const sessionConfig: SessionConfig = {
      availableTools: [...REVIEW_AVAILABLE_TOOLS],
      hooks: {
        onPreToolUse: this.#toolPolicyGuard.buildPreToolUseHook(
          profile,
          auditWriter
        )
      },
      model: this.#modelProvider?.model ?? profile.model,
      ...(this.#modelProvider?.mode === "byok"
        ? { provider: this.#modelProvider.provider }
        : {}),
      reasoningEffort: "high",
      streaming: REVIEW_STREAMING_ENABLED,
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

    const session = await this.#clientManager.getClient().createSession(sessionConfig);

    return new SessionExecutor(session);
  }
}
