import {
  type SessionConfig
} from "@github/copilot-sdk";

import type {
  ReviewSessionCreationOptions,
  ReviewSessionFactoryLike,
  ReviewSessionProfileLike
} from "../core/session-factory-contracts.ts";
import { SessionTurnAbortedError } from "../core/errors.ts";
import type { CopilotClientLike } from "./copilot-client-manager.ts";
import {
  SessionExecutor,
  type SessionLike
} from "./session-executor.ts";
import type { KnowledgeSvc } from "./knowledge.ts";
import { buildRemoveAllSectionsConfig } from "./review-system-message-sections.ts";
import { ToolPolicyGuard } from "./tool-policy/tool-policy-guard.ts";
import type { ToolAuditSink } from "./tool-audit-writer.ts";
import type { ResolvedReviewSessionModelProvider } from "./review-model-provider-resolver.ts";

export type ReviewSessionProfile = ReviewSessionProfileLike;

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
    const sessionPromise = this.#clientManager.getClient().createSession(sessionConfig);
    const session = await waitForSessionCreation(sessionPromise, options?.signal);

    return new SessionExecutor(session);
  }
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
