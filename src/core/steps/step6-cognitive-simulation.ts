import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createStep6DispositionResolve } from "./step-resolve-helpers.ts";


const STEP6_SYSTEM_ADDITION = [
  "## Current Step: Cognitive Simulation",
  "- Verify and finalize this file's findings through end-to-end execution simulation. This step produces the complete final findings and a disposition record as a single JSON object.",
  "- Use the candidateFindings array in <review_state> as the starting point. Your primary job is to verify, refine, reconcile, or remove them through end-to-end simulation.",
  "- Perform an end-to-end simulation of the main execution path and the state transitions relevant to the existing findings.",
  "- Check edge and abnormal paths only when they are needed to confirm, falsify, or materially refine an existing finding, or when the simulation directly exposes a new concrete deviation on the path under review.",
  "- If findings conflict, trace the discrepancy back to the execution path, state transitions, assumptions, or source evidence, and resolve in favor of the conclusion with stronger support.",
  "- You may add a new finding only when it is directly exposed by the simulation or by re-checking a path made necessary by a conflict, inconsistency, or uncertainty in the existing findings.",
  "- IMPORTANT: Apply the same evidence, reachability, and actionability standard used for first-pass findings. Do not retain, add, or modify findings based on theoretical speculation, weak inference, or implausible paths. This step is a verification and reconciliation pass, not a general bug hunt.",
  "- Every emitted finding must include a `traceability` object that anchors the finding to the reviewed file.",
  "- When <diff> can be validated, a `line-range` anchor must overlap at least one changed head-side line. If the correct anchor intentionally points outside the changed lines because it identifies a dependency path, include `dependencyPathException` with a non-empty `reason` and `dependencyAnchor.filePath`.",
  "- Every finding must include `findingId`, `supportingEvidence`, `reachability`, `uncertaintyStatus`, and `verifierVerdict`. Only `\"supported\"` findings with credible reachability and an accepted verifierVerdict whose checks all pass will be accepted.",
  "- You MUST produce a `dispositions` array that accounts for EVERY finding in the <review_state> candidateFindings array. Each disposition records whether the candidate was retained, modified, or retired, with a taxonomy reason and explanation.",
  "- Output valid JSON only."
].join("\n");

