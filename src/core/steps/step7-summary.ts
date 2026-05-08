import type {FileReviewContext} from "../file-review-context.ts";
import {SUMMARY_SECTION_KEY} from "../review-section-contract.ts";
import {REVIEW_TURN_TIMEOUT_MS} from "../review-runtime-contract.ts";
import type {ReviewStatePromptSerializer} from "../review-state-prompt-serializer.ts";
import {buildRiskSnapshot, type RiskSnapshot} from "../risk-level.ts";
import type {StepExecutionPlan, StepDefinition} from "../step-runner.ts";
import {MARKDOWN_STEP_SYSTEM_MESSAGE} from "./shared-step-system-blocks.ts";
import {createStep7Resolve} from "./step-resolve-helpers.ts";

const STEP7_SYSTEM_ADDITION = [
    "## Current Step: Summary",
    "- Produce only the narrative portion of the final summary: the review basis, behavior-change reminder, and risk rationale for this file.",
    "- Base the narrative on the provided review state: the established file context, validated review results, and unresolved information gaps.",
    "- Keep the narrative concise and reader-facing. Use only information supported by the review state, and synthesize the review result without duplicating the detailed Findings entries.",
    "- This step contributes only the three requested narrative sections; the final report shell and deterministic summary fields are assembled outside this response.",
    "- Language: 正體中文. Preserve code identifiers, file paths, function/class/property names, commands, error messages, API names, enum values, and literal values exactly as they appear in the review state."
].join("\n");

export interface Step7SummaryStepOptions {
    promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

type Step7Verdict =
    | "未發現需處理事項"
    | "未發現需處理事項，但有審查限制"
    | "僅有非阻斷性建議"
    | "必須優先修正";

type Step7ReviewConfidenceState = "complete" | "limited";

interface Step7SummaryStatus {
    readonly verdict: Step7Verdict;
    readonly riskLevel: RiskSnapshot["derivedRiskLevel"];
    readonly mustFixFindingCount: number;
    readonly niceToHaveFindingCount: number;
    readonly missingInformationCount: number;
    readonly reviewConfidenceState: Step7ReviewConfidenceState;
    readonly limitationSummary: string;
    readonly actionGuidance: readonly string[];
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
        const {stepId} = this;
        const snapshot = buildRiskSnapshot(context.getFindings());
        const missingInformationItems = context.getMissingInformationItems() ?? [];
        const summaryStatus = buildStep7SummaryStatus(
            snapshot,
            missingInformationItems.length
        );
        return {
            stepId,
            prompt: {
                systemMessage: [MARKDOWN_STEP_SYSTEM_MESSAGE, STEP7_SYSTEM_ADDITION].join("\n\n"),
                userMessage: buildStep7UserMessage(
                    this.#promptSerializer.serialize({
                        context,
                        include: [
                            "review-basis",
                            "approved-findings",
                            "missing-information",
                            "validation-report"
                        ]
                    })
                )
            },
            reviewProfile: {
                knowledgeMode: "disabled",
                model: "gpt-5.4-mini",
                timeoutMs: REVIEW_TURN_TIMEOUT_MS
            },
            resolve: createStep7Resolve({
                stepId,
                filePath: context.filePath,
                sectionKey: SUMMARY_SECTION_KEY,
                expectedRiskLevel: snapshot.derivedRiskLevel,
                forbiddenResponsePatterns: [
                    /^##\s+Summary\b/mu,
                    /^###\s+審查結論(?:\s|$)/mu,
                    /^###\s+後續行動(?:\s|$)/mu,
                    /(?:整體風險等級|Overall risk level)[：:]/iu
                ],
                composeReport: (response) => composeStep7Report(response, summaryStatus)
            })
        };
    }
}

function buildStep7UserMessage(reviewState: string): string {
    return [
        buildStep7Instruction(),
        "",
        reviewState
    ].join("\n");
}

