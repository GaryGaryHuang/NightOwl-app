import {
  type SessionConfig
} from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import type { ReviewSessionFactoryLike } from "../core/session-factory-contracts.ts";
import {
  type CopilotClientLike,
  SessionExecutor
} from "./session-executor.ts";
import type { KnowledgeSvc } from "./knowledge.ts";
import { ToolPolicyGuard } from "./tool-policy-guard.ts";
import type { ToolAuditSink } from "./tool-audit-writer.ts";

export interface ReviewSessionProfile {
  stepId?: string;
  knowledgeMode?: ReviewKnowledgeMode;
  model: string;
  outputBaseDir: string;
  repoRoot: string;
  systemMessage: string;
  workingDirectory?: string;
}

/**
 * The explicit set of tool names exposed to LLM in review sessions.
 * Matches the SOP tool capability set defined in tool-spec.md §3.1.
 */
export const REVIEW_AVAILABLE_TOOLS = [
  "bash",
  "web_fetch",
  "view",
  "grep",
  "glob"
] as const;

export interface ReviewSessionFactoryOptions {
  clientManager: {
    getClient(): Pick<CopilotClientLike, "createSession">;
  };
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  toolPolicyGuard: ToolPolicyGuard;
  auditWriterProvider?: () => ToolAuditSink | undefined;
}

/**
 * Build review sessions with review-specific tool policy, knowledge injection, and optional audit wiring.
 */
export class ReviewSessionFactory implements ReviewSessionFactoryLike {
  readonly #clientManager: ReviewSessionFactoryOptions["clientManager"];
  readonly #knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  readonly #toolPolicyGuard: ToolPolicyGuard;
  readonly #auditWriterProvider?: () => ToolAuditSink | undefined;

  constructor(options: ReviewSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
    this.#knowledgeSvc = options.knowledgeSvc;
    this.#toolPolicyGuard = options.toolPolicyGuard;
    this.#auditWriterProvider = options.auditWriterProvider;
  }

  async createSession(profile: ReviewSessionProfile): Promise<SessionExecutor> {
    const auditWriter = this.#auditWriterProvider?.();
    const sessionConfig: SessionConfig = {
      availableTools: [...REVIEW_AVAILABLE_TOOLS],
      hooks: {
        onPreToolUse: this.#toolPolicyGuard.buildPreToolUseHook(
          profile,
          auditWriter
        )
      },
      model: profile.model,
      reasoningEffort: "high",
      streaming: false,
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
        content: profile.systemMessage
      },
      onPermissionRequest: this.#toolPolicyGuard.buildPermissionHandler(
        profile,
        auditWriter
      )
    };

    // Default to built-in Context7 unless a step explicitly opts out of knowledge mode.
    const mcpServers = this.#knowledgeSvc?.getMcpServers(
      profile.knowledgeMode ?? "built-in-context7"
    );

    if (mcpServers) {
      sessionConfig.mcpServers = mcpServers;
    }

    if (profile.workingDirectory) {
      sessionConfig.workingDirectory = profile.workingDirectory;
    }

    const session = await this.#clientManager.getClient().createSession(sessionConfig);

    return new SessionExecutor(session);
  }
}
