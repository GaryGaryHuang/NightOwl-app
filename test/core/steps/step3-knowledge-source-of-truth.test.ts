import assert from "node:assert/strict";
import test from "node:test";

import { FileReviewContext } from "../../../src/core/file-review-context.ts";
import { ReviewNoteFinalizer } from "../../../src/core/finalizer.ts";
import { Step3KnowledgeSourceOfTruthStep } from "../../../src/core/steps/step3-knowledge-source-of-truth.ts";

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
  "## Current Step: Knowledge & Source of Truth",
  "- Assess whether the context gathered in prior steps (Overview and Dependencies & Boundaries in <current_review>) leaves any knowledge gaps that must be resolved for later analysis.",
  "- Use external retrieval only when genuine gaps remain that local context, repo-native evidence, or prior steps cannot resolve.",
  "- When retrieval is needed, prioritize source-of-truth material: repo-native documentation, version files, official docs, specs, standards, and version-specific API references.",
  "- Use supplementary material only when source-of-truth material is insufficient, and label it accordingly.",
  "- Keep this step focused on establishing the governing rules, references, versions, assumptions, and out-of-scope boundaries for this review.",
  "- IMPORTANT: This step is for knowledge convergence, not for broad research, bug finding, or general advice.",
  "- Begin the response with `## Knowledge & Source of Truth`."
].join("\n");

const EXPECTED_STEP_INSTRUCTION = [
  "IMPORTANT: This step is for knowledge convergence only. Do NOT perform bug finding, general advice, or broad research.",
  "",
  "Review the Overview and Dependencies & Boundaries in <current_review>, then determine what additional knowledge is required to support later analysis of this change.",
  "",
  "Use <current_review> as the primary input. Retrieve additional repo or external context only when needed to resolve a concrete knowledge gap.",
  "",
  "1. Assess whether any knowledge gaps remain that matter for this review, such as:",
  "   - technologies, frameworks, or libraries directly involved in the change",
  "   - API behavior or contract details that are not clear from local evidence",
  "   - version-specific constraints that may affect interpretation of the diff",
  "   - domain rules or standards that are necessary to evaluate later scenarios",
  "",
  "2. If genuine gaps exist, retrieve only the references needed to close those gaps.",
  "   - Prioritize repo-native evidence first, such as version files, configuration files, internal docs, or project conventions.",
  "   - Then use authoritative external sources, such as official docs, specs, standards, or versioned API references.",
  "   - Use supplementary sources only when authoritative sources do not fully answer the question, and label them clearly.",
  "   - Confirm only the versions that are relevant to this change. Do not collect unrelated project version information.",
  "",
  "3. Converge the scope of this review:",
  "   - State the rules, standards, references, and assumptions that will govern later analysis",
  "   - Explicitly list what is out of scope for this review",
  "   - If a necessary assumption remains uncertain, make that uncertainty explicit rather than overstating confidence",
  "",
  "Respond in the following format. If no applicable repo-native or external reference is needed for this change, write `無` under 版本／文件參考:",
  "",
  "## Knowledge & Source of Truth",
  "- 版本／文件參考：",
  "  - [package/framework/standard] [version if applicable] — [source link or repo-native source]",
  "- 採用規則與假設：",
  "  - [本次 review 依據的具體規則、版本化行為、repo 慣例或必要假設]",
  "- 排除範圍：",
  "  - [明確不在本次 review 範圍內的面向]",
  "",
  "Before submitting your response, verify:",
  "- Begins with `## Knowledge & Source of Truth`",
  "- 版本／文件參考 is present with at least one entry including a source, or explicitly states `無`",
  "- 採用規則與假設 is present with at least one concrete rule, version constraint, repo convention, or assumption",
  "- 排除範圍 is present with at least one explicitly out-of-scope item"
].join("\n");

test("Step3KnowledgeSourceOfTruthStep prepares the exact Step 3 prompt contract from diff and current review", () => {
  const context = createContextWithStep2();
  const step = new Step3KnowledgeSourceOfTruthStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.equal(plan.stepId, "step3-knowledge-source-of-truth");
  assert.equal(plan.kind, "section");
  assert.equal(plan.sectionKey, "knowledge-source-of-truth");
  assert.deepEqual(plan.reviewProfile, {
    model: "gpt-5-mini",
    timeoutMs: 300_000
  });
  assert.deepEqual(plan.completionCheck, {
    kind: "judge",
    criteria: [
      "段落 `## Knowledge & Source of Truth` 必須存在，且符合下列條件：",
      "- 「版本／文件參考」欄位必須出現，且至少包含一筆引用，內容需含來源；若此 change 不需要額外參考，則明確寫出 `無`。",
      "- 「採用規則與假設」欄位必須出現，且至少包含一條具體規則、版本化行為、repo 慣例或必要假設。",
      "- 「排除範圍」欄位必須出現，且至少包含一項明確不在本次 review 範圍內的面向。"
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
      "</current_review>",
      "",
      EXPECTED_STEP_INSTRUCTION
    ].join("\n")
  );
  assert.doesNotMatch(plan.prompt.userMessage, /<changeset_context>/u);
  assert.doesNotMatch(plan.prompt.userMessage, /Review not yet generated/u);
});

test("Step3KnowledgeSourceOfTruthStep prompt contract still allows explicit `無` and explicit uncertainty handling", () => {
  const context = createContextWithStep2();
  const step = new Step3KnowledgeSourceOfTruthStep({
    reviewNoteFinalizer: new ReviewNoteFinalizer()
  });

  const plan = step.prepare(context);

  assert.match(
    plan.prompt.userMessage,
    /If no applicable repo-native or external reference is needed for this change, write `無` under 版本／文件參考/u
  );
  assert.match(
    plan.prompt.userMessage,
    /If a necessary assumption remains uncertain, make that uncertainty explicit rather than overstating confidence/u
  );
});

function createContextWithStep2(): FileReviewContext {
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

  return context;
}
