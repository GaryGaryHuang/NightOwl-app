import type {
  BuiltinDryRunReviewStepContract
} from "./dry-run-review-step-contract.ts";

const STUB_CHANGESET_OVERVIEW = `## Changeset Overview

### 調整範圍
本次變更涉及主要業務邏輯調整，影響核心模組的介面設計與行為契約。

### 跨檔案邊界
多個模組之間存在介面依賴，變更需要同步更新呼叫端。

### 行為變更
主要函式的輸入參數或輸出型別有所調整，可能影響下游消費者的行為預期。

### 測試覆蓋觀察
[dry-run] 測試覆蓋狀態待真實 run 驗證。`;

const STUB_OVERVIEW = `## Overview

### 整體理解
[dry-run] 此檔案在 changeset 中扮演核心角色，負責協調相關功能模組的互動。

### 行為變更
[dry-run] 可觀察到的行為變更：主要函式簽名調整，影響直接呼叫端。

### 檔案職責
[dry-run] 此檔案的主要職責為定義介面契約與協調業務邏輯。

### 改動目的
[dry-run] 根據 diff 可觀察到的改動方向：擴充現有介面以支援新功能參數。

### 影響範圍
[dry-run] 直接影響區域：本檔案匯出的公開 API 及其直接使用者。

### 測試覆蓋觀察
[dry-run] 對應測試檔案的覆蓋範圍待真實 run 驗證。`;

const STUB_DEPENDENCIES_BOUNDARIES = `## Dependencies & Boundaries

### 相依清單
- [dry-run] 依賴模組 A：提供資料存取介面
- [dry-run] 依賴模組 B：提供業務邏輯服務

### 隱含相依
- [dry-run] 隱含型別依賴：透過 structural typing 依賴上游介面形狀`;

const STUB_KNOWLEDGE_SOURCE_OF_TRUTH = `## Knowledge & Source of Truth

### 版本／文件參考
- [dry-run] 相關規格文件待真實 run 驗證

### 採用規則與假設
- [dry-run] 本次實作遵循現有架構慣例

### 排除範圍
- [dry-run] 外部 API 版本相容性待確認`;

const STUB_STRATEGY_WHAT_IF = `## Strategy & What-if Scenarios

### 高風險區域
[dry-run] 介面變更可能影響下游消費者，需確認向下相容性。

### What-if 分析

W1: 若下游消費者未更新至新介面 → 型別錯誤或執行時例外。
[dry-run] 緩解：確保向下相容或提供遷移路徑。

W2: 若輸入參數為 undefined 或 null → 潛在的 NullReferenceError。
[dry-run] 緩解：加入防禦性邊界檢查。

W3: 若並行呼叫競爭同一資源 → 競態條件可能導致狀態不一致。
[dry-run] 緩解：審視並行存取保護機制。`;

const STUB_VALIDATION_INTERROGATION = '{"findings": []}';

const STUB_COGNITIVE_SIMULATION = '{"findings": []}';

const STUB_SUMMARY = `## Summary

### 審查基礎
[dry-run] 本次審查基於 diff 內容與 stub 佔位資料，非真實 AI 分析。

### 行為變更提醒
無

### 風險評估
整體風險等級：None
[dry-run] 此為 dry-run 模式產出，不反映真實風險評估結果。`;

const DRY_RUN_STUB_RESPONSES: Record<BuiltinDryRunReviewStepContract, string> = {
  "changeset-overview": STUB_CHANGESET_OVERVIEW,
  overview: STUB_OVERVIEW,
  "dependencies-boundaries": STUB_DEPENDENCIES_BOUNDARIES,
  "knowledge-source-of-truth": STUB_KNOWLEDGE_SOURCE_OF_TRUTH,
  "strategy-what-if-scenarios": STUB_STRATEGY_WHAT_IF,
  "validation-interrogation": STUB_VALIDATION_INTERROGATION,
  "cognitive-simulation": STUB_COGNITIVE_SIMULATION,
  summary: STUB_SUMMARY
};

export function getDryRunStubResponse(
  contract: string
): string | undefined {
  return DRY_RUN_STUB_RESPONSES[contract as BuiltinDryRunReviewStepContract];
}
