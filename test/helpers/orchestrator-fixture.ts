import type { FileReviewContext, Finding } from "../../src/core/file-review-context.ts";
import type { StepResult } from "../../src/core/step-runner.ts";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function buildOverviewResponse(filePath: string): string {
  return [
    "## Overview",
    `- 整體理解：${filePath} 位於本次 changeset 中`,
    "- 行為變更：無行為變更",
    `- 檔案職責：負責 ${filePath}`,
    "- 改動目的：調整測試資料",
    `- 影響範圍：${filePath}`,
    "- 測試覆蓋觀察：未見對應測試異動"
  ].join("\n");
}

export function buildDependenciesResponse(filePath: string): string {
  return [
    "## Dependencies & Boundaries",
    "- 相依清單：",
    `  - \`[${filePath}:valueService]\` → 提供 value 更新 → Consume`,
    "    - Contract：輸入 value 並回傳更新結果",
    "    - 評估：此 diff 維持既有 boundary",
    "- 隱含相依：",
    "  - 無"
  ].join("\n");
}

export function buildKnowledgeResponse(filePath: string): string {
  return [
    "## Knowledge & Source of Truth",
    "- 版本／文件參考：",
    `  - ${filePath} package.json — repo-native source`,
    "- 採用規則與假設：",
    "  - 依 repo 內設定檔與版本檔推論行為約束",
    "- 排除範圍：",
    "  - 外部官方文件查證不在本次 foundation 範圍內"
  ].join("\n");
}

export function lineRangeTraceability(lineStart: number, lineEnd: number) {
  return {
    kind: "line-range" as const,
    lineStart,
    lineEnd
  };
}

// Identifies the current SOP step from the "## Current Step: <name>" header
// injected into every review session's system message.
export function detectStepId(
  systemMessage: string
):
  | "step1-overview"
  | "step2-dependencies-boundaries"
  | "step3-knowledge-source-of-truth"
  | "step4-strategy-what-if-scenarios"
  | "step5-validation-interrogation"
  | "step6-cognitive-simulation"
  | "step7-summary" {
  if (/## Current Step: Overview/u.test(systemMessage)) {
    return "step1-overview";
  }

  if (/## Current Step: Dependencies & Boundaries/u.test(systemMessage)) {
    return "step2-dependencies-boundaries";
  }

  if (/## Current Step: Knowledge & Source of Truth/u.test(systemMessage)) {
    return "step3-knowledge-source-of-truth";
  }

  if (/## Current Step: Strategy & What-if Scenarios/u.test(systemMessage)) {
    return "step4-strategy-what-if-scenarios";
  }

  if (/## Current Step: Validation & Interrogation/u.test(systemMessage)) {
    return "step5-validation-interrogation";
  }

  if (/## Current Step: Cognitive Simulation/u.test(systemMessage)) {
    return "step6-cognitive-simulation";
  }

  if (/## Current Step: Summary/u.test(systemMessage)) {
    return "step7-summary";
  }

  throw new Error(`Unable to detect step from system message: ${systemMessage.slice(0, 200)}`);
}

// Extracts the reviewed file path from a step prompt. Two formats are tried:
//   1. <diff path="..."> — used by Steps 1–6.
//   2. - Source file: `...`  — used by Step 7 (summary).
export function extractDiffPath(prompt: string): string {
  const match = prompt.match(/<diff path="([^"]+)"/u);

  if (match) {
    return match[1];
  }

  const sourceMatch = prompt.match(/- Source file: `([^`]+)`/u);

  if (sourceMatch) {
    return sourceMatch[1];
  }

  throw new Error(`Missing diff path in prompt: ${prompt}`);
}

export function buildStandardStep5JsonResponse(): string {
  return JSON.stringify({
    findings: [
      {
        type: "must",
        title: "問題標題",
        traceability: lineRangeTraceability(1, 1),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 88
      }
    ]
  });
}

export function buildStandardStep6JsonResponse(): string {
  return JSON.stringify({
    findings: [
      {
        type: "must",
        title: "問題標題",
        traceability: lineRangeTraceability(1, 1),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 91
      }
    ]
  });
}

export function buildStandardStep7SummaryResponse(filePath: string): string {
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${filePath} 這次改動主要調整執行流程。`,
    `- 依據規範：依 ${filePath} 的 repo source-of-truth 與版本假設審查。`,
    "- 審查假設：未擴張到外部知識查證。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    "- 整體風險等級：Medium",
    "- 風險理由：final findings 仍需留意。"
  ].join("\n");
}

export function buildSimulationStep5JsonResponse(): string {
  return JSON.stringify({
    findings: [
      {
        type: "must",
        title: "初版 findings",
        traceability: lineRangeTraceability(1, 1),
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 88
      }
    ]
  });
}

