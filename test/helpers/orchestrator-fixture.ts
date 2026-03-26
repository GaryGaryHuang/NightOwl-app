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
