import type { FileReviewContext } from "../file-review-context.ts";
import {
  CANDIDATE_FINDINGS_STEP_ID,
  REVIEW_BASIS_STEP_ID,
  SEMANTIC_VALIDATION_STEP_ID
} from "../review-step-ids.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import {
  LOOP_ACTIONS,
  SEMANTIC_GATE_IDS,
  VALIDATION_DECISIONS,
  type CandidateFindings
} from "../semantic-review.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import {
  JSON_STEP_SYSTEM_MESSAGE,
  MISSING_INFORMATION_DISCIPLINE_BLOCK
} from "./shared-step-system-blocks.ts";
import { createValidationReportV1Resolve } from "./step-resolve-helpers.ts";

const SEMANTIC_VALIDATION_SYSTEM_ADDITION = [
  "## Current Step: Semantic Validation",
  "- Task: adjudicate only the existing `<review_state>.candidateFindings` payload; do not discover, author, or broaden findings.",
  "- Critical rule: validate `findings`, `findingOrigins`, `hypothesisClosure`, and `criticalMissingInformation` together as one claim set before any candidate can be approved.",
  "- Decision rule: evidence, provenance, hypothesis closure, and scope must support the same defect claim; otherwise reject or require repair according to the step instruction.",
  "- Rerun rule: on semantic rerun, validate repairs to the current payload only; do not request a fresh supplemental sweep."
].join("\n");

