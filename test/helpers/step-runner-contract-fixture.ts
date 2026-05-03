import assert from "node:assert/strict";

import {
  type FileReviewContextInput,
  type FindingsPayload,
  FileReviewContext
} from "../../src/core/file-review-context.ts";
import type { VerifierReportEntry } from "../../src/core/verifier-report.ts";
import type { ReviewSectionKey } from "../../src/core/review-section-contract.ts";
import {
  type StepDefinition,
  type StepExecutionPlan,
  type StepResolveServices,
  StepRunner
} from "../../src/core/step-runner.ts";
import type { ReviewSessionFactoryLike } from "../../src/core/session-factory-contracts.ts";
import { SessionExecutor } from "../../src/services/session-executor.ts";
import { lineRangeTraceability } from "./orchestrator-fixture.ts";

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

export function makeSectionResolve(sectionKey: ReviewSectionKey): StepExecutionPlan["resolve"] {
  return async (response, _services) => {
    return (targetContext) => {
      targetContext.setSection(sectionKey, response);
    };
  };
}

export function makePassingJudgeServices(): StepResolveServices {
  const emptyReport: VerifierReportEntry[] = [];

  return {
    judgeService: {
      async evaluate(_input) {
        return { passed: true };
      }
    },
    validator: {
      validate(_input) {
        return { schemaVersion: 2, findings: [] };
      },
      validateWithReport(_input) {
        return { payload: { schemaVersion: 2, findings: [] }, report: emptyReport };
      },
      filterByAcceptance(payload: FindingsPayload) {
        return payload;
      },
      filterByAcceptanceWithReport(payload: FindingsPayload) {
        return { payload, report: emptyReport };
      },
      validateWithDispositions(_input) {
        return { schemaVersion: 2, findings: [], dispositions: [] };
      },
      validateDispositionCompleteness(_input) {}
    }
  };
}

export { lineRangeTraceability };

export function diffHunkTraceability(hunkHeader: string) {
  return {
    kind: "diff-hunk" as const,
    hunkHeader
  };
}

// Minimal step-definition factory used by tests that focus on StepRunner
// behavior (retry, error wrapping) rather than prompt content or judge/validator logic.
export function createSectionTestStep(input: {
  stepId?: string;
  sectionKey?: ReviewSectionKey;
  systemMessage?: string;
  userMessage?: string;
  reviewProfile?: StepExecutionPlan["reviewProfile"];
  resolve?: StepExecutionPlan["resolve"];
}) {
  const stepId = input.stepId ?? "step1-overview";
  const sectionKey = input.sectionKey ?? "overview";

  return {
    stepId,
    prepare() {
      return {
        stepId,
        prompt: {
          systemMessage: input.systemMessage ?? "system prompt",
          userMessage: input.userMessage ?? "user prompt"
        },
        reviewProfile: input.reviewProfile ?? {
          knowledgeMode: "disabled",
          model: "gpt-5-mini",
          timeoutMs: 300_000
        },
        resolve: input.resolve ?? (async (response: string) => {
          return (context: FileReviewContext) => {
            context.setSection(sectionKey, response);
          };
        })
      };
    }
  };
}

// Helper resolve that calls judgeService — use in tests that verify judge invocation or retry via judge rejection.
export function makeSectionResolveWithJudge(
  stepId: string,
  filePath: string,
  sectionKey: ReviewSectionKey,
  criteria: string
): StepExecutionPlan["resolve"] {
  return async (response: string, services: StepResolveServices) => {
    if (!services.judgeService) {
      throw new Error("judge service is not configured");
    }

    const judgeResult = await services.judgeService.evaluate({
      stepId,
      filePath,
      criteria,
      sectionContent: response
    });

    if (!judgeResult.passed) {
      throw new Error(judgeResult.cause ?? "judge rejected");
    }

    return (context: FileReviewContext) => {
      context.setSection(sectionKey, response);
    };
  };
}

export function createStructuredTestStep(input: {
  stepId?: string;
  userMessage?: string;
  reviewProfile?: StepExecutionPlan["reviewProfile"];
  resolve?: StepExecutionPlan["resolve"];
}) {
  const stepId = input.stepId ?? "step5-validation-interrogation";

  return {
    stepId,
    prepare() {
      return {
        stepId,
        prompt: {
          systemMessage: "system prompt",
          userMessage: input.userMessage ?? "user prompt"
        },
        reviewProfile: input.reviewProfile ?? {
          knowledgeMode: "disabled",
          model: "gpt-5-mini",
          timeoutMs: 300_000
        },
        resolve: input.resolve ?? (async (response: string, services: StepResolveServices) => {
          const validated = services.validator.validate({
            responseText: response
          });
          const payload = services.validator.filterByAcceptance(validated);

          return (context: FileReviewContext) => {
            context.setFindings(payload.findings);
          };
        })
      };
    }
  };
}

// Canonical section content reused by prompt-rebuild tests.
// Each step sees all prior sections; the step response is the current section.
export const SECTION_SEEDS: Record<string, string> = {
  overview: [
    "## Overview",
    "- 整體理解：測試用概覽",
    "- 行為變更：無行為變更",
    "- 檔案職責：維護 app value",
    "- 改動目的：調整常數",
    "- 影響範圍：src/app.ts",
    "- 測試覆蓋觀察：未見對應測試異動"
  ].join("\n"),
  "dependencies-boundaries": [
    "## Dependencies & Boundaries",
    "- 相依清單：",
    "  - 無外部相依",
    "- 隱含相依：",
    "  - 無"
  ].join("\n"),
  "knowledge-source-of-truth": [
    "## Knowledge & Source of Truth",
    "- 版本／文件參考：",
    "  - 無",
    "- 採用規則與假設：",
    "  - 依 repo 內設定檔推論版本約束",
    "- 排除範圍：",
    "  - 外部官方文件查證不在本次 foundation 範圍內"
  ].join("\n"),
  "strategy-what-if-scenarios": [
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    "  - state transition：本次改動調整 value 更新流程",
    "- What-if 假設情境：",
    "  - W1: 觸發條件：value 為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整路徑",
    "  - W2: 觸發條件：依賴回傳異常；預期正確行為：應保留錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示邊界",
    "  - W3: 觸發條件：多次呼叫；預期正確行為：結果應穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
  ].join("\n")
};

