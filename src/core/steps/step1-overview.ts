import type { FileReviewContext } from "../file-review-context.ts";
import { OVERVIEW_SECTION_KEY } from "../review-section-contract.ts";
import type { RunContext } from "../run-context.ts";
import type { StepExecutionPlan, StepDefinition, StepResolveServices } from "../step-runner.ts";
import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";


const STEP1_SYSTEM_ADDITION = [
  "## Current Step: Overview",
  "- Combine `<changeset_context>` with the file-level `<diff>` to build a file-specific working overview for subsequent steps. The overview must add information value beyond what `<changeset_context>` already provides.",
  "- Describe this file's specific contribution to the changeset, not a restatement of the changeset's scope. Later steps depend on the specificity of this overview to target their analysis precisely.",
  "- Focus on this file's role in the broader changeset, its primary responsibility, the direction of the change, directly observable behavioral changes, and the directly affected area.",
  "- Keep the scope centered on this file. Only retrieve additional repo context when local evidence is insufficient to determine the file's role, change direction, affected area, or test coverage observation.",
  "- \u5f71\u97ff\u7bc4\u570d must stay at the level of this file's directly changed code paths. Do not expand into downstream consumers or dependency contracts \u2014 that is Step 2's job.",
  "- If this file has corresponding test file changes, gather the behavioral expectations and boundary conditions those tests reveal as additional context.",
  "- This step gathers information only. Do not look for bugs, assess correctness, evaluate risk, map dependency contracts, or anticipate conclusions from later steps.",
  "- Begin the response with `## Overview`."
].join("\n");

const STEP1_INSTRUCTION = [
  "This step gathers information only. Do not look for bugs, assess correctness, evaluate risk, or anticipate conclusions from later steps.",
  "",
  "Read `<changeset_context>` and `<diff>`, then produce an Overview for this file.",
  "",
  "Use `<changeset_context>` and `<diff>` as the primary inputs. Retrieve additional repo context only when needed to clarify this file's role, the observable direction of the change, the directly affected area, or test coverage observations.",
  "",
  "1. Explain how this file fits into the broader changeset and what role it plays in the overall change.",
  "2. Identify observable behavioral changes introduced in this file — as observations, not correctness judgments.",
  "3. Identify the file's primary function and responsibility.",
  "4. Describe the observable purpose and direction of this change based on the available evidence. If the purpose is uncertain, make the uncertainty explicit.",
  "5. Describe the directly affected components, functions, or behaviors visible from this file's changes. Do not expand into dependency or contract analysis.",
  "6. Note whether this file has corresponding test file changes. If so, extract the behavioral expectations and boundary conditions they reveal as additional context.",
  "",
  "Keep the Overview concise but informative. Include only information that is likely to improve the accuracy of later file-level review.",
  "",
  "Respond in the following format:",
  "",
  "## Overview",
  "- 整體理解：[this file's specific contribution to the changeset — not a restatement of the changeset category or scope]",
  "- 行為變更：[concrete before→after behavioral change in this file, or 無行為變更]",
  "- 檔案職責：[the file's primary role and responsibility]",
  "- 改動目的：[the before→after transformation: what the code did before and what it does now, with uncertainty explicit only when the diff and changeset context genuinely cannot resolve it]",
  "- 影響範圍：[directly affected code paths, functions, or behaviors in this file only — not downstream dependencies]",
  "- 測試覆蓋觀察：[whether this file's changes have corresponding test changes and what behavioral context those tests reveal, or 未見對應測試異動]",
  "",
  "Before submitting your response, verify:",
  "- Begins with `## Overview`",
  "- All six fields are present: 整體理解、行為變更、檔案職責、改動目的、影響範圍、測試覆蓋觀察",
  "- Each field contains a meaningful answer, not a placeholder or blank line",
  "- 整體理解 adds file-specific detail beyond what <changeset_context> already states",
  "- 改動目的 describes a concrete before→after transformation, not a generic category label"
].join("\n");

const STEP1_JUDGE_CRITERIA = [
  "段落 `## Overview` 必須存在，且以下六個欄位都必須出現，並對應回答該欄位要求：",
  "- 整體理解",
  "- 行為變更",
  "- 檔案職責",
  "- 改動目的",
  "- 影響範圍",
  "- 測試覆蓋觀察"
].join("\n");

export interface Step1OverviewStepOptions {
  runContext: RunContext;
}

/**
 * First per-file step: turn the shared Step 0 context plus the file diff into the working overview for later steps.
 */
export class Step1OverviewStep implements StepDefinition {
  readonly stepId = "step1-overview";
  readonly #runContext: RunContext;

  constructor(options: Step1OverviewStepOptions) {
    this.#runContext = options.runContext;
  }

  prepare(context: FileReviewContext): StepExecutionPlan {
    const { stepId } = this;
    return {
      stepId,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP1_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep1UserMessage(context, this.#runContext)
      },
      reviewProfile: {
        model: "gpt-5-mini",
        timeoutMs: 300_000
      },
      async resolve(response: string, services: StepResolveServices) {
        if (!services.judgeService) {
          throw new Error("judge service is not configured");
        }

        const judgeResult = await services.judgeService.evaluate({
          stepId,
          filePath: context.filePath,
          criteria: STEP1_JUDGE_CRITERIA,
          sectionContent: response
        });

        if (!judgeResult.passed) {
          throw new Error(judgeResult.cause ?? "judge rejected");
        }

        return (targetContext: FileReviewContext) => {
          targetContext.setSection(OVERVIEW_SECTION_KEY, response);
        };
      }
    };
  }
}

function buildStep1UserMessage(
  context: FileReviewContext,
  runContext: RunContext
): string {
  // Keep Step 0's shared changeset framing adjacent to the file diff so the model can situate this file before deeper analysis starts.
  return [
    "<changeset_context>",
    runContext.changesetOverview,
    "</changeset_context>",
    "",
    `<diff path="${context.filePath}" base="${context.baseRef}" head="${context.headRef}">`,
    context.diffContent,
    "</diff>",
    "",
    STEP1_INSTRUCTION
  ].join("\n");
}
