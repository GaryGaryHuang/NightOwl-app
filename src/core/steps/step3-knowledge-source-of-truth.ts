import type { FileReviewContext } from "../file-review-context.ts";
import { KNOWLEDGE_SOURCE_OF_TRUTH_SECTION_KEY } from "../review-section-contract.ts";
import type { ReviewStatePromptSerializer } from "../review-state-prompt-serializer.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";
import { createSectionResolve } from "./step-resolve-helpers.ts";


const STEP3_SYSTEM_ADDITION = [
  "## Current Step: Knowledge & Source of Truth",
  "- Assess whether the context gathered in prior steps (Overview and Dependencies & Boundaries in <review_state>) leaves any knowledge gaps that must be resolved for later analysis.",
  "- Facts already confirmed in <review_state> \u2014 such as project-wide version constraints, build configuration baselines, or platform boundaries \u2014 can be referenced directly. Each session is independent, but <review_state> carries forward verified context from prior steps.",
  "- Use external retrieval only when genuine gaps remain that local context, repo-native evidence, or prior steps cannot resolve.",
  "- When retrieval is needed, prioritize source-of-truth material: repo-native documentation, version files, official docs, specs, standards, and version-specific API references.",
  "- Use supplementary material only when source-of-truth material is insufficient, and label it accordingly.",
  "- Keep this step focused on establishing the governing rules, references, versions, assumptions, and out-of-scope boundaries for this review.",
  "- This step is for knowledge convergence, not for broad research, bug finding, or general advice.",
  "- Begin the response with `## Knowledge & Source of Truth`."
].join("\n");

const STEP3_INSTRUCTION = [
  "This step is for knowledge convergence only. Do not perform bug finding, general advice, or broad research.",
  "",
  "Review the Overview and Dependencies & Boundaries in <review_state>, then determine what additional knowledge is required to support later analysis of this change.",
  "",
  "Use <review_state> as the primary input. Retrieve additional repo or external context only when needed to resolve a concrete knowledge gap.",
  "",
  "1. Assess whether any knowledge gaps remain that matter for this review, such as:",
  "   - technologies, frameworks, or libraries directly involved in the change",
  "   - API behavior or contract details that are not clear from local evidence",
  "   - version-specific constraints that may affect interpretation of the diff",
  "   - domain rules or standards that are necessary to evaluate later scenarios",
  "",
  "2. If genuine gaps exist, retrieve only the references needed to close those gaps.",
  "   - Prioritize repo-native evidence first, such as version files, configuration files, internal docs, or project conventions.",
  "   - Then use authoritative external sources, such as official docs, specs, standards, or versioned API references.",
  "   - Use supplementary sources only when authoritative sources do not fully answer the question, and label them clearly.",
  "   - Confirm only the versions that are relevant to this change. Do not collect unrelated project version information.",
  "",
  "3. Converge the scope of this review:",
  "   - State the rules, standards, references, and assumptions that will govern later analysis",
  "   - Explicitly list what is out of scope for this review",
  "   - If a necessary assumption remains uncertain, make that uncertainty explicit rather than overstating certainty",
  "",
  "Respond in the following format. If no applicable repo-native or external reference is needed for this change, write `無` under 版本／文件參考:",
  "",
  "## Knowledge & Source of Truth",
  "- 版本／文件參考：",
  "  - [package/framework/standard] [version if applicable] — [source link or repo-native source]",
  "- 採用規則與假設：",
  "  - [本次 review 依據的具體規則、版本化行為、repo 慣例或必要假設]",
  "- 排除範圍：",
  "  - [明確不在本次 review 範圍內的面向]",
  "",
  "Before submitting your response, verify:",
  "- Begins with `## Knowledge & Source of Truth`",
  "- 版本／文件參考 is present with at least one entry including a source, or explicitly states `無`",
  "- 採用規則與假設 is present with at least one concrete rule, version constraint, repo convention, or assumption",
  "- 排除範圍 is present with at least one explicitly out-of-scope item"
].join("\n");

const STEP3_JUDGE_CRITERIA = [
  "段落 `## Knowledge & Source of Truth` 必須存在，且符合下列條件：",
  "- 「版本／文件參考」欄位必須出現，且至少包含一筆引用，內容需含來源；若此 change 不需要額外參考，則明確寫出 `無`。",
  "- 「採用規則與假設」欄位必須出現，且至少包含一條具體規則、版本化行為、repo 慣例或必要假設。",
  "- 「排除範圍」欄位必須出現，且至少包含一項明確不在本次 review 範圍內的面向。"
].join("\n");

export interface Step3KnowledgeSourceOfTruthStepOptions {
  promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;
}

/**
 * Close the knowledge gaps that materially affect later review, while pinning the rules and assumptions that govern the rest of the SOP.
 */
export class Step3KnowledgeSourceOfTruthStep implements StepDefinition {
  readonly stepId = "step3-knowledge-source-of-truth";
  readonly #promptSerializer: Pick<ReviewStatePromptSerializer, "serialize">;

  constructor(options: Step3KnowledgeSourceOfTruthStepOptions) {
    this.#promptSerializer = options.promptSerializer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const { stepId } = this;
    return {
      stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP3_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep3UserMessage(
          context,
          this.#promptSerializer.serialize({ context, include: ["sections"] })
        )
      },
      reviewProfile: {
        model: "gpt-5.4-mini",
        timeoutMs: 300_000
      },
      resolve: createSectionResolve({
        stepId,
        filePath: context.filePath,
        sectionKey: KNOWLEDGE_SOURCE_OF_TRUTH_SECTION_KEY,
        criteria: STEP3_JUDGE_CRITERIA
      })
    };
  }
}

function buildStep3UserMessage(
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
    STEP3_INSTRUCTION
  ].join("\n");
}
