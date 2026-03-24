import assert from "node:assert/strict";
import test from "node:test";

import { ReviewNoteFinalizer } from "../../src/core/finalizer.ts";
import { FileReviewContext } from "../../src/core/file-review-context.ts";

test("ReviewNoteFinalizer renders the exact bootstrap snapshot shape", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  assert.equal(
    finalizer.render(context),
    ["# src/app.ts", "", "- Source file: `src/app.ts`", "- Status: Review not yet generated."].join("\n")
  );
});

test("ReviewNoteFinalizer renders the Step 1 success snapshot without later-step placeholders", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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

  const rendered = finalizer.render(context);

  assert.equal(
    rendered,
    [
      "# src/app.ts",
      "",
      "- Source file: `src/app.ts`",
      "",
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動"
    ].join("\n")
  );
  assert.doesNotMatch(rendered, /Review not yet generated/u);
  assert.doesNotMatch(rendered, /Step 2|Step 3|pending/u);
});

test("ReviewNoteFinalizer renders Overview before Dependencies & Boundaries for Step 2 handoff and snapshots", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );

  const rendered = finalizer.render(context);

  assert.equal(
    rendered,
    [
      "# src/app.ts",
      "",
      "- Source file: `src/app.ts`",
      "",
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動",
      "",
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  assert.match(rendered, /## Overview[\s\S]*## Dependencies & Boundaries/u);
  assert.doesNotMatch(rendered, /Review not yet generated/u);
  assert.doesNotMatch(rendered, /Step 3|pending/u);
});

test("ReviewNoteFinalizer renders Knowledge & Source of Truth after Dependencies & Boundaries for Step 3 handoff and snapshots", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - package.json — repo local source",
      "- 採用規則與假設：",
      "  - 依 repo 設定檔判讀版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );

  const rendered = finalizer.render(context);

  assert.equal(
    rendered,
    [
      "# src/app.ts",
      "",
      "- Source file: `src/app.ts`",
      "",
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動",
      "",
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無",
      "",
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - package.json — repo local source",
      "- 採用規則與假設：",
      "  - 依 repo 設定檔判讀版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );
  assert.match(
    rendered,
    /## Overview[\s\S]*## Dependencies & Boundaries[\s\S]*## Knowledge & Source of Truth/u
  );
  assert.doesNotMatch(rendered, /Review not yet generated/u);
  assert.doesNotMatch(rendered, /Step 4|pending/u);
});

test("ReviewNoteFinalizer renders Strategy & What-if Scenarios after Knowledge & Source of Truth for Step 4 handoff and snapshots", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - package.json — repo local source",
      "- 採用規則與假設：",
      "  - 依 repo 設定檔判讀版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );
  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：這次改動調整 value 更新流程，值得驗證狀態切換是否一致",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：value 為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新的分支是否略過 fallback；與本次改動的關聯：diff 調整了 value 更新路徑",
      "  - W2: 觸發條件：dependency 回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示 valueService boundary",
      "  - W3: 觸發條件：多次重複呼叫；預期正確行為：應保持可預測結果；待驗證風險/不確定性：狀態是否會累積偏移；與本次改動的關聯：Step 3 已收斂 repo 假設"
    ].join("\n")
  );

  const rendered = finalizer.render(context);

  assert.equal(
    rendered,
    [
      "# src/app.ts",
      "",
      "- Source file: `src/app.ts`",
      "",
      "## Overview",
      "- 整體理解：測試用概覽",
      "- 行為變更：無行為變更",
      "- 檔案職責：維護 app value",
      "- 改動目的：調整常數",
      "- 影響範圍：src/app.ts",
      "- 測試覆蓋觀察：未見對應測試異動",
      "",
      "## Dependencies & Boundaries",
      "- 相依清單：",
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無",
      "",
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - package.json — repo local source",
      "- 採用規則與假設：",
      "  - 依 repo 設定檔判讀版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內",
      "",
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：這次改動調整 value 更新流程，值得驗證狀態切換是否一致",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：value 為空；預期正確行為：應維持既有 fallback；待驗證風險/不確定性：新的分支是否略過 fallback；與本次改動的關聯：diff 調整了 value 更新路徑",
      "  - W2: 觸發條件：dependency 回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示 valueService boundary",
      "  - W3: 觸發條件：多次重複呼叫；預期正確行為：應保持可預測結果；待驗證風險/不確定性：狀態是否會累積偏移；與本次改動的關聯：Step 3 已收斂 repo 假設"
    ].join("\n")
  );
  assert.match(
    rendered,
    /## Overview[\s\S]*## Dependencies & Boundaries[\s\S]*## Knowledge & Source of Truth[\s\S]*## Strategy & What-if Scenarios/u
  );
  assert.doesNotMatch(rendered, /Review not yet generated/u);
  assert.doesNotMatch(rendered, /^## Findings/mu);
  assert.doesNotMatch(rendered, /Step 5|Step 6|Step 7|pending/u);
});

