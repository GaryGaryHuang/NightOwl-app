import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizers/review-note-finalizer.ts";
import { SUMMARY_SECTION_KEY } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition, StepResolveServices } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";


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
