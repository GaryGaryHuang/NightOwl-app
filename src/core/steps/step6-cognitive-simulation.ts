import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import type { CandidateFindingsV3 } from "../semantic-review.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createValidationReportV1Resolve } from "./step-resolve-helpers.ts";


const STEP6_SYSTEM_ADDITION = [
  "## Current Step: Semantic Validation",
  "- Validate Step 5 `CandidateFindingsV3` against the diff, `ReviewBasisV1`, candidate evidence chains, host semantic gates, and prior loop feedback.",
  "- This step is a validator, not a bug hunt. Do not introduce new defects outside Step 5 candidate evidence chains.",
  "- Return `ValidationReportV1` with overall status, per-finding decisions, approved findings, missing information items, loop control, and optional stop reason.",
  "- If a concern is not already represented by a Step 5 candidate, record validator feedback or missing information only; do not append it as an approved finding.",
  "- Use `rewrite_required`, `downgrade`, `drop`, or `convert_to_missing_information` when evidence, trigger, impact, counter-evidence, severity/confidence alignment, identifiers, anchors, or hypothesis closure are insufficient.",
  "- Request a Step 5 semantic rerun only when the required corrections are machine-actionable. Repeated unsupported claims, missing critical contracts, unresolved identifier hallucination, or max reruns must stop the loop rather than forcing approval.",
  "- Output valid JSON only."
].join("\n");

const STEP6_INSTRUCTION = [
  "Validate this file's Step 5 `CandidateFindingsV3` payload and return `ValidationReportV1`.",
  "",
  "1. Start from the candidateFindings array in <review_state>.",
  "   - These are Step 5 candidate findings, not approved defects.",
  "   - Validate each candidate against the diff, `ReviewBasisV1`, evidence refs, identifier registry, hypothesis closure, prior validation feedback, and semantic gate expectations.",
  "   - Do not introduce new approved findings outside the Step 5 candidate set.",
  "",
  "2. Apply the host semantic gates for every candidate.",
  "   - Evidence refs: cited evidence IDs must exist in `ReviewBasisV1.evidenceRefs`.",
  "   - Identifiers: named identifiers must match the current identifier registry and reviewed code.",
  "   - Traceability: anchors must be valid for the reviewed file or carry a valid dependency-path exception.",
  "   - Execution path and trigger: the runtime path must be credible, concrete, and consistent with the diff.",
  "   - Mechanism and impact: the failure mechanism and user/system impact must be specific and proportionate.",
  "   - Counter-evidence: the candidate must show meaningful counter-evidence was checked.",
  "   - Severity/confidence alignment: priority, severity, confidence, and evidence strength must match the proven evidence.",
  "   - Hypothesis closure: the candidate must close or honestly account for the source hypotheses.",
  "   - Missing-information honesty: unproven contract, trigger, impact, or identifier claims must become missing information rather than approved defects.",
  "",
  "3. Decide each candidate outcome.",
  "   - `approve`: all required gates pass; include the user-facing approved finding in `approvedFindings`.",
  "   - `rewrite_required`: the candidate may be valid but needs machine-actionable corrections before approval.",
  "   - `downgrade`: evidence supports a lower priority/severity/confidence than Step 5 claimed.",
  "   - `drop`: the candidate is contradicted, out of scope, duplicate, unreachable, or too weak.",
  "   - `convert_to_missing_information`: the concern cannot be proven because a contract, trigger, identifier, evidence ref, or impact claim is missing.",
  "",
  "4. Preserve a strict no-new-bug boundary.",
  "   - If validation reveals a concern not already represented by a Step 5 candidate evidence chain, record it as validator feedback or missing information.",
  "   - Do not add it to `approvedFindings`.",
  "   - `approvedFindings[].findingId` must match a Step 5 candidate findingId.",
  "",
  "5. Use semantic rerun only for actionable correction.",
  "   - Set `loopControl.action = \"rerun_step5\"` only when Step 5 can repair the candidate with concrete required corrections.",
  "   - Put those corrections in `perFindingResults[].requiredCorrections`.",
  "   - Use `loopControl.action = \"stop\"` when repeated unsupported claims, a missing critical contract, unresolved identifier hallucination, or max reruns prevents reliable approval.",
  "   - Do not force approval when validation cannot prove the defect.",
  "",
  "6. Apply a final validator consistency pass before output.",
  "   - Every Step 5 candidate must have a `perFindingResults` entry.",
  "   - Dropped or converted candidates must not appear in `approvedFindings`.",
  "   - Missing information must be explicit, scoped, and tied to why reliable approval is blocked.",
  "   - If no candidates can be approved, return an empty `approvedFindings` array and preserve missing-information items or stop reason when applicable.",
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  "{\"schemaVersion\": 1, \"overallStatus\": \"PASS\", \"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"approve\", \"failedGates\": [], \"requiredCorrections\": [], \"recommendedClassification\": \"confirmed_problem\", \"recommendedPriority\": \"must\", \"recommendedSeverity\": \"high\", \"reason\": \"all semantic gates passed\"}], \"approvedFindings\": [{\"findingId\": \"F1\", \"sourceHypothesisId\": \"H1\", \"type\": \"must\", \"title\": \"問題標題\", \"traceability\": {\"kind\": \"line-range\", \"lineStart\": 21, \"lineEnd\": 22}, \"expectedBehavior\": \"nullable input must return the existing fallback before dereference\", \"actualBehavior\": \"the changed code dereferences input.value before checking for null\", \"deviation\": \"null input now throws instead of returning fallback\", \"impact\": \"requests with null input fail with a runtime TypeError\", \"suggestion\": \"restore the null guard before reading input.value\"}], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"accept\", \"reason\": \"all gates passed\"}}",
  "",
  "If no findings can be approved because Step 5 needs correction, return: {\"schemaVersion\": 1, \"overallStatus\": \"RERUN_STEP5\", \"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"rewrite_required\", \"failedGates\": [\"impact_proportionate\"], \"requiredCorrections\": [\"Prove the concrete user/system impact or convert the candidate to missing information.\"], \"reason\": \"impact is asserted but not proven\"}], \"approvedFindings\": [], \"missingInformationItems\": [], \"loopControl\": {\"action\": \"rerun_step5\", \"reason\": \"Step 5 must repair machine-actionable evidence gaps\"}}",
  "",
  "If reliable approval is blocked by missing information or a stop condition, return: {\"schemaVersion\": 1, \"overallStatus\": \"INSUFFICIENT_INFORMATION_FOR_RELIABLE_REVIEW\", \"perFindingResults\": [{\"findingId\": \"F1\", \"decision\": \"convert_to_missing_information\", \"failedGates\": [\"missing_information_honest\"], \"requiredCorrections\": [], \"reason\": \"required external contract is unavailable\"}], \"approvedFindings\": [], \"missingInformationItems\": [{\"itemId\": \"MI1\", \"findingId\": \"F1\", \"description\": \"Need the service contract for null input handling.\", \"whyItMatters\": \"Without the contract the validator cannot prove expected behavior.\"}], \"loopControl\": {\"action\": \"stop\", \"reason\": \"missing critical contract\"}, \"stopReason\": \"missing_critical_contract\"}",
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
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP6_SYSTEM_ADDITION].join("\n\n"),
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
        timeoutMs: 300_000
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