test("ReviewNoteFinalizer renders Findings after Strategy & What-if Scenarios without confidence", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - package.json — repo local source",
      "- 採用規則與假設：",
      "  - 依 repo 設定檔判讀版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );
  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：這次改動調整 value 更新流程",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：value 為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整流程",
      "  - W2: 觸發條件：dependency 回傳異常；預期正確行為：應保留錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：重複呼叫；預期正確行為：結果應保持穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "問題標題",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 guard",
        confidence: 88
      }
    ]
  });

  const rendered = finalizer.render(context);

  assert.match(
    rendered,
    /## Strategy & What-if Scenarios[\s\S]*## Findings/u
  );
  assert.match(rendered, /^## Findings/mu);
  assert.match(rendered, /- \[must\] 問題標題/u);
  assert.match(rendered, /- Context：具體情境/u);
  assert.match(rendered, /- Deviation：預期與實際有落差/u);
  assert.match(rendered, /- Impact：會造成 correctness 問題/u);
  assert.match(rendered, /- Suggestion：補上 guard/u);
  assert.doesNotMatch(rendered, /confidence/u);
});

test("ReviewNoteFinalizer renders empty Findings as `- 無`", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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
      "  - 依 repo 規則判讀",
      "- 排除範圍：",
      "  - 外部知識不在本次範圍內"
    ].join("\n")
  );
  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：值得驗證",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：空輸入；預期正確行為：維持 fallback；待驗證風險/不確定性：流程是否偏移；與本次改動的關聯：diff 調整流程",
      "  - W2: 觸發條件：dependency 異常；預期正確行為：保留錯誤處理；待驗證風險/不確定性：邊界是否改變；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：重複呼叫；預期正確行為：結果穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );
  context.updateStructuredState({ findings: [] });

  const rendered = finalizer.render(context);

  assert.match(rendered, /^## Findings/mu);
  assert.match(rendered, /## Findings\n- 無/u);
  assert.doesNotMatch(rendered, /無 findings\./u);
  assert.doesNotMatch(rendered, /confidence/u);
});

test("ReviewNoteFinalizer does not render Findings before structured findings state exists", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：值得驗證",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：空輸入；預期正確行為：維持 fallback；待驗證風險/不確定性：流程是否偏移；與本次改動的關聯：diff 調整流程",
      "  - W2: 觸發條件：dependency 異常；預期正確行為：保留錯誤處理；待驗證風險/不確定性：邊界是否改變；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：重複呼叫；預期正確行為：結果穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );

  const rendered = finalizer.render(context);

  assert.doesNotMatch(rendered, /^## Findings/mu);
});

