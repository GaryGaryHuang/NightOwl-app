import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizer.ts";
import { DEPENDENCIES_BOUNDARIES_SECTION } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";

// Keep in sync with the identical COMMON_SYSTEM_MESSAGE in all step files and changeset-overview-runner.ts.
const COMMON_SYSTEM_MESSAGE = [
  "You are a senior code reviewer with expertise in correctness verification, contract-boundary analysis, and behavioral-regression detection. You are executing one designated step of the Code Review SOP.",
  "Your task in each invocation is to complete only the current step and produce the exact output required for that step.",
  "Do not exceed the current step's scope, and do not perform or anticipate later steps.",
  "",
  "## Evidence & Traceability",
  "- Ground every conclusion in observable evidence from the diff, source files, or tool results.",
  "- Separate facts from assumptions: annotate inferences with `[假設]`; mark any claim lacking sufficient evidence with `[待確認]`.",
  "- If a tool call fails, returns no relevant result, or the available context is insufficient, mark the affected claim as `[待確認]` rather than fabricating content.",
  "- Do not treat speculation, likely intent, or common practice as established fact unless supported by evidence.",
  "- State what the code observably does, not what you believe the author intended.",
  "",
  "## Context Retrieval",
  "- Retrieve only the minimal context needed to complete the current step reliably.",
  "- Prefer local evidence first: `view`, `grep`, `glob` for file inspection; use `bash` for git operations (`git diff`, `git blame`, `git log`) or when built-in tools cannot fulfill the task.",
  "- Use `web_fetch` and MCP tools only when the current step requires external knowledge verification that local context cannot provide.",
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
  "- Language: 正體中文, except JSON keys explicitly specified in the step contract."
].join("\n");

const STEP2_SYSTEM_ADDITION = [
  "## Current Step: Dependencies & Boundaries",
  "- Map the dependency and interaction boundaries that are directly relevant to this change.",
  "- Focus on the boundaries this file consumes or provides where the diff, the file's role, or the observable behavior makes that boundary important for later review.",
  "- For each relevant dependency, describe the contract from a black-box perspective: what it is responsible for, what goes in, what comes out, what error conditions or usage constraints are visible from available evidence, and whether the diff appears to preserve or change that boundary.",
  "- Identify implicit dependencies only when there is concrete evidence or a strong signal from the diff, the file's role, or the surrounding context that they are involved in this change.",
  "- Keep the goal of this step narrow: clarify boundaries, contracts, and downstream touch points that later steps may need to reason about.",
  "- IMPORTANT: This step gathers information only. Do NOT look for bugs, make correctness judgments, or perform full risk analysis.",
  "- Begin the response with `## Dependencies & Boundaries`."
].join("\n");

const STEP2_INSTRUCTION = [
  "IMPORTANT: This step gathers information only. Do NOT look for bugs, make correctness judgments, or perform full risk analysis.",
  "",
  "Based on the diff and the Overview in <current_review>, map out this file's dependency relationships and interaction boundaries that are directly relevant to this change.",
  "",
  "Use the diff and the Overview as the primary inputs. Retrieve additional repo context only when needed to clarify a dependency's role, contract boundary, or direct downstream touch points. Do not enumerate unrelated imports, utilities, or general architecture background.",
  "",
  "1. List the explicit dependencies that are directly relevant to this change or necessary to understand this file's key interaction boundaries (e.g., imports, external calls, exported interfaces, or other directly used integration points).",
  "   For each dependency, state:",
  "   - Its responsibility and interaction type (Consume or Provide)",
  "   - The relevant contract from a black-box perspective: inputs, outputs, error conditions, and any observable usage constraints supported by available evidence",
  "   - Whether this diff appears to preserve the existing contract boundary, change how the boundary is used, or change the boundary itself; if changed, note the observable downstream touch points",
  "",
  "2. Identify implicit dependencies as a separate pass, but include only those that are plausibly involved in this change based on available evidence. Consider:",
  "   - Shared state: in-memory state, global singletons, cache, context/store",
  "   - Persistent storage: database reads/writes, schema dependencies, durable state",
  "   - Asynchronous concerns: events, scheduling, background jobs, message queues",
  "   - Side effects: logging, metrics, alerts, notifications, or other externally visible effects",
  "",
  "3. Keep the output selective and high-signal:",
  "   - Include only dependencies and boundaries likely to matter for subsequent analysis",
  "   - Prefer observable contracts over internal implementation detail",
  "   - If available evidence is insufficient to fully describe a contract or boundary, record the uncertainty explicitly rather than guessing",
  "",
  "Respond in the following format. If there are no explicit dependencies, write `無外部相依` under 相依清單. If there are no implicit dependencies, write `無` under 隱含相依:",
  "",
  "## Dependencies & Boundaries",
  "- 相依清單：",
  "  - `[相依物件]` → [職責] → Consume/Provide",
  "    - Contract：[I/O 規格；描述輸入、輸出、錯誤條件、使用限制，若資訊不足則明確標示不確定性]",
  "    - 評估：[此 diff 是維持既有 boundary、改變使用方式、或改動 boundary 本身；若有變更，標記可觀察的下游接觸點]",
  "- 隱含相依：",
  "  - [類型: 共享狀態 / 持久化 / 非同步 / 副作用]：[描述]",
  "",
  "Before submitting your response, verify:",
  "- Begins with `## Dependencies & Boundaries`",
  "- 相依清單 is present with at least one entry, or explicitly states `無外部相依`",
  "- If entries exist, each includes both `Contract` and `評估`",
  "- 隱含相依 is present with at least one entry, or explicitly states `無`"
].join("\n");

const STEP2_JUDGE_CRITERIA = [
  "段落 `## Dependencies & Boundaries` 必須存在，且符合下列條件：",
  "- 「相依清單」欄位必須出現，且至少包含一個相依項目，或明確寫出 `無外部相依`。",
  "- 若有相依項目，每個項目都必須包含 `Contract` 與 `評估`。",
  "- 「隱含相依」欄位必須出現，且有至少一項內容，或明確寫出 `無`。"
].join("\n");

export interface Step2DependenciesBoundariesStepOptions {
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

/**
 * Map only the dependency contracts and interaction boundaries that later validation may need to reason about.
 */
export class Step2DependenciesBoundariesStep implements StepDefinition {
  readonly stepId = "step2-dependencies-boundaries";
  readonly #reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;

  constructor(options: Step2DependenciesBoundariesStepOptions) {
    this.#reviewNoteFinalizer = options.reviewNoteFinalizer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    return {
      stepId: this.stepId,
      kind: "section",
      sectionKey: DEPENDENCIES_BOUNDARIES_SECTION.key,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP2_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep2UserMessage(context, this.#reviewNoteFinalizer.render(context))
      },
      reviewProfile: {
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      completionCheck: {
        kind: "judge",
        criteria: STEP2_JUDGE_CRITERIA
      },
      applyTo(targetContext: FileReviewContext, responseText: string) {
        targetContext.setSection(DEPENDENCIES_BOUNDARIES_SECTION.key, responseText);
      }
    };
  }
}

function buildStep2UserMessage(
  context: FileReviewContext,
  currentReview: string
): string {
  // Re-render the current note so this step can extend the prior Overview instead of re-deriving it from scratch.
  return [
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    "<current_review>",
    currentReview,
    "</current_review>",
    "",
    STEP2_INSTRUCTION
  ].join("\n");
}
