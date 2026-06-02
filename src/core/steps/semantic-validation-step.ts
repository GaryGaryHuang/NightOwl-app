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
  "- Every candidate must have exactly one origin by 1-based `findingOrigins[].findingIndex`.",
  "- Apply these semantic gates to every candidate:",
  "   - `evidence`: the candidate's evidence and origin `evidenceIds` must be concrete, traceable, and consistent with `<review_state>.reviewBasis.evidenceRefs` and the reviewed code; named identifiers, execution path, and mechanism must be concrete.",
  "   - `impact`: the user/system impact must be specific and proportionate to the proven evidence; the candidate's `counterEvidence` must contain substantive checks (not just assertions or restatements). Treat `must_fix` as valid only when evidence proves a merge-blocking defect; otherwise require `nice_to_have` for a lower-priority but still actionable issue, or drop the candidate when impact is not proven.",
  "   - `traceability`: schema must be complete, and the location must be precise enough for a reviewer to inspect; do not fail a candidate solely because it lacks exact changed-line overlap when the reviewed-file location is defensible and inspectable.",
  "   - `completeness`: the candidate must close or honestly account for source hypotheses. A hypothesis-origin candidate must reference only H IDs whose `hypothesisClosure.status` is `closed_by_candidate`; unresolved contract, trigger, impact, or identifier claims fail this gate only when they prevent reliable approval or rejection.",
  "   - `scope`: the candidate must not be a duplicate, low-value restatement, or a new bug outside the current candidate set. A supplemental-origin candidate must stay within its stated lens and direct changed behavior or evidence-backed path. Reject candidates whose only trigger is a hypothetical future caller, custom test double, hand-written object, or omitted optional parameter that no current repo-supported call site omits.",
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
  "- Report `missingInformationItems` only for explicit, scoped, user-actionable missing facts that still block a reliable final approve/drop decision after applying `<review_state>` evidence.",
  "- Leave `missingInformationItems` empty when the final conclusion would be the same without the missing fact.",
  "- Missing information about likely repo-readable implementations, call sites, tests, packaging files, or downstream consumers should normally be treated as earlier retrieval failure, not as final blocking missing information.",
  "- Omit ordinary review uncertainty, generic or direct-test coverage gaps, facts absent only from the current file, internal debug or validator notes, and facts the model should have checked with repository tools.",
  "- If there are no candidates but `<review_state>.candidateFindings.criticalMissingInformation` is non-empty, apply these rules to surface only the user-actionable blockers and keep `loopControl.action` as `accept`.",
  "",
  "Output object - return exactly these three top-level keys, no more and no fewer:",
  "- `perFindingResults`: array of validation result objects, one per candidate finding ID.",
  "- `missingInformationItems`: array of `{ description, whyItMatters }` objects; use `[]` when empty.",
  "- `loopControl`: a single `{ action, reason }` object.",
  "",
  "Entry field rules - concrete object examples are below; apply these constraints to every matching entry:",
  "- `perFindingResults[]`: `{ \"findingId\", \"decision\", \"failedGates\", \"requiredCorrections\", \"reason\" }`; `decision` is one of " + formatQuotedValues(VALIDATION_DECISIONS) + "; every `failedGates` value is one of " + formatQuotedValues(SEMANTIC_GATE_IDS) + "; `reason` is a non-empty string.",
  "- `perFindingResults[]` by decision: `approve` requires empty `failedGates` and empty `requiredCorrections`; `rewrite_required` requires non-empty `failedGates` and non-empty `requiredCorrections` with concrete machine-actionable repairs; `drop` lists the `failedGates` that justify the drop and keeps `requiredCorrections` empty.",
  "- `missingInformationItems[]`: `{ \"description\", \"whyItMatters\" }`, both non-empty strings.",
  "- `loopControl`: `{ \"action\", \"reason\" }`; `action` is one of " + formatQuotedValues(LOOP_ACTIONS) + "; `reason` is a non-empty string.",
  "",
  "Cross-reference invariants - verify all of these before output:",
  "- coverage: every candidate in `<review_state>.candidateFindings.findings[]` has exactly one `perFindingResults` entry, with no duplicate or missing `findingId`.",
  "- ID source: use candidate finding IDs only in `perFindingResults[].findingId`; candidate IDs are per-turn local F IDs listed in `<candidate_ids>` and repeated in `<review_state>.candidateFindings.findings[].findingId`.",
  "- gate consistency: approved candidates have empty `failedGates` and empty `requiredCorrections`; failed semantic gate IDs go in `failedGates` and concrete repair instructions go in `requiredCorrections`.",
  "- loop control: `loopControl.action` is `rerun` only when at least one candidate is `rewrite_required`; otherwise `loopControl.action` is `accept`, and an empty `perFindingResults` array is never `rerun`.",
  "- missing information: `missingInformationItems` stays empty unless a user-actionable blocker survives the Step 5 rules.",
  "",
  "Complete JSON output examples - labels are explanatory only; after the final JSON object, output nothing further:",
  "Findings approved example:",
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"approve\", \"failedGates\": [], \"requiredCorrections\": [], \"reason\": \"all semantic gates passed\"}], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"accept\", \"reason\": \"all gates passed\"}}",
  "",
  "Candidate correction required example - one candidate is approved while another remains active for repair:",
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"approve\", \"failedGates\": [], \"requiredCorrections\": [], \"reason\": \"all semantic gates passed\"}, {\"findingId\": \"F2\", \"decision\": \"rewrite_required\", \"failedGates\": [\"impact\"], \"requiredCorrections\": [\"Prove the concrete user/system impact from existing candidate evidence, or drop the candidate if that proof is unavailable.\"], \"reason\": \"impact is asserted but not proven\"}], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"rerun\", \"reason\": \"one active candidate still needs machine-actionable repair\"}}",
  "",
  "User-actionable missing information example - reliable approval is blocked by missing information that cannot be repaired from repository evidence:",
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"drop\", \"failedGates\": [\"completeness\"], \"requiredCorrections\": [], \"reason\": \"required external contract is unavailable\"}], \"missingInformationItems\": [{\"description\": \"Need the service contract for null input handling.\", \"whyItMatters\": \"Without the contract the validator cannot prove expected behavior.\"}], \"loopControl\": {\"action\": \"accept\", \"reason\": \"candidate cannot be approved without user-actionable missing information\"}}",
  "",
  "No candidates example:",
  "{\"perFindingResults\": [], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"accept\", \"reason\": \"no candidate findings to validate\"}}",
  "",
  "No candidates with user-actionable `criticalMissingInformation` example:",
  "{\"perFindingResults\": [], \"missingInformationItems\": [{\"description\": \"Need the binary SDK API/version information for the local AAR.\", \"whyItMatters\": \"Without it the review cannot verify runtime compatibility with the changed call sites.\"}], \"loopControl\": {\"action\": \"accept\", \"reason\": \"no candidate findings to rewrite; preserve blocking missing information\"}}"
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
