import type { FileReviewContext } from "../file-review-context.ts";
import {
  CANDIDATE_FINDINGS_STEP_ID,
  REVIEW_BASIS_STEP_ID
} from "../review-step-ids.ts";
import type { ReviewBasis } from "../review-basis.ts";
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
  "- Non-crash runtime effects can support a candidate when the critical candidate gate is satisfied; examples are non-exhaustive and must not broaden review beyond ledger hypotheses, changed behavior, or the bounded supplemental sweep.",
  "- A validated deviation is not enough by itself; emit it only when it is concrete, actionable, and reachable in current code.",
  "- Treat the supplemental sweep as an exception, not a second review pass. Skip it unless a high-signal deviation is already fully evidenced by directly changed behavior or the same reviewed evidence-backed path; do not broaden repository exploration, and emit at most two supplemental candidates.",
  "- Each candidate must carry provenance that distinguishes whether it closes a ledger hypothesis or comes from the supplemental sweep. If a candidate materially resolves a ledger hypothesis, record it as hypothesis-origin; supplemental origins are only for findings independent of ledger closure.",
  "- Reserve `criticalMissingInformation` for unresolved facts that still determine whether a candidate exists or materially change trigger, reachability, impact, or required contract after the `Missing Information Discipline` checks; do not use it as the default fallback for incomplete proof or as a caveat on an emitted candidate.",
  "- Use `reasonable_risk` only when mechanism, reachable trigger, and observable impact are proven, and the expected contract is locally bounded enough to explain why the behavior is risky. If a missing contract or product-intent fact would change whether the behavior is a problem, close the item as `insufficient_information` or omit the candidate.",
  "- Before output, drop or close without a candidate any entry that is weakly supported, not credibly reachable, redundant, too speculative, or inconsistent with its evidence, provenance, hypothesis closure, or scope.",
  "- Do not report candidates based on theoretical speculation, weak inference, or implausible edge conditions. Do not force a candidate for every hypothesis.",
  "- If `<retry_repair_context>` is appended, treat it only as deterministic validation feedback; regenerate the complete CandidateFindings JSON for the same diff, ReviewBasis, and review state, fixing the named schema/provenance/closure issue without running new bug hunting."
].join("\n");