function buildStep7Instruction(): string {
    return [
        "Use the <review_state> block as the concrete input.",
        "Use this source map when transferring review state into prose:",
        "- 審查依據: use reviewBasis for the file role, behavior changes, confirmed evidence, source-of-truth references, tool-backed facts, and code paths.",
        "- 待確認資訊: summarize only <review_state>.missingInformationItems; write 無 when that array is empty.",
        "- 行為變更提醒: use reviewBasis.changedBehavior, dependencyMap, flowMap, and approved finding context to describe runtime behavior changes as direct facts.",
        "- 風險判定理由: use approvedFindings, validationReport, missingInformationItems, and affected behavior to explain why the review result is clean, nice-to-have, must-fix, or limited.",
        "- When using validationReport, describe the semantic validation outcome in reader-facing terms.",
        "",
        "Return exactly these three Markdown sections in this order:",
        "",
        "### 審查依據",
        "- 異動概要：[one sentence describing this file's before→after transformation]",
        "- 已核對依據：[decisive confirmed evidence, source-of-truth references, tool results, or code paths]",
        "- 待確認資訊：[summarize <review_state>.missingInformationItems; write 無 when that array is empty]",
        "",
        "### 行為變更提醒",
        "- [runtime behavior changes the reader should verify, stated as direct facts; write 無行為變更 only when there is no runtime behavior change]",
        "",
        "### 風險判定理由",
        "- [how approvedFindings, validationReport, missingInformationItems, and affected behavior lead to the review result]"
    ].join("\n");
}

function buildStep7SummaryStatus(
    snapshot: RiskSnapshot,
    missingInformationCount: number
): Step7SummaryStatus {
    const reviewConfidenceState: Step7ReviewConfidenceState =
        missingInformationCount > 0 ? "limited" : "complete";
    return {
        verdict: deriveStep7Verdict(snapshot, missingInformationCount),
        riskLevel: snapshot.derivedRiskLevel,
        mustFixFindingCount: snapshot.mustCount,
        niceToHaveFindingCount: snapshot.niceCount,
        missingInformationCount,
        reviewConfidenceState,
        limitationSummary: missingInformationCount === 0
            ? "無"
            : `${missingInformationCount} 項 missing information`,
        actionGuidance: buildStep7ActionGuidance(
            snapshot,
            reviewConfidenceState,
            missingInformationCount
        )
    };
}

function deriveStep7Verdict(
    snapshot: RiskSnapshot,
    missingInformationCount: number
): Step7Verdict {
    if (snapshot.mustCount > 0) {
        return "必須優先修正";
    }
    if (snapshot.niceCount > 0) {
        return "僅有非阻斷性建議";
    }
    if (missingInformationCount > 0) {
        return "未發現需處理事項，但有審查限制";
    }
    return "未發現需處理事項";
}

function buildStep7ActionGuidance(
    snapshot: RiskSnapshot,
    reviewConfidenceState: Step7ReviewConfidenceState,
    missingInformationCount: number
): string[] {
    const limitationGuidance = reviewConfidenceState === "limited"
        ? [
            `審查限制：仍有 ${missingInformationCount} 項 missing information。`
        ]
        : [];

    if (snapshot.mustCount > 0) {
        return [
            "Must-fix：有已確認的 must-fix findings。",
            snapshot.niceCount > 0
                ? "Nice-to-have：有已確認的 nice-to-have findings。"
                : "Nice-to-have：無。",
            ...limitationGuidance
        ];
    }
    if (snapshot.niceCount > 0) {
        return [
            "Must-fix：無。",
            "Nice-to-have：有已確認的 nice-to-have findings。",
            ...limitationGuidance
        ];
    }
    if (limitationGuidance.length > 0) {
        return [
            "Clean：沒有 validated findings。",
            ...limitationGuidance
        ];
    }
    return [
        "Clean：沒有 validated findings。"
    ];
}

function composeStep7Report(response: string, status: Step7SummaryStatus): string {
    const narrative = response.trim();
    return [
        "## Summary",
        "### 審查結論",
        `- 結論：${status.verdict}`,
        `- 整體風險等級：${status.riskLevel}`,
        `- 已驗證的結果：must-fix ${status.mustFixFindingCount}；nice-to-have ${status.niceToHaveFindingCount}`,
        `- 審查限制：${status.limitationSummary}`,
        "",
        narrative,
        "",
        "### 後續行動",
        ...status.actionGuidance.map((line) => `- ${line}`)
    ].join("\n");
}