const SEMANTIC_VALIDATION_INSTRUCTION = [
  "Validate this file's `<review_state>.candidateFindings` payload and return the validation report JSON object.",
  "",
  "Inputs:",
  "- `<diff>` is the canonical reviewed-file change input. Use it to check reviewed-file traceability, changed-code causality, and whether a candidate is inspectable.",
  "- `<review_state>.candidateFindings` is the only candidate source. Validate its `findings`, `findingOrigins`, `hypothesisClosure`, and `criticalMissingInformation` together; do not create new findings.",
  "- `<review_state>.approvedFindings`, when present, is read-only host-approved context from earlier Semantic Validation rounds. Use it only for duplicate/conflict checks against active candidates.",
  "- `<review_state>.reviewBasis.evidenceRefs` defines the reportable evidence IDs that candidate origins may cite.",
  "- `<review_state>.validationFeedback`, when present, is prior Semantic Validation feedback for the current candidate payload repair loop.",
  "",
  "Field roles:",
  "- `perFindingResults`: one validation result for each candidate finding ID; it decides whether that candidate is promoted, repaired, or dropped.",
  "- `missingInformationItems`: final user-actionable blockers that still prevent reliable approval/drop after applying the available review state.",
  "- `loopControl`: Orchestrator control for whether Candidate Findings should repair the current payload or the pipeline should accept the validation result.",
  "",
  "Step 1 - Select the validation mode:",
  "- Read `<review_state>.validationFeedback` first to pick the branch: absent or empty means first validation pass; present and non-empty means semantic rerun.",
  "- First validation pass: validate the current candidate payload once.",
  "- Semantic rerun: validate only the current active rewrite candidates, checking whether they repaired the prior `failedGates` and `requiredCorrections`.",
  "- If there are no candidates, skip candidate validation, apply the Step 5 missing-information rules, and set `loopControl.action` to `accept`.",
  "",
  "Step 2 - Validate each candidate claim set:",
  "- Treat each candidate as an unapproved review claim until this step approves it.",
  "- Approve a candidate only when every required gate below passes for the same defect claim across evidence, provenance, hypothesis closure, and scope.",
  "- Every candidate must have exactly one origin by 1-based `findingOrigins[].findingIndex`.",
  "- Apply each semantic gate to every candidate. Pass / Fail / Exception clauses below define each gate:",
  "   - `evidence`: Pass when the candidate evidence and origin `evidenceIds` are concrete and traceable, consistent with `<review_state>.reviewBasis.evidenceRefs` and the reviewed code, with concrete named identifiers, execution path, and mechanism. Fail when any cited `evidenceId` is unsupported, or the identifiers, execution path, or mechanism stay vague or unverifiable.",
  "   - `impact`: Pass when the user/system impact is specific and proportionate to the proven evidence, and `counterEvidence` holds substantive checks rather than assertions or restatements. Fail when impact is asserted but not proven, or `counterEvidence` only restates the claim. Fail when a `must_fix` candidate's evidence only supports a lower priority; this is repairable by lowering priority to `nice_to_have` in Step 3.",
  "   - `traceability`: Pass when the schema is complete and the location is precise enough for a reviewer to inspect. Fail when the schema is incomplete or the location cannot be inspected. Exception: do not fail solely for missing exact changed-line overlap when the reviewed-file location is defensible and inspectable.",
  "   - `completeness`: Pass when the candidate closes or honestly accounts for its source hypotheses, and a hypothesis-origin candidate references only H IDs whose `hypothesisClosure.status` is `closed_by_candidate`. Fail when a hypothesis origin cites an H ID not closed `closed_by_candidate`, or an unresolved contract, trigger, impact, or identifier claim prevents reliable approval or rejection. Exception: an unresolved claim that does not change the approve/reject decision does not fail this gate.",
  "   - `scope`: Pass when the candidate is unique, in-scope, and, if supplemental-origin, stays within its stated lens and direct changed behavior or evidence-backed path. Fail when the candidate is a duplicate, low-value restatement, a new bug outside the current candidate set, or a supplemental origin outside its bounded scope. Fail when the only trigger is a hypothetical future caller, custom test double, hand-written object, or omitted optional parameter that no current repo-supported call site omits.",
  "   - Provenance mismatch fails the nearest semantic gate: unsupported `evidenceIds` fail `evidence`, invalid hypothesis closure fails `completeness`, and supplemental origin outside bounded scope fails `scope`.",
  "- If the current candidate still fails a prior semantic-rerun correction, fail the matching semantic gate for that candidate.",
  "",
  "Step 3 - Choose each candidate outcome:",
  "- `approve`: all required gates pass, no blocking missing information changes the decision, and the candidate can be promoted to a final finding as-is.",
  "- `rewrite_required`: the same candidate claim may be valid but needs machine-actionable repair before approval. Use this only when Candidate Findings can repair the existing payload or origin without new bug hunting, such as lowering priority from `must_fix` to `nice_to_have`, supplying concrete existing evidence for trigger/identifier/impact, or aligning origin/closure with the same claim.",
  "- `drop`: the candidate is contradicted, out of scope, duplicate, unreachable, speculative, too weak to justify a rewrite, or is blocked by user-actionable missing information that cannot be repaired from repository evidence.",
  "- If an active candidate duplicates or conflicts with an already approved finding in `<review_state>.approvedFindings`, use `drop` with failed gate `scope`, not `rewrite_required`.",
  "- If a candidate depends on future/custom construction rather than a current repo-supported execution path, use `drop` unless the same candidate can be rewritten to a supported trigger with concrete code evidence.",
  "",
  "Step 4 - Choose loop control:",
  "- Set `loopControl.action = \"rerun\"` only when at least one `perFindingResults[]` entry has `decision = \"rewrite_required\"`.",
  "- Otherwise set `loopControl.action = \"accept\"`: when every `perFindingResults[]` entry has `decision = \"approve\"` or `decision = \"drop\"`, or when there are no candidates.",
  "- Never set `loopControl.action = \"rerun\"` for an empty `perFindingResults` array.",
  "",
  "Step 5 - Apply missing-information rules:",
  "- User-facing missing information must be reported in `missingInformationItems` (this step's output field), not in the candidate payload's `criticalMissingInformation` format.",
  "- After applying the shared Missing Information Discipline, surface only blockers that still affect this step's final approve/drop decision in `missingInformationItems`.",
  "- Leave `missingInformationItems` empty when the final conclusion would be the same without the missing fact.",
  "- If there are no candidates but `<review_state>.candidateFindings.criticalMissingInformation` is non-empty, apply these rules to surface only the user-actionable blockers and keep `loopControl.action` as `accept`.",
  "",
  "Step 6 - Reconcile before output:",
  "- Confirm `perFindingResults` covers every candidate exactly once, each decision matches its `failedGates`/`requiredCorrections` shape, `loopControl.action` follows the decisions, and `missingInformationItems` holds only surviving blockers; fix any mismatch before emitting the object.",
  "",
  "Output object - return exactly these three top-level keys, no more and no fewer:",
  "- `perFindingResults`: array of validation result objects, one per candidate finding ID.",
  "- `missingInformationItems`: array of `{ description, whyItMatters }` objects; use `[]` when empty.",
  "- `loopControl`: a single `{ reason, action }` object.",
  "",
  "Entry field rules - concrete object examples are below; apply these constraints to every matching entry:",
  "- `perFindingResults[]`: `{ \"findingId\", \"reason\", \"failedGates\", \"requiredCorrections\", \"decision\" }`; write the keys in this order so `reason` and `failedGates` are committed before the final `decision`; `decision` is one of " + formatQuotedValues(VALIDATION_DECISIONS) + "; every `failedGates` value is one of " + formatQuotedValues(SEMANTIC_GATE_IDS) + "; `reason` is a non-empty string.",
  "- `perFindingResults[]` by decision: `approve` requires empty `failedGates` and empty `requiredCorrections`; `rewrite_required` requires non-empty `failedGates` and non-empty `requiredCorrections` with concrete machine-actionable repairs; `drop` names at least one `failedGate` that justifies the drop and keeps `requiredCorrections` empty.",
  "- `missingInformationItems[]`: `{ \"description\", \"whyItMatters\" }`, both non-empty strings.",
  "- `loopControl`: `{ \"reason\", \"action\" }`; write `reason` before `action`; `action` is one of " + formatQuotedValues(LOOP_ACTIONS) + "; `reason` is a non-empty string.",
  "",
  "Cross-reference invariants - verify all of these before output:",
  "- coverage: every candidate in `<review_state>.candidateFindings.findings[]` has exactly one `perFindingResults` entry, with no duplicate or missing `findingId`.",
  "- ID source: use candidate finding IDs only in `perFindingResults[].findingId`; candidate IDs are per-turn local F IDs listed in `<candidate_ids>` and repeated in `<review_state>.candidateFindings.findings[].findingId`.",
  "- gate consistency: `approve` has empty `failedGates` and empty `requiredCorrections`; `rewrite_required` and `drop` each name at least one `failedGate`, and only `rewrite_required` carries `requiredCorrections`.",
  "- loop control: set `loopControl.action` to `rerun` only when at least one candidate is `rewrite_required`; otherwise set it to `accept`, and an empty `perFindingResults` array is always `accept`.",
  "- missing information: `missingInformationItems` stays empty unless a user-actionable blocker survives the Step 5 rules.",
  "",
  "Complete JSON output examples - labels are explanatory only; after the final JSON object, output nothing further:",
  "Findings approved example:",
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"reason\": \"all semantic gates passed\", \"failedGates\": [], \"requiredCorrections\": [], \"decision\": \"approve\"}], \"missingInformationItems\": [], \"loopControl\": {\"reason\": \"all gates passed\", \"action\": \"accept\"}}",
  "",
  "Candidate correction required example - one candidate is approved while another remains active for repair:",
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"reason\": \"all semantic gates passed\", \"failedGates\": [], \"requiredCorrections\": [], \"decision\": \"approve\"}, {\"findingId\": \"F2\", \"reason\": \"impact is asserted but not proven\", \"failedGates\": [\"impact\"], \"requiredCorrections\": [\"Prove the concrete user/system impact from existing candidate evidence, or drop the candidate if that proof is unavailable.\"], \"decision\": \"rewrite_required\"}], \"missingInformationItems\": [], \"loopControl\": {\"reason\": \"one active candidate still needs machine-actionable repair\", \"action\": \"rerun\"}}",
  "",
  "User-actionable missing information example - reliable approval is blocked by missing information that cannot be repaired from repository evidence:",
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"reason\": \"required external contract is unavailable\", \"failedGates\": [\"completeness\"], \"requiredCorrections\": [], \"decision\": \"drop\"}], \"missingInformationItems\": [{\"description\": \"Need the service contract for null input handling.\", \"whyItMatters\": \"Without the contract the validator cannot prove expected behavior.\"}], \"loopControl\": {\"reason\": \"candidate cannot be approved without user-actionable missing information\", \"action\": \"accept\"}}",
  "",
  "No candidates example:",
  "{\"perFindingResults\": [], \"missingInformationItems\": [], \"loopControl\": {\"reason\": \"no candidate findings to validate\", \"action\": \"accept\"}}",
  "",
  "No candidates with user-actionable `criticalMissingInformation` example:",
  "{\"perFindingResults\": [], \"missingInformationItems\": [{\"description\": \"Need the binary SDK API/version information for the local AAR.\", \"whyItMatters\": \"Without it the review cannot verify runtime compatibility with the changed call sites.\"}], \"loopControl\": {\"reason\": \"no candidate findings to rewrite; preserve blocking missing information\", \"action\": \"accept\"}}"
].join("\n");