const CANDIDATE_FINDINGS_INSTRUCTION = [
  "Produce the CandidateFindings JSON object for this file from the inputs above.",
  "",
  "Input contract:",
  "- `<diff>` is the canonical reviewed-file change input. Ground reviewed-file traceability and changed-code causality in this diff or current code evidence reached from it.",
  "- `<review_basis>` is the source of ReviewBasis evidence IDs and ledger hypotheses. Use `<review_basis>.hypothesisLedger` as the primary validation queue, not as assumed defects.",
  "- `<review_state>` contains current-run state for this file, including prior `candidateFindings` and `validationFeedback` on semantic rerun.",
  "- You may use current code or tool evidence to re-trace a material path; only `<review_basis>.evidenceRefs[]` supplies reportable E IDs.",
  "",
  "Field separation rules:",
  "- Use `findings` only for candidate defects or reachable risks that satisfy the step's critical candidate gate; do not use it for hypotheses, summaries, style concerns, or final approval.",
  "- Use `findingOrigins` as provenance sidecar data that distinguishes whether findings close ledger hypotheses or come from the bounded supplemental sweep.",
  "- Use `hypothesisClosure` as ledger accounting only. Include exactly one closure entry for every `<review_basis>.hypothesisLedger[].hypothesisId`, even when no finding is emitted.",
  "- Use `criticalMissingInformation` only for specific unresolved facts that still block a reliable candidate/no-candidate decision after the speculation and missing-information filter.",
  "",
  "Pass mode rules:",
  "- If `validationFeedback` is present and non-empty in `<review_state>`, this is a semantic rerun.",
  "- On semantic rerun, start from prior `<review_state>.candidateFindings`; use `validationFeedback.failedGates` and `validationFeedback.requiredCorrections` only as aggregate repair constraints.",
  "- On semantic rerun, repair or drop existing candidates only. Do not perform a new supplemental sweep, introduce more candidates, introduce more supplemental candidates, replace a dropped candidate with a different claim, or preserve a candidate solely because it existed before.",
  "- On first pass, close every ledger hypothesis before running any supplemental sweep.",
  "",
  "Entry construction rules:",
  "- On first pass, for each ledger hypothesis, re-trace only the material path needed for that scenario using the review basis, reviewed diff, and current code or tool evidence when needed.",
  "- On semantic rerun, apply corrections only to prior candidates, origins, and closure entries; if a correction cannot be satisfied within prior candidate scope, drop the candidate and keep hypothesis closure honest.",
  "- If a finding closes a hypothesis, set that hypothesis closure status to `closed_by_candidate` and add a hypothesis origin that references the closed H ID and supporting ReviewBasis E IDs.",
  "- If no candidate is justified for a hypothesis, close it with `rejected_by_evidence` when current evidence preserves expected behavior or disproves the risk, or `insufficient_information` when the `Missing Information Discipline` gates still block the decision; a closure entry does not require a finding.",
  "- Run one bounded supplemental sweep only after every ledger hypothesis has a closure decision and only on the first Candidate Findings pass.",
  "- Limit supplemental candidates to at most two high-signal deviations from directly changed behavior or the same reviewed evidence-backed path, including material data flow, control flow, dependency contracts, or tests that define the changed contract.",
  "- A supplemental candidate must prove mechanism, trigger, reachability, impact, traceability, and evidence without creating a new hypothesis.",
  "",
  "Speculation and missing-information filter:",
  "- Treat hypothetical future implementations, custom test doubles, hand-written object construction, and omitted optional arguments with no current repo call-site trigger as speculative triggers; do not emit candidates from those triggers alone.",
  "- If the `Missing Information Discipline` gates still block a ledger-backed candidate/no-candidate decision, close the related hypothesis as `insufficient_information` and record the fact in `criticalMissingInformation`.",
  "- For supplemental-only uncertainty, omit the candidate instead of recording `criticalMissingInformation`.",
  "",
  "Completion policy:",
  "- Before writing the answer, reconcile the final payload: candidates may coexist with unrelated `insufficient_information` closures, but every finding, `findingOrigins` entry, `hypothesisClosure` entry, and `criticalMissingInformation` item must match the field rules below.",
  "- If no candidates remain, return empty `findings` and `findingOrigins` arrays while keeping complete `hypothesisClosure` and any qualifying `criticalMissingInformation`.",
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
  "- `confirmed_problem` may use `severity` of \"high\" or \"low\".",
  "- `reasonable_risk` must use `severity = \"low\"` and describe residual uncertainty in `counterEvidence`.",
  "- Every finding must include non-empty `counterEvidence`.",
  `- hypothesisClosure.status values: ${formatQuotedValues(HYPOTHESIS_CLOSURE_STATUSES)}.`,
  "- `findingOrigins[].lens` values for supplemental findings: \"changed_behavior_sweep\", \"data_flow_sweep\", \"control_flow_sweep\", \"dependency_contract_sweep\", \"test_contract_sweep\".",
  "- Every finding must have exactly one `findingOrigins` entry by 1-based `findingOrigins[].findingIndex`, matching the finding's position in `findings[]`.",
  "- A hypothesis origin must have `kind = \"hypothesis\"`, non-empty `hypothesisIds`, non-empty `evidenceIds`, and a non-empty `rationale`; every referenced H ID must have `hypothesisClosure.status = \"closed_by_candidate\"`.",
  "- A supplemental origin must have `kind = \"supplemental\"`, a valid `lens`, non-empty `evidenceIds`, non-empty `rationale`, and `relatedHypothesisIds` as an array.",
  "- Use H IDs only in `hypothesisClosure[].hypothesisId`, `findingOrigins[].hypothesisIds`, and `findingOrigins[].relatedHypothesisIds`.",
  "- Use evidence IDs only from `<review_basis>.evidenceRefs[].evidenceId`.",
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

function requireReviewBasis(context: FileReviewContext): ReviewBasis {
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
