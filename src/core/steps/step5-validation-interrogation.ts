import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizers/review-note-finalizer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createStructuredResolve } from "./step-resolve-helpers.ts";


const STEP5_SYSTEM_ADDITION = [
  "## Current Step: Validation & Interrogation",
  "- Use the W# scenarios in the Strategy & What-if Scenarios section of <current_review> as the investigation plan for this step.",
  "- Treat each W# as a testable hypothesis, not as an assumed defect.",
  "- Validate each scenario with targeted code-level analysis. Trace the relevant Data Flow and Control Flow, including entry conditions, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation logic that materially affects the scenario.",
  "- This step produces the first-pass findings for later review. Convert a validated deviation into a finding only when the available evidence supports a concrete, actionable problem on a credibly reachable real-world path.",
  "- Every emitted finding must include a `traceability` object that anchors the finding to the reviewed file.",
  "- Keep the scope centered on scenario-driven validation. You may include a closely related deviation only when it is directly exposed by the same validation path.",
  "- When determining whether a deviation exists, explicitly check against the rules, assumptions, and scope boundaries established in the Knowledge & Source of Truth section of <current_review>. Do not report deviations that fall within the declared out-of-scope boundaries.",
  "- IMPORTANT: Do not report findings based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a finding for every scenario.",
  "- Output valid JSON only."
].join("\n");

const STEP5_INSTRUCTION = [
  "Based on the W# scenarios in the Strategy & What-if Scenarios section of <current_review>, validate each scenario in sequence and produce the first-pass findings for this file.",
  "",
  "1. Use the W# scenarios as the investigation plan for this step.",
  "   - Treat each W# as a testable hypothesis, not as an assumed defect.",
  "   - Validate the scenarios one by one to ensure coverage, but do not force a finding for every scenario.",
  "",
  "2. For each scenario:",
  "   - Read the relevant source files and trace the Data Flow and Control Flow for the path under investigation.",
  "   - Identify the concrete trigger condition, entry path, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation behavior relevant to that scenario.",
  "   - Determine whether the expected correct behavior described in the scenario is preserved, or whether a concrete deviation is supported by the available evidence.",
  "   - If the scenario is not supported, already handled, or not credibly reachable in practice, do not turn it into a finding.",
  "",
  "3. Create a finding only when all of the following are true:",
  "   - the code path is credibly reachable in a real-world scenario",
  "   - the deviation is supported by concrete evidence from the code or tool results",
  "   - the impact is meaningful enough to be actionable",
  "   - the concern is not merely theoretical or dependent on implausible assumptions",
  "",
  "4. Classify each finding as:",
  "   - `must`: a concrete, actionable problem with meaningful correctness, consistency, safety, compatibility, or operational impact",
  "   - `nice`: a lower-severity but still evidence-backed improvement opportunity that is useful to address",
  "",
  "5. For each finding, assign a `confidence` score (0–100) based on the strength of evidence, path reachability, and clarity of the deviation and impact.",
  "",
  "6. Every finding must include a `traceability` object for the reviewed file:",
  "   - use `\"kind\": \"line-range\"` with positive integer `lineStart` and `lineEnd` for head-side 1-based file lines",
  "   - use `\"kind\": \"diff-hunk\"` with `hunkHeader` only when you are anchoring the finding to an actual unified diff hunk header from <diff>",
  "",
  "7. Apply a final skepticism pass before output:",
  "   - Remove any finding that is weakly supported, not credibly reachable, redundant with another finding, or too speculative to defend in review.",
  "   - If no findings remain after validating all scenarios, return an empty `findings` array.",
  "",
  "8. Keep the scope disciplined:",
  "   - Prioritize deviations uncovered through the W# scenarios.",
  "   - Include a newly discovered deviation only if it is directly exposed by the same validation path.",
  "   - Do not expand into a general bug hunt beyond the scenario-driven validation of this step.",
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  "{\"findings\": [{\"type\": \"must\", \"title\": \"問題標題\", \"traceability\": {\"kind\": \"line-range\", \"lineStart\": 14, \"lineEnd\": 18}, \"context\": \"具體程式位置、條件或情境脈絡\", \"deviation\": \"預期行為與實際行為的落差\", \"impact\": \"若不處理會造成的後果\", \"suggestion\": \"具體且可執行的修正或改善建議\", \"confidence\": 85}]}",
  "",
  "If no findings remain, return: {\"findings\": []}",
  "The `type` field must be either `\"must\"` or `\"nice\"`.",
  "Output exactly one JSON object. Begin with `{` and end with `}` \u2014 no Markdown code fences, no surrounding text, no trailing content after the closing brace."
].join("\n");

export interface Step5ValidationInterrogationStepOptions {
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

/**
 * Run the first-pass scenario validation and emit only evidence-backed structured findings.
 */
export class Step5ValidationInterrogationStep implements StepDefinition {
  readonly stepId = "step5-validation-interrogation";
  readonly #reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;

  constructor(options: Step5ValidationInterrogationStepOptions) {
    this.#reviewNoteFinalizer = options.reviewNoteFinalizer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    return {
      stepId: this.stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP5_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep5UserMessage(
          context,
          this.#reviewNoteFinalizer.render(context)
        )
      },
      reviewProfile: {
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      resolve: createStructuredResolve({
        filePath: context.filePath,
        diffContent: context.diffContent
      })
    };
  }
}

function buildStep5UserMessage(
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
    STEP5_INSTRUCTION
  ].join("\n");
}