export const INITIAL_FINDING = {
  type: "must",
  title: "初版 findings",
  traceability: lineRangeTraceability(30, 32),
  expectedBehavior: "初版預期行為",
  actualBehavior: "初版實際行為",
  deviation: "初版落差",
  impact: "初版 impact",
  suggestion: "初版建議",
} as const;

export const FINAL_FINDING = {
  type: "must",
  title: "最終 findings",
  traceability: diffHunkTraceability("@@ -1 +1 @@"),
  expectedBehavior: "最終預期行為",
  actualBehavior: "最終實際行為",
  deviation: "最終落差",
  impact: "最終 impact",
  suggestion: "最終建議",
} as const;

export const NICE_FINAL_FINDING = {
  type: "nice",
  title: "從空 findings 補出的最終問題",
  traceability: lineRangeTraceability(40, 40),
  expectedBehavior: "最終預期行為",
  actualBehavior: "最終實際行為",
  deviation: "最終落差",
  impact: "最終 impact",
  suggestion: "最終建議",
} as const;

export const DEFAULT_JUDGE_RESOLVE = makeSectionResolveWithJudge(
  "step1-overview", "src/app.ts", "overview", "must contain overview fields"
);

export const SUMMARY_RESPONSE = [
  "## Summary",
  "### 審查基礎",
  "- 改動概要：調整主要執行流程。",
  "- 依據規範：依 repo source-of-truth 與版本假設審查。",
  "- 審查假設：未擴張到外部知識查證。",
  "### 行為變更提醒",
  "- 無",
  "### 風險評估",
  "- 整體風險等級：High",
  "- 風險理由：final findings 仍需留意。"
].join("\n");

export function runDefaultSectionStep(
  runner: StepRunner,
  context: ReturnType<typeof createStepRunnerContext>
) {
  return runner.run({
    step: createSectionTestStep({}),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });
}

export function runDefaultJudgeOverviewStep(
  runner: StepRunner,
  context: ReturnType<typeof createStepRunnerContext>
) {
  return runner.run({
    step: createSectionTestStep({
      resolve: DEFAULT_JUDGE_RESOLVE
    }),
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });
}

// Shared helper for prompt-rebuild tests.
// Each step rebuilds its prompt from committed context state on retry;
// provisional content from the first attempt must not leak.
export async function assertPromptRebuildOnRetry(input: {
  seedSections: string[];
  step: StepDefinition;
  response: string;
  expectedPromptLandmark: RegExp;
  provisionalLabel: string;
  resultSectionKey: ReviewSectionKey;
  resultPattern: RegExp;
  extraAssertions?: (context: ReturnType<typeof createStepRunnerContext>) => void;
}): Promise<void> {
  const prompts: string[] = [];
  const context = createStepRunnerContext();

  for (const key of input.seedSections) {
    context.setSection(key, SECTION_SEEDS[key]);
  }

  const runner = new StepRunner({
    reviewSessionFactory: createReviewSessionFactory({
      onSendAndWait({ prompt }) {
        prompts.push(prompt);
        return input.response;
      }
    }),
    judgeService: {
      async evaluate(evalInput) {
        if (prompts.length === 1) {
          assert.doesNotMatch(
            evalInput.sectionContent,
            new RegExp(input.provisionalLabel, "u")
          );
          return { passed: false, cause: "judge rejected" };
        }

        return { passed: true };
      }
    }
  });

  const result = await runner.run({
    step: input.step,
    context,
    outputBaseDir: "/workspace/output",
    repoRoot: "/workspace/repo"
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0], prompts[1]);
  assert.match(prompts[0] ?? "", /<review_state\b/u);
  assert.match(prompts[0] ?? "", input.expectedPromptLandmark);
  assert.doesNotMatch(prompts[0] ?? "", /Review not yet generated/u);
  assert.doesNotMatch(
    prompts[0] ?? "",
    new RegExp(input.provisionalLabel, "u")
  );
  assert.equal(context.getSection(input.resultSectionKey), undefined);

  result.applyTo(context);

  assert.match(
    context.getSection(input.resultSectionKey) ?? "",
    input.resultPattern
  );
  input.extraAssertions?.(context);
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
 * Creates a minimal ReviewSessionFactoryLike that tracks each created
 * session and each sendAndWait call with per-session and per-send counters.
 * Tests use the hook callbacks to assert on call ordering, retry behaviour,
 * and early disconnects without needing a real Copilot connection.
 */
export function createReviewSessionFactory(input: {
  onCreateSession?: (profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0], sessionIndex: number) => void;
  onSendAndWait: (call: {
    profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0];
    prompt: string;
    timeoutMs?: number;
    sessionIndex: number;
    sendIndex: number;
  }) => string | undefined;
  onDisconnect?: (call: {
    profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0];
    sessionIndex: number;
    sendCount: number;
  }) => void;
  onAbort?: (call: {
    profile: Parameters<ReviewSessionFactoryLike["createSession"]>[0];
    sessionIndex: number;
    sendCount: number;
  }) => void;
}): ReviewSessionFactoryLike {
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
