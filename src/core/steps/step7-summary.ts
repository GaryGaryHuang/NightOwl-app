import type { FileReviewContext } from "../file-review-context.ts";
import { SUMMARY_SECTION_KEY } from "../review-section-contract.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import { buildRiskSnapshot, type RiskSnapshot } from "../risk-level.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createStep7HybridResolve } from "./step-resolve-helpers.ts";


const STEP7_SYSTEM_ADDITION = [
  "## Current Step: Summary",
  "- Produce a structured summary based on the review basis, validated findings, missing-information items, and the host risk package.",
  "- The summary is the section readers check first; every sentence must earn its place. Prefer precise conclusions over generic hedging. When uncertainty is real, tie it to the exact missing fact or unresolved evidence \u2014 do not append a vague disclaimer.",
  "- Do not list specific findings, must-fix items, or paraphrased finding details \u2014 those belong in the Findings section.",
  "- Consume only the review basis, validated findings, missing-information items, and the host risk package. Do not introduce new findings, identifiers, trigger conditions, impacts, or technical claims.",
  "- The `<risk_snapshot>` block in the user message contains the host-computed risk level. You MUST use that exact value as the `整體風險等級` in your response. Do not override or recompute the risk level based on your own assessment.",
  "- Do not expose internal field names in reader-facing prose. Avoid terms such as `risk_snapshot`, `derivedRiskLevel`, `mustCount`, `niceCount`, `acceptedFindingIds`, `ReviewBasisV1`, `Step 6`, and `approvedFindings`.",
  "- If missing-information items exist, `必要假設` must summarize those missing facts for a human reader. Do not write `無` when missing-information state is non-empty.",
  "- Begin the response with `## Summary`."
].join("\n");

export interface Step7SummaryStepOptions {
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

/**
 * Final section step: turn the completed note into a reader-facing summary without duplicating the detailed findings.
 */
export class Step7SummaryStep implements StepDefinition {
  readonly stepId = "step7-summary";
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;

  constructor(options: Step7SummaryStepOptions) {
    this.#promptSerializer = options.promptSerializer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const { stepId } = this;
    const snapshot = buildRiskSnapshot(context.getFindings());
    return {
      stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP7_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep7UserMessage(
          this.#promptSerializer.serialize({
            context,
            include: [
              "review-basis",
              "approved-findings",
              "missing-information"
            ]
          }),
          snapshot
        )
      },
      reviewProfile: {
        knowledgeMode: "disabled",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: createStep7HybridResolve({
        stepId,
        filePath: context.filePath,
        sectionKey: SUMMARY_SECTION_KEY,
        criteria: buildStep7JudgeCriteria(),
        expectedRiskLevel: snapshot.derivedRiskLevel,
        allowedFindingIds: snapshot.acceptedFindingIds,
        allowedMissingInformationIds:
          context.getMissingInformationItems()?.map((item) => item.itemId) ?? []
      })
    };
  }
}

function buildStep7UserMessage(reviewState: string, snapshot: RiskSnapshot): string {
  const readerSafeSnapshot = {
    riskLevel: snapshot.derivedRiskLevel,
    mustFixFindingCount: snapshot.mustCount,
    niceToHaveFindingCount: snapshot.niceCount,
    findingIds: snapshot.acceptedFindingIds,
    basis: snapshot.riskBasis
  };

  return [
    reviewState,
    "",
    "<risk_snapshot>",
    JSON.stringify(readerSafeSnapshot),
    "</risk_snapshot>",
    "",
    buildStep7Instruction()
  ].join("\n");
}

function buildStep7Instruction(): string {
  return [
    "This summary is the section readers check first. Every sentence must earn its place.",
    "Use only the review basis, validated findings, missing-information items, and the host risk package. Do not introduce new findings or technical claims.",
    "",
    "Read <review_state> and write a structured summary with the following three sections:",
    "",
    "1. 審查基礎: Give the reader just enough context to judge whether the review's conclusions are well grounded.",
    "   - 改動概要: One sentence describing this file's specific before→after transformation, based on the prepared role and behavior-change evidence plus the validated review state. Do not repeat content that will appear in 行為變更提醒.",
    "   - 依據規範: Only list specifications or references that were decisive for this review's conclusions — omit generic build config (gradle versions, build.gradle.kts) that applies to every file in the changeset.",
    "   - 必要假設: State only assumptions or missing facts that materially shaped the review's conclusions and still could not be confirmed from user context, source-of-truth references, repo evidence, code, dependency implementation, or tool results. If `missingInformationItems` is non-empty, summarize each item in reader-facing language. If no necessary assumptions or missing facts remain, write `無`.",
    "",
    "2. 行為變更提醒: Tell the reader what changed at runtime that they or the author should verify. This section must add information beyond 改動概要.",
    "   - State each behavioral change as a direct fact (e.g. \"停止服務改為呼叫 stopForeground(STOP_FOREGROUND_REMOVE)\"), not as a meta-observation (e.g. \"可觀察到的變更是…\").",
    "   - Do not restate finding details. If correctness was established through final findings, reflect that through 風險評估 instead of duplicating the finding here.",
    "   - If the change has no runtime behavioral impact (e.g. annotation-only removal), write `無行為變更`.",
    "",
    "3. 風險評估: Use the host-computed risk level from `<risk_snapshot>` as the `整體風險等級`. Do not recompute or override it.",
    "   - 整體風險等級: Copy the exact `riskLevel` value from `<risk_snapshot>` (High / Low / None).",
    "   - 風險理由: Explain in user-facing terms how confirmed findings, unresolved missing information, and affected behavior determined the level. Do not mention internal field names or add hedging tails.",
    "",
    "Respond in the following format:",
    "",
    "## Summary",
    "### 審查基礎",
    "- 改動概要：[one-sentence before→after transformation]",
    "- 依據規範：[only decisive references — omit generic build config]",
    "- 必要假設：[necessary assumptions that shaped conclusions, or 無]",
    "### 行為變更提醒",
    "- [runtime behavioral changes as direct facts, or 無行為變更]",
    "### 風險評估",
    "- 整體風險等級：[High / Low / None]",
    "- 風險理由：[reference specific findings or their absence — no hedging]",
    "",
    "Before submitting your response, verify:",
    "- Begins with `## Summary`",
    "- Contains `### 審查基礎` with all three sub-fields answered: 改動概要、依據規範、必要假設",
    "- 改動概要 is one sentence; 必要假設 lists unresolved assumptions or missing facts that shaped conclusions, or explicitly states 無 only when missing-information state is empty; 依據規範 omits generic build config",
    "- Contains `### 行為變更提醒` that adds information beyond 改動概要, or states `無行為變更`",
    "- Contains `### 風險評估` with 整體風險等級 matching the host-computed risk level exactly, and 風險理由 free of hedging tails or internal field names"
  ].join("\n");
}

function buildStep7JudgeCriteria(): string {
  return [
    "段落 `## Summary` 必須存在，且符合以下條件：",
    "- 包含 `### 審查基礎` 子段落，且「改動概要」、「依據規範」、「必要假設」三個欄位都必須出現並對應回答欄位要求；若無必要假設，必須明確寫 `無`。",
    "- 包含 `### 行為變更提醒` 子段落，且有具體內容或明確寫 `無行為變更`。",
    "- 包含 `### 風險評估` 子段落，且「整體風險等級」為 High / Low / None 其中之一，「風險理由」非空。"
  ].join("\n");
}
