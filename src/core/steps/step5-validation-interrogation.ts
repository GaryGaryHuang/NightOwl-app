import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewBasisV1 } from "../review-basis.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import {
  CANDIDATE_CLASSIFICATIONS,
  CANDIDATE_SEVERITIES,
  HYPOTHESIS_CLOSURE_STATUSES
} from "../semantic-review.ts";
import { buildXmlishJsonBlock } from "../prompt-serialization.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import {
  JSON_FINDING_STEP_SYSTEM_MESSAGE,
  MISSING_INFORMATION_DISCIPLINE_BLOCK
} from "./shared-step-system-blocks.ts";
import { createCandidateFindingsV3Resolve } from "./step-resolve-helpers.ts";

const STEP5_STRUCTURED_OUTPUT_GUIDANCE = [
  "### Structured-output guardrails",
  "- Before writing the answer, choose one of these outcomes: findings ready, no findings, or insufficient information.",
  "- `criticalMissingInformation` must always be an array of objects. Never emit strings, null, IDs, or Markdown bullets in that array.",
  "- A valid missing-information item is exactly: {\"description\": \"specific missing fact\", \"whyItMatters\": \"why this blocks a reliable finding\"}.",
  "- If the reviewed code has an observable, credibly reachable behavior problem, emit a `reasonable_risk` candidate with `severity = \"low\"` even when product intent is not fully specified; put the uncertainty in `counterEvidence` instead of converting the whole concern to missing information.",
  "- Do not convert locally provable orchestration risks into `criticalMissingInformation` only because an external SDK/API contract is unavailable. Competing local timeouts, cancellation races, stale async result guards, null-to-empty normalization, and partial-result loss can be low-severity `reasonable_risk` candidates when changed local code proves trigger and impact.",
  "- A candidate trigger must be reachable through current repo-supported production code, tests that document supported behavior, or an explicitly external contract. Do not create findings that require hypothetical future callers, custom test doubles, hand-written objects, or omitted optional parameters that no current call site omits.",
  "- `hypothesisClosure` must contain exactly one entry for each `ReviewBasisV1.hypothesisLedger[].hypothesisId`; use H IDs only there, not as finding IDs.",
  "- Do not emit `findingId`; the harness assigns F IDs after validation."
] as const;

const STEP5_SYSTEM_ADDITION = [
  "## Current Step: Validation & Interrogation",
  "- Use `ReviewBasisV1.hypothesisLedger` in <review_basis> as the investigation plan for this step.",
  "- Treat each hypothesis as testable review work, not as an assumed defect.",
  "- Validate each hypothesis with targeted code-level analysis. Trace the relevant Data Flow and Control Flow, including entry conditions, guard conditions, state-change points, exception branches, and any rollback, retry, or compensation logic that materially affects the hypothesis.",
  "- This step produces candidate findings only. It does not write final approved findings.",
  "- Convert a validated deviation into a candidate only when the available evidence supports a concrete, actionable problem on a credibly reachable real-world path.",
  "- Keep the scope centered on hypothesis-driven validation. You may include a closely related deviation only when it is directly exposed by the same validation path.",
  "- When determining whether a deviation exists, explicitly check against the facts, inferences, named paths/symbols/API references cited by the review basis, missing information, and source-of-truth expectations established in <review_basis>. Do not report deviations that fall outside the review basis.",
  "- IMPORTANT: Do not report candidates based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a candidate for every hypothesis.",
  "- Do not downgrade observable behavior changes to missing information solely because the product requirement is implicit. A concrete silent failure, data loss, wrong event, wrong timeout, or missing signal can be a low-severity `reasonable_risk` when the code path and impact are evidence-backed."
].join("\n");

