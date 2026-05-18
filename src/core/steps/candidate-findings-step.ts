import type { FileReviewContext } from "../file-review-context.ts";
import {
  CANDIDATE_FINDINGS_STEP_ID,
  REVIEW_BASIS_STEP_ID
} from "../review-step-ids.ts";
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

const CANDIDATE_FINDINGS_SYSTEM_ADDITION = [
  "## Current Step: Candidate Findings",
  "- Use `<review_basis>.hypothesisLedger` as the planned validation queue for this step. It may be empty; do not invent hypotheses or findings when the basis contains no evidence-backed validation target.",
  "- Treat each hypothesis as testable review work, not as an assumed defect.",
  "- Validate each hypothesis against the reviewed diff and the supporting review basis fields: changedBehavior, facts, inferences, dependencyMap, flowMap, testCoverage, missingInformation, and evidenceRefs.",
  "- Trace only the Data Flow and Control Flow that materially affects the current hypothesis, including entry conditions, guard conditions, state-change points, async boundaries, error paths, rollback, retry, or compensation behavior.",
  "- This step produces candidate findings only. It does not write final approved findings.",
  "- Convert a validated deviation into a candidate only when the available evidence supports a concrete, actionable problem on a credibly reachable current code path.",
  "- Keep the scope centered on hypothesis-driven validation. You may include a closely related deviation only when it is directly exposed by the same validation path.",
  "- Reserve `criticalMissingInformation` for unresolved facts that still determine whether a candidate exists or materially change trigger, reachability, impact, or required contract after the `Missing Information Discipline` checks; do not use it as the default fallback for incomplete proof.",
  "- IMPORTANT: Do not report candidates based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a candidate for every hypothesis.",
  "- When local code evidence already proves trigger and impact, use `reasonable_risk` for bounded low-severity uncertainty instead of downgrading the issue to missing information solely because product intent or an external contract is incomplete."
].join("\n");

const CANDIDATE_FINDINGS_INSTRUCTION = [
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
  "   - If the claim violates declared scope, omit it.",
  "   - Do not emit candidates whose only trigger is a hypothetical future implementation, custom test double, hand-written object construction, or omitted optional argument when all current repo call sites pass the required value.",
  "   - Treat silent data loss, result misclassification, and hidden failure signals as observable runtime effects when current code proves trigger and impact.",
  "   - Treat async and control-flow coordination risks, such as competing local timeouts, cancellation races, stale async result guards, null-to-empty normalization, and partial-result loss, as evidence for a candidate when local code proves the mechanism, trigger, and impact.",
  "   - When a specific unresolved fact still blocks a reliable candidate/no-candidate decision after these checks because trigger, reachability, impact, or required contract cannot be resolved, close the related hypothesis as `insufficient_information` and record that fact in `criticalMissingInformation`.",
  "",
  "6. Before output, re-check each candidate:",
  "   - Drop any candidate that is weakly supported, not credibly reachable, redundant with another candidate, or too speculative to defend in review.",
  "   - If no candidates remain, follow the candidate findings completion policy.",
  "",
  "Candidate findings completion policy:",
  "- Before writing the answer, choose one of these outcomes: findings ready, no findings, or insufficient information.",
  "- If no candidates remain after validating all hypotheses, return an empty `findings` array with complete `hypothesisClosure` and only `criticalMissingInformation` that still satisfies section 5.",
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

interface CandidateFindingsStepOptions {
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

/**
 * Run the first-pass scenario validation and emit only evidence-backed structured findings.
 */
export class CandidateFindingsStep implements StepDefinition {
  readonly stepId = CANDIDATE_FINDINGS_STEP_ID;
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;

  constructor(options: CandidateFindingsStepOptions) {
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
          CANDIDATE_FINDINGS_SYSTEM_ADDITION
        ].join("\n\n"),
        userMessage: buildCandidateFindingsUserMessage(
          context,
          reviewBasis,
          this.#promptSerializer.serialize({
            context,
            include: [REVIEW_BASIS_STEP_ID, "validation-feedback"]
          })
        )
      },
      reviewProfile: {
        knowledgeMode: "built-in-context7",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: createCandidateFindingsV3Resolve({
        filePath: context.filePath,
        diffContent: context.diffContent,
        reviewBasis
      })
    };
  }
}

function buildCandidateFindingsUserMessage(
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
    CANDIDATE_FINDINGS_INSTRUCTION
  ].join("\n");
}

function requireReviewBasis(context: FileReviewContext): ReviewBasisV1 {
  const reviewBasis = context.getReviewBasis();
  if (!reviewBasis) {
    throw new Error(
      `ReviewBasis must exist before Candidate Findings for "${context.filePath}"`
    );
  }
  return reviewBasis;
}

function formatQuotedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}
