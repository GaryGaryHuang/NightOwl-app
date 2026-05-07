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

const STEP5_SYSTEM_ADDITION = [
  "## Current Step: Validation & Interrogation",
  "- Use `<review_basis>.hypothesisLedger` as the planned validation queue for this step. It may be empty; do not invent hypotheses or findings when the basis contains no evidence-backed validation target.",
  "- Treat each hypothesis as testable review work, not as an assumed defect.",
  "- Validate each hypothesis against the reviewed diff and the supporting review basis fields: changedBehavior, facts, inferences, dependencyMap, flowMap, testCoverage, missingInformation, and evidenceRefs.",
  "- Trace only the Data Flow and Control Flow that materially affects the current hypothesis, including entry conditions, guard conditions, state-change points, async boundaries, error paths, rollback, retry, or compensation behavior.",
  "- This step produces candidate findings only. It does not write final approved findings.",
  "- Convert a validated deviation into a candidate only when the available evidence supports a concrete, actionable problem on a credibly reachable current code path.",
  "- Keep the scope centered on hypothesis-driven validation. You may include a closely related deviation only when it is directly exposed by the same validation path.",
  "- Use missing information only for specific facts that block proving trigger, impact, expected contract, or reachability; do not use it for ordinary uncertainty or low-signal gaps.",
  "- IMPORTANT: Do not report candidates based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a candidate for every hypothesis.",
  "- Do not downgrade observable behavior changes to missing information solely because the product requirement is implicit. A concrete silent failure, data loss, wrong event, wrong timeout, or missing signal can be a low-severity `reasonable_risk` when the code path and impact are evidence-backed."
].join("\n");