interface SemanticValidationStepOptions {
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

/**
 * Reconcile the first-pass findings through end-to-end simulation before they become the final findings set.
 */
export class SemanticValidationStep implements StepDefinition {
  readonly stepId = SEMANTIC_VALIDATION_STEP_ID;
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;

  constructor(options: SemanticValidationStepOptions) {
    this.#promptSerializer = options.promptSerializer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const candidatePayload = requireCandidatePayload(context);

    return {
      stepId: this.stepId,
      prompt: {
        systemMessage: [
          JSON_STEP_SYSTEM_MESSAGE,
          MISSING_INFORMATION_DISCIPLINE_BLOCK.content,
          SEMANTIC_VALIDATION_SYSTEM_ADDITION
        ].join("\n\n"),
        userMessage: buildSemanticValidationUserMessage(
          context,
          this.#promptSerializer.serialize({
            context,
            include: [
              REVIEW_BASIS_STEP_ID,
              CANDIDATE_FINDINGS_STEP_ID,
              "approved-findings",
              "validation-feedback"
            ]
          }),
          candidatePayload
        )
      },
      reviewProfile: {
        knowledgeMode: "disabled",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: createValidationReportV1Resolve({
        filePath: context.filePath,
        diffContent: context.diffContent,
        reviewBasis: context.getReviewBasis(),
        candidatePayload
      })
    };
  }
}

function buildSemanticValidationUserMessage(
  context: FileReviewContext,
  reviewState: string,
  candidatePayload: CandidateFindings
): string {
  return [
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    reviewState,
    "",
    "<candidate_ids>",
    JSON.stringify(candidatePayload.findings.map((finding) => finding.findingId)),
    "</candidate_ids>",
    "",
    SEMANTIC_VALIDATION_INSTRUCTION
  ].join("\n");
}

function requireCandidatePayload(context: FileReviewContext): CandidateFindings {
  const candidatePayload = context.getCandidateFindings();
  if (!candidatePayload) {
    throw new Error(
      `CandidateFindings must exist before Semantic Validation for "${context.filePath}"`
    );
  }
  return candidatePayload;
}

function formatQuotedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}
