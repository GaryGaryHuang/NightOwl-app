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
  HYPOTHESIS_CLOSURE_STATUSES,
  SUPPLEMENTAL_LENSES
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
  "- Select the pass mode from `<review_state>`, then follow the numbered Step procedure in the step instruction as the single detailed workflow, keeping candidate origins aligned with hypothesis closure.",
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
  "Inputs:",
  "- `<diff>` is the canonical reviewed-file change input. Ground reviewed-file traceability and changed-code causality in this diff or in current code reached from it.",
  "- `<review_basis>` supplies the ledger hypotheses to validate and the only reportable evidence IDs, defined in `<review_basis>.evidenceRefs[]`.",
  "- `<review_state>` carries this file's current-run state, including prior `candidateFindings` and `validationFeedback`.",
  "- You may re-trace a material path with current code or tool evidence, but report only evidence IDs that exist in `<review_basis>.evidenceRefs[]`.",
  "",
  "Field roles:",
  "- `findings`: candidate defects or reachable risks that pass the critical candidate gate; not hypotheses, summaries, style notes, or final approval.",
  "- `findingOrigins`: provenance sidecar marking each finding as a hypothesis origin or a supplemental origin.",
  "- `hypothesisClosure`: ledger accounting with exactly one entry per `<review_basis>.hypothesisLedger[].hypothesisId`, with or without a finding.",
  "- `criticalMissingInformation`: specific unresolved facts that still block a candidate/no-candidate decision after applying the speculation and missing-information guardrails below.",
  "",
  "Step 1 - Select the pass mode:",
  "- Read `<review_state>.validationFeedback` first to pick the branch: absent or empty means first pass; present and non-empty means semantic rerun.",
  "- First pass: close every ledger hypothesis, then run at most one bounded supplemental sweep.",
  "- Semantic rerun: start from prior `<review_state>.candidateFindings`, repair or drop those candidates only, and treat `validationFeedback.failedGates` and `validationFeedback.requiredCorrections` as aggregate repair constraints.",
  "- A semantic rerun adds no candidates, runs no supplemental sweep, and never swaps a dropped candidate for a new claim or keeps one only because it existed before.",
  "",
  "Step 2 - Build entries and closures:",
  "- First pass, per hypothesis: re-trace only the material path for that scenario using the review basis, reviewed diff, and current code or tool evidence when needed, then record its closure.",
  "- Closure decision: a finding closes its hypothesis as `closed_by_candidate`; otherwise close as `rejected_by_evidence` when evidence preserves expected behavior or disproves the risk, or `insufficient_information` when `Missing Information Discipline` gates still block the decision. A closure entry does not require a finding.",
  "- For each finding that closes a hypothesis, add a hypothesis origin referencing the closed H ID and its supporting `E*` evidence IDs.",
  "- Supplemental sweep, first pass only: after every hypothesis has a closure, emit at most two high-signal candidates from directly changed behavior or the same evidence-backed path (data flow, control flow, dependency contract, or contract-defining tests), each with a supplemental origin and no new hypothesis.",
  "- Semantic rerun: apply corrections only to prior candidates, origins, and closures; if a correction cannot hold within a candidate's scope, drop it and keep its hypothesis closure honest.",
  "",
  "Step 3 - Apply speculation and missing-information guardrails:",
  "- Do not emit a candidate whose only trigger is a hypothetical future implementation, a custom test double, hand-written object construction, or an omitted optional argument with no current repo call site.",
  "- When `Missing Information Discipline` gates block a ledger-backed decision, close that hypothesis as `insufficient_information` and record the blocking fact in `criticalMissingInformation`.",
  "- For supplemental-only uncertainty, omit the candidate instead of recording `criticalMissingInformation`.",
  "",
  "Step 4 - Reconcile before output:",
  "- Before output, reconcile the payload: candidates may coexist with unrelated `insufficient_information` closures, and every finding, `findingOrigins` entry, `hypothesisClosure` entry, and `criticalMissingInformation` item must satisfy the entry field rules and cross-reference invariants below.",
  "- With no candidates, return empty `findings` and `findingOrigins` arrays while keeping the complete `hypothesisClosure` and any qualifying `criticalMissingInformation`.",
  "",
  "Output object - all four keys are required arrays; use `[]` when a key is empty:",
  "- `findings`: candidate finding objects (field rules below).",
  "- `findingOrigins`: one provenance entry per finding.",
  "- `hypothesisClosure`: one closure entry per `<review_basis>.hypothesisLedger` hypothesis.",
  "- `criticalMissingInformation`: `{ description, whyItMatters }` objects.",
  "",
  "Entry field rules - concrete object examples are below; apply these constraints to every matching entry:",
  "- `findings[]` classification and severity: `classification` is one of " + formatQuotedValues(CANDIDATE_CLASSIFICATIONS) + "; `severity` is one of " + formatQuotedValues(CANDIDATE_SEVERITIES) + ". `reasonable_risk` requires `severity` \"low\"; `confirmed_problem` may use \"high\" or \"low\".",
  "- `findings[]` text fields: `title`, `evidence`, `triggerCondition`, and `impact` are non-empty strings, and `counterEvidence` is a non-empty array of strings (for `reasonable_risk`, state the residual uncertainty there).",
  "- `findings[]` omit `findingId`; it is assigned downstream.",
  "- `findings[].traceability`: either `{ \"kind\": \"line-range\", \"lineStart\", \"lineEnd\" }` with positive integers where `lineEnd >= lineStart`, or `{ \"kind\": \"diff-hunk\", \"hunkHeader\" }`; prefer `line-range` anchored to the reviewed diff.",
  "- `findingOrigins[]` hypothesis entry: `{ \"findingIndex\", \"kind\": \"hypothesis\", \"hypothesisIds\", \"evidenceIds\", \"rationale\" }` with non-empty `hypothesisIds`, non-empty `evidenceIds`, and a non-empty `rationale`.",
  "- `findingOrigins[]` supplemental entry: `{ \"findingIndex\", \"kind\": \"supplemental\", \"lens\", \"evidenceIds\", \"rationale\", \"relatedHypothesisIds\" }`; `lens` is one of " + formatQuotedValues(SUPPLEMENTAL_LENSES) + "; `evidenceIds` and `rationale` are non-empty; `relatedHypothesisIds` is an array that may be empty.",
  "- `hypothesisClosure[]`: `{ \"hypothesisId\", \"status\", \"rationale\" }`; `status` is one of " + formatQuotedValues(HYPOTHESIS_CLOSURE_STATUSES) + ".",
  "- `criticalMissingInformation[]`: `{ \"description\", \"whyItMatters\" }`, both non-empty strings.",
  "",
  "Cross-reference invariants - verify all of these before output:",
  "- ID sources: use H IDs only from `<review_basis>.hypothesisLedger[].hypothesisId` and evidence IDs only from `<review_basis>.evidenceRefs[].evidenceId`; H IDs appear only in `hypothesisClosure[].hypothesisId`, `findingOrigins[].hypothesisIds`, and `findingOrigins[].relatedHypothesisIds`.",
  "- findings to origins: exactly one `findingOrigins` entry per finding, linked by 1-based `findingIndex` to the finding's position in `findings`; no duplicate or missing index.",
  "- closure coverage: exactly one `hypothesisClosure` entry per ledger hypothesis, with no duplicates.",
  "- hypothesis origins to closure: every H ID in a hypothesis origin must have `status` \"closed_by_candidate\", and every \"closed_by_candidate\" closure must be referenced by a hypothesis origin.",
  "- missing information: any \"insufficient_information\" closure requires at least one `criticalMissingInformation` item, and `criticalMissingInformation` stays empty unless such a closure exists.",
  "- supplemental limit: at most two supplemental `findingOrigins` entries per file.",
  "",
  "Complete JSON output examples - labels are explanatory only; output only the JSON object:",
  "Findings ready - confirmed_problem closing a hypothesis:",
  `{"findings": [{"classification": "confirmed_problem", "severity": "high", "title": "problem title", "traceability": {"kind": "line-range", "lineStart": 1, "lineEnd": 9}, "evidence": "guard runs after dereference", "triggerCondition": "nullable input", "impact": "request fails", "counterEvidence": ["fallback checked"]}], "findingOrigins": [{"findingIndex": 1, "kind": "hypothesis", "hypothesisIds": ["H1"], "evidenceIds": ["E1"], "rationale": "candidate covers the hypothesis"}], "hypothesisClosure": [{"hypothesisId": "H1", "status": "closed_by_candidate", "rationale": "candidate covers the hypothesis"}], "criticalMissingInformation": []}`,
  "",
  "Supplemental finding - reasonable_risk from a sweep:",
  `{"findings": [{"classification": "reasonable_risk", "severity": "low", "title": "changed branch can drop partial result", "traceability": {"kind": "line-range", "lineStart": 20, "lineEnd": 28}, "evidence": "changed branch returns before preserving partial result", "triggerCondition": "timeout after partial data arrives", "impact": "caller receives empty result instead of partial data", "counterEvidence": ["no fallback restores partial data"]}], "findingOrigins": [{"findingIndex": 1, "kind": "supplemental", "lens": "control_flow_sweep", "evidenceIds": ["E2"], "rationale": "directly changed control path exposes the deviation", "relatedHypothesisIds": []}], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "changed path preserves the expected contract for H1"}], "criticalMissingInformation": []}`,
  "",
  "No findings - every hypothesis closed by evidence:",
  `{"findings": [], "findingOrigins": [], "hypothesisClosure": [{"hypothesisId": "H1", "status": "rejected_by_evidence", "rationale": "changed path preserves fallback"}], "criticalMissingInformation": []}`,
  "",
  "Insufficient information - blocked hypothesis with criticalMissingInformation:",
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
