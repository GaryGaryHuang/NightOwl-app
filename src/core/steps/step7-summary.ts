import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizer.ts";
import { SUMMARY_SECTION_KEY } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition, StepResolveServices } from "../step-runner.ts";

// Keep in sync with the identical COMMON_SYSTEM_MESSAGE in all step files and changeset-overview-runner.ts.
const COMMON_SYSTEM_MESSAGE = [
  "You are a senior code reviewer with expertise in correctness verification, contract-boundary analysis, and behavioral-regression detection. You are executing one designated step of the Code Review SOP.",
  "Your task in each invocation is to complete only the current step and produce the exact output required for that step.",
  "Do not exceed the current step's scope, and do not perform or anticipate later steps.",
  "",
  "## Evidence & Traceability",
  "- State what the code observably does, not what you believe the author intended.",
  "- Ground every conclusion in observable evidence from the diff, source files, or tool results.",
  "- Separate facts from assumptions: annotate inferences with `[假設]`; mark any claim lacking sufficient evidence with `[待確認]`.",
  "- If a tool call fails, returns no relevant result, or the available context is insufficient, mark the affected claim as `[待確認]` rather than fabricating content.",
  "- Do not treat speculation, likely intent, or common practice as established fact unless supported by evidence.",
  "- When describing what changed, use the specific before\u2192after transformation visible in the evidence rather than substituting a generic category label. Specificity in earlier steps directly improves the precision of later steps.",
  "- Reserve `[\u5047\u8a2d]` for inferences that genuinely cannot be confirmed from the combined evidence of the diff, changeset context, source files, and tool results. When these sources together make a conclusion clear, state it as fact.",
  "",
  "## Context Retrieval",
  "- Retrieve only the minimal context needed to complete the current step reliably.",
  "- Prefer local evidence first: `view`, `grep`, `glob` for file inspection; use `bash` for git operations (`git diff`, `git blame`, `git log`) or when built-in tools cannot fulfill the task.",
  "- Use `web_fetch` and MCP tools only when the current step requires external knowledge verification that local context cannot provide.",
  "- When multiple independent retrievals are needed, batch them in a single turn rather than retrieving sequentially.",
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
  "- Prefer concise, information-dense writing. Do not pad sentences with hedging tails (e.g. \"\u4f46\u4ecd\u4fdd\u7559\u2026\u4e0d\u78ba\u5b9a\u6027\"), filler prefixes (e.g. \"\u53ef\u89c0\u5bdf\u5230\u7684\"), or restatements of what the reader already knows.",
  "- Language: 正體中文, except JSON keys explicitly specified in the step contract."
].join("\n");

const STEP7_SYSTEM_ADDITION = [
  "## Current Step: Summary",
  "- Produce a structured summary based on the completed review note.",
  "- The summary is the section readers check first; every sentence must earn its place. Prefer precise conclusions over generic hedging. When uncertainty is real, tie it to the exact missing fact or unresolved evidence \u2014 do not append a vague disclaimer.",
  "- Do not list specific findings, must-fix items, or paraphrased finding details \u2014 those belong in the Findings section.",
  "- Derive the risk level strictly from the Findings section: `[must]` findings \u2192 High or Medium; only `[nice]` findings \u2192 Low; no findings (Findings shows `\u7121`) \u2192 None. Do not override this rule based on your own assessment of the change's impact.",
  "- Begin the response with `## Summary`."
].join("\n");

export interface Step7SummaryStepOptions {
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

/**
 * Final section step: turn the completed note into a reader-facing summary without duplicating the detailed findings.
 */
export class Step7SummaryStep implements StepDefinition {
  readonly stepId = "step7-summary";
  readonly #reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;

  constructor(options: Step7SummaryStepOptions) {
    this.#reviewNoteFinalizer = options.reviewNoteFinalizer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const { stepId } = this;
    return {
      stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP7_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep7UserMessage(
          this.#reviewNoteFinalizer.render(context)
        )
      },
      reviewProfile: {
        model: "gpt-5-mini",
        timeoutMs: 300_000
      },
      async resolve(response: string, services: StepResolveServices) {
        if (!services.judgeService) {
          throw new Error("judge service is not configured");
        }

        const judgeResult = await services.judgeService.evaluate({
          stepId,
          filePath: context.filePath,
          criteria: buildStep7JudgeCriteria(),
          sectionContent: response
        });

        if (!judgeResult.passed) {
          throw new Error(judgeResult.cause ?? "judge rejected");
        }

        return (targetContext: FileReviewContext) => {
          targetContext.setSection(SUMMARY_SECTION_KEY, response);
        };
      }
    };
  }
}

