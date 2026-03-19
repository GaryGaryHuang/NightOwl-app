import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step4StrategyWhatIfScenariosStep } from "../../../src/core/steps/step4-strategy-what-if-scenarios.ts";

const EXPECTED_SYSTEM_MESSAGE = [
  "You are a senior code reviewer with expertise in correctness verification, contract-boundary analysis, and behavioral-regression detection. You are executing one designated step of the Code Review SOP.",
  "Your task in each invocation is to complete only the current step and produce the exact output required for that step.",
  "Do not exceed the current step's scope, and do not perform or anticipate later steps.",
  "",
  "## Evidence & Traceability",
  "- Ground every conclusion in observable evidence from the diff, source files, or tool results.",
  "- Separate facts from assumptions: annotate inferences with `[假設]`; mark any claim lacking sufficient evidence with `[待確認]`.",
  "- If a tool call fails, returns no relevant result, or the available context is insufficient, mark the affected claim as `[待確認]` rather than fabricating content.",
  "- Do not treat speculation, likely intent, or common practice as established fact unless supported by evidence.",
  "- State what the code observably does, not what you believe the author intended.",
  "",
  "## Context Retrieval",
  "- Retrieve only the minimal context needed to complete the current step reliably.",
  "- Prefer local evidence first: `view`, `grep`, `glob` for file inspection; use `bash` for git operations (`git diff`, `git blame`, `git log`) or when built-in tools cannot fulfill the task.",
  "- Use `web_fetch` and MCP tools only when the current step requires external knowledge verification that local context cannot provide.",
  "- Stop retrieving additional context once it no longer changes the current step's output.",
  "",
  "## Scope Discipline",
  "- Focus only on the task defined by the current step.",
  "- Do not pre-emptively perform bug finding, risk evaluation, validation, or summary work unless the current step explicitly requires it.",
  "- Do not add extra sections, side notes, or recommendations beyond the current step's output contract.",
  "",
  "## Response Format",
  "- Follow the current step's output contract exactly.",
  "- Markdown steps: begin with the designated `##` heading. No preamble or extra sections.",
  "- JSON steps: output one valid JSON object only. No Markdown code fences or explanatory text.",
  "- Make each field specific enough to support the next step's reasoning, but omit unrequested background content.",
  "- Language: 正體中文, except JSON keys explicitly specified in the step contract.",
  "",
  "## Current Step: Strategy & What-if Scenarios",
  "- Synthesize the Overview, Dependencies & Boundaries, and Knowledge & Source of Truth in <current_review> to define the investigation strategy for later validation.",
  "- Use prior context to identify the specific failure surfaces that are most worth testing in this file. Do not generate generic scenarios that could apply to arbitrary code changes.",
  "- Each What-if scenario must be a neutral, testable hypothesis for later validation to investigate — not a conclusion that a bug exists.",
  "- Ground each scenario in available evidence from the diff, the file's role, relevant dependency boundaries, and any governing rules, versions, assumptions, or out-of-scope constraints established earlier.",
  "- Prefer a small set of high-signal scenarios that cover distinct failure modes or materially different uncertainties over a longer but repetitive list.",
  "- IMPORTANT: This step defines where later validation should focus. Do NOT perform the validation itself, do not report findings, and do not make correctness judgments.",
  "- Begin the response with `## Strategy & What-if Scenarios`."
].join("\n");

const EXPECTED_STEP_INSTRUCTION = [
  "IMPORTANT: This step defines where later validation should focus. Do NOT perform the validation itself, do not report findings, and do not make correctness judgments.",
  "",
  "Based on the Overview, Dependencies & Boundaries, and Knowledge & Source of Truth in <current_review>, define the validation strategy for this file by identifying its most relevant high-risk areas and framing them as What-if scenarios for later investigation.",
  "",
  "Use prior steps as the primary input. Do not generate generic review heuristics. Each scenario must be grounded in the actual change, the file's role, the relevant dependency boundaries, and the applicable rules, versions, assumptions, and scope limits already established.",
  "",
  "1. Identify the high-risk areas that are most relevant to this change.",
  "   - Derive them from the actual context gathered so far, not from a generic checklist alone.",
  "   - For each high-risk area, explain why this change makes that area worth validating.",
  "",
  "2. Define 3–8 What-if scenarios for later validation to investigate.",
  "   - Number each scenario W1, W2, ...",
  "   - Aim for 3–5 scenarios. Expand to 6–8 only when the change is genuinely high-risk (for example: writes, transactions, auth, concurrency, state transitions, external side effects).",
  "   - Each scenario must be non-redundant and target a distinct failure mode or uncertainty.",
  "   - Each scenario must be framed as a testable hypothesis, not as an assumed defect.",
  "   - Each scenario must include:",
  "     - the trigger condition or situation",
  "     - the expected correct behavior",
  "     - the failure risk or uncertainty to investigate",
  "     - why this scenario is relevant to this specific change",
  "   - Prefer diversity across materially relevant risk categories, but do not force artificial coverage of categories that are not supported by the context.",
  "   - If a plausible risk area is explicitly ruled out by prior context or out-of-scope boundaries, do not include it as a What-if scenario.",
  "",
  "3. Keep the scenario set selective and high-signal.",
  "   - Include only scenarios that are likely to improve the effectiveness of later validation.",
  "   - Avoid restating the same concern in multiple forms.",
  "   - If available evidence is insufficient, record the uncertainty explicitly rather than inflating the scenario.",
  "",
  "Respond in the following format:",
  "",
  "## Strategy & What-if Scenarios",
  "- 高風險區域：",
  "  - [風險類別]：[為何這次改動使其成為值得驗證的高風險區域]",
  "- What-if 假設情境：",
  "  - W1: [觸發條件]；預期正確行為：[... ]；待驗證風險/不確定性：[... ]；與本次改動的關聯：[... ]",
  "  - W2: ...",
  "",
  "Before submitting your response, verify:",
  "- Begins with `## Strategy & What-if Scenarios`",
  "- 高風險區域 is present with at least one area and its relevance to this specific change",
  "- At least 3 What-if scenarios are present, each numbered W1, W2, ...",
  "- Each scenario includes all four elements: trigger condition, expected correct behavior, risk/uncertainty to investigate, and relevance to this change",
  "- No scenario contains unreplaced placeholder text or is a generic checklist item detached from this change"
].join("\n");

