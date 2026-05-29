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
import { createCandidateFindingsResolve } from "./step-resolve-helpers.ts";

const CANDIDATE_FINDINGS_SYSTEM_ADDITION = [
  "## Current Step: Candidate Findings",
  "- Critical candidate gate: emit a finding only when current evidence proves mechanism, trigger, credible reachability, observable impact, reviewed-file traceability, and supporting ReviewBasis evidence. Otherwise close the relevant hypothesis without a finding; do not ask follow-up questions or guess.",
  "- This step produces candidate findings only. It does not approve final findings, create new hypotheses, or write reader-facing review summary.",
  "- Follow this execution order: 1. Determine first pass versus semantic rerun from `<review_state>`. 2. On first pass, read ReviewBasis and close every ledger hypothesis. 3. On first pass only, run one bounded supplemental sweep only when a distinct fully evidenced deviation is already exposed by tracing ledger hypotheses or directly changed behavior. 4. On semantic rerun, start from prior candidate findings; repair or drop existing candidates only, and do not introduce new candidates. 5. Align candidate origins with hypothesis closure. 6. Emit CandidateFindings JSON according to the current step instruction.",
  "- Treat `<review_basis>.hypothesisLedger` as primary guidance, not the exhaustive source of possible candidates. It focuses investigation; it does not justify open-ended bug hunting.",
  "- Treat each hypothesis as testable review work, not as an assumed defect; validate it against the reviewed diff, ReviewBasis evidence, and only the material Data Flow or Control Flow needed for that path.",
  "- A validated deviation is not enough by itself; emit it only when it is concrete, actionable, and reachable in current code.",
  "- Treat the supplemental sweep as an exception, not a second review pass. Skip it unless a high-signal deviation is already fully evidenced by directly changed behavior or the same reviewed evidence-backed path; do not broaden repository exploration, and emit at most two supplemental candidates.",
  "- Each candidate must carry provenance that distinguishes whether it closes a ledger hypothesis or comes from the supplemental sweep. If a candidate materially resolves a ledger hypothesis, record it as hypothesis-origin; supplemental origins are only for findings independent of ledger closure.",
  "- Reserve `criticalMissingInformation` for unresolved facts that still determine whether a candidate exists or materially change trigger, reachability, impact, or required contract after the `Missing Information Discipline` checks; do not use it as the default fallback for incomplete proof or as a caveat on an emitted candidate.",
  "- Use `reasonable_risk` only when mechanism, reachable trigger, and observable impact are proven, and the expected contract is locally bounded enough to explain why the behavior is risky. If a missing contract would change whether the behavior is a problem, close the item as `insufficient_information` or omit the candidate.",
  "- Before output, drop or close without a candidate any entry whose evidence, provenance, hypothesis closure, or scope cannot be made consistent.",
  "- Do not report candidates based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a candidate for every hypothesis.",
  "- If `<retry_repair_context>` is appended, treat it only as deterministic validation feedback; regenerate the complete CandidateFindings JSON for the same diff, ReviewBasis, and review state, fixing the named schema/provenance/closure issue without running new bug hunting."
].join("\n");

