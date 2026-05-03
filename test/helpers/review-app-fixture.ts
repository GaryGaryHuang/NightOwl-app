import {
  lineRangeTraceability
} from "./orchestrator-fixture.ts";

/**
 * Produces a minimal but structurally valid session response for each SOP
 * step by matching against the system-message content.
 *
 * Judge sessions (no availableTools) receive a plain "Y" so the completion
 * check passes without needing real AI output.
 * Steps 5–6 return compact JSON findings; all other steps return Markdown
 * sections in the format expected by the finalizer.
 */
export function buildSessionResponse(
  config: { systemMessage?: unknown; availableTools?: string[] },
  prompt: string
): string {
  if (Array.isArray(config.availableTools) && config.availableTools.length === 0) {
    return "Y";
  }

  const systemMessage = extractSystemMessageContent(config.systemMessage);

  if (/## Current Step: Overview/u.test(systemMessage)) {
    return [
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n");
  }

  if (/## Current Step: Dependencies & Boundaries/u.test(systemMessage)) {
    return [
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n");
  }

  if (/## Current Step: Knowledge & Source of Truth/u.test(systemMessage)) {
    return [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - demo-lib 1.0 — https://example.com/demo-lib",
      "- 採用規則與假設：",
      "  - 以 repo 內設定與版本化行為作為判讀依據",
      "- 排除範圍：",
      "  - 外部非官方補充資料不在本次範圍內"
    ].join("\n");
  }

  if (/## Current Step: Strategy & What-if Scenarios/u.test(systemMessage)) {
    return [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：值得驗證狀態切換是否一致",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：輸入為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 直接調整處理流程"
    ].join("\n");
  }

  if (/## Current Step: Validation & Interrogation/u.test(systemMessage)) {
    return JSON.stringify({
      schemaVersion: 2,
      findings: [
        {
          type: "must",
          title: "問題標題",
          traceability: lineRangeTraceability(1, 1),
          expectedBehavior: "應維持既有 fallback",
          actualBehavior: "新分支略過 fallback",
          deviation: "預期與實際有落差",
          impact: "會造成 correctness 問題",
          suggestion: "補上 guard",
          findingId: "F1"
        }
      ]
    });
  }

  if (/## Current Step: Cognitive Simulation/u.test(systemMessage)) {
    return JSON.stringify({
      schemaVersion: 2,
      findingUpdates: [
        {
          type: "must",
          title: "問題標題",
          traceability: lineRangeTraceability(1, 1),
          expectedBehavior: "應維持既有 fallback",
          actualBehavior: "simulation reaches branch without fallback",
          deviation: "預期與實際有落差",
          impact: "會造成 correctness 問題",
          suggestion: "補上 guard",
          findingId: "F1"
        }
      ],
      dispositions: [
        {
          findingId: "F1",
          status: "modified",
          reason: "SUPPORTED",
          explanation: "simulation confirms the finding"
        }
      ]
    });
  }

  if (/## Current Step: Summary/u.test(systemMessage)) {
    return [
      "## Summary",
      "### 審查基礎",
      "- 改動概要：這次改動主要調整執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 審查假設：未擴張到外部知識查證。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：High",
      "- 風險理由：至少一個 must-fix finding 經驗證後仍成立。"
    ].join("\n");
  }

  throw new Error(`Unexpected session prompt: ${prompt}`);
}

export function extractSystemMessageContent(systemMessage: unknown): string {
  if (
    systemMessage &&
    typeof systemMessage === "object" &&
    "content" in systemMessage &&
    typeof systemMessage.content === "string"
  ) {
    return systemMessage.content;
  }

  return "";
}

// Each predicate matches the step-identifying header embedded in the session's
// system message; used by tests to locate specific session configs in recorded
// arrays without coupling to session index order.
export function isKnowledgeSourceOfTruthSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Knowledge & Source of Truth/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

export function isChangesetOverviewSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Changeset Overview/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

export function isStrategyWhatIfSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Strategy & What-if Scenarios/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

export function isValidationInterrogationSystemMessage(systemMessage: unknown): boolean {
  return /## Current Step: Validation & Interrogation/u.test(
    extractSystemMessageContent(systemMessage)
  );
}

export function isJudgeSystemMessage(systemMessage: unknown): boolean {
  return /Output only Y or N/u.test(extractSystemMessageContent(systemMessage));
}
