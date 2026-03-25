import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import type { FindingsPayload } from "../structured-output-validator.ts";

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

const STEP5_SYSTEM_ADDITION = [
  "## Current Step: Validation & Interrogation",
  "- Use the W# scenarios in the Strategy & What-if Scenarios section of <current_review> as the investigation plan for this step.",
  "- Treat each W# as a testable hypothesis, not as an assumed defect.",
  "- Validate each scenario with targeted code-level analysis. Trace the relevant Data Flow and Control Flow, including entry conditions, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation logic that materially affects the scenario.",
  "- This step produces the first-pass findings for later review. Convert a validated deviation into a finding only when the available evidence supports a concrete, actionable problem on a credibly reachable real-world path.",
  "- Every emitted finding must include a `traceability` object that anchors the finding to the reviewed file.",
  "- Keep the scope centered on scenario-driven validation. You may include a closely related deviation only when it is directly exposed by the same validation path.",
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
  "Do not wrap the JSON in Markdown code fences or add any text outside the JSON object.",
  "Stop immediately after the closing `}`. Do not add any text, explanation, or newline after the JSON object."
].join("\n");

export interface Step5ValidationInterrogationStepOptions {
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

export class Step5ValidationInterrogationStep implements StepDefinition {
  readonly stepId = "step5-validation-interrogation";
  readonly #reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;

  constructor(options: Step5ValidationInterrogationStepOptions) {
    this.#reviewNoteFinalizer = options.reviewNoteFinalizer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    return {
      stepId: this.stepId,
      kind: "structured",
      structuredTarget: "findings",
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
      completionCheck: {
        kind: "deterministic",
        validatorId: "findings-json"
      },
      applyTo(targetContext: FileReviewContext, response: string | FindingsPayload) {
        const findings =
          typeof response === "string" ? [] : response.findings;

        targetContext.updateStructuredState({ findings });
      }
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
