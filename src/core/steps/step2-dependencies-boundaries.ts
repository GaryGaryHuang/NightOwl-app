import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import { DEPENDENCIES_BOUNDARIES_SECTION_KEY } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createSectionResolve } from "./step-resolve-helpers.ts";


const STEP2_SYSTEM_ADDITION = [
  "## Current Step: Dependencies & Boundaries",
  "- Map the dependency and interaction boundaries that are directly relevant to this change.",
  "- Focus on the boundaries this file consumes or provides where the diff, the file's role, or the observable behavior makes that boundary important for later review.",
  "- For each relevant dependency, describe the contract from a black-box perspective: what it is responsible for, what goes in, what comes out, what error conditions or usage constraints are visible from available evidence, and whether the diff appears to preserve or change that boundary.",
  "- Identify implicit dependencies only when there is concrete evidence or a strong signal from the diff, the file's role, or the surrounding context that they are involved in this change.",
  "- Keep the goal of this step narrow: clarify boundaries, contracts, and downstream touch points that later steps may need to reason about.",
  "- This step gathers information only. Do not look for bugs, make correctness judgments, or perform full risk analysis.",
  "- Begin the response with `## Dependencies & Boundaries`."
].join("\n");

const STEP2_INSTRUCTION = [
  "This step gathers information only. Do not look for bugs, make correctness judgments, or perform full risk analysis.",
  "",
  "Based on the diff and the Overview in <review_state>, map out this file's dependency relationships and interaction boundaries that are directly relevant to this change.",
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
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

/**
 * Map only the dependency contracts and interaction boundaries that later validation may need to reason about.
 */
export class Step2DependenciesBoundariesStep implements StepDefinition {
  readonly stepId = "step2-dependencies-boundaries";
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;

  constructor(options: Step2DependenciesBoundariesStepOptions) {
    this.#promptSerializer = options.promptSerializer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const { stepId } = this;
    return {
      stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP2_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep2UserMessage(context, this.#promptSerializer.serialize({ context, include: ["sections"] }))
      },
      reviewProfile: {
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      resolve: createSectionResolve({
        stepId,
        filePath: context.filePath,
        sectionKey: DEPENDENCIES_BOUNDARIES_SECTION_KEY,
        criteria: STEP2_JUDGE_CRITERIA
      })
    };
  }
}

function buildStep2UserMessage(
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
    STEP2_INSTRUCTION
  ].join("\n");
}