const STEP5_INSTRUCTION = [
  "Based on `<review_basis>.hypothesisLedger`, validate each hypothesis in sequence and produce candidate findings for this file.",
  "",
  "Required output top-level fields:",
  "- `findings`: array of candidate finding objects",
  "- `hypothesisClosure`: array of `{ hypothesisId, status, rationale }`",
  "- `criticalMissingInformation`: array of `{ description, whyItMatters }` objects",
  "",
  "Non-empty array item shapes:",
  "- `findings`: `{ \"classification\": \"confirmed_problem\", \"severity\": \"high\", \"title\": \"problem title\", \"traceability\": { \"kind\": \"line-range\", \"lineStart\": 1, \"lineEnd\": 9 }, \"evidence\": \"guard runs after dereference\", \"triggerCondition\": \"nullable input\", \"impact\": \"request fails\", \"counterEvidence\": [\"fallback checked\"] }`",
  "- `hypothesisClosure`: `{ \"hypothesisId\": \"H1\", \"status\": \"closed_by_candidate\", \"rationale\": \"candidate covers the hypothesis\" }`",
  "- `criticalMissingInformation`: `{ \"description\": \"Need null contract.\", \"whyItMatters\": \"Expected behavior is unclear.\" }`",
  "",
  "Enum, ID, and entry rules:",
  `- classification values: ${formatQuotedValues(CANDIDATE_CLASSIFICATIONS)}.`,
  `- severity values: ${formatQuotedValues(CANDIDATE_SEVERITIES)}.`,
  `- hypothesisClosure.status values: ${formatQuotedValues(HYPOTHESIS_CLOSURE_STATUSES)}.`,
  "- `hypothesisClosure` is closure accounting only: include exactly one entry for each `<review_basis>.hypothesisLedger[].hypothesisId`.",
  "- A closure entry does not require a finding; use `rejected_by_evidence` or `insufficient_information` when no candidate is justified.",
  "- Use H IDs only in `hypothesisClosure[].hypothesisId`.",
  "",
  "Validation feedback and rerun investigation rules:",
  "0. If `validationFeedback` is present and non-empty in `<review_state>`, this is a rerun requested by semantic validation.",
  "   - Treat `validationFeedback.failedGates` and `validationFeedback.requiredCorrections` as aggregate correction constraints for regenerating candidates from `<review_basis>.hypothesisLedger`.",
  "   - Do not preserve or re-emit a candidate solely because it existed in a prior run; re-validate each hypothesis and emit only candidates that satisfy the corrections.",
  "",
  "1. For each scenario or rerun correction:",
  "   - Use the review basis and current code or tool evidence to re-trace only the material path needed for that scenario.",
  "   - Decide whether the expected behavior is preserved, a concrete deviation is evidence-backed, or the item should close without a candidate.",
  "",
  "Candidate creation and classification rules:",
  "2. Create or re-emit a candidate only for a concrete, actionable deviation that is supported by current code or tool evidence.",
  "   - The path and trigger must be credibly reachable through current repo-supported production code, tests that define supported behavior, or an explicit external API/SDK contract.",
  "   - If the concern depends on theoretical or implausible assumptions, close it without a candidate.",
  "",
  "3. Classify each candidate as exactly one of:",
  "   - `confirmed_problem`: evidence proves a concrete defect candidate; use `severity` of `high` or `low`, and include non-empty `counterEvidence`.",
  "   - `reasonable_risk`: evidence supports a reachable behavior risk but confidence or product intent is incomplete; use `severity = \"low\"` and describe uncertainty in `counterEvidence`.",
  "",
  "4. Every candidate must include a `traceability` object for the reviewed file:",
  "   - follow the system `Code Locations & Inline Anchors` guidance",
  "   - use `\"kind\": \"line-range\"` with positive integer `lineStart` and `lineEnd`, or `\"kind\": \"diff-hunk\"` with an exact `hunkHeader`",
  "   - if exact localization is not defensible, use the closest supportable reviewed-file location and make the evidence basis explicit; do not invent line numbers",
  "",
  "5. Apply the speculation and missing-information filter:",
  "   - If evidence or reachability is weak because a specific blocking fact is missing, list that blocker in `criticalMissingInformation` instead.",
  "   - If the code evidence shows a reachable behavior that can silently lose data, misclassify a result, or hide a failure signal, prefer a low-severity `reasonable_risk` candidate over missing information; describe uncertainty in `counterEvidence`.",
  "   - Do not convert locally provable orchestration risks into `criticalMissingInformation` solely because an external SDK/API contract is unavailable or incomplete; validate the local behavior directly when changed code proves trigger and impact. Competing local timeouts, cancellation races, stale async result guards, null-to-empty normalization, and partial-result loss can be low-severity `reasonable_risk` candidates.",
  "   - Do not emit candidates whose only trigger is a hypothetical future implementation, custom test double, hand-written object construction, or omitted optional argument when all current repo call sites pass the required value.",
  "   - If the claim violates declared scope, omit it.",
  "",
  "6. Before output, re-check each candidate:",
  "   - Drop any candidate that is weakly supported, not credibly reachable, redundant with another candidate, or too speculative to defend in review.",
  "   - If no candidates remain, follow the candidate findings completion policy.",
  "",
  "Candidate findings completion policy:",
  "- Before writing the answer, choose one of these outcomes: findings ready, no findings, or insufficient information.",
  "- If no candidates remain after validating all hypotheses, return an empty `findings` array with complete `hypothesisClosure` and any `criticalMissingInformation`.",
  "",
  "Complete JSON output examples:",
  "Example labels are explanatory only; output only the JSON object.",
  "Findings ready example:",
  `{"findings": [{"classification": "confirmed_problem", "severity": "high", "title": "problem title", "traceability": {"kind": "line-range", "lineStart": 1, "lineEnd": 9}, "evidence": "guard runs after dereference", "triggerCondition": "nullable input", "impact": "request fails", "counterEvidence": ["fallback checked"]}], "hypothesisClosure": [{"hypothesisId": "H1", "status": "closed_by_candidate", "rationale": "candidate covers the hypothesis"}], "criticalMissingInformation": []}`,
  "",
  "No findings example:",
  `{"findings": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "changed path preserves fallback"}], "criticalMissingInformation": []}`,
  "",
  "Insufficient information example:",
  `{"findings": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "insufficient_information", "rationale": "specific missing contract blocks validation"}], "criticalMissingInformation": [{"description": "Need null contract.", "whyItMatters": "Expected behavior is unclear."}]}`
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
