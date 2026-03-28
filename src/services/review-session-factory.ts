import {
  type SessionConfig
} from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import {
  type CopilotClientLike,
  SessionExecutor
} from "./session-executor.ts";
import type { KnowledgeSvc } from "./knowledge.ts";
import { ToolPolicyGuard } from "./tool-policy-guard.ts";
import type { ToolAuditWriter } from "./tool-audit-writer.ts";

export interface ReviewSessionProfile {
  knowledgeMode?: ReviewKnowledgeMode;
  model: string;
  outputBaseDir: string;
  repoRoot: string;
  systemMessage: string;
  workingDirectory?: string;
}

export interface ReviewSessionFactoryOptions {
  clientManager: {
    getClient(): Pick<CopilotClientLike, "createSession">;
  };
  knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  toolPolicyGuard: ToolPolicyGuard;
}

/**
 * Build review sessions with review-specific tool policy, knowledge injection, and optional audit wiring.
 */
export class ReviewSessionFactory {
  readonly #clientManager: ReviewSessionFactoryOptions["clientManager"];
  readonly #knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  readonly #toolPolicyGuard: ToolPolicyGuard;
  #auditWriter?: ToolAuditWriter;

  constructor(options: ReviewSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
    this.#knowledgeSvc = options.knowledgeSvc;
    this.#toolPolicyGuard = options.toolPolicyGuard;
  }

  async createSession(profile: ReviewSessionProfile): Promise<SessionExecutor> {
    const sessionConfig: SessionConfig = {
      hooks: {
        onPreToolUse: this.#toolPolicyGuard.buildPreToolUseHook(
          profile,
          this.#auditWriter
        )
      },
      model: profile.model,
      reasoningEffort: "high",
      streaming: false,
      systemMessage: {
        mode: "replace",
        content: profile.systemMessage
      },
      onPermissionRequest: this.#toolPolicyGuard.buildPermissionHandler(
        profile,
        this.#auditWriter
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

  setAuditWriter(writer: ToolAuditWriter): void {
    this.#auditWriter = writer;
  }
}
