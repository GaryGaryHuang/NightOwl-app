import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionConfig } from "@github/copilot-sdk";

import type {
  ReviewContext7OverrideConfig,
  ReviewLocalMcpServerConfig,
  ReviewRemoteMcpServerConfig
} from "../../src/core/review-mcp-server-config.ts";
import type { ReviewSessionProfile } from "../../src/services/review-session-factory.ts";
import type {
  CopilotClientLike
} from "../../src/services/copilot-client-manager.ts";
import type {
  SessionLike
} from "../../src/services/session-executor.ts";
import type { ToolAuditRecord } from "../../src/services/tool-audit-writer.ts";

export const BASE_REVIEW_PROFILE: ReviewSessionProfile = {
  knowledgeMode: "built-in-context7",
  model: "gpt-5.4-mini",
  repoRoot: "/workspace/repo",
  systemMessage: "system prompt",
  workingDirectory: "/workspace/repo"
};

export function createRecordedConfigs<T = SessionConfig>(): T[] {
  return [];
}

export function createAssistantSession(
  content = "ok"
): SessionLike {
  return {
    async sendAndWait() {
      return {
        type: "assistant.message",
        data: { content }
      };
    },
    async abort() {},
    async disconnect() {}
  };
}

export function createSessionRecordingClientManager(
  recordedConfigs: SessionConfig[],
  sessionFactory: (config: SessionConfig) => SessionLike = () =>
    createAssistantSession()
) {
  return {
    getClient() {
      return {
        async createSession(config: SessionConfig) {
          recordedConfigs.push(config);
          return sessionFactory(config);
        }
      };
    }
  };
}

// Records the lifecycle events ("start" / "stop" / "forceStop") in an array
// so tests can assert the exact call sequence, including no-call scenarios
// when startup fails before the client is fully initialised.
export function createLifecycleClientFactory(
  lifecycle: string[],
  input: {
    forceStopShouldThrowBeforeStart?: boolean;
  } = {}
): () => CopilotClientLike {
  return () => ({
    async start() {
      lifecycle.push("start");
    },
    async stop() {
      lifecycle.push("stop");
    },
    async forceStop() {
      if (input.forceStopShouldThrowBeforeStart) {
        throw new Error("forceStop should not be called before startup");
      }

      lifecycle.push("forceStop");
    },
    async createSession() {
      throw new Error("createSession should not be called in this test");
    }
  });
}

export function createAuditFileFixture() {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nightowl-audit-"));
  const auditPath = path.join(tempDir, "tool-audit.jsonl");

  return {
    tempDir,
    auditPath,
    read() {
      return readFileSync(auditPath, "utf8");
    },
    cleanup() {
      rmSync(tempDir, { force: true, recursive: true });
    }
  };
}

export function createLocalMcpServer(
  overrides: Partial<ReviewLocalMcpServerConfig> = {}
): ReviewLocalMcpServerConfig {
  return {
    type: overrides.type ?? "local",
    command: overrides.command ?? "npx",
    args: overrides.args ?? ["-y", "@example/demo-mcp"],
    tools: overrides.tools ?? ["*"],
    ...(overrides.env !== undefined ? { env: overrides.env } : {}),
    ...(overrides.cwd !== undefined ? { cwd: overrides.cwd } : {}),
    ...(overrides.timeout !== undefined ? { timeout: overrides.timeout } : {})
  };
}

export function createRemoteMcpServer(
  overrides: Partial<ReviewRemoteMcpServerConfig> = {}
): ReviewRemoteMcpServerConfig {
  return {
    type: "http",
    url: "https://mcp.example.com/v1",
    tools: ["*"],
    ...overrides
  };
}

export function createContext7Override(
  overrides: Partial<ReviewContext7OverrideConfig> = {}
): ReviewContext7OverrideConfig {
  return {
    type: "context7",
    ...overrides
  };
}

export function createToolAuditRecord(
  overrides: Partial<ToolAuditRecord> = {}
): ToolAuditRecord {
  return {
    ts: "2026-03-24T10:00:00.000Z",
    tool: "shell",
    decision: "allow",
    args: { command: "git log --oneline -5" },
    ...overrides
  };
}