const CANDIDATE_FINDINGS_INSTRUCTION = [
  "Validate ledger hypotheses first, then perform one bounded supplemental sweep when allowed, and produce candidate findings for this file.",
  "",
  "Required output top-level fields:",
  "- `findings`: array of candidate finding objects",
  "- `findingOrigins`: array of provenance sidecar entries, one per finding",
  "- `hypothesisClosure`: array of `{ hypothesisId, status, rationale }`",
  "- `criticalMissingInformation`: array of `{ description, whyItMatters }` objects",
  "",
  "Non-empty array item shapes:",
  "- `findings`: `{ \"classification\": \"confirmed_problem\", \"severity\": \"high\", \"title\": \"problem title\", \"traceability\": { \"kind\": \"line-range\", \"lineStart\": 1, \"lineEnd\": 9 }, \"evidence\": \"guard runs after dereference\", \"triggerCondition\": \"nullable input\", \"impact\": \"request fails\", \"counterEvidence\": [\"fallback checked\"] }`",
  "- `findingOrigins` for a ledger-backed finding: `{ \"findingIndex\": 1, \"kind\": \"hypothesis\", \"hypothesisIds\": [\"H1\"], \"evidenceIds\": [\"E1\"], \"rationale\": \"candidate directly closes H1\" }`",
  "- `findingOrigins` for a supplemental finding: `{ \"findingIndex\": 2, \"kind\": \"supplemental\", \"lens\": \"control_flow_sweep\", \"evidenceIds\": [\"E2\"], \"rationale\": \"changed branch exposes the deviation\", \"relatedHypothesisIds\": [] }`",
  "- `hypothesisClosure`: `{ \"hypothesisId\": \"H1\", \"status\": \"closed_by_candidate\", \"rationale\": \"candidate covers the hypothesis\" }`",
  "- `criticalMissingInformation`: `{ \"description\": \"Need null contract.\", \"whyItMatters\": \"Expected behavior is unclear.\" }`",
  "",
  "Enum, ID, and entry rules:",
  `- classification values: ${formatQuotedValues(CANDIDATE_CLASSIFICATIONS)}.`,
  `- severity values: ${formatQuotedValues(CANDIDATE_SEVERITIES)}.`,
  `- hypothesisClosure.status values: ${formatQuotedValues(HYPOTHESIS_CLOSURE_STATUSES)}.`,
  "- `findingOrigins[].lens` values for supplemental findings: \"changed_behavior_sweep\", \"data_flow_sweep\", \"control_flow_sweep\", \"dependency_contract_sweep\", \"test_contract_sweep\".",
  "- `hypothesisClosure` is closure accounting only: include exactly one entry for each `<review_basis>.hypothesisLedger[].hypothesisId`.",
  "- A closure entry does not require a finding; use `rejected_by_evidence` or `insufficient_information` when no candidate is justified.",
  "- Use H IDs only in `hypothesisClosure[].hypothesisId`, `findingOrigins[].hypothesisIds`, and `findingOrigins[].relatedHypothesisIds`.",
  "- Use evidence IDs only from `<review_basis>.evidenceRefs[].evidenceId`.",
  "",
  "Validation feedback and rerun investigation rules:",
  "0. If `validationFeedback` is present and non-empty in `<review_state>`, this is a rerun requested by semantic validation.",
  "   - Treat `validationFeedback.failedGates` and `validationFeedback.requiredCorrections` as aggregate correction constraints for repairing the existing candidate payload.",
  "   - Do not perform a new supplemental sweep on rerun.",
  "   - Do not preserve or re-emit a candidate solely because it existed in a prior run; repair or drop existing candidates and emit only candidates that satisfy the corrections.",
  "   - Update `findingOrigins` so each surviving finding still has exactly one matching origin.",
  "",
  "1. For each ledger hypothesis or rerun correction:",
  "   - Use the review basis and current code or tool evidence to re-trace only the material path needed for that scenario.",
  "   - Decide whether the expected behavior is preserved, a concrete deviation is evidence-backed, or the item should close without a candidate.",
  "   - If a finding closes a hypothesis, set that hypothesis closure status to `closed_by_candidate` and add a hypothesis origin that references the closed H ID and supporting evidence IDs.",
  "",
  "2. Supplemental sweep rules:",
  "   - Run the sweep only after every ledger hypothesis has a closure decision and only on the first Candidate Findings pass.",
  "   - Limit supplemental candidates to at most two high-signal deviations from directly changed behavior, data flow, control flow, dependency contracts, or tests that define the changed contract.",
  "   - A supplemental candidate must prove mechanism, trigger, reachability, impact, traceability, and evidence without creating a new hypothesis.",
  "   - Add a supplemental origin with `kind`, `lens`, non-empty `evidenceIds`, non-empty `rationale`, and `relatedHypothesisIds` as an array; use an empty array when no ledger hypothesis is related.",
  "",
  "Candidate creation and classification rules:",
  "3. Create or re-emit a candidate only for a concrete, actionable deviation that is supported by current code or tool evidence.",
  "   - The path and trigger must be credibly reachable through current repo-supported production code, tests that define supported behavior, or an explicit external API/SDK contract.",
  "   - If the concern depends on theoretical or implausible assumptions, close it without a candidate.",
  "",
  "4. Classify each candidate as exactly one of:",
  "   - `confirmed_problem`: evidence proves a concrete defect candidate; use `severity` of `high` or `low`, and include non-empty `counterEvidence`.",
  "   - `reasonable_risk`: evidence supports a reachable behavior risk but confidence or product intent is incomplete; use `severity = \"low\"` and describe uncertainty in `counterEvidence`.",
  "",
  "5. Every candidate must include a reviewed-file `traceability` object that follows the system `Finding Code Locations & Inline Anchors` guidance.",
  "",
  "6. Every candidate must have exactly one origin:",
  "   - `findingOrigins[].findingIndex` is 1-based and must match the candidate's position in `findings[]`.",
  "   - A hypothesis origin must have `kind = \"hypothesis\"`, non-empty `hypothesisIds`, non-empty `evidenceIds`, and a non-empty `rationale`; every referenced H ID must have `hypothesisClosure.status = \"closed_by_candidate\"`.",
  "   - A supplemental origin must have `kind = \"supplemental\"`, a valid `lens`, non-empty `evidenceIds`, non-empty `rationale`, and `relatedHypothesisIds` as an array.",
  "",
  "7. Apply the speculation and missing-information filter:",
  "   - If the claim violates declared scope, omit it.",
  "   - Do not emit candidates whose only trigger is a hypothetical future implementation, custom test double, hand-written object construction, or omitted optional argument when all current repo call sites pass the required value.",
  "   - Treat silent data loss, result misclassification, and hidden failure signals as observable runtime effects when current code proves trigger and impact.",
  "   - Treat async and control-flow coordination risks, such as competing local timeouts, cancellation races, stale async result guards, null-to-empty normalization, and partial-result loss, as evidence for a candidate when local code proves the mechanism, trigger, and impact.",
  "   - When a specific unresolved fact still blocks a reliable candidate/no-candidate decision after these checks because trigger, reachability, impact, or required contract cannot be resolved, close the related hypothesis as `insufficient_information` and record that fact in `criticalMissingInformation`.",
  "",
  "8. Before output, re-check each candidate:",
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
  `{"findings": [{"classification": "confirmed_problem", "severity": "high", "title": "problem title", "traceability": {"kind": "line-range", "lineStart": 1, "lineEnd": 9}, "evidence": "guard runs after dereference", "triggerCondition": "nullable input", "impact": "request fails", "counterEvidence": ["fallback checked"]}], "findingOrigins": [{"findingIndex": 1, "kind": "hypothesis", "hypothesisIds": ["H1"], "evidenceIds": ["E1"], "rationale": "candidate covers the hypothesis"}], "hypothesisClosure": [{"hypothesisId": "H1", "status": "closed_by_candidate", "rationale": "candidate covers the hypothesis"}], "criticalMissingInformation": []}`,
  "",
  "Supplemental finding example:",
  `{"findings": [{"classification": "reasonable_risk", "severity": "low", "title": "changed branch can drop partial result", "traceability": {"kind": "line-range", "lineStart": 20, "lineEnd": 28}, "evidence": "changed branch returns before preserving partial result", "triggerCondition": "timeout after partial data arrives", "impact": "caller receives empty result instead of partial data", "counterEvidence": ["no fallback restores partial data"]}], "findingOrigins": [{"findingIndex": 1, "kind": "supplemental", "lens": "control_flow_sweep", "evidenceIds": ["E2"], "rationale": "directly changed control path exposes the deviation", "relatedHypothesisIds": []}], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "changed path preserves the expected contract for H1"}], "criticalMissingInformation": []}`,
  "",
  "No findings example:",
  `{"findings": [], "findingOrigins": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "changed path preserves fallback"}], "criticalMissingInformation": []}`,
  "",
  "Insufficient information example:",
  `{"findings": [], "findingOrigins": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "insufficient_information", "rationale": "specific missing contract blocks validation"}], "criticalMissingInformation": [{"description": "Need null contract.", "whyItMatters": "Expected behavior is unclear."}]}`
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
    const previousCandidateFindings =
      context.getPriorValidatorFeedback() === undefined
        ? undefined
        : context.getCandidateFindings();

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
            include: [
              REVIEW_BASIS_STEP_ID,
              CANDIDATE_FINDINGS_STEP_ID,
              "validation-feedback"
            ]
          })
        )
      },
      reviewProfile: {
        knowledgeMode: "built-in-context7",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: createCandidateFindingsResolve({
        filePath: context.filePath,
        diffContent: context.diffContent,
        reviewBasis,
        ...(previousCandidateFindings === undefined
          ? {}
          : { previousCandidateFindings })
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
