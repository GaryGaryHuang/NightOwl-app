import type { FileReviewContext } from "../file-review-context.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import {
  LOOP_ACTIONS,
  SEMANTIC_GATE_IDS,
  VALIDATION_DECISIONS,
  type CandidateFindingsV3
} from "../semantic-review.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import {
  JSON_STEP_SYSTEM_MESSAGE,
  MISSING_INFORMATION_DISCIPLINE_BLOCK
} from "./shared-step-system-blocks.ts";
import { createValidationReportV1Resolve } from "./step-resolve-helpers.ts";

const STEP6_SYSTEM_ADDITION = [
  "## Current Step: Semantic Validation",
  "- Validate Step 5 `CandidateFindingsV3` against the diff, `ReviewBasisV1`, candidate evidence chains, host semantic gates, and prior loop feedback.",
  "- This step is a validator, not a bug hunt. Do not introduce new defects outside Step 5 candidate evidence chains.",
  "- If a concern is not already represented by a Step 5 candidate, record it as missing information only when it is a specific user-actionable fact that blocks reliable review judgment."
].join("\n");

const STEP6_STRUCTURED_OUTPUT_GUIDANCE = [
  "### Structured-output guardrails",
  "- Use candidate finding IDs only in `perFindingResults[].findingId`. Candidate IDs are the F IDs listed in `<candidate_ids>` and repeated in `<review_state>.candidateFindings.findings[].findingId`.",
  "- Never use hypothesis IDs such as H1 in `perFindingResults[].findingId`.",
  "- `missingInformationItems` must always be an array of objects. Never emit strings, null, IDs, or Markdown bullets in that array.",
  "- A valid missing-information item is exactly: {\"description\": \"specific missing fact\", \"whyItMatters\": \"why this blocks reliable approval\"}.",
  "- Do not copy all ReviewBasis or Step 5 missing information into `missingInformationItems`. Keep only user-actionable facts that still block approving or rejecting the review result.",
  "- Do not emit generic direct-test gaps, facts absent only from the current file, or internal validator/debug notes as `missingInformationItems`.",
  "- If there are no Step 5 candidates, return `perFindingResults: []` and set `loopControl.action` to `accept`; never use `rerun` when `perFindingResults` is empty.",
  "- If there are no Step 5 candidates but `candidateFindings.result` is `INSUFFICIENT_INFORMATION`, convert each still-user-actionable `candidateFindings.criticalMissingInformation` blocker into `missingInformationItems` and keep `loopControl.action` as `accept`."
] as const;

