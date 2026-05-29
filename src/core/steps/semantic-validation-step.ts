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
  "Required output top-level fields:",
  "- `perFindingResults`: array of validation result objects",
  "- `missingInformationItems`: array of `{ description, whyItMatters }` objects",
  "- `loopControl`: `{ action, reason }`",
  "",
  "Non-empty array item shapes:",
  "- `perFindingResults`: `{ \"findingId\": \"F1\", \"decision\": \"approve\", \"failedGates\": [], \"requiredCorrections\": [], \"reason\": \"all semantic gates passed\" }`",
  "- `missingInformationItems`: `{ \"description\": \"specific missing fact\", \"whyItMatters\": \"why this blocks reliable approval\" }`",
  "- `loopControl`: `{ \"action\": \"accept\", \"reason\": \"all gates passed\" }`",
  "",
  "Enum, ID, and entry rules:",
  `- Allowed perFindingResults[].decision values: ${formatQuotedValues(VALIDATION_DECISIONS)}.`,
  `- Allowed perFindingResults[].failedGates values: ${formatQuotedValues(SEMANTIC_GATE_IDS)}.`,
  `- Allowed loopControl.action values: ${formatQuotedValues(LOOP_ACTIONS)}.`,
  "- Use candidate finding IDs only in `perFindingResults[].findingId`. Candidate IDs are the F IDs listed in `<candidate_ids>` and repeated in `<review_state>.candidateFindings.findings[].findingId`.",
  "",
  "Validation feedback and rerun validation rules:",
  "0. If `validationFeedback` is present and non-empty in `<review_state>`, this is a semantic rerun.",
  "   - Use prior `failedGates` and `requiredCorrections` only to check whether the current candidate payload repaired the previous validation concerns.",
  "   - Do not treat `validationFeedback` as a source of new findings, a new supplemental sweep, or new missing-information items.",
  "   - If the current candidate still fails a prior correction, fail the matching semantic gate for that candidate.",
  "",
  "Candidate source and semantic gate rules:",
  "1. Evaluate `<review_state>.candidateFindings` as one payload: `findings`, `findingOrigins`, `hypothesisClosure`, and `criticalMissingInformation` together.",
  "   - Treat candidate findings as unapproved review claims until this validation step approves them.",
  "   - Every candidate must have exactly one origin by 1-based `findingOrigins[].findingIndex`.",
  "",
  "2. Apply the semantic gates listed below for every candidate.",
  "   - `evidence`: the candidate's evidence and origin `evidenceIds` must be concrete, traceable, and consistent with `<review_state>.reviewBasis.evidenceRefs` and the reviewed code; named identifiers, execution path, and mechanism must be concrete.",
  "   - `impact`: the user/system impact must be specific and proportionate to the proven evidence; the candidate's `counterEvidence` must contain substantive checks (not just assertions or restatements); classification and severity must match the proven evidence level.",
  "   - `traceability`: schema must be complete, and the location must be precise enough for a reviewer to inspect; do not fail a candidate solely because it lacks exact changed-line overlap when the reviewed-file location is defensible and inspectable.",
  "   - `completeness`: the candidate must close or honestly account for source hypotheses. A hypothesis-origin candidate must reference only H IDs whose `hypothesisClosure.status` is `closed_by_candidate`; unresolved contract, trigger, impact, or identifier claims fail this gate only when they prevent reliable approval or rejection.",
  "   - `scope`: the candidate must not be a duplicate, low-value restatement, or a new bug outside the current candidate set. A supplemental-origin candidate must stay within its stated lens and direct changed behavior or evidence-backed path. Reject candidates whose only trigger is a hypothetical future caller, custom test double, hand-written object, or omitted optional parameter that no current repo-supported call site omits.",
  "   - Provenance mismatch fails the nearest semantic gate: unsupported `evidenceIds` fail `evidence`, invalid hypothesis closure fails `completeness`, and supplemental origin outside bounded scope fails `scope`.",
  "",
  "Candidate outcome rules:",
  "3. Decide each candidate outcome.",
  "   - `approve`: all required gates pass; the candidate will be promoted to a final finding as-is.",
  "   - `rewrite_required`: the candidate may be valid but needs machine-actionable corrections before approval. This includes cases where evidence supports a lower classification/severity, or the candidate can be repaired by supplying concrete code evidence for trigger, identifier, or impact.",
  "   - `drop`: the candidate is contradicted, out of scope, duplicate, unreachable, too weak to justify a rewrite, or blocked by user-actionable missing information that cannot be repaired from repository evidence.",
  "   - If a candidate depends on future/custom construction rather than a current repo-supported execution path, use `drop` unless a rerun can rewrite it to a supported trigger with concrete code evidence.",
  "",
  "Semantic rerun rules:",
  "4. Use semantic rerun only for actionable correction.",
  "   - Set `loopControl.action = \"rerun\"` only when at least one candidate has `rewrite_required` and a rerun can repair it with concrete required corrections to the existing candidate payload or origins.",
  "   - When `loopControl.action = \"rerun\"`, do not set any `perFindingResults[].decision` to `approve`; use `rewrite_required` for repairable candidates and `drop` for candidates that should not continue.",
  "   - Required corrections must not ask Candidate Findings to hunt for new bugs or run a fresh supplemental sweep.",
  "   - If all candidates are `approve` or `drop`, set `loopControl.action = \"accept\"`.",
  "   - Put corrections in `perFindingResults[].requiredCorrections`.",
  "   - Do not force approval when validation cannot prove the defect.",
  "",
  "Validator consistency and missing-information rules:",
  "5. Apply a final validator consistency pass before output.",
  "   - Every candidate in `<review_state>.candidateFindings.findings[]` must have a `perFindingResults` entry.",
  "   - User-facing missing information must be reported in `missingInformationItems` (this step's output field), not in the candidate payload's `criticalMissingInformation` format.",
  "   - Report `missingInformationItems` only for explicit, scoped, user-actionable missing facts that still block a reliable final approve/drop decision after applying `<review_state>` evidence.",
  "   - Leave `missingInformationItems` empty when the final conclusion would be the same without the missing fact.",
  "   - Missing information about likely repo-readable implementations, call sites, tests, packaging files, or downstream consumers should normally be treated as earlier retrieval failure, not as final blocking missing information.",
  "   - Omit ordinary review uncertainty, generic or direct-test coverage gaps, facts absent only from the current file, internal debug or validator notes, and facts the model should have checked with repository tools.",
  "",
  "Validation report completion policy:",
  "- If there are no candidates, return `perFindingResults: []` and set `loopControl.action` to `accept`; never use `rerun` when `perFindingResults` is empty.",
  "- If there are no candidates but `candidateFindings.result` is `INSUFFICIENT_INFORMATION`, apply the missing-information rules in section 5 to `candidateFindings.criticalMissingInformation` and keep `loopControl.action` as `accept`.",
  "",
  "Complete JSON output examples:",
  "Example labels are explanatory only; output only the JSON object.",
  "Findings approved example:",
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"approve\", \"failedGates\": [], \"requiredCorrections\": [], \"reason\": \"all semantic gates passed\"}], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"accept\", \"reason\": \"all gates passed\"}}",
  "",
  "Candidate correction required example:",
  "If no findings can be approved because the candidate payload needs correction, return: {\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"rewrite_required\", \"failedGates\": [\"impact\"], \"requiredCorrections\": [\"Prove the concrete user/system impact or convert the candidate to missing information.\"], \"reason\": \"impact is asserted but not proven\"}], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"rerun\", \"reason\": \"candidate payload must repair machine-actionable evidence gaps\"}}",
  "",
  "User-actionable missing information example:",
  "If reliable approval is blocked by user-actionable missing information that cannot be repaired from repository evidence, return: {\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"drop\", \"failedGates\": [\"completeness\"], \"requiredCorrections\": [], \"reason\": \"required external contract is unavailable\"}], \"missingInformationItems\": [{\"description\": \"Need the service contract for null input handling.\", \"whyItMatters\": \"Without the contract the validator cannot prove expected behavior.\"}], \"loopControl\": {\"action\": \"accept\", \"reason\": \"candidate cannot be approved without user-actionable missing information\"}}",
  "",
  "No candidates example:",
  "If there are no candidates, return: {\"perFindingResults\": [], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"accept\", \"reason\": \"no candidate findings to validate\"}}",
  "",
  "No candidates with user-actionable `criticalMissingInformation` example:",
  "If there are no candidates but `<review_state>.candidateFindings.criticalMissingInformation` contains user-actionable blockers, return: {\"perFindingResults\": [], \"missingInformationItems\": [{\"description\": \"Need the binary SDK API/version information for the local AAR.\", \"whyItMatters\": \"Without it the review cannot verify runtime compatibility with the changed call sites.\"}], \"loopControl\": {\"action\": \"accept\", \"reason\": \"no candidate findings to rewrite; preserve blocking missing information\"}}"
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
