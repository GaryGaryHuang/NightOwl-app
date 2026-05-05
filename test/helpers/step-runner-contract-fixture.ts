import assert from "node:assert/strict";

import {
  type FileReviewContextInput,
  FileReviewContext
} from "../../src/core/file-review-context.ts";
import type { VerifierReportEntry } from "../../src/core/verifier-report.ts";
import type { ReviewSectionKey } from "../../src/core/review-section-contract.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../../src/core/review-runtime-contract.ts";
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
      validateCandidateFindingsV3WithReport(_input) {
        return {
          payload: {
            result: "NO_FINDINGS",
            findings: [],
            hypothesisClosure: [],
            criticalMissingInformation: []
          },
          report: emptyReport
        };
      },
      validateValidationReportV1WithReport(_input) {
        return {
          payload: {
            schemaVersion: 1,
            overallStatus: "PASS",
            perFindingResults: [],
            approvedFindings: [],
            missingInformationItems: [],
            loopControl: { action: "accept", reason: "no findings" }
          },
          report: emptyReport
        };
      }
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
  const stepId = input.stepId ?? "step7-summary";
  const sectionKey = input.sectionKey ?? "summary";

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
          timeoutMs: REVIEW_TURN_TIMEOUT_MS
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
          timeoutMs: REVIEW_TURN_TIMEOUT_MS
        },
        resolve: input.resolve ?? (async (_response: string, _services: StepResolveServices) => {
          return (context: FileReviewContext) => {
            context.setCandidateFindingsV3({
              result: "NO_FINDINGS",
              findings: [],
              hypothesisClosure: [],
              criticalMissingInformation: []
            });
          };
        })
      };
    }
  };
}

// Canonical section content reused by prompt-rebuild tests.
// Each step sees all prior sections; the step response is the current section.
export const SECTION_SEEDS: Record<string, string> = {
  "custom-analysis": [
    "## Custom Analysis",
    "- 測試用自訂 section"
  ].join("\n"),
  "custom-risk-notes": [
    "## Custom Risk Notes",
    "- 自訂 section 可以保留 generic note rendering 行為"
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
  "step7-summary", "src/app.ts", "summary", "must contain summary fields"
);

export const SUMMARY_RESPONSE = [
  "## Summary",
  "### 審查基礎",
  "- 改動概要：調整主要執行流程。",
  "- 依據規範：依 repo source-of-truth 與版本假設審查。",
  "- 必要假設：無。",
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

export function runDefaultJudgeSectionStep(
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
