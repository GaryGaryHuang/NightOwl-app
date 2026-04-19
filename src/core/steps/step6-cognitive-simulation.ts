import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizers/review-note-finalizer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createStructuredResolve } from "./step-resolve-helpers.ts";


const STEP6_SYSTEM_ADDITION = [
  "## Current Step: Cognitive Simulation",
  "- Verify and finalize this file's findings through end-to-end execution simulation. This step produces the complete final findings as a single JSON object — output all retained, modified, and new findings, not just the changes from the previous step.",
  "- Use the first-pass findings in <current_review> as the starting point for this step. Your primary job is to verify, refine, reconcile, or remove them through end-to-end simulation.",
  "- Perform an end-to-end simulation of the main execution path and the state transitions relevant to the existing findings.",
  "- Check edge and abnormal paths only when they are needed to confirm, falsify, or materially refine an existing finding, or when the simulation directly exposes a new concrete deviation on the path under review.",
  "- If findings conflict, trace the discrepancy back to the execution path, state transitions, assumptions, or source evidence, and resolve in favor of the conclusion with stronger support.",
  "- You may add a new finding only when it is directly exposed by the simulation or by re-checking a path made necessary by a conflict, inconsistency, or uncertainty in the existing findings.",
  "- IMPORTANT: Apply the same evidence, reachability, and actionability standard used for first-pass findings. Do not retain, add, or modify findings based on theoretical speculation, weak inference, or implausible paths. This step is a verification and reconciliation pass, not a general bug hunt.",
  "- Every emitted finding must include a `traceability` object that anchors the finding to the reviewed file.",
  "- When <diff> can be validated, a `line-range` anchor must overlap at least one changed head-side line. If the correct anchor intentionally points outside the changed lines because it identifies a dependency path, include `dependencyPathException` with a non-empty `reason` and `dependencyAnchor.filePath`.",
  "- For every finding retained, modified, or added, assign a fresh `confidence` score (0–100) based on your own simulation evidence — do not carry over scores from the previous step.",
  "- The Findings section in <current_review> is a Markdown rendering of the first-pass results, not the original JSON payload, and it does not include confidence scores.",
  "- Treat those findings as provisional results to verify through simulation, not as final conclusions to preserve by default.",
  "- Output valid JSON only."
].join("\n");

const STEP6_INSTRUCTION = [
  "Perform a cognitive simulation of this file's changes to verify and finalize the first-pass findings in <current_review>.",
  "",
  "1. Start from the existing findings in <current_review>.",
  "   - Treat them as provisional first-pass results from the previous step, not as final truth.",
  "   - Your goal is to verify, refine, reconcile, or remove them through simulation.",
  "",
  "2. Simulate the relevant execution paths end to end.",
  "   - Walk through the main execution path and the state transitions relevant to the existing findings.",
  "   - Check edge and abnormal paths only when they are needed to confirm, falsify, or materially refine an existing finding, or when the simulation directly reveals a new concrete deviation on the path under review.",
  "   - Consider null/empty inputs, boundary conditions, malformed data, dependency failures (timeout/500/retry), partial failure, idempotency, and race conditions only when they are relevant to the findings under review or are directly exposed during simulation.",
  "",
  "3. Review each existing finding against the simulated behavior.",
  "   - Remove a finding if the simulation or source evidence shows that:",
  "     - the referenced path is not credibly reachable in practice",
  "     - the concern is already handled",
  "     - the deviation does not actually occur under the relevant execution semantics",
  "     - the impact is not supported after closer verification",
  "   - Modify a finding if the core concern is valid but the type, context, deviation, impact, or suggestion needs correction.",
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
  "6. For every retained, modified, or newly added finding, assign a `confidence` score (0–100) based on the strength of evidence, path reachability, and clarity of the deviation and impact.",
  "",
  "7. Every retained, modified, or newly added finding must include a `traceability` object for the reviewed file:",
  "   - use `\"kind\": \"line-range\"` with positive integer `lineStart` and `lineEnd` for head-side 1-based file lines",
  "   - when <diff> can be validated, `line-range` must overlap at least one changed head-side line; if the correct anchor intentionally points outside the changed lines because it identifies a dependency path, include `dependencyPathException` with non-empty `reason` and `dependencyAnchor.filePath`",
  "   - use `\"kind\": \"diff-hunk\"` with `hunkHeader` only when you are anchoring the finding to an actual unified diff hunk header from <diff>",
  "",
  "8. Apply a final consistency and skepticism pass before output.",
  "   - Remove any finding that is speculative, weakly supported, redundant, or not defensible after simulation.",
  "   - Output the complete final JSON object.",
  "   - If no valid findings remain, return an empty `findings` array.",
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  "{\"findings\": [{\"type\": \"must\", \"title\": \"問題標題\", \"traceability\": {\"kind\": \"line-range\", \"lineStart\": 21, \"lineEnd\": 22}, \"context\": \"具體程式位置、條件或情境脈絡\", \"deviation\": \"預期行為與實際行為的落差\", \"impact\": \"若不處理會造成的後果\", \"suggestion\": \"具體且可執行的修正或改善建議\", \"confidence\": 85}]}",
  "",
  "If no findings remain, return: {\"findings\": []}",
  "The `type` field must be either `\"must\"` or `\"nice\"`.",
  "Output exactly one JSON object. Begin with `{` and end with `}` \u2014 no Markdown code fences, no surrounding text, no trailing content after the closing brace."
].join("\n");

export interface Step6CognitiveSimulationStepOptions {
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

/**
 * Reconcile the first-pass findings through end-to-end simulation before they become the final findings set.
 */
export class Step6CognitiveSimulationStep implements StepDefinition {
  readonly stepId = "step6-cognitive-simulation";
  readonly #reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;

  constructor(options: Step6CognitiveSimulationStepOptions) {
    this.#reviewNoteFinalizer = options.reviewNoteFinalizer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    return {
      stepId: this.stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP6_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep6UserMessage(
          context,
          this.#reviewNoteFinalizer.render(context)
        )
      },
      reviewProfile: {
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      // Step 6 replaces the provisional findings with the post-simulation final set.
      resolve: createStructuredResolve({
        filePath: context.filePath,
        diffContent: context.diffContent
      })
    };
  }
}

function buildStep6UserMessage(
  context: FileReviewContext,
  currentReview: string
): string {
  return [
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    "<current_review>",
    currentReview,
    "</current_review>",
    "",
    STEP6_INSTRUCTION
  ].join("\n");
}
