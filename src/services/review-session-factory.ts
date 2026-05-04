import {
  type SessionEvent,
  type SessionConfig
} from "@github/copilot-sdk";

import type { ReviewKnowledgeMode } from "../core/review-knowledge-mode.ts";
import {
  REVIEW_STREAMING_ENABLED,
  REVIEW_TURN_TIMEOUT_SECONDS
} from "../core/review-runtime-contract.ts";
import type { ReviewSessionFactoryLike } from "../core/session-factory-contracts.ts";
import type { CopilotClientLike } from "./copilot-client-manager.ts";
import { SessionExecutor } from "./session-executor.ts";
import type { KnowledgeSvc } from "./knowledge.ts";
import { buildRemoveAllSectionsConfig } from "./review-system-message-sections.ts";
import { ToolPolicyGuard } from "./tool-policy/tool-policy-guard.ts";
import type { ToolAuditSink } from "./tool-audit-writer.ts";

export interface ReviewSessionProfile {
  stepId?: string;
  knowledgeMode: ReviewKnowledgeMode;
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
  toolPolicyGuard: ToolPolicyGuard;
  auditWriterProvider?: () => ToolAuditSink | undefined;
  onSessionLogEvent?: (event: ReviewSessionLogEvent) => void;
}

export interface ReviewSessionLogEvent {
  stepId: string;
  message: string;
}

/**
 * Build review sessions with review-specific tool policy, knowledge injection, and optional audit wiring.
 */
export class ReviewSessionFactory implements ReviewSessionFactoryLike {
  readonly #clientManager: ReviewSessionFactoryOptions["clientManager"];
  readonly #knowledgeSvc?: Pick<KnowledgeSvc, "getMcpServers">;
  readonly #toolPolicyGuard: ToolPolicyGuard;
  readonly #auditWriterProvider?: () => ToolAuditSink | undefined;
  readonly #onSessionLogEvent?: (event: ReviewSessionLogEvent) => void;

  constructor(options: ReviewSessionFactoryOptions) {
    this.#clientManager = options.clientManager;
    this.#knowledgeSvc = options.knowledgeSvc;
    this.#toolPolicyGuard = options.toolPolicyGuard;
    this.#auditWriterProvider = options.auditWriterProvider;
    this.#onSessionLogEvent = options.onSessionLogEvent;
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
      model: profile.model,
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
      ),
      ...(this.#onSessionLogEvent === undefined
        ? {}
        : {
            onEvent: buildReviewSessionEventLogger(
              profile,
              this.#onSessionLogEvent
            )
          })
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

function buildReviewSessionEventLogger(
  profile: ReviewSessionProfile,
  emit: (event: ReviewSessionLogEvent) => void
): (event: SessionEvent) => void {
  const stepId = profile.stepId ?? "review-session";
  let messageDeltaLogged = false;
  let lastStreamingBucket = -1;
  const toolNamesByCallId = new Map<string, string>();

  return (event) => {
    if (event.type === "tool.execution_start") {
      toolNamesByCallId.set(event.data.toolCallId, event.data.toolName);
    }
    const message = formatReviewSessionEvent({
      event,
      model: profile.model,
      messageDeltaLogged,
      lastStreamingBucket,
      toolNamesByCallId
    });

    if (event.type === "assistant.message_delta") {
      messageDeltaLogged = true;
    }
    if (event.type === "assistant.streaming_delta") {
      lastStreamingBucket = streamingBucket(event.data.totalResponseSizeBytes);
    }
    if (!message) {
      return;
    }

    emit({ stepId, message });
  };
}

function formatReviewSessionEvent(input: {
  event: SessionEvent;
  model: string;
  messageDeltaLogged: boolean;
  lastStreamingBucket: number;
  toolNamesByCallId: ReadonlyMap<string, string>;
}): string | undefined {
  const { event } = input;

  switch (event.type) {
    case "session.start":
      return `session started (model ${input.model}, timeout ${REVIEW_TURN_TIMEOUT_SECONDS}s, streaming on)`;

    case "assistant.message_delta":
      return input.messageDeltaLogged
        ? undefined
        : "assistant response stream started";

    case "assistant.streaming_delta": {
      const bucket = streamingBucket(event.data.totalResponseSizeBytes);
      if (bucket === input.lastStreamingBucket) {
        return undefined;
      }
      return `streaming response received (${formatBytes(event.data.totalResponseSizeBytes)})`;
    }

    case "tool.execution_start":
      return `tool started: ${event.data.toolName}`;

    case "tool.execution_progress":
      return `tool progress: ${event.data.progressMessage}`;

    case "tool.execution_complete":
      return `tool completed: ${input.toolNamesByCallId.get(event.data.toolCallId) ?? event.data.toolCallId} (${event.data.success ? "success" : "failed"})`;

    case "session.error":
      return `session error: ${event.data.message}`;

    case "session.idle":
      return "session idle";

    default:
      return undefined;
  }
}

function streamingBucket(totalResponseSizeBytes: number): number {
  if (!Number.isFinite(totalResponseSizeBytes) || totalResponseSizeBytes <= 0) {
    return -1;
  }

  return Math.floor((totalResponseSizeBytes - 1) / 8192);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${Math.max(0, Math.floor(bytes))} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KiB`;
}
