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
  "- `<review_state>.reviewBasis.evidenceRefs` defines the reportable evidence IDs that candidate origins may cite.",
  "- `<review_state>.validationFeedback`, when present, is prior Semantic Validation feedback for the current candidate payload repair loop.",
  "",
  "Field roles:",
  "- `perFindingResults`: one validation result for each candidate finding ID; it decides whether that candidate is promoted, repaired, or dropped.",
  "- `missingInformationItems`: final user-actionable blockers that still prevent reliable approval/drop after applying the available review state.",
  "- `loopControl`: Orchestrator control for whether Candidate Findings should repair the current payload or the pipeline should accept the validation result.",
  "",
  "Step 1 - Select the validation mode:",
  "- Read `<review_state>.validationFeedback` first.",
  "- First validation pass: `validationFeedback` is absent or empty; validate the current candidate payload once.",
  "- Semantic rerun: `validationFeedback` is present and non-empty; validate only whether the current payload repaired the prior `failedGates` and `requiredCorrections`.",
  "- A semantic rerun does not add findings, start a supplemental sweep, or turn validation feedback into new missing-information items.",
  "- If there are no candidates, skip candidate validation, apply Step 5 missing-information rules, and set `loopControl.action` to `accept`.",
  "",
  "Step 2 - Validate each candidate claim set:",
  "- Treat each candidate as an unapproved review claim until this step approves it.",
  "- Validate the candidate's finding text, origin, hypothesis closure, and critical missing information as one claim set.",
  "- Every candidate must have exactly one origin by 1-based `findingOrigins[].findingIndex`.",
  "- Apply these semantic gates to every candidate:",
  "   - `evidence`: the candidate's evidence and origin `evidenceIds` must be concrete, traceable, and consistent with `<review_state>.reviewBasis.evidenceRefs` and the reviewed code; named identifiers, execution path, and mechanism must be concrete.",
  "   - `impact`: the user/system impact must be specific and proportionate to the proven evidence; the candidate's `counterEvidence` must contain substantive checks (not just assertions or restatements); classification and severity must match the proven evidence level.",
  "   - `traceability`: schema must be complete, and the location must be precise enough for a reviewer to inspect; do not fail a candidate solely because it lacks exact changed-line overlap when the reviewed-file location is defensible and inspectable.",
  "   - `completeness`: the candidate must close or honestly account for source hypotheses. A hypothesis-origin candidate must reference only H IDs whose `hypothesisClosure.status` is `closed_by_candidate`; unresolved contract, trigger, impact, or identifier claims fail this gate only when they prevent reliable approval or rejection.",
  "   - `scope`: the candidate must not be a duplicate, low-value restatement, or a new bug outside the current candidate set. A supplemental-origin candidate must stay within its stated lens and direct changed behavior or evidence-backed path. Reject candidates whose only trigger is a hypothetical future caller, custom test double, hand-written object, or omitted optional parameter that no current repo-supported call site omits.",
  "   - Provenance mismatch fails the nearest semantic gate: unsupported `evidenceIds` fail `evidence`, invalid hypothesis closure fails `completeness`, and supplemental origin outside bounded scope fails `scope`.",
  "- If the current candidate still fails a prior semantic-rerun correction, fail the matching semantic gate for that candidate.",
  "",
  "Step 3 - Choose each candidate outcome:",
  "- `approve`: all required gates pass, no blocking missing information changes the decision, and the candidate can be promoted to a final finding as-is.",
  "- `rewrite_required`: the same candidate claim may be valid but needs machine-actionable repair before approval. Use this only when Candidate Findings can repair the existing payload or origin without new bug hunting, such as lowering classification/severity, supplying concrete existing evidence for trigger/identifier/impact, or aligning origin/closure with the same claim.",
  "- `drop`: the candidate is contradicted, out of scope, duplicate, unreachable, speculative, too weak to justify a rewrite, requires a fresh supplemental sweep or new defect claim, or is blocked by user-actionable missing information that cannot be repaired from repository evidence.",
  "- If a candidate depends on future/custom construction rather than a current repo-supported execution path, use `drop` unless the same candidate can be rewritten to a supported trigger with concrete code evidence.",
  "- Do not force approval when validation cannot prove the defect.",
  "",
  "Step 4 - Choose loop control:",
  "- Set `loopControl.action = \"rerun\"` only when at least one candidate is `rewrite_required` and the required corrections are concrete repairs to the existing candidate payload or origins.",
  "- When `loopControl.action = \"rerun\"`, do not approve any candidate; use `rewrite_required` for repairable candidates and `drop` for candidates that should not continue.",
  "- Required corrections must not ask Candidate Findings to hunt for new bugs, create a new supplemental finding, or run a fresh supplemental sweep.",
  "- If every candidate is `approve` or `drop`, set `loopControl.action = \"accept\"`.",
  "- If there are no candidates, set `loopControl.action = \"accept\"`; never rerun an empty `perFindingResults` array.",
  "",
  "Step 5 - Reconcile before output:",
  "- Every candidate in `<review_state>.candidateFindings.findings[]` must have exactly one `perFindingResults` entry.",
  "- Use candidate finding IDs only in `perFindingResults[].findingId`. Candidate IDs are the F IDs listed in `<candidate_ids>` and repeated in `<review_state>.candidateFindings.findings[].findingId`.",
  "- Put failed semantic gate IDs in `perFindingResults[].failedGates` and concrete repair instructions in `perFindingResults[].requiredCorrections`.",
  "- Approved candidates must have empty `failedGates` and empty `requiredCorrections`.",
  "- User-facing missing information must be reported in `missingInformationItems` (this step's output field), not in the candidate payload's `criticalMissingInformation` format.",
  "- Report `missingInformationItems` only for explicit, scoped, user-actionable missing facts that still block a reliable final approve/drop decision after applying `<review_state>` evidence.",
  "- Leave `missingInformationItems` empty when the final conclusion would be the same without the missing fact.",
  "- Missing information about likely repo-readable implementations, call sites, tests, packaging files, or downstream consumers should normally be treated as earlier retrieval failure, not as final blocking missing information.",
  "- Omit ordinary review uncertainty, generic or direct-test coverage gaps, facts absent only from the current file, internal debug or validator notes, and facts the model should have checked with repository tools.",
  "",
  "Output contract:",
  "- Return one JSON object with exactly these top-level fields: `perFindingResults`, `missingInformationItems`, and `loopControl`.",
  "- `perFindingResults`: array of validation result objects.",
  "- `missingInformationItems`: array of `{ description, whyItMatters }` objects.",
  "- `loopControl`: `{ action, reason }`.",
  "- Allowed perFindingResults[].decision values: " + formatQuotedValues(VALIDATION_DECISIONS) + ".",
  "- Allowed perFindingResults[].failedGates values: " + formatQuotedValues(SEMANTIC_GATE_IDS) + ".",
  "- Allowed loopControl.action values: " + formatQuotedValues(LOOP_ACTIONS) + ".",
  "- Non-empty `perFindingResults` item shape: `{ \"findingId\": \"F1\", \"decision\": \"approve\", \"failedGates\": [], \"requiredCorrections\": [], \"reason\": \"all semantic gates passed\" }`.",
  "- Non-empty `missingInformationItems` item shape: `{ \"description\": \"specific missing fact\", \"whyItMatters\": \"why this blocks reliable approval\" }`.",
  "- `loopControl` shape: `{ \"action\": \"accept\", \"reason\": \"all gates passed\" }`.",
  "- If there are no candidates but `<review_state>.candidateFindings.criticalMissingInformation` is non-empty, apply the missing-information rules in Step 5 and keep `loopControl.action` as `accept`.",
  "- After the final JSON object, output nothing further.",
  "",
  "Complete JSON output examples:",
  "Example labels are explanatory only; after the final JSON object, output nothing further.",
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
