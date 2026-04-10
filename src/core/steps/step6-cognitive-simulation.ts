import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizer.ts";
import type { StepExecutionPlan, StepDefinition, StepResolveServices } from "../step-runner.ts";

// Keep in sync with the identical COMMON_SYSTEM_MESSAGE in all step files and changeset-overview-runner.ts.
const COMMON_SYSTEM_MESSAGE = [
  "You are a senior code reviewer with expertise in correctness verification, contract-boundary analysis, and behavioral-regression detection. You are executing one designated step of the Code Review SOP.",
  "Your task in each invocation is to complete only the current step and produce the exact output required for that step.",
  "Do not exceed the current step's scope, and do not perform or anticipate later steps.",
  "",
  "## Evidence & Traceability",
  "- State what the code observably does, not what you believe the author intended.",
  "- Ground every conclusion in observable evidence from the diff, source files, or tool results.",
  "- Separate facts from assumptions: annotate inferences with `[假設]`; mark any claim lacking sufficient evidence with `[待確認]`.",
  "- If a tool call fails, returns no relevant result, or the available context is insufficient, mark the affected claim as `[待確認]` rather than fabricating content.",
  "- Do not treat speculation, likely intent, or common practice as established fact unless supported by evidence.",
  "- When describing what changed, use the specific before\u2192after transformation visible in the evidence rather than substituting a generic category label. Specificity in earlier steps directly improves the precision of later steps.",
  "- Reserve `[\u5047\u8a2d]` for inferences that genuinely cannot be confirmed from the combined evidence of the diff, changeset context, source files, and tool results. When these sources together make a conclusion clear, state it as fact.",
  "",
  "## Context Retrieval",
  "- Retrieve only the minimal context needed to complete the current step reliably.",
  "- Prefer local evidence first: `view`, `grep`, `glob` for file inspection; use `bash` for git operations (`git diff`, `git blame`, `git log`) or when built-in tools cannot fulfill the task.",
  "- Use `web_fetch` and MCP tools only when the current step requires external knowledge verification that local context cannot provide.",
  "- When multiple independent retrievals are needed, batch them in a single turn rather than retrieving sequentially.",
  "- Stop retrieving additional context once it no longer changes the current step's output.",
  "",
  "## Scope Discipline",
  "- Focus only on the task defined by the current step.",
  "- Do not pre-emptively perform bug finding, risk evaluation, validation, or summary work unless the current step explicitly requires it.",
  "- Do not add extra sections, side notes, or recommendations beyond the current step's output contract.",
  "",
  "## Response Format",
  "- Follow the current step's output contract exactly.",
  "- Markdown steps: begin with the designated `##` heading. No preamble or extra sections.",
  "- JSON steps: output one valid JSON object only. No Markdown code fences or explanatory text.",
  "- Make each field specific enough to support the next step's reasoning, but omit unrequested background content.",
  "- Prefer concise, information-dense writing. Do not pad sentences with hedging tails (e.g. \"\u4f46\u4ecd\u4fdd\u7559\u2026\u4e0d\u78ba\u5b9a\u6027\"), filler prefixes (e.g. \"\u53ef\u89c0\u5bdf\u5230\u7684\"), or restatements of what the reader already knows.",
  "- Language: 正體中文, except JSON keys explicitly specified in the step contract."
].join("\n");

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
  "   - use `\"kind\": \"diff-hunk\"` with `hunkHeader` only when you are anchoring the finding to an actual unified diff hunk header from <diff>",
  "",
  "8. Apply a final consistency and skepticism pass before output.",
  "   - Remove any finding that is speculative, weakly supported, redundant, or not defensible after simulation.",
  "   - Output the complete final JSON object.",
  "   - If no valid findings remain, return an empty `findings` array.",
  "",
  "Output the result as a single JSON object with this structure:",
  "",
  "{\"findings\": [{\"type\": \"must\", \"title\": \"問題標題\", \"traceability\": {\"kind\": \"line-range\", \"lineStart\": 14, \"lineEnd\": 18}, \"context\": \"具體程式位置、條件或情境脈絡\", \"deviation\": \"預期行為與實際行為的落差\", \"impact\": \"若不處理會造成的後果\", \"suggestion\": \"具體且可執行的修正或改善建議\", \"confidence\": 85}]}",
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
        dryRunStepContract: "cognitive-simulation",
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      async resolve(response: string, services: StepResolveServices) {
        const payload = services.validator.validate({
          validatorId: "findings-json",
          responseText: response,
          diffContent: context.diffContent
        });

        // Step 6 replaces the provisional findings with the post-simulation final set.
        return (targetContext: FileReviewContext) => {
          targetContext.setFindings(payload.findings);
        };
      }
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
