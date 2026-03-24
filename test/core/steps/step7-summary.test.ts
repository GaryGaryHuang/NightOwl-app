import assert from "node:assert/strict";
import test from "node:test";

import type { Finding } from "../../../src/core/file-review-context.ts";
import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step7SummaryStep } from "../../../src/core/steps/step7-summary.ts";

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
  "## Current Step: Summary",
  "- Produce a structured summary based on the completed review note.",
  "- The summary serves as the review's audit trail: it tells the reader what this review was based on, what behavioral changes were observed, and how to interpret the overall risk of the final findings.",
  "- Do NOT list specific findings, must-fix items, or paraphrased finding details — those belong in the Findings section.",
  "- Keep the summary reader-facing, high-level, and traceable to the completed review note.",
  "- Begin the response with `## Summary`."
].join("\n");

test("Step7SummaryStep prepares the exact Step 7 prompt contract from current review only", () => {
  const context = createContextWithFindings([createFinding("must", 91, "最終問題")]);
  const step = new Step7SummaryStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.equal(plan.stepId, "step7-summary");
  assert.equal(plan.kind, "section");
  assert.equal(plan.sectionKey, "summary");
  assert.deepEqual(plan.reviewProfile, {
    model: "gpt-5-mini",
    timeoutMs: 300_000
  });
  assert.deepEqual(plan.completionCheck, {
    kind: "judge",
    criteria: buildExpectedJudgeCriteria()
  });
  assert.equal(plan.prompt.systemMessage, EXPECTED_SYSTEM_MESSAGE);
  assert.equal(
    plan.prompt.userMessage,
    [
      "<current_review>",
      buildExpectedCurrentReview(),
      "</current_review>",
      "",
      buildExpectedStepInstruction()
    ].join("\n")
  );
  assert.doesNotMatch(plan.prompt.userMessage, /<diff/u);
  assert.doesNotMatch(plan.prompt.userMessage, /<changeset_context>/u);
  assert.doesNotMatch(plan.prompt.userMessage, /<required_risk_level>/u);
  assert.doesNotMatch(
    plan.prompt.userMessage.match(/<current_review>[\s\S]*<\/current_review>/u)?.[0] ?? "",
    /confidence/u
  );
});

test("Step7SummaryStep uses consistent prompt and criteria regardless of findings risk level", () => {
  const context = createContextWithFindings([createFinding("nice", 95, "建議項")]);
  const step = new Step7SummaryStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.doesNotMatch(plan.prompt.userMessage, /<required_risk_level>/u);
  assert.deepEqual(plan.completionCheck, {
    kind: "judge",
    criteria: buildExpectedJudgeCriteria()
  });
});

test("Step7SummaryStep carries explicit empty findings state in current review", () => {
  const context = createContextWithFindings([]);
  const step = new Step7SummaryStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.match(
    plan.prompt.userMessage,
    /<current_review>[\s\S]*## Findings\n- 無[\s\S]*<\/current_review>/u
  );
  assert.doesNotMatch(plan.prompt.userMessage, /無 findings\./u);
  assert.doesNotMatch(plan.prompt.userMessage, /<required_risk_level>/u);
  assert.deepEqual(plan.completionCheck, {
    kind: "judge",
    criteria: buildExpectedJudgeCriteria()
  });
});

function buildExpectedStepInstruction(): string {
  return [
    "This summary serves as the audit trail for the reader to understand what this review was based on and how to interpret its conclusions.",
    "",
    "Read <current_review> and write a structured summary with the following three sections:",
    "",
    "1. 審查基礎: Describe the basis of this review so the reader can judge whether the final conclusions are well grounded.",
    "   - 改動概要: Summarize the change at a high level, based on Overview.",
    "   - 依據規範: List the key specifications, framework versions, source-of-truth references, or standards that governed this review, based on Knowledge & Source of Truth.",
    "   - 審查假設: State the assumptions and scope boundaries that materially shaped this review, including what was explicitly treated as out of scope.",
    "",
    "2. 行為變更提醒: Consolidate the observable behavioral change observations from earlier steps.",
    "   - Report behavioral changes as observations only.",
    "   - Do not restate findings or correctness judgments here.",
    "   - If no behavioral changes were observed, write `無`.",
    "",
    "3. 風險評估: Provide an overall risk assessment of the completed review.",
    "   - 整體風險等級: One of High / Medium / Low / None.",
    "   - 風險理由: Briefly explain the chosen risk level based on the final findings, the observed behavioral changes, and the review assumptions/scope boundaries.",
    "",
    "Keep the summary concise, high-level, and grounded in <current_review>.",
    "",
    "Respond in the following format:",
    "",
    "## Summary",
    "### 審查基礎",
    "- 改動概要：[from Overview]",
    "- 依據規範：[from Knowledge & Source of Truth]",
    "- 審查假設：[from Knowledge's 採用規則與假設 and 排除範圍]",
    "### 行為變更提醒",
    "- [consolidated behavioral change observations, or 無]",
    "### 風險評估",
    "- 整體風險等級：[High / Medium / Low / None]",
    "- 風險理由：[rationale based on final findings, behavioral changes, and review scope/assumptions]",
    "",
    "Before submitting your response, verify:",
    "- Begins with `## Summary`",
    "- Contains `### 審查基礎` with all three sub-fields answered: 改動概要、依據規範、審查假設",
    "- Contains `### 行為變更提醒` with specific content or explicitly states `無`",
    "- Contains `### 風險評估` with 整體風險等級 set to one of High / Medium / Low / None, and a non-empty 風險理由"
  ].join("\n");
}

function buildExpectedJudgeCriteria(): string {
  return [
    "段落 `## Summary` 必須存在，且符合以下條件：",
    "- 包含 `### 審查基礎` 子段落，且「改動概要」、「依據規範」、「審查假設」三個欄位都必須出現並對應回答欄位要求。",
    "- 包含 `### 行為變更提醒` 子段落，且有具體內容或明確寫 `無`。",
    "- 包含 `### 風險評估` 子段落，且「整體風險等級」為 High / Medium / Low / None 其中之一，「風險理由」需對應整體風險判斷。"
  ].join("\n");
}

function createContextWithFindings(findings: Finding[]): FileReviewContext {
  const context = createBaseContext();
  context.updateStructuredState({ findings });
  return context;
}

function createFinding(
  type: "must" | "nice",
  confidence: number,
  title: string
): Finding {
  return {
    type,
    title,
    context: "具體情境",
    deviation: "預期與實際有落差",
    impact: "會造成 correctness 問題",
    suggestion: "補上 final guard",
    confidence
  };
}

function buildExpectedCurrentReview(): string {
  return [
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
    "  - W3: 觸發條件：多次重複呼叫；預期正確行為：應保持可預測結果；待驗證風險/不確定性：狀態是否會累積偏移；與本次改動的關聯：Step 3 已收斂 repo 假設",
    "",
    "## Findings",
    "1 must-fix issue(s), 0 nice-to-have suggestion(s).",
    "- [must] 最終問題",
    "  - Context：具體情境",
    "  - Deviation：預期與實際有落差",
    "  - Impact：會造成 correctness 問題",
    "  - Suggestion：補上 final guard"
  ].join("\n");
}

function createBaseContext(): FileReviewContext {
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

  return context;
}