const STEP6_INSTRUCTION = [
  "Validate this file's Step 5 `CandidateFindingsV3` payload and return `ValidationReportV1`.",
  "",
  "1. Start from the complete candidateFindings CandidateFindingsV3 object in <review_state>.",
  "   - Use `candidateFindings.findings`, `candidateFindings.hypothesisClosure`, and `candidateFindings.criticalMissingInformation` together.",
  "   - These are Step 5 candidate findings and closure/missing-information state, not approved defects.",
  "   - Validate each candidate against the diff, `ReviewBasisV1`, evidence refs, identifier registry, hypothesis closure, prior validation feedback, and semantic gate expectations.",
  "",
  "2. Apply the host semantic gates for every candidate.",
  `   Allowed gate IDs: ${formatQuotedValues(SEMANTIC_GATE_IDS)}.`,
  "   - `evidence`: the candidate's evidence must be concrete, traceable, and consistent with `ReviewBasisV1.evidenceRefs` and the reviewed code; named identifiers must match the current identifier registry; execution path and mechanism must be concrete.",
  "   - `impact`: the user/system impact must be specific and proportionate to the proven evidence; the candidate's `counterEvidence` must contain substantive checks (not just assertions or restatements); classification and severity must match the proven evidence level.",
  "   - `traceability`: schema must be complete, and the location must be precise enough for a reviewer to inspect; exact changed-line overlap is a prompt instruction for Step 5, not a deterministic validator rule.",
  "   - `completeness`: the candidate must close or honestly account for the source hypotheses; unproven contract, trigger, impact, or identifier claims must become missing information.",
  "   - `scope`: the candidate must not be a duplicate, low-value restatement, or a new bug outside the Step 5 candidate set. Reject candidates whose only trigger is a hypothetical future caller, custom test double, hand-written object, or omitted optional parameter that no current repo-supported call site omits.",
  "",
  "3. Decide each candidate outcome.",
  "   - `approve`: all required gates pass; the candidate will be promoted to a final finding as-is.",
  "   - `rewrite_required`: the candidate may be valid but needs machine-actionable corrections before approval. This includes cases where evidence supports a lower classification/severity, or the concern cannot be proven because a contract, trigger, identifier, or impact claim is missing.",
  "   - `drop`: the candidate is contradicted, out of scope, duplicate, unreachable, or too weak to justify a rewrite.",
  "   - If a candidate depends on future/custom construction rather than a current repo-supported execution path, use `drop` unless Step 5 can rewrite it to a supported trigger with concrete code evidence.",
  "",
  "4. Use semantic rerun only for actionable correction.",
  "   - Set `loopControl.action = \"rerun\"` only when at least one candidate has `rewrite_required` and Step 5 can repair it with concrete required corrections.",
  "   - When `loopControl.action = \"rerun\"`, do not set any `perFindingResults[].decision` to `approve`; use `rewrite_required` for repairable candidates and `drop` for candidates that should not continue.",
  "   - If `candidateFindings.findings` is empty, Step 5 has no candidate to rewrite; set `loopControl.action = \"accept\"` even when `missingInformationItems` is non-empty.",
  "   - If all candidates are `approve` or `drop`, set `loopControl.action = \"accept\"`.",
  "   - Put corrections in `perFindingResults[].requiredCorrections`.",
  "   - Do not force approval when validation cannot prove the defect.",
  "",
  "5. Apply a final validator consistency pass before output.",
  "   - Every Step 5 candidate must have a `perFindingResults` entry.",
  "   - User-facing missing information must be reported in `missingInformationItems` (Step 6 output field), not in Step 5's `criticalMissingInformation` format.",
  "   - Missing information must be explicit, scoped, and tied to why reliable approval is blocked.",
  "   - Omit items that are only internal debug context, ordinary review uncertainty, generic test coverage suggestions, or facts the model should have checked with repository tools.",
  "",
  ...STEP6_STRUCTURED_OUTPUT_GUIDANCE,
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  `Allowed perFindingResults[].decision values: ${formatQuotedValues(VALIDATION_DECISIONS)}.`,
  `Allowed perFindingResults[].failedGates values: ${formatQuotedValues(SEMANTIC_GATE_IDS)}.`,
  `Allowed loopControl.action values: ${formatQuotedValues(LOOP_ACTIONS)}.`,
  "{\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"approve\", \"failedGates\": [], \"requiredCorrections\": [], \"reason\": \"all semantic gates passed\"}], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"accept\", \"reason\": \"all gates passed\"}}",
  "",
  "If no findings can be approved because Step 5 needs correction, return: {\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"rewrite_required\", \"failedGates\": [\"impact\"], \"requiredCorrections\": [\"Prove the concrete user/system impact or convert the candidate to missing information.\"], \"reason\": \"impact is asserted but not proven\"}], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"rerun\", \"reason\": \"Step 5 must repair machine-actionable evidence gaps\"}}",
  "",
  "If reliable approval is blocked by user-actionable missing information, return: {\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"rewrite_required\", \"failedGates\": [\"completeness\"], \"requiredCorrections\": [\"Provide the service contract for null input handling or convert to explicit missing information.\"], \"reason\": \"required external contract is unavailable\"}], \"missingInformationItems\": [{\"description\": \"Need the service contract for null input handling.\", \"whyItMatters\": \"Without the contract the validator cannot prove expected behavior.\"}], \"loopControl\": {\"action\": \"rerun\", \"reason\": \"Step 5 must address missing critical contract\"}}",
  "",
  "If there are no Step 5 candidates, return: {\"perFindingResults\": [], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"accept\", \"reason\": \"no candidate findings to validate\"}}",
  "",
  "If there are no Step 5 candidates but Step 5 returned user-actionable `criticalMissingInformation`, return: {\"perFindingResults\": [], \"missingInformationItems\": [{\"description\": \"Need the binary SDK API/version information for the local AAR.\", \"whyItMatters\": \"Without it the review cannot verify runtime compatibility with the changed call sites.\"}], \"loopControl\": {\"action\": \"accept\", \"reason\": \"no candidate findings to rewrite; preserve blocking missing information\"}}"
].join("\n");

export interface Step6CognitiveSimulationStepOptions {
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

/**
 * Reconcile the first-pass findings through end-to-end simulation before they become the final findings set.
 */
export class Step6CognitiveSimulationStep implements StepDefinition {
  readonly stepId = "step6-cognitive-simulation";
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;

  constructor(options: Step6CognitiveSimulationStepOptions) {
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
          STEP6_SYSTEM_ADDITION
        ].join("\n\n"),
        userMessage: buildStep6UserMessage(
          context,
          this.#promptSerializer.serialize({
            context,
            include: [
              "review-basis",
              "candidate-findings",
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
        stepId: this.stepId,
        filePath: context.filePath,
        diffContent: context.diffContent,
        reviewBasis: context.getReviewBasis(),
        candidatePayload
      })
    };
  }
}

function buildStep6UserMessage(
  context: FileReviewContext,
  reviewState: string,
  candidatePayload: CandidateFindingsV3
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
    STEP6_INSTRUCTION
  ].join("\n");
}

function requireCandidatePayload(context: FileReviewContext): CandidateFindingsV3 {
  const candidatePayload = context.getCandidateFindingsV3();
  if (!candidatePayload) {
    throw new Error(
      `CandidateFindingsV3 must exist before Step 6 for "${context.filePath}"`
    );
  }
  return candidatePayload;
}

function formatQuotedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}