const STEP5_INSTRUCTION = [
  "Based on `ReviewBasisV1.hypothesisLedger` in <review_basis>, validate each hypothesis in sequence and produce candidate findings for this file.",
  "",
  "0. If `validationFeedback` is present and non-empty in <review_state>, this is a rerun. Address the `requiredCorrections` from the prior validation for the relevant candidates before re-emitting them.",
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
  "   - the trigger is present in current repo-supported production code, current tests that define supported behavior, or an explicit external API/SDK contract",
  "   - the deviation is supported by concrete evidence from the code or tool results",
  "   - the impact is meaningful enough to be actionable",
  "   - the concern is not merely theoretical or dependent on implausible assumptions",
  "",
  "4. Classify each candidate as:",
  "   - `confirmed_problem`: a concrete, evidence-backed defect candidate with `severity` of `high` or `low`",
  "   - `reasonable_risk`: a lower-confidence but evidence-backed risk candidate; must use `severity = \"low\"`",
  "",
  "5. Every candidate must include a `traceability` object for the reviewed file:",
  "   - follow the system `Code Locations & Inline Anchors` guidance",
  "   - use `\"kind\": \"line-range\"` with positive integer `lineStart` and `lineEnd`, or `\"kind\": \"diff-hunk\"` with an exact `hunkHeader`",
  "   - if exact localization is not defensible, use the closest supportable reviewed-file location and make the evidence basis explicit; do not invent line numbers",
  "",
  "6. Do not emit speculative defect candidates.",
  "   - If evidence or reachability is weak, list the missing information in `criticalMissingInformation` instead.",
  "   - If the code evidence shows a reachable behavior that can silently lose data, misclassify a result, or hide a failure signal, prefer a low-severity `reasonable_risk` candidate over missing information; describe uncertainty in `counterEvidence`.",
  "   - If local code proves an orchestration boundary risk such as competing local timeouts, cancellation races, stale async result guards, null-to-empty normalization, or partial-result loss, validate that local behavior directly. Do not demote it to missing information solely because an upstream SDK/API contract is incomplete.",
  "   - Do not emit candidates whose only trigger is a hypothetical future implementation, custom test double, hand-written object construction, or omitted optional argument when all current repo call sites pass the required value.",
  "   - Do not list ordinary direct-test gaps, facts absent only from this file, or general follow-up checks as `criticalMissingInformation`.",
  "   - If the claim violates declared scope, omit it.",
  "",
  "7. Every candidate must include:",
  "   - `classification` and `severity`",
  "   - `title`: a concise summary of the problem",
  "   - `traceability`: anchor to the relevant code",
  "   - `evidence`: prose describing the concrete code evidence supporting the finding",
  "   - `triggerCondition`: the condition that triggers the problem",
  "   - `impact`: the user-visible or system-visible consequence",
  "   - `counterEvidence`: array of strings; must be non-empty for `confirmed_problem` (describe what you checked against the finding)",
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
  ...STEP5_STRUCTURED_OUTPUT_GUIDANCE,
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  `Allowed classification values: ${formatQuotedValues(CANDIDATE_CLASSIFICATIONS)}.`,
  `Allowed severity values: ${formatQuotedValues(CANDIDATE_SEVERITIES)}.`,
  `Allowed hypothesisClosure.status values: ${formatQuotedValues(HYPOTHESIS_CLOSURE_STATUSES)}.`,
  `{"findings": [{"classification": "confirmed_problem", "severity": "high", "title": "問題標題", "traceability": {"kind": "line-range", "lineStart": 21, "lineEnd": 22}, "evidence": "changed branch dereferences input.value before fallback; guard was moved after dereference", "triggerCondition": "nullable input reaches the changed branch", "impact": "requests with null input fail with a runtime TypeError", "counterEvidence": ["existing fallback path no longer runs before dereference"]}], "hypothesisClosure": [{"hypothesisId": "H1", "status": "closed_by_candidate", "rationale": "candidate covers the hypothesis"}], "criticalMissingInformation": []}`,
  "",
  `If no findings remain, return: {"findings": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "changed path preserves fallback"}], "criticalMissingInformation": []}`,
  "",
  `If evidence is insufficient, return: {"findings": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "insufficient_information", "rationale": "required contract is unavailable"}], "criticalMissingInformation": [{"description": "Need the service contract for null payload semantics.", "whyItMatters": "Without it the review cannot prove whether the observed fallback is correct or defective."}]}`
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
        systemMessage: [
          JSON_FINDING_STEP_SYSTEM_MESSAGE,
          MISSING_INFORMATION_DISCIPLINE_BLOCK.content,
          STEP5_SYSTEM_ADDITION
        ].join("\n\n"),
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
    ...buildXmlishJsonBlock("review_basis", reviewBasis),
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

function formatQuotedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}
