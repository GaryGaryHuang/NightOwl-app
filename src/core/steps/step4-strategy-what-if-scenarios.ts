import type { FileReviewContext } from "../file-review-context.ts";
import { STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY } from "../review-section-contract.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createSectionResolve } from "./step-resolve-helpers.ts";

// --- Hypothesis count class ------------------------------------------------

export const STEP4_FILE_CATEGORIES = [
  "feature",
  "bugfix",
  "refactor",
  "config",
  "test",
  "docs"
] as const;

export type Step4FileCategory = (typeof STEP4_FILE_CATEGORIES)[number];

export interface Step4FileCategoryMap {
  readonly changedFiles: readonly {
    readonly path: string;
    readonly category: Step4FileCategory;
  }[];
}

/** Drives Step 4 scenario count rules based on file category. */
export type HypothesisCountClass = "zero" | "low" | "normal";

/** Map a file category to the hypothesis count class. */
export function resolveHypothesisCountClass(
  category: Step4FileCategory
): HypothesisCountClass {
  switch (category) {
    case "docs":
    case "test":
      return "zero";
    case "config":
    case "refactor":
      return "low";
    case "feature":
    case "bugfix":
      return "normal";
  }
}


const STEP4_SYSTEM_ADDITION = [
  "## Current Step: Strategy & What-if Scenarios",
  "- Synthesize the Overview, Dependencies & Boundaries, and Knowledge & Source of Truth in <review_state> to define the investigation strategy for later validation.",
  "- Use prior context to identify the specific failure surfaces that are most worth testing in this file. Do not generate generic scenarios that could apply to arbitrary code changes.",
  "- Each What-if scenario must be a neutral, testable hypothesis for later validation to investigate — not a conclusion that a bug exists.",
  "- Ground each scenario in available evidence from the diff, the file's role, relevant dependency boundaries, and any governing rules, versions, assumptions, or out-of-scope constraints established earlier.",
  "- Prefer a small set of high-signal scenarios that cover distinct failure modes or materially different uncertainties over a longer but repetitive list.",
  "- This step defines where later validation should focus. Do not perform the validation itself, do not report findings, and do not make correctness judgments.",
  "- Begin the response with `## Strategy & What-if Scenarios`."
].join("\n");

// --- Dynamic instruction & judge criteria -----------------------------------

function buildStep4Instruction(countClass: HypothesisCountClass): string {
  const lines: string[] = [
    "This step defines where later validation should focus. Do not perform the validation itself, do not report findings, and do not make correctness judgments.",
    "",
    "Based on the Overview, Dependencies & Boundaries, and Knowledge & Source of Truth in <review_state>, define the validation strategy for this file by identifying its most relevant high-risk areas and framing them as What-if scenarios for later investigation.",
    "",
    "Use prior steps as the primary input. Do not generate generic review heuristics. Each scenario must be grounded in the actual change, the file's role, the relevant dependency boundaries, and the applicable rules, versions, assumptions, and scope limits already established.",
    "",
    "1. Identify the high-risk areas that are most relevant to this change.",
    "   - Derive them from the actual context gathered so far, not from a generic checklist alone.",
    "   - For each high-risk area, explain why this change makes that area worth validating.",
    ""
  ];

  // Count-specific rules
  if (countClass === "zero") {
    lines.push(
      "2. This file is classified as a docs-only or test-only change.",
      "   - If no production behavior changes are worth investigating, state「無需驗證情境」and do not emit any What-if scenarios.",
      "   - If you detect production behavior that warrants investigation, you may emit at most 2 scenarios with explicit justification for why the docs/test change affects production behavior.",
      "   - Number any scenarios W1, W2."
    );
  } else if (countClass === "low") {
    lines.push(
      "2. Define 1–2 What-if scenarios for later validation to investigate.",
      "   - Number each scenario W1, W2.",
      "   - This file is a config or refactor change with limited behavior scope. Do not exceed 2 scenarios."
    );
  } else {
    lines.push(
      "2. Define 3–5 What-if scenarios for later validation to investigate.",
      "   - Number each scenario W1, W2, ...",
      "   - Do not exceed 5 scenarios."
    );
  }

  // Common scenario format requirements
  lines.push(
    "   - Each scenario must be non-redundant and target a distinct failure mode or uncertainty.",
    "   - Each scenario must be framed as a testable hypothesis, not as an assumed defect.",
    "   - Each scenario must include:",
    "     - the trigger condition or situation",
    "     - the expected correct behavior",
    "     - the failure risk or uncertainty to investigate",
    "     - why this scenario is relevant to this specific change",
    "   - Prefer diversity across materially relevant risk categories, but do not force artificial coverage of categories that are not supported by the context.",
    "   - If a plausible risk area is explicitly ruled out by prior context or out-of-scope boundaries, do not include it as a What-if scenario.",
    "",
    "3. Keep the scenario set selective and high-signal.",
    "   - Include only scenarios that are likely to improve the effectiveness of later validation.",
    "   - Avoid restating the same concern in multiple forms.",
    "   - If available evidence is insufficient, record the uncertainty explicitly rather than inflating the scenario.",
    "",
    "Respond in the following format:",
    "",
    "## Strategy & What-if Scenarios",
    "- 高風險區域：",
    "  - [風險類別]：[為何這次改動使其成為值得驗證的高風險區域]",
    "- What-if 假設情境：",
    "  - W1: [觸發條件]；預期正確行為：[... ]；待驗證風險/不確定性：[... ]；與本次改動的關聯：[... ]",
    "  - W2: ...",
    "",
    "Before submitting your response, verify:",
    "- Begins with `## Strategy & What-if Scenarios`"
  );

  // Count-specific verification checklist
  if (countClass === "zero") {
    lines.push(
      "- 高風險區域 is present (may be「無」for docs/test-only changes)",
      "- Either「無需驗證情境」is stated with no scenarios, or at most 2 What-if scenarios are present with production-behavior justification, each numbered W1, W2"
    );
  } else if (countClass === "low") {
    lines.push(
      "- 高風險區域 is present with at least one area and its relevance to this specific change",
      "- 1–2 What-if scenarios are present, each numbered W1, W2"
    );
  } else {
    lines.push(
      "- 高風險區域 is present with at least one area and its relevance to this specific change",
      "- 3–5 What-if scenarios are present, each numbered W1, W2, ..."
    );
  }

  lines.push(
    "- Each scenario includes all four elements: trigger condition, expected correct behavior, risk/uncertainty to investigate, and relevance to this change",
    "- No scenario contains unreplaced placeholder text or is a generic checklist item detached from this change"
  );

  return lines.join("\n");
}

