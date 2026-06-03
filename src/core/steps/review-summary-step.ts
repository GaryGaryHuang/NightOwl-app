import type {FileReviewContext, Finding} from "../file-review-context.ts";
import {REVIEW_BASIS_STEP_ID, REVIEW_SUMMARY_STEP_ID} from "../review-step-ids.ts";
import {SUMMARY_SECTION_KEY} from "../review-section-contract.ts";
import {REVIEW_TURN_TIMEOUT_MS} from "../review-runtime-contract.ts";
import type {ReviewStatePromptSerializer} from "../review-state-prompt-serializer.ts";
import {countMustFindings, countNiceFindings} from "../risk-level.ts";
import type {StepExecutionPlan, StepDefinition} from "../step-runner.ts";
import {MARKDOWN_STEP_SYSTEM_MESSAGE} from "./shared-step-system-blocks.ts";

type ReviewSummaryLanguage = "zh-TW" | "en";

interface ReviewSummaryNarrativeSectionPattern {
    readonly label: string;
    readonly pattern: RegExp;
}

const REVIEW_SUMMARY_NARRATIVE_SECTIONS: Record<
    ReviewSummaryLanguage,
    readonly ReviewSummaryNarrativeSectionPattern[]
> = {
    "zh-TW": [
        { label: "審查依據", pattern: /^#{2,4}\s+審查依據(?:[：:]|\s|$)/mu },
        { label: "行為變更提醒", pattern: /^#{2,4}\s+行為變更提醒(?:[：:]|\s|$)/mu }
    ],
    en: [
        { label: "Review Basis", pattern: /^#{2,4}\s+Review Basis(?:[：:]|\s|$)/mu },
        {
            label: "Behavior Change Notes",
            pattern: /^#{2,4}\s+Behavior Change Notes(?:[：:]|\s|$)/mu
        }
    ]
};

const REVIEW_SUMMARY_SYSTEM_ADDITION = [
    "## Current Step: Review Summary",
    "- Produce the reader-facing narrative portion of the final per-file review summary, containing exactly the `### 審查依據` and `### 行為變更提醒` sections.",
    "- Use the provided review state as the evidence source; internal record names, validator objects, and bookkeeping are private source material, not report text.",
    "- This step contributes only the requested narrative sections; the final report shell and deterministic summary fields are assembled outside this response.",
    "- Language: 正體中文. Preserve code identifiers, file paths, function/class/property names, commands, error messages, API names, enum values, and literal values exactly as they appear in the review state."
].join("\n");

interface ReviewSummaryStepOptions {
    promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
    language?: ReviewSummaryLanguage;
}

interface ReviewSummaryStatus {
    readonly mustFixFindingCount: number;
    readonly niceToHaveFindingCount: number;
    readonly limitationSummary: string;
}

/**
 * Final section step: turn the completed note into a reader-facing summary without duplicating the detailed findings.
 */
export class ReviewSummaryStep implements StepDefinition {
    readonly stepId = REVIEW_SUMMARY_STEP_ID;
    readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
    readonly #language: ReviewSummaryLanguage;

    constructor(options: ReviewSummaryStepOptions) {
        this.#promptSerializer = options.promptSerializer;
        this.#language = options.language ?? "zh-TW";
    }

    prepare(context: FileReviewContext): StepExecutionPlan {
        const {stepId} = this;
        const missingInformationItems = context.getMissingInformationItems() ?? [];
        const summaryStatus = buildReviewSummaryStatus(
            context.getFindings(),
            missingInformationItems.length,
            this.#language
        );
        return {
            stepId,
            prompt: {
                systemMessage: [
                    MARKDOWN_STEP_SYSTEM_MESSAGE,
                    REVIEW_SUMMARY_SYSTEM_ADDITION
                ].join("\n\n"),
                userMessage: buildReviewSummaryUserMessage(
                    this.#promptSerializer.serialize({
                        context,
                        include: [
                            REVIEW_BASIS_STEP_ID,
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
            resolve: async (response) => {
                rejectMalformedReviewSummaryNarrative(
                    response,
                    REVIEW_SUMMARY_NARRATIVE_SECTIONS[this.#language]
                );
                const sectionContent = composeReviewSummaryReport(
                    response,
                    summaryStatus,
                    this.#language
                );

                return (targetContext: FileReviewContext) => {
                    targetContext.setSection(SUMMARY_SECTION_KEY, sectionContent);
                };
            }
        };
    }
}

function buildReviewSummaryUserMessage(reviewState: string): string {
    return [
        reviewState,
        "",
        buildReviewSummaryInstruction()
    ].join("\n");
}

function buildReviewSummaryInstruction(): string {
    return [
        "Produce the reader-facing Review Summary narrative for this file from the inputs above.",
        "",
        "Inputs:",
        "- `<review_state>` is private source material; it is not printed verbatim in the final review output. Use it only to locate source data.",
        "- `<review_state>.reviewBasis` supplies the file role, changed behavior, confirmed evidence, source-of-truth references, code paths, dependency, and flow context.",
        "- `<review_state>.approvedFindings` and `<review_state>.validationReport` supply the validated finding outcomes.",
        "- `<review_state>.missingInformationItems` is the only source for the final missing-information list.",
        "",
        "Step 1 - Write `### 審查依據`:",
        "- `- 異動概要：` from the review basis file role and changed behavior.",
        "- `- 已核對依據：` from the confirmed evidence, source-of-truth references, tool-backed facts, and code paths.",
        "- `- 待確認資訊：` from the final `<review_state>.missingInformationItems` array only. If that final array is empty, write exactly `無` even if review basis, broader changeset context, adjacent-file absence, missing collaborators, test gaps, external contracts, or intermediate review notes mention uncertainty. When the array has multiple items, fold them into this single bullet rather than splitting into sub-bullets or dropping items.",
        "",
        "Step 2 - Write `### 行為變更提醒`:",
        "- Describe runtime behavior changes as direct facts, sourced only from the reviewed behavior, dependency, flow, and finding-outcome context in `<review_state>`.",
        "- Emit one or more bullets, or exactly `- 無行為變更` when there is no runtime behavior change.",
        "",
        "Section line shapes:",
        "- `### 審查依據` must contain exactly these three bullets, in this order: `- 異動概要：...`, `- 已核對依據：...`, `- 待確認資訊：...`.",
        "- `### 行為變更提醒` must contain one or more bullets, or exactly `- 無行為變更`.",
        "",
        "Source-material translation rules:",
        "- Internal source labels are never report wording. Do not print labels such as `reviewBasis`, `approvedFindings`, `validationReport`, `missingInformationItems`, Candidate Findings, Semantic Validation, or synthetic IDs such as `E1`, `F1`, `H1`, `MI1` in the narrative.",
        "- Translate internal source material into reader-facing statements about evidence, finding outcomes, missing-information limits, code paths, and behavior.",
        "- The deterministic `審查結論` summary fields are assembled outside this response; `待確認資訊` shares the same `missingInformationItems` source as the outer `審查限制` line, so do not reconcile or restate counts.",
        "",
        "Completion policy:",
        "- Begin directly with `### 審查依據`; output only the two required Markdown sections; do not add an outer summary heading, conclusion or action sections, prefaces, code fences, or explanatory labels.",
        "- Preserve concrete identifiers, file paths, API names, commands, and literal values exactly when they are useful evidence.",
        "- Keep the summary compact; do not duplicate detailed Findings entries, but keep the decisive facts needed to understand the result.",
        "",
        "Complete Markdown output examples - labels are explanatory only; output only the two Markdown sections:",
        "With evidence and a behavior change:",
        "### 審查依據",
        "- 異動概要：...",
        "- 已核對依據：...",
        "- 待確認資訊：...",
        "",
        "### 行為變更提醒",
        "- ...",
        "",
        "No missing information and no behavior change:",
        "### 審查依據",
        "- 異動概要：...",
        "- 已核對依據：...",
        "- 待確認資訊：無",
        "",
        "### 行為變更提醒",
        "- 無行為變更"
    ].join("\n");
}

function buildReviewSummaryStatus(
    findings: Finding[] | undefined,
    missingInformationCount: number,
    language: ReviewSummaryLanguage
): ReviewSummaryStatus {
    return {
        mustFixFindingCount: countMustFindings(findings),
        niceToHaveFindingCount: countNiceFindings(findings),
        limitationSummary: missingInformationCount === 0
            ? language === "en" ? "None" : "無"
            : language === "en"
                ? `${missingInformationCount} missing information item(s)`
                : `${missingInformationCount} 項 missing information`
    };
}

function composeReviewSummaryReport(
    response: string,
    status: ReviewSummaryStatus,
    language: ReviewSummaryLanguage
): string {
    const narrative = response.trim();
    if (language === "en") {
        return [
            "## Summary",
            "### Review Conclusion",
            `- Verified results: must-fix ${status.mustFixFindingCount}; nice-to-have ${status.niceToHaveFindingCount}`,
            `- Review limitations: ${status.limitationSummary}`,
            "",
            narrative
        ].join("\n");
    }

    return [
        "## Summary",
        "### 審查結論",
        `- 已驗證的結果：must-fix ${status.mustFixFindingCount}；nice-to-have ${status.niceToHaveFindingCount}`,
        `- 審查限制：${status.limitationSummary}`,
        "",
        narrative
    ].join("\n");
}

function rejectMalformedReviewSummaryNarrative(
    response: string,
    narrativeSections: readonly ReviewSummaryNarrativeSectionPattern[]
): void {
    if (response.trim().length === 0) {
        throw new Error("Review Summary narrative response is empty");
    }

    for (const section of narrativeSections) {
        if (!section.pattern.test(response)) {
            throw new Error(
                `Review Summary narrative is missing required section: ${section.label}`
            );
        }
    }
}
