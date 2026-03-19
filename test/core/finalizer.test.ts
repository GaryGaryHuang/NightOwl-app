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
