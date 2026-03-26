import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizer.ts";
import { SUMMARY_SECTION } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";

// Keep in sync with the identical COMMON_SYSTEM_MESSAGE in all step files and changeset-overview-runner.ts.
const COMMON_SYSTEM_MESSAGE = [
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
  "- Language: 正體中文, except JSON keys explicitly specified in the step contract."
].join("\n");

const STEP7_SYSTEM_ADDITION = [
  "## Current Step: Summary",
  "- Produce a structured summary based on the completed review note.",
  "- The summary serves as the review's audit trail: it tells the reader what this review was based on, what behavioral changes were observed, and how to interpret the overall risk of the final findings.",
  "- Do NOT list specific findings, must-fix items, or paraphrased finding details — those belong in the Findings section.",
  "- Keep the summary reader-facing, high-level, and traceable to the completed review note.",
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
    return {
      stepId: this.stepId,
      kind: "section",
      sectionKey: SUMMARY_SECTION.key,
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
      completionCheck: {
        kind: "judge",
        criteria: buildStep7JudgeCriteria()
      },
      applyTo(targetContext: FileReviewContext, responseText: string) {
        targetContext.setSection(SUMMARY_SECTION.key, responseText);
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

function buildStep7JudgeCriteria(): string {
  return [
    "段落 `## Summary` 必須存在，且符合以下條件：",
    "- 包含 `### 審查基礎` 子段落，且「改動概要」、「依據規範」、「審查假設」三個欄位都必須出現並對應回答欄位要求。",
    "- 包含 `### 行為變更提醒` 子段落，且有具體內容或明確寫 `無`。",
    "- 包含 `### 風險評估` 子段落，且「整體風險等級」為 High / Medium / Low / None 其中之一，「風險理由」需對應整體風險判斷。"
  ].join("\n");
}
