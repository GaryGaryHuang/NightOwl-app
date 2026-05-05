import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewBasisV1 } from "../review-basis.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import {
  CANDIDATE_CLASSIFICATIONS,
  CANDIDATE_SEVERITIES,
  HYPOTHESIS_CLOSURE_STATUSES
} from "../semantic-review.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { JSON_STEP_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createCandidateFindingsV3Resolve } from "./step-resolve-helpers.ts";


const STEP5_SYSTEM_ADDITION = [
  "## Current Step: Validation & Interrogation",
  "- Use `ReviewBasisV1.hypothesisLedger` in <review_basis> as the investigation plan for this step.",
  "- Treat each hypothesis as testable review work, not as an assumed defect.",
  "- Validate each hypothesis with targeted code-level analysis. Trace the relevant Data Flow and Control Flow, including entry conditions, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation logic that materially affects the hypothesis.",
  "- This step produces candidate findings only. It does not write final approved findings.",
  "- Convert a validated deviation into a candidate only when the available evidence supports a concrete, actionable problem on a credibly reachable real-world path.",
  "- Every emitted candidate must include classification, severity, title, traceability, evidence, triggerCondition, impact, and counterEvidence.",
  "- When <diff> can be validated, a `line-range` anchor must overlap at least one changed head-side line.",
  "- Keep the scope centered on hypothesis-driven validation. You may include a closely related deviation only when it is directly exposed by the same validation path.",
  "- When determining whether a deviation exists, explicitly check against the facts, inferences, identifiers, missing information, and source-of-truth expectations established in <review_basis>. Do not report deviations that fall outside the review basis.",
  "- IMPORTANT: Do not report candidates based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a candidate for every hypothesis.",
  "- If trigger, impact, or required contract cannot be proven, record it in `criticalMissingInformation` instead of emitting a candidate finding.",
  "- Output valid JSON only."
].join("\n");

const STEP5_INSTRUCTION = [
  "Based on `ReviewBasisV1.hypothesisLedger` in <review_basis>, validate each hypothesis in sequence and produce candidate findings for this file.",
  "",
  "1. Use `hypothesisLedger` as the investigation plan for this step.",
  "   - Treat each hypothesis as testable review work, not as an assumed defect.",
  "   - Validate the hypotheses one by one to ensure coverage, but do not force a candidate for every hypothesis.",
  "",
  "2. For each scenario:",
  "   - Read the relevant source files and trace the Data Flow and Control Flow for the path under investigation.",
  "   - Identify the concrete trigger condition, entry path, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation behavior relevant to that scenario.",
  "   - Determine whether the expected correct behavior described by the review basis is preserved, or whether a concrete deviation is supported by the available evidence.",
  "   - If the hypothesis is not supported, already handled, blocked by missing information, or not credibly reachable in practice, do not turn it into a defect candidate.",
  "",
  "3. Create a candidate only when all of the following are true:",
  "   - the code path is credibly reachable in a real-world scenario",
  "   - the deviation is supported by concrete evidence from the code or tool results",
  "   - the impact is meaningful enough to be actionable",
  "   - the concern is not merely theoretical or dependent on implausible assumptions",
  "",
  "4. Classify each candidate as:",
  "   - `confirmed_problem`: a concrete, evidence-backed defect candidate with `severity` of `high` or `low`",
  "   - `reasonable_risk`: a lower-confidence but evidence-backed risk candidate; must use `severity = \"low\"`",
  "",
  "5. Every candidate must include a `traceability` object for the reviewed file:",
  "   - use `\"kind\": \"line-range\"` with positive integer `lineStart` and `lineEnd` for head-side 1-based file lines",
  "   - when <diff> can be validated, `line-range` must overlap at least one changed head-side line",
  "   - use `\"kind\": \"diff-hunk\"` with `hunkHeader` only when you are anchoring the finding to an actual unified diff hunk header from <diff>",
  "",
  "6. Do not emit speculative defect candidates.",
  "   - If evidence or reachability is weak, list the missing information in `criticalMissingInformation` instead.",
  "   - If the claim violates declared scope, omit it.",
  "",
  "7. Every candidate must include:",
  "   - `classification` and `severity`",
  "   - `title`: a concise summary of the problem",
  "   - `traceability`: anchor to the relevant code",
  "   - `evidence`: prose describing the concrete code evidence supporting the finding",
  "   - `triggerCondition`: the condition that triggers the problem",
  "   - `impact`: the user-visible or system-visible consequence",
  "   - `counterEvidence`: array of strings describing evidence that was checked against the finding",
  "",
  "8. Apply a final skepticism pass before output:",
  "   - Remove or convert any candidate that is weakly supported, not credibly reachable, redundant with another candidate, or too speculative to defend in review.",
  "   - If no candidates remain after validating all hypotheses, return an empty `findings` array with complete `hypothesisClosure` and any `criticalMissingInformation`.",
  "",
  "9. Keep the scope disciplined:",
  "   - Prioritize deviations uncovered through `ReviewBasisV1.hypothesisLedger`.",
  "   - Include a newly discovered deviation only if it is directly exposed by the same validation path.",
  "   - Do not expand into a general bug hunt beyond the hypothesis-driven validation of this step.",
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  `Allowed classification values: ${formatQuotedValues(CANDIDATE_CLASSIFICATIONS)}.`,
  `Allowed severity values: ${formatQuotedValues(CANDIDATE_SEVERITIES)}.`,
  `Allowed hypothesisClosure.status values: ${formatQuotedValues(HYPOTHESIS_CLOSURE_STATUSES)}.`,
  `{"findings": [{"classification": "confirmed_problem", "severity": "high", "title": "問題標題", "traceability": {"kind": "line-range", "lineStart": 21, "lineEnd": 22}, "evidence": "changed branch dereferences input.value before fallback; guard was moved after dereference", "triggerCondition": "nullable input reaches the changed branch", "impact": "requests with null input fail with a runtime TypeError", "counterEvidence": ["existing fallback path no longer runs before dereference"]}], "hypothesisClosure": [{"hypothesisId": "H1", "status": "closed_by_candidate", "rationale": "candidate covers the hypothesis"}], "criticalMissingInformation": []}`,
  "",
  `If no findings remain, return: {"findings": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "changed path preserves fallback"}], "criticalMissingInformation": []}`,
  "Output exactly one JSON object. Begin with `{` and end with `}` \u2014 no Markdown code fences, no surrounding text, no trailing content after the closing brace."
].join("\n");

