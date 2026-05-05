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
import { JSON_STEP_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createValidationReportV1Resolve } from "./step-resolve-helpers.ts";


const STEP6_SYSTEM_ADDITION = [
  "## Current Step: Semantic Validation",
  "- Validate Step 5 `CandidateFindingsV3` against the diff, `ReviewBasisV1`, candidate evidence chains, host semantic gates, and prior loop feedback.",
  "- This step is a validator, not a bug hunt. Do not introduce new defects outside Step 5 candidate evidence chains.",
  "- Return `ValidationReportV1` with per-finding decisions, missing information items, and loop control.",
  "- If a concern is not already represented by a Step 5 candidate, record it as missing information only.",
  "- Use `rewrite_required` when evidence, trigger, impact, counter-evidence, classification/severity alignment, identifiers, anchors, or hypothesis closure are insufficient and Step 5 can repair them. Use `drop` when the candidate is contradicted, out of scope, or too weak.",
  "- Output valid JSON only."
].join("\n");

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
  "   - `traceability`: anchors must be valid for the reviewed file or carry a valid dependency-path exception; schema must be complete.",
  "   - `completeness`: the candidate must close or honestly account for the source hypotheses; unproven contract, trigger, impact, or identifier claims must become missing information.",
  "   - `scope`: the candidate must not be a duplicate, low-value restatement, or a new bug outside the Step 5 candidate set.",
  "",
  "3. Decide each candidate outcome.",
  "   - `approve`: all required gates pass; the candidate will be promoted to a final finding as-is.",
  "   - `rewrite_required`: the candidate may be valid but needs machine-actionable corrections before approval. This includes cases where evidence supports a lower classification/severity, or the concern cannot be proven because a contract, trigger, identifier, or impact claim is missing.",
  "   - `drop`: the candidate is contradicted, out of scope, duplicate, unreachable, or too weak to justify a rewrite.",
  "",
  "4. Use semantic rerun only for actionable correction.",
  "   - Set `loopControl.action = \"rerun\"` only when at least one candidate has `rewrite_required` and Step 5 can repair it with concrete required corrections.",
  "   - If all candidates are `approve` or `drop`, set `loopControl.action = \"accept\"`.",
  "   - Put corrections in `perFindingResults[].requiredCorrections`.",
  "   - Do not force approval when validation cannot prove the defect.",
  "",
  "5. Apply a final validator consistency pass before output.",
  "   - Every Step 5 candidate must have a `perFindingResults` entry.",
  "   - Missing information must be reported in `missingInformationItems` (Step 6 output field), not in Step 5's `criticalMissingInformation` format.",
  "   - Missing information must be explicit, scoped, and tied to why reliable approval is blocked.",
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
  "If reliable approval is blocked by missing information, return: {\"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"rewrite_required\", \"failedGates\": [\"completeness\"], \"requiredCorrections\": [\"Provide the service contract for null input handling or convert to explicit missing information.\"], \"reason\": \"required external contract is unavailable\"}], \"missingInformationItems\": [{\"description\": \"Need the service contract for null input handling.\", \"whyItMatters\": \"Without the contract the validator cannot prove expected behavior.\"}], \"loopControl\": {\"action\": \"rerun\", \"reason\": \"Step 5 must address missing critical contract\"}}",
  "Output exactly one JSON object. Begin with `{` and end with `}` — no Markdown code fences, no surrounding text, no trailing content after the closing brace."
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
        systemMessage: [JSON_STEP_SYSTEM_MESSAGE, STEP6_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep6UserMessage(
          context,
          this.#promptSerializer.serialize({
            context,
            include: [
              "review-basis",
              "candidate-findings",
              "validation-feedback"
            ]
          })
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
  reviewState: string
): string {
  return [
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    reviewState,
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
