import {
  type FileReviewContextInput,
  FileReviewContext
} from "../../src/core/file-review-context.ts";
import type { StepExecutionPlan, StepReviewSessionFactoryLike } from "../../src/core/step-runner.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";

const DEFAULT_CONTEXT_INPUT: FileReviewContextInput = {
  filePath: "src/app.ts",
  noteFilePath: "/workspace/output/.nightowl/review/run/files/src__app.ts.md",
  diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
  baseRef: "main",
  headRef: "feature-branch"
};

export function createStepRunnerContext(
  overrides: Partial<FileReviewContextInput> = {}
): FileReviewContext {
  return new FileReviewContext({
    ...DEFAULT_CONTEXT_INPUT,
    ...overrides
  });
}

export function applySection(sectionKey: string): StepExecutionPlan["applyTo"] {
  return (targetContext, response) => {
    if (typeof response !== "string") {
      throw new Error(`expected string response for section ${sectionKey}`);
    }

    targetContext.setSection(sectionKey, response);
  };
}

export { lineRangeTraceability } from "./orchestrator-fixture.ts";

export function diffHunkTraceability(hunkHeader: string) {
  return {
    kind: "diff-hunk" as const,
    hunkHeader
  };
}

// Step 4 (Strategy & What-if Scenarios) reads the accumulated prior sections
// from FileReviewContext when building its prompt. This helper pre-populates
// the context so StepRunner tests for Step 4 receive a realistic prompt
// without having to run Steps 1–3 first.
export function seedStep4Context(context: FileReviewContext): void {
  context.setSection(
    "overview",
    [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );
  context.setSection(
    "dependencies-boundaries",
    [
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - 無外部相依",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - 無",
      "- 採用規則與假設：",
      "  - 依 repo 內設定檔推論版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );
  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：本次改動調整 value 更新流程",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：value 為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整路徑",
      "  - W2: 觸發條件：依賴回傳異常；預期正確行為：應保留錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：多次呼叫；預期正確行為：結果應穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );
}

/**
 * Creates a minimal StepReviewSessionFactoryLike that tracks each created
 * session and each sendAndWait call with per-session and per-send counters.
 * Tests use the hook callbacks to assert on call ordering, retry behaviour,
 * and early disconnects without needing a real Copilot connection.
 */
export function createReviewSessionFactory(input: {
  onCreateSession?: (profile: Parameters<StepReviewSessionFactoryLike["createSession"]>[0], sessionIndex: number) => void;
  onSendAndWait: (call: {
    profile: Parameters<StepReviewSessionFactoryLike["createSession"]>[0];
    prompt: string;
    timeoutMs?: number;
    sessionIndex: number;
    sendIndex: number;
  }) => string | undefined;
  onDisconnect?: (call: {
    profile: Parameters<StepReviewSessionFactoryLike["createSession"]>[0];
    sessionIndex: number;
    sendCount: number;
  }) => void;
  onAbort?: (call: {
    profile: Parameters<StepReviewSessionFactoryLike["createSession"]>[0];
    sessionIndex: number;
    sendCount: number;
  }) => void;
}): StepReviewSessionFactoryLike {
  let sessionIndex = 0;

  return {
    async createSession(profile) {
      sessionIndex += 1;
      const currentSessionIndex = sessionIndex;
      input.onCreateSession?.(profile, currentSessionIndex);
      let sendIndex = 0;

      return new SessionExecutor({
        async sendAndWait(options, timeoutMs) {
          sendIndex += 1;
          const content = input.onSendAndWait({
            profile,
            prompt: options.prompt,
            timeoutMs,
            sessionIndex: currentSessionIndex,
            sendIndex
          });

          return {
            data: {
              content
            }
          };
        },
        async disconnect() {
          input.onDisconnect?.({
            profile,
            sessionIndex: currentSessionIndex,
            sendCount: sendIndex
          });
        },
        async abort() {
          input.onAbort?.({
            profile,
            sessionIndex: currentSessionIndex,
            sendCount: sendIndex
          });
        }
      });
    }
  };
}
