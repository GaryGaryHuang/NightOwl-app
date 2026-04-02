import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizer.ts";
import { STRATEGY_WHAT_IF_SCENARIOS_SECTION } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";

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
    return {
      stepId: this.stepId,
      kind: "section",
      sectionKey: STRATEGY_WHAT_IF_SCENARIOS_SECTION.key,
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
      completionCheck: {
        kind: "judge",
        criteria: STEP4_JUDGE_CRITERIA
      },
      applyTo(targetContext: FileReviewContext, responseText: string) {
        targetContext.setSection(STRATEGY_WHAT_IF_SCENARIOS_SECTION.key, responseText);
      }
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