function buildStep4JudgeCriteria(countClass: HypothesisCountClass): string {
  const lines: string[] = [
    "段落 `## Strategy & What-if Scenarios` 必須存在，且符合下列條件："
  ];

  if (countClass === "zero") {
    lines.push(
      "- 「高風險區域」欄位必須出現。若無高風險區域，需明確標記「無」。",
      "- 若標記「無需驗證情境」，不需要 What-if 項目。",
      "- 若存在 What-if 項目，數量不得超過 2 個，且必須以 W# 編號並附帶生產行為關聯的解釋。"
    );
  } else if (countClass === "low") {
    lines.push(
      "- 「高風險區域」欄位必須出現，且至少包含一項與本次改動相關的高風險區域，並說明其關聯。",
      "- What-if 項目 1–2 個，且每項都使用 W# 編號，格式為 W1、W2。"
    );
  } else {
    lines.push(
      "- 「高風險區域」欄位必須出現，且至少包含一項與本次改動相關的高風險區域，並說明其關聯。",
      "- What-if 項目 3–5 個，且每項都使用 W# 編號，格式為 W1、W2、...。"
    );
  }

  lines.push(
    "- 每個 What-if 項目都必須包含：",
    "  - 觸發條件或情境",
    "  - 預期正確行為",
    "  - 待驗證的風險或不確定性",
    "  - 與本次改動的關聯",
    "- What-if 項目不得只是泛用風險口號或未替換的佔位文字。"
  );

  return lines.join("\n");
}

export interface Step4StrategyWhatIfScenariosStepOptions {
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
  fileCategoryMap: Step4FileCategoryMap;
}

/**
 * Convert the accumulated context into a small set of change-specific validation hypotheses for the finding stages.
 */
export class Step4StrategyWhatIfScenariosStep implements StepDefinition {
  readonly stepId = "step4-strategy-what-if-scenarios";
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
  readonly #fileCategoryMap: Step4FileCategoryMap;

  constructor(options: Step4StrategyWhatIfScenariosStepOptions) {
    this.#promptSerializer = options.promptSerializer;
    this.#fileCategoryMap = options.fileCategoryMap;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const { stepId } = this;
    const countClass = this.#resolveCountClassForFile(context.filePath);
    return {
      stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP4_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep4UserMessage(
          context,
          this.#promptSerializer.serialize({ context, include: ["sections"] }),
          countClass
        )
      },
      reviewProfile: {
        knowledgeMode: "disabled",
        model: "gpt-5.4-mini",
        timeoutMs: REVIEW_TURN_TIMEOUT_MS
      },
      resolve: createSectionResolve({
        stepId,
        filePath: context.filePath,
        sectionKey: STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY,
        criteria: buildStep4JudgeCriteria(countClass)
      })
    };
  }

  #resolveCountClassForFile(filePath: string): HypothesisCountClass {
    const entry = this.#fileCategoryMap.changedFiles.find((f) => f.path === filePath);
    if (!entry) return "normal";
    return resolveHypothesisCountClass(entry.category);
  }
}

function buildStep4UserMessage(
  context: FileReviewContext,
  reviewState: string,
  countClass: HypothesisCountClass
): string {
  return [
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    reviewState,
    "",
    buildStep4Instruction(countClass)
  ].join("\n");
}