test("Step4StrategyWhatIfScenariosStep prepares the exact Step 4 prompt contract from diff and current review", () => {
  const context = createContextWithStep3();
  const step = new Step4StrategyWhatIfScenariosStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.equal(plan.stepId, "step4-strategy-what-if-scenarios");
  assert.equal(plan.kind, "section");
  assert.equal(plan.sectionKey, "strategy-what-if-scenarios");
  assert.deepEqual(plan.reviewProfile, {
    model: "gpt-5.4-mini",
    timeoutMs: 300_000
  });
  assert.deepEqual(plan.completionCheck, {
    kind: "judge",
    criteria: [
      "段落 `## Strategy & What-if Scenarios` 必須存在，且符合下列條件：",
      "- 「高風險區域」欄位必須出現，且至少包含一項與本次改動相關的高風險區域，並說明其關聯。",
      "- What-if 項目至少 3 個，且每項都使用 W# 編號，格式為 W1、W2、...。",
      "- 每個 What-if 項目都必須包含：",
      "  - 觸發條件或情境",
      "  - 預期正確行為",
      "  - 待驗證的風險或不確定性",
      "  - 與本次改動的關聯",
      "- What-if 項目不得只是泛用風險口號或未替換的佔位文字。"
    ].join("\n")
  });
  assert.equal(plan.prompt.systemMessage, EXPECTED_SYSTEM_MESSAGE);
  assert.equal(
    plan.prompt.userMessage,
    [
      '<diff path="src/app.ts" base="main" head="feature-branch">',
      "@@ -1 +1 @@",
      "-export const value = 1;",
      "+export const value = 2;",
      "",
      "</diff>",
      "",
      "<current_review>",
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
      "</current_review>",
      "",
      EXPECTED_STEP_INSTRUCTION
    ].join("\n")
  );
  assert.doesNotMatch(plan.prompt.userMessage, /<changeset_context>/u);
  assert.doesNotMatch(plan.prompt.userMessage, /Review not yet generated/u);
});

test("Step4StrategyWhatIfScenariosStep remains a section-only state update under strategy-what-if-scenarios", () => {
  const context = createContextWithStep3();
  const step = new Step4StrategyWhatIfScenariosStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);
  const responseText = [
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    "  - state transition：本次改動調整了 value 更新路徑",
    "- What-if 假設情境：",
    "  - W1: 觸發條件：輸入為空；預期正確行為：應維持 fallback；待驗證風險/不確定性：新分支是否略過 fallback；與本次改動的關聯：diff 調整流程",
    "  - W2: 觸發條件：依賴回傳異常；預期正確行為：應保留既有錯誤處理；待驗證風險/不確定性：boundary 是否變動；與本次改動的關聯：Step 2 已標示依賴邊界",
    "  - W3: 觸發條件：重複呼叫；預期正確行為：結果應保持穩定；待驗證風險/不確定性：狀態是否累積偏移；與本次改動的關聯：Step 3 已收斂假設"
  ].join("\n");

  assert.equal(context.getSection("strategy-what-if-scenarios"), undefined);

  plan.applyTo(context, responseText);

  assert.equal(context.getSection("strategy-what-if-scenarios"), responseText);
  assert.doesNotMatch(context.getSection("strategy-what-if-scenarios") ?? "", /^## Findings/mu);
  assert.doesNotMatch(context.getSection("strategy-what-if-scenarios") ?? "", /Step 5|Step 6|Step 7/u);
});

function createContextWithStep3(): FileReviewContext {
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

  return context;
}
