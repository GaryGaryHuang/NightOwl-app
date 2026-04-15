import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizers/review-note-finalizer.ts";
import { STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createSectionResolve } from "./step-resolve-helpers.ts";


const STEP4_SYSTEM_ADDITION = [
  "## Current Step: Strategy & What-if Scenarios",
  "- Synthesize the Overview, Dependencies & Boundaries, and Knowledge & Source of Truth in <current_review> to define the investigation strategy for later validation.",
  "- Use prior context to identify the specific failure surfaces that are most worth testing in this file. Do not generate generic scenarios that could apply to arbitrary code changes.",
  "- Each What-if scenario must be a neutral, testable hypothesis for later validation to investigate — not a conclusion that a bug exists.",
  "- Ground each scenario in available evidence from the diff, the file's role, relevant dependency boundaries, and any governing rules, versions, assumptions, or out-of-scope constraints established earlier.",
  "- Prefer a small set of high-signal scenarios that cover distinct failure modes or materially different uncertainties over a longer but repetitive list.",
  "- This step defines where later validation should focus. Do not perform the validation itself, do not report findings, and do not make correctness judgments.",
  "- Begin the response with `## Strategy & What-if Scenarios`."
].join("\n");

const STEP4_INSTRUCTION = [
  "This step defines where later validation should focus. Do not perform the validation itself, do not report findings, and do not make correctness judgments.",
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

const STEP4_JUDGE_CRITERIA = [
  "段落 `## Strategy & What-if Scenarios` 必須存在，且符合下列條件：",
  "- 「高風險區域」欄位必須出現，且至少包含一項與本次改動相關的高風險區域，並說明其關聯。",
  "- What-if 項目至少 3 個，且每項都使用 W# 編號，格式為 W1、W2、...。",
  "- 每個 What-if 項目都必須包含：",
  "  - 觸發條件或情境",
  "  - 預期正確行為",
  "  - 待驗證的風險或不確定性",
  "  - 與本次改動的關聯",
  "- What-if 項目不得只是泛用風險口號或未替換的佔位文字。"
].join("\n");

export interface Step4StrategyWhatIfScenariosStepOptions {
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

/**
 * Convert the accumulated context into a small set of change-specific validation hypotheses for the finding stages.
 */
export class Step4StrategyWhatIfScenariosStep implements StepDefinition {
  readonly stepId = "step4-strategy-what-if-scenarios";
  readonly #reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;

  constructor(options: Step4StrategyWhatIfScenariosStepOptions) {
    this.#reviewNoteFinalizer = options.reviewNoteFinalizer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const { stepId } = this;
    return {
      stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP4_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep4UserMessage(
          context,
          this.#reviewNoteFinalizer.render(context)
        )
      },
      reviewProfile: {
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      resolve: createSectionResolve({
        stepId,
        filePath: context.filePath,
        sectionKey: STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY,
        criteria: STEP4_JUDGE_CRITERIA
      })
    };
  }
}

function buildStep4UserMessage(
  context: FileReviewContext,
  currentReview: string
): string {
  return [
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    "<current_review>",
    currentReview,
    "</current_review>",
    "",
    STEP4_INSTRUCTION
  ].join("\n");
}
