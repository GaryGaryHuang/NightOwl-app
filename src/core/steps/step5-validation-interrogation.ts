import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createStructuredResolve } from "./step-resolve-helpers.ts";


const STEP5_SYSTEM_ADDITION = [
  "## Current Step: Validation & Interrogation",
  "- Use `ReviewBasisV1.hypothesisLedger` in <review_basis> as the investigation plan for this step.",
  "- Treat each hypothesis as testable review work, not as an assumed defect.",
  "- Validate each hypothesis with targeted code-level analysis. Trace the relevant Data Flow and Control Flow, including entry conditions, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation logic that materially affects the hypothesis.",
  "- This Phase 1 step still produces lean Finding schema v2 first-pass findings for later review. CandidateFindingsV3 and the semantic validator loop arrive in Phase 2.",
  "- Convert a validated deviation into a finding only when the available evidence supports a concrete, actionable problem on a credibly reachable real-world path.",
  "- Every emitted finding must include a `traceability` object that anchors the finding to the reviewed file.",
  "- When <diff> can be validated, a `line-range` anchor must overlap at least one changed head-side line. If the correct anchor intentionally points outside the changed lines because it identifies a dependency path, include `dependencyPathException` with a non-empty `reason` and `dependencyAnchor.filePath`.",
  "- Keep the scope centered on hypothesis-driven validation. You may include a closely related deviation only when it is directly exposed by the same validation path.",
  "- When determining whether a deviation exists, explicitly check against the facts, inferences, identifiers, missing information, and source-of-truth expectations established in <review_basis>. Do not report deviations that fall outside the review basis.",
  "- IMPORTANT: Do not report findings based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a finding for every scenario.",
  "- Every finding must include `findingId` and the user-facing finding fields. Do not include internal verifier metadata or fields outside the JSON structure.",
  "- Output valid JSON only."
].join("\n");

const STEP5_INSTRUCTION = [
  "Based on `ReviewBasisV1.hypothesisLedger` in <review_basis>, validate each hypothesis in sequence and produce the first-pass findings for this file.",
  "",
  "1. Use `hypothesisLedger` as the investigation plan for this step.",
  "   - Treat each hypothesis as testable review work, not as an assumed defect.",
  "   - Validate the hypotheses one by one to ensure coverage, but do not force a finding for every hypothesis.",
  "",
  "2. For each scenario:",
  "   - Read the relevant source files and trace the Data Flow and Control Flow for the path under investigation.",
  "   - Identify the concrete trigger condition, entry path, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation behavior relevant to that scenario.",
  "   - Determine whether the expected correct behavior described by the review basis is preserved, or whether a concrete deviation is supported by the available evidence.",
  "   - If the hypothesis is not supported, already handled, blocked by missing information, or not credibly reachable in practice, do not turn it into a finding.",
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
  "5. Every finding must include a `traceability` object for the reviewed file:",
  "   - use `\"kind\": \"line-range\"` with positive integer `lineStart` and `lineEnd` for head-side 1-based file lines",
  "   - when <diff> can be validated, `line-range` must overlap at least one changed head-side line; if the correct anchor intentionally points outside the changed lines because it identifies a dependency path, include `dependencyPathException` with non-empty `reason` and `dependencyAnchor.filePath`",
  "   - use `\"kind\": \"diff-hunk\"` with `hunkHeader` only when you are anchoring the finding to an actual unified diff hunk header from <diff>",
  "",
  "6. Do not emit speculative findings.",
  "   - If evidence or reachability is weak, omit the finding instead of encoding uncertainty.",
  "   - If the claim violates declared scope, omit it.",
  "",
  "7. Every finding must include:",
  "   - `findingId`: a unique string within this payload (e.g. \"F1\", \"F2\")",
  "   - `expectedBehavior`: the specific correct behavior required by code, contract, or source-of-truth evidence",
  "   - `actualBehavior`: the specific behavior observed from the changed code",
  "   - `sourceHypothesisId` (optional): the hypothesis ID from `ReviewBasisV1.hypothesisLedger` that led to this finding",
  "",
  "8. Apply a final skepticism pass before output:",
  "   - Remove any finding that is weakly supported, not credibly reachable, redundant with another finding, or too speculative to defend in review.",
  "   - If no findings remain after validating all scenarios, return an empty `findings` array.",
  "",
  "9. Keep the scope disciplined:",
  "   - Prioritize deviations uncovered through `ReviewBasisV1.hypothesisLedger`.",
  "   - Include a newly discovered deviation only if it is directly exposed by the same validation path.",
  "   - Do not expand into a general bug hunt beyond the hypothesis-driven validation of this step.",
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  "Top-level `schemaVersion` must be `2`.",
  "{\"schemaVersion\": 2, \"findings\": [{\"findingId\": \"F1\", \"sourceHypothesisId\": \"W1\", \"type\": \"must\", \"title\": \"問題標題\", \"traceability\": {\"kind\": \"line-range\", \"lineStart\": 21, \"lineEnd\": 22}, \"expectedBehavior\": \"nullable input must return the existing fallback before dereference\", \"actualBehavior\": \"the changed code dereferences input.value before checking for null\", \"deviation\": \"null input now throws instead of returning fallback\", \"impact\": \"requests with null input fail with a runtime TypeError\", \"suggestion\": \"restore the null guard before reading input.value\"}]}",
  "",
  "If no findings remain, return: {\"schemaVersion\": 2, \"findings\": []}",
  "The `type` field must be either `\"must\"` or `\"nice\"`.",
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
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP5_SYSTEM_ADDITION].join("\n\n"),
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
        timeoutMs: 300_000
      },
      resolve: createStructuredResolve({
        stepId: this.stepId,
        filePath: context.filePath,
        diffContent: context.diffContent
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

function requireReviewBasis(context: FileReviewContext): unknown {
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