export function buildSimulationStep6JsonResponse(): string {
  return JSON.stringify({
    findings: [
      {
        type: "must",
        title: "最終 findings",
        traceability: lineRangeTraceability(1, 1),
        context: "模擬後確認的具體情境",
        deviation: "經 simulation 後確認最終落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
}

// `whatIfStyle: "minimal"` emits a single W1 scenario; default "full" emits
// three scenarios. Use "minimal" when the test only needs a parseable response
// and does not assert on scenario count.
export function buildStrategyResponse(
  filePath: string,
  options?: { label?: string; whatIfStyle?: "full" | "minimal" }
): string {
  const label = options?.label ?? filePath;
  const whatIfs =
    options?.whatIfStyle === "minimal"
      ? [
          `  - W1: 觸發條件：${label} 輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程`
        ]
      : [
          `  - W1: 觸發條件：${label} 輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程`,
          `  - W2: 觸發條件：${label} 依賴回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示 dependency boundary`,
          `  - W3: 觸發條件：${label} 重複執行；預期正確行為：結果應保持穩定；待驗證風險/不確定性：狀態是否累積偏移；與本次改動的關聯：Step 3 已收斂假設與範圍`
        ];
  return [
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    `  - state transition：${label} 這次改動調整了主要執行路徑，值得驗證狀態切換是否一致`,
    "- What-if 假設情境：",
    ...whatIfs
  ].join("\n");
}

export type Step7NarrativeRiskLevel = "High" | "Medium" | "Low" | "None";

export function buildSummaryResponse(
  filePath: string,
  options: { label?: string; riskLevel?: Step7NarrativeRiskLevel } = {}
): string {
  const label = options.label ?? filePath;
  const riskLevel = options.riskLevel ?? "Medium";
  return [
    "## Summary",
    "### 審查基礎",
    `- 改動概要：${label} 這次改動主要調整執行流程。`,
    `- 依據規範：依 ${label} 的 repo source-of-truth 與版本假設審查。`,
    "- 審查假設：未擴張到外部知識查證。",
    "### 行為變更提醒",
    "- 無",
    "### 風險評估",
    `- 整體風險等級：${riskLevel}`,
    "- 風險理由：final findings 仍需留意。"
  ].join("\n");
}

export function createFinding(type: "must" | "nice", title: string, confidence = 90): Finding {
  return {
    type,
    title,
    traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 guard",
    confidence
  };
}

export function buildFindingsForFile(filePath: string): Finding[] {
  if (filePath === "src/app.ts") {
    return [
      createFinding("must", "must finding"),
      createFinding("nice", "nice finding")
    ];
  }

  if (filePath === "packages/app/index.ts") {
    return [createFinding("must", "only must finding")];
  }

  return [];
}

export interface SuccessfulStepResultOptions {
  onTerminalApply?: () => void;
  findingsByFile?: ReadonlyMap<string, Finding[]>;
  narrativeRiskByFile?: ReadonlyMap<string, Step7NarrativeRiskLevel>;
}

/**
 * Builds a StepResult whose `applyTo` writes to the correct FileReviewContext
 * slot for each step. This mirrors the real step implementations so orchestrator
 * tests can verify state propagation without running an actual Copilot session.
 *
 * The optional `narrativeRiskByFile` map lets tests override the risk level
 * written in the Step 7 summary, enabling assertions on risk-level derivation.
 */
export function buildSuccessfulStepResult(
  stepId: string,
  filePath: string,
  options: SuccessfulStepResultOptions = {}
): StepResult {
  if (stepId === "step1-overview") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection("overview", buildOverviewResponse(filePath));
      }
    };
  }

  if (stepId === "step2-dependencies-boundaries") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "dependencies-boundaries",
          buildDependenciesResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step3-knowledge-source-of-truth") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "knowledge-source-of-truth",
          buildKnowledgeResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step4-strategy-what-if-scenarios") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "strategy-what-if-scenarios",
          buildStrategyResponse(filePath)
        );
      }
    };
  }

  if (stepId === "step5-validation-interrogation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setFindings(options.findingsByFile?.get(filePath) ?? buildFindingsForFile(filePath));
      }
    };
  }

  if (stepId === "step6-cognitive-simulation") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setFindings(options.findingsByFile?.get(filePath) ?? buildFindingsForFile(filePath));
      }
    };
  }

  if (stepId === "step7-summary") {
    return {
      stepId,
      applyTo(targetContext: FileReviewContext) {
        targetContext.setSection(
          "summary",
          buildSummaryResponse(filePath, { riskLevel: options.narrativeRiskByFile?.get(filePath) })
        );
        options.onTerminalApply?.();
      }
    };
  }

  throw new Error(`Unexpected step: ${stepId}`);
}