function buildStep7UserMessage(currentReview: string): string {
  // Summary is derived from the fully rendered note so it can synthesize the final findings context and all prior sections together.
  return [
    "<current_review>",
    currentReview,
    "</current_review>",
    "",
    buildStep7Instruction()
  ].join("\n");
}

function buildStep7Instruction(): string {
  return [
    "This summary is the section readers check first. Every sentence must earn its place.",
    "",
    "Read <current_review> and write a structured summary with the following three sections:",
    "",
    "1. 審查基礎: Give the reader just enough context to judge whether the review's conclusions are well grounded.",
    "   - 改動概要: One sentence describing this file's specific before→after transformation, based on Overview. Do not repeat content that will appear in 行為變更提醒.",
    "   - 依據規範: Only list specifications or references that were decisive for this review's conclusions — omit generic build config (gradle versions, build.gradle.kts) that applies to every file in the changeset.",
    "   - 審查假設: State the 1–3 assumptions that most shaped the review's conclusions. Do not list items that were excluded from scope — the reader needs to know what you assumed, not what you skipped.",
    "",
    "2. 行為變更提醒: Tell the reader what changed at runtime that they or the author should verify. This section must add information beyond 改動概要.",
    "   - State each behavioral change as a direct fact (e.g. \"停止服務改為呼叫 stopForeground(STOP_FOREGROUND_REMOVE)\"), not as a meta-observation (e.g. \"可觀察到的變更是…\").",
    "   - Do not restate findings or correctness judgments.",
    "   - If the change has no runtime behavioral impact (e.g. annotation-only removal), write `無行為變更`.",
    "",
    "3. 風險評估: Determine the overall risk level strictly from the Findings section in <current_review>.",
    "   - Classification rule (mandatory — do not override based on your own judgment):",
    "     - High: at least one `[must]` finding exists and its described evidence and impact are strong",
    "     - Medium: at least one `[must]` finding exists but evidence or impact is moderate",
    "     - Low: only `[nice]` findings exist",
    "     - None: no findings exist (the Findings section shows `無`)",
    "   - 整體風險等級: One of High / Medium / Low / None.",
    "   - 風險理由: Reference the specific findings (or their absence) that determined the level. Do not add hedging qualifiers about residual uncertainty.",
    "",
    "Respond in the following format:",
    "",
    "## Summary",
    "### 審查基礎",
    "- 改動概要：[one-sentence before→after transformation]",
    "- 依據規範：[only decisive references — omit generic build config]",
    "- 審查假設：[1–3 assumptions that shaped conclusions]",
    "### 行為變更提醒",
    "- [runtime behavioral changes as direct facts, or 無行為變更]",
    "### 風險評估",
    "- 整體風險等級：[High / Medium / Low / None]",
    "- 風險理由：[reference specific findings or their absence — no hedging]",
    "",
    "Before submitting your response, verify:",
    "- Begins with `## Summary`",
    "- Contains `### 審查基礎` with all three sub-fields answered: 改動概要、依據規範、審查假設",
    "- 改動概要 is one sentence; 審查假設 has at most 3 items; 依據規範 omits generic build config",
    "- Contains `### 行為變更提醒` that adds information beyond 改動概要, or states `無行為變更`",
    "- Contains `### 風險評估` with 整體風險等級 strictly derived from Findings, and 風險理由 free of hedging tails"
  ].join("\n");
}

function buildStep7JudgeCriteria(): string {
  return [
    "段落 `## Summary` 必須存在，且符合以下條件：",
    "- 包含 `### 審查基礎` 子段落，且「改動概要」、「依據規範」、「審查假設」三個欄位都必須出現並對應回答欄位要求。",
    "- 包含 `### 行為變更提醒` 子段落，且有具體內容或明確寫 `無行為變更`。",
    "- 包含 `### 風險評估` 子段落，且「整體風險等級」為 High / Medium / Low / None 其中之一，「風險理由」非空。"
  ].join("\n");
}
