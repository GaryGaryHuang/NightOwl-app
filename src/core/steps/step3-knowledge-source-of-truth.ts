import type { FileReviewContext } from "../file-review-context.ts";
import type { ReviewNoteFinalizer } from "../finalizer.ts";
import { KNOWLEDGE_SOURCE_OF_TRUTH_SECTION } from "../review-section-contract.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";

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

const STEP3_SYSTEM_ADDITION = [
  "## Current Step: Knowledge & Source of Truth",
  "- Assess whether the context gathered in prior steps (Overview and Dependencies & Boundaries in <current_review>) leaves any knowledge gaps that must be resolved for later analysis.",
  "- Facts already confirmed in <current_review> \u2014 such as project-wide version constraints, build configuration baselines, or platform boundaries \u2014 can be referenced directly. Each session is independent, but <current_review> carries forward verified context from prior steps.",
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
  "Review the Overview and Dependencies & Boundaries in <current_review>, then determine what additional knowledge is required to support later analysis of this change.",
  "",
  "Use <current_review> as the primary input. Retrieve additional repo or external context only when needed to resolve a concrete knowledge gap.",
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
  "   - If a necessary assumption remains uncertain, make that uncertainty explicit rather than overstating confidence",
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
  reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;
}

/**
 * Close the knowledge gaps that materially affect later review, while pinning the rules and assumptions that govern the rest of the SOP.
 */
export class Step3KnowledgeSourceOfTruthStep implements StepDefinition {
  readonly stepId = "step3-knowledge-source-of-truth";
  readonly #reviewNoteFinalizer: Pick<ReviewNoteFinalizer, "render">;

  constructor(options: Step3KnowledgeSourceOfTruthStepOptions) {
    this.#reviewNoteFinalizer = options.reviewNoteFinalizer;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    return {
      stepId: this.stepId,
      kind: "section",
      sectionKey: KNOWLEDGE_SOURCE_OF_TRUTH_SECTION.key,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP3_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep3UserMessage(
          context,
          this.#reviewNoteFinalizer.render(context)
        )
      },
      reviewProfile: {
        knowledgeMode: "built-in-context7",
        model: "gpt-5-mini",
        timeoutMs: 300_000
      },
      completionCheck: {
        kind: "judge",
        criteria: STEP3_JUDGE_CRITERIA
      },
      applyTo(targetContext: FileReviewContext, responseText: string) {
        targetContext.setSection(KNOWLEDGE_SOURCE_OF_TRUTH_SECTION.key, responseText);
      }
    };
  }
}

function buildStep3UserMessage(
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
    STEP3_INSTRUCTION
  ].join("\n");
}