export interface Step5ValidationInterrogationStepOptions {
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

/**
 * Run the first-pass scenario validation and emit only evidence-backed structured findings.
 */
export class Step5ValidationInterrogationStep implements StepDefinition {
  readonly stepId = "step5-validation-interrogation";
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;

  constructor(options: Step5ValidationInterrogationStepOptions) {
    this.#promptSerializer = options.promptSerializer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const reviewBasis = requireReviewBasis(context);

    return {
      stepId: this.stepId,
      prompt: {
        systemMessage: [JSON_STEP_SYSTEM_MESSAGE, STEP5_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep5UserMessage(
          context,
          reviewBasis,
          this.#promptSerializer.serialize({
            context,
            include: ["review-basis", "validation-feedback"]
          })
        )
      },
      reviewProfile: {
        knowledgeMode: "disabled",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: createCandidateFindingsV3Resolve({
        stepId: this.stepId,
        filePath: context.filePath,
        diffContent: context.diffContent,
        reviewBasis
      })
    };
  }
}

function buildStep5UserMessage(
  context: FileReviewContext,
  reviewBasis: unknown,
  reviewState: string
): string {
  return [
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    '<review_basis format="json">',
    stringifyForXmlishBlock(reviewBasis),
    "</review_basis>",
    "",
    reviewState,
    "",
    STEP5_INSTRUCTION
  ].join("\n");
}

function requireReviewBasis(context: FileReviewContext): ReviewBasisV1 {
  const reviewBasis = context.getReviewBasis();
  if (!reviewBasis) {
    throw new Error(
      `ReviewBasis must exist before Step 5 for "${context.filePath}"`
    );
  }
  return reviewBasis;
}

function stringifyForXmlishBlock(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[<>&]/gu, (char) => {
    switch (char) {
      case "<":
        return "\\u003c";
      case ">":
        return "\\u003e";
      case "&":
        return "\\u0026";
      default:
        return char;
    }
  });
}

function formatQuotedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}
