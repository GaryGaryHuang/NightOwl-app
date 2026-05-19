import type {FileReviewContext, Finding} from "../file-review-context.ts";
import {REVIEW_BASIS_STEP_ID, REVIEW_SUMMARY_STEP_ID} from "../review-step-ids.ts";
import {SUMMARY_SECTION_KEY} from "../review-section-contract.ts";
import {REVIEW_TURN_TIMEOUT_MS} from "../review-runtime-contract.ts";
import type {ReviewStatePromptSerializer} from "../review-state-prompt-serializer.ts";
import {countMustFindings, countNiceFindings} from "../risk-level.ts";
import type {StepExecutionPlan, StepDefinition} from "../step-runner.ts";
import {MARKDOWN_STEP_SYSTEM_MESSAGE} from "./shared-step-system-blocks.ts";
import {createReviewSummaryResolve} from "./step-resolve-helpers.ts";

const REVIEW_SUMMARY_SYSTEM_ADDITION = [
    "## Current Step: Review Summary",
    "- Produce the reader-facing narrative portion of the final per-file review summary.",
    "- Use the provided review state as the evidence source; internal record names, validator objects, and bookkeeping are private source material, not report text.",
    "- This step contributes only the requested narrative sections; the final report shell and deterministic summary fields are assembled outside this response.",
    "- Language: 正體中文. Preserve code identifiers, file paths, function/class/property names, commands, error messages, API names, enum values, and literal values exactly as they appear in the review state."
].join("\n");

interface ReviewSummaryStepOptions {
    promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
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

    constructor(options: ReviewSummaryStepOptions) {
        this.#promptSerializer = options.promptSerializer;
    }

    prepare(context: FileReviewContext): StepExecutionPlan {
        const {stepId} = this;
        const missingInformationItems = context.getMissingInformationItems() ?? [];
        const summaryStatus = buildReviewSummaryStatus(
            context.getFindings(),
            missingInformationItems.length
        );
        return {
            stepId,
            prompt: {
                systemMessage: [MARKDOWN_STEP_SYSTEM_MESSAGE, REVIEW_SUMMARY_SYSTEM_ADDITION].join("\n\n"),
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
            resolve: createReviewSummaryResolve({
                stepId,
                filePath: context.filePath,
                sectionKey: SUMMARY_SECTION_KEY,
                composeReport: (response) => composeReviewSummaryReport(response, summaryStatus)
            })
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
        "Use the `<review_state>` block above as private source material for this Review Summary summary. It is not printed verbatim in the final review output.",
        "",
        "Required output sections, in this order; begin with `### 審查依據`:",
        "- `### 審查依據`",
        "- `### 行為變更提醒`",
        "",
        "Section line shapes:",
        "- `### 審查依據` must contain exactly these bullets:",
        "  - `- 異動概要：...`",
        "  - `- 已核對依據：...`",
        "  - `- 待確認資訊：...`",
        "- `### 行為變更提醒` must contain one or more bullets, or exactly `- 無行為變更` when there is no runtime behavior change.",
        "",
        "Source-material translation rules:",
        "- Internal source labels are never report wording. Use them only to locate source data; do not print labels such as `reviewBasis`, `approvedFindings`, `validationReport`, `missingInformationItems`, Candidate Findings, Semantic Validation, or synthetic IDs such as `E1`, `F1`, `H1` in the narrative.",
        "- Translate internal source material into reader-facing statements about evidence, finding outcomes, missing-information limits, code paths, and behavior.",
        "- 審查依據: use the review basis and validated state for the file role, behavior changes, confirmed evidence, source-of-truth references, tool-backed facts, and code paths.",
        "- 待確認資訊: use only the final `<review_state>.missingInformationItems` array as the final missing-information list. If that final list is empty, write exactly `無` even if review basis, broader changeset context, adjacent-file absence, missing collaborators, test gaps, external contracts, or intermediate review notes mention uncertainty.",
        "- 行為變更提醒: use the reviewed behavior, dependency, flow, and finding-outcome context to describe runtime behavior changes as direct facts.",
        "",
        "Completion policy:",
        "- Output only the two required Markdown sections; do not add an outer summary heading, conclusion or action sections, prefaces, code fences, or explanatory labels.",
        "- Preserve concrete identifiers, file paths, API names, commands, and literal values exactly when they are useful evidence.",
        "- Keep the summary compact; do not duplicate detailed Findings entries, but keep the decisive facts needed to understand the result.",
        "",
        "Complete Markdown output example:",
        "The label is explanatory only; output only the two Markdown sections.",
        "",
        "### 審查依據",
        "- 異動概要：...",
        "- 已核對依據：...",
        "- 待確認資訊：...",
        "",
        "### 行為變更提醒",
        "- ..."
    ].join("\n");
}

function buildReviewSummaryStatus(
    findings: Finding[] | undefined,
    missingInformationCount: number
): ReviewSummaryStatus {
    return {
        mustFixFindingCount: countMustFindings(findings),
        niceToHaveFindingCount: countNiceFindings(findings),
        limitationSummary: missingInformationCount === 0
            ? "無"
            : `${missingInformationCount} 項 missing information`
    };
}

function composeReviewSummaryReport(response: string, status: ReviewSummaryStatus): string {
    const narrative = response.trim();
    return [
        "## Summary",
        "### 審查結論",
        `- 已驗證的結果：must-fix ${status.mustFixFindingCount}；nice-to-have ${status.niceToHaveFindingCount}`,
        `- 審查限制：${status.limitationSummary}`,
        "",
        narrative
    ].join("\n");
}