test("ReviewNoteFinalizer renders Summary after Findings without changing Findings content", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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
      "  - `[valueService]` → 提供 value 更新 → Consume",
      "    - Contract：輸入 value 並回傳更新結果",
      "    - 評估：此 diff 維持既有 boundary",
      "- 隱含相依：",
      "  - 無"
    ].join("\n")
  );
  context.setSection(
    "knowledge-source-of-truth",
    [
      "## Knowledge & Source of Truth",
      "- 版本／文件參考：",
      "  - package.json — repo local source",
      "- 採用規則與假設：",
      "  - 依 repo 設定檔判讀版本約束",
      "- 排除範圍：",
      "  - 外部官方文件查證不在本次 foundation 範圍內"
    ].join("\n")
  );
  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：這次改動調整 value 更新流程",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：value 為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整流程",
      "  - W2: 觸發條件：dependency 回傳異常；預期正確行為：應保留錯誤處理；待驗證風險/不確定性：boundary 是否仍一致；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：重複呼叫；預期正確行為：結果應保持穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "最終問題",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
  context.setSection(
    "summary",
    [
      "## Summary",
      "### 審查基礎",
      "- 改動概要：調整主要執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 審查假設：未擴張到外部知識查證。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：Medium",
      "- 風險理由：final findings 仍需留意。"
    ].join("\n")
  );

  const rendered = finalizer.render(context);

  assert.match(rendered, /## Findings[\s\S]*## Summary/u);
  assert.match(rendered, /^## Summary/mu);
  assert.match(rendered, /\[must\] 最終問題/u);
  assert.match(rendered, /### 風險評估/u);
  assert.equal((rendered.match(/^## Summary/mgu) ?? []).length, 1);
});

test("ReviewNoteFinalizer preserves empty Findings before Summary", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：值得驗證",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：空輸入；預期正確行為：維持 fallback；待驗證風險/不確定性：流程是否偏移；與本次改動的關聯：diff 調整流程",
      "  - W2: 觸發條件：dependency 異常；預期正確行為：保留錯誤處理；待驗證風險/不確定性：邊界是否改變；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：重複呼叫；預期正確行為：結果穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );
  context.updateStructuredState({ findings: [] });
  context.setSection(
    "summary",
    [
      "## Summary",
      "### 審查基礎",
      "- 改動概要：調整主要執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 審查假設：未擴張到外部知識查證。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：None",
      "- 風險理由：目前未保留 final findings。"
    ].join("\n")
  );

  const rendered = finalizer.render(context);

  assert.match(rendered, /## Findings\n- 無[\s\S]*## Summary/u);
  assert.doesNotMatch(rendered, /無 findings\./u);
  assert.equal((rendered.match(/^## Summary/mgu) ?? []).length, 1);
});

test("ReviewNoteFinalizer renders a populated Summary without placeholders when declared pre-findings sections are absent", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setSection(
    "summary",
    [
      "## Summary",
      "### 審查基礎",
      "- 改動概要：調整主要執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 審查假設：未擴張到外部知識查證。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：None",
      "- 風險理由：目前未保留 final findings。"
    ].join("\n")
  );

  const rendered = finalizer.render(context);

  assert.equal(
    rendered,
    [
      "# src/app.ts",
      "",
      "- Source file: `src/app.ts`",
      "",
      "## Summary",
      "### 審查基礎",
      "- 改動概要：調整主要執行流程。",
      "- 依據規範：依 repo source-of-truth 與版本假設審查。",
      "- 審查假設：未擴張到外部知識查證。",
      "### 行為變更提醒",
      "- 無",
      "### 風險評估",
      "- 整體風險等級：None",
      "- 風險理由：目前未保留 final findings。"
    ].join("\n")
  );
  assert.doesNotMatch(rendered, /Review not yet generated/u);
  assert.doesNotMatch(rendered, /^## Overview/mu);
  assert.doesNotMatch(rendered, /^## Findings/mu);
});

test("ReviewNoteFinalizer renders bootstrap interruption snapshot with deterministic warning block", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.markInterrupted("step1-overview", "judge rejected");

  const rendered = finalizer.render(context);

  assert.equal(
    rendered,
    [
      "# src/app.ts",
      "",
      "- Source file: `src/app.ts`",
      "- Status: Review not yet generated.",
      "",
      "> [!WARNING] Review Interrupted",
      "> 本檔案在執行 step1-overview 時失敗（原因：judge rejected），後續審查已略過。"
    ].join("\n")
  );
});

test("ReviewNoteFinalizer renders warning block on top of the last successful section snapshot", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

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
  context.markInterrupted("step2-dependencies-boundaries", "judge timeout");

  const rendered = finalizer.render(context);

  assert.match(rendered, /^## Overview/mu);
  assert.match(
    rendered,
    /## Overview[\s\S]*> \[!WARNING\] Review Interrupted[\s\S]*step2-dependencies-boundaries/u
  );
});

test("ReviewNoteFinalizer renders warning block on top of Step 6 findings snapshot without provisional Summary", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.setSection(
    "strategy-what-if-scenarios",
    [
      "## Strategy & What-if Scenarios",
      "- 高風險區域：",
      "  - state transition：值得驗證",
      "- What-if 假設情境：",
      "  - W1: 觸發條件：空輸入；預期正確行為：維持 fallback；待驗證風險/不確定性：流程是否偏移；與本次改動的關聯：diff 調整流程",
      "  - W2: 觸發條件：dependency 異常；預期正確行為：保留錯誤處理；待驗證風險/不確定性：邊界是否改變；與本次改動的關聯：Step 2 已標示邊界",
      "  - W3: 觸發條件：重複呼叫；預期正確行為：結果穩定；待驗證風險/不確定性：狀態是否偏移；與本次改動的關聯：Step 3 已收斂假設"
    ].join("\n")
  );
  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "最終問題",
        context: "具體情境",
        deviation: "預期與實際有落差",
        impact: "會造成 correctness 問題",
        suggestion: "補上 final guard",
        confidence: 91
      }
    ]
  });
  context.markInterrupted("step7-summary", "judge rejected");

  const rendered = finalizer.render(context);

  assert.match(rendered, /^## Findings/mu);
  assert.match(rendered, /\[must\] 最終問題/u);
  assert.doesNotMatch(rendered, /^## Summary/mu);
  assert.match(
    rendered,
    /## Findings[\s\S]*> \[!WARNING\] Review Interrupted[\s\S]*step7-summary/u
  );
});

test("ReviewNoteFinalizer prepends statistics line before grouped findings", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.updateStructuredState({
    findings: [
      {
        type: "nice",
        title: "A",
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 85
      },
      {
        type: "must",
        title: "B",
        context: "ctx",
        deviation: "dev",
        impact: "high",
        suggestion: "fix it",
        confidence: 88
      },
      {
        type: "nice",
        title: "C",
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional too",
        confidence: 82
      }
    ]
  });

  const rendered = finalizer.render(context);

  assert.match(rendered, /^## Findings$/mu);
  assert.match(rendered, /1 must-fix issue\(s\), 2 nice-to-have suggestion\(s\)\./u);
  const findingsIdx = rendered.indexOf("## Findings");
  const statsIdx = rendered.indexOf("1 must-fix issue(s), 2 nice-to-have suggestion(s).");
  const bIdx = rendered.indexOf("- [must] B");
  const aIdx = rendered.indexOf("- [nice] A");
  const cIdx = rendered.indexOf("- [nice] C");

  assert.ok(findingsIdx < statsIdx, "statistics line should come after ## Findings heading");
  assert.ok(statsIdx < bIdx, "statistics line should come before first finding");
  assert.ok(bIdx < aIdx, "must finding B should come before nice finding A");
  assert.ok(aIdx < cIdx, "nice finding A should come before nice finding C");
});

test("ReviewNoteFinalizer groups all must findings before all nice findings preserving intra-group order", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.updateStructuredState({
    findings: [
      {
        type: "must",
        title: "X",
        context: "ctx",
        deviation: "dev",
        impact: "high",
        suggestion: "fix",
        confidence: 90
      },
      {
        type: "must",
        title: "Y",
        context: "ctx",
        deviation: "dev",
        impact: "high",
        suggestion: "fix",
        confidence: 88
      }
    ]
  });

  const rendered = finalizer.render(context);

  assert.match(rendered, /2 must-fix issue\(s\), 0 nice-to-have suggestion\(s\)\./u);
  assert.ok(rendered.indexOf("- [must] X") < rendered.indexOf("- [must] Y"));
});

test("ReviewNoteFinalizer renders statistics for all-nice findings with 0 must prefix", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.updateStructuredState({
    findings: [
      {
        type: "nice",
        title: "P",
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 85
      },
      {
        type: "nice",
        title: "Q",
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 83
      }
    ]
  });

  const rendered = finalizer.render(context);

  assert.match(rendered, /0 must-fix issue\(s\), 2 nice-to-have suggestion\(s\)\./u);
  assert.ok(rendered.indexOf("- [nice] P") < rendered.indexOf("- [nice] Q"));
});

test("ReviewNoteFinalizer renders empty findings as a single - 無 marker", () => {
  const finalizer = new ReviewNoteFinalizer();
  const context = new FileReviewContext({
    filePath: "src/app.ts",
    noteFilePath: "/workspace/review/run/files/src__app.ts.md",
    diffContent: "",
    baseRef: "main",
    headRef: "feature-branch"
  });

  context.updateStructuredState({ findings: [] });

  const rendered = finalizer.render(context);

  assert.match(rendered, /## Findings\n- 無/u);
  assert.doesNotMatch(rendered, /無 findings\./u);
});