const STEP6_INSTRUCTION = [
  "Perform a cognitive simulation of this file's changes to verify and finalize the candidate findings provided in <review_state> candidateFindings.",
  "",
  "1. Start from the candidateFindings array in <review_state>.",
  "   - These are the structured first-pass results from the previous step, with their findingIds.",
  "   - Your goal is to verify, refine, reconcile, or remove them through simulation.",
  "",
  "2. Simulate the relevant execution paths end to end.",
  "   - Walk through the main execution path and the state transitions relevant to the existing findings.",
  "   - Check edge and abnormal paths only when they are needed to confirm, falsify, or materially refine an existing finding, or when the simulation directly reveals a new concrete deviation on the path under review.",
  "   - Consider null/empty inputs, boundary conditions, malformed data, dependency failures (timeout/500/retry), partial failure, idempotency, and race conditions only when they are relevant to the findings under review or are directly exposed during simulation.",
  "",
  "3. Review each candidate finding against the simulated behavior.",
  "   - Retire a finding if the simulation or source evidence shows that:",
  "     - the referenced path is not credibly reachable in practice",
  "     - the concern is already handled",
  "     - the deviation does not actually occur under the relevant execution semantics",
  "     - the impact is not supported after closer verification",
  "   - Modify a finding if the core concern is valid but the type, expected behavior, actual behavior, deviation, impact, or suggestion needs correction. Keep the same findingId.",
  "   - Retain a finding only if the simulated behavior still supports it as a real, actionable problem under the same evidence, reachability, and actionability standard used in the previous step.",
  "",
  "4. Resolve conflicts and inconsistencies.",
  "   - If findings conflict with each other, with the simulated execution path, or with the established assumptions and source-of-truth context, investigate the discrepancy and keep the conclusion with stronger evidence.",
  "   - Ensure the final findings set is internally consistent and does not contain redundant or overlapping findings that describe the same underlying problem.",
  "",
  "5. Add a new finding only when both conditions are true:",
  "   - it is directly exposed by the simulation or by re-checking a path made necessary by a conflict, inconsistency, or uncertainty in the existing findings",
  "   - it satisfies the same evidence, reachability, and actionability standard expected of a retained finding",
  "",
  "6. Every retained, modified, or newly added finding must include a `traceability` object for the reviewed file:",
  "   - use `\"kind\": \"line-range\"` with positive integer `lineStart` and `lineEnd` for head-side 1-based file lines",
  "   - when <diff> can be validated, `line-range` must overlap at least one changed head-side line; if the correct anchor intentionally points outside the changed lines because it identifies a dependency path, include `dependencyPathException` with non-empty `reason` and `dependencyAnchor.filePath`",
  "   - use `\"kind\": \"diff-hunk\"` with `hunkHeader` only when you are anchoring the finding to an actual unified diff hunk header from <diff>",
  "",
  "7. Every finding must include an `uncertaintyStatus`:",
  "   - `\"supported\"`: evidence and reachability clearly support the finding",
  "   - `\"tentative\"`: plausible but not proven — do not emit as final finding",
  "   - `\"unsupported\"`: evidence is missing or contradicted",
  "   - `\"out_of_scope\"`: claim violates declared scope",
  "   Only `\"supported\"` findings will be accepted.",
  "",
  "8. Every finding must include:",
  "   - `findingId`: a unique string within this payload (e.g. \"F1\", \"F2\")",
  "   - `expectedBehavior`: the specific correct behavior required by code, contract, or source-of-truth evidence",
  "   - `actualBehavior`: the specific behavior observed from the changed code or simulation",
  "   - `supportingEvidence`: a non-empty array of evidence references, each with `evidenceRef` and `supports`; the `supports` value must cover all of `expectedBehavior`, `actualBehavior`, `reachability`, and `impact` across the finding",
  "   - `reachability`: an object with boolean `credible`, non-empty string `entryPoint`, and non-empty `guardsChecked` array",
  "   - `verifierVerdict`: an object with `status: \"accepted\"` and `checks` values of `\"pass\"` for all of `anchor`, `evidence`, `reachability`, `impact`, `scope`, and `duplicate`",
  "   - `sourceHypothesisId` (optional): the W# scenario ID if applicable",
  "",
  "9. Produce a `dispositions` array that accounts for EVERY finding in <review_state> candidateFindings.",
  "   - Each disposition must include: `findingId` (matching the candidate), `status` (\"retained\", \"modified\", or \"retired\"), `reason` (one of \"SUPPORTED\", \"ANCHOR\", \"EVIDENCE\", \"REACHABILITY\", \"OUT_OF_SCOPE\", \"DUPLICATE\", or \"CONTRADICTION\"), and `explanation` (one-sentence justification).",
  "   - Retained or modified candidates MUST also appear in the `findings` array.",
  "   - Retired candidates MUST NOT appear in the `findings` array.",
  "   - New findings (not from candidates) do not need a disposition entry.",
  "",
  "10. Apply a final consistency and skepticism pass before output.",
  "   - Remove any finding that is speculative, weakly supported, redundant, or not defensible after simulation.",
  "   - Output the complete final JSON object.",
  "   - If no valid findings remain, return an empty `findings` array — but still include dispositions for all candidates.",
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  "{\"schemaVersion\": 2, \"findings\": [{\"findingId\": \"F1\", \"sourceHypothesisId\": \"W1\", \"type\": \"must\", \"title\": \"問題標題\", \"traceability\": {\"kind\": \"line-range\", \"lineStart\": 21, \"lineEnd\": 22}, \"expectedBehavior\": \"nullable input must return the existing fallback before dereference\", \"actualBehavior\": \"simulation reaches input.value before any null check\", \"deviation\": \"null input now throws instead of returning fallback\", \"impact\": \"requests with null input fail with a runtime TypeError\", \"suggestion\": \"restore the null guard before reading input.value\", \"uncertaintyStatus\": \"supported\", \"supportingEvidence\": [{\"evidenceRef\": \"E1\", \"supports\": \"expectedBehavior\"}, {\"evidenceRef\": \"E2\", \"supports\": \"actualBehavior\"}, {\"evidenceRef\": \"E3\", \"supports\": \"reachability\"}, {\"evidenceRef\": \"E4\", \"supports\": \"impact\"}], \"reachability\": {\"entryPoint\": \"handleRequest(input)\", \"guardsChecked\": [\"public route passes nullable input\", \"no earlier null guard remains\"], \"credible\": true}, \"verifierVerdict\": {\"status\": \"accepted\", \"checks\": {\"anchor\": \"pass\", \"evidence\": \"pass\", \"reachability\": \"pass\", \"impact\": \"pass\", \"scope\": \"pass\", \"duplicate\": \"pass\"}}}], \"dispositions\": [{\"findingId\": \"F1\", \"status\": \"retained\", \"reason\": \"SUPPORTED\", \"explanation\": \"simulation confirms the deviation is real and reachable\"}]}",
  "",
  "If no findings remain, return: {\"schemaVersion\": 2, \"findings\": [], \"dispositions\": [{\"findingId\": \"F1\", \"status\": \"retired\", \"reason\": \"REACHABILITY\", \"explanation\": \"path is not credibly reachable\"}]}",
  "The `type` field must be either `\"must\"` or `\"nice\"`.",
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
    const candidateFindings = context.getFindings() ?? [];
    const candidateFindingIds = candidateFindings.map((f) => f.findingId);

    return {
      stepId: this.stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP6_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep6UserMessage(
          context,
          this.#promptSerializer.serialize({
            context,
            include: ["sections", "candidate-findings"]
          })
        )
      },
      reviewProfile: {
        knowledgeMode: "disabled",
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      resolve: createStep6DispositionResolve({
        stepId: this.stepId,
        filePath: context.filePath,
        diffContent: context.diffContent,
        candidateFindingIds
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
