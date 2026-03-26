import type { FileReviewContext } from "../file-review-context.ts";
import { OVERVIEW_SECTION } from "../review-section-contract.ts";
import type { RunContext } from "../run-context.ts";
import type { StepExecutionPlan, StepDefinition } from "../step-runner.ts";

// Duplicated in each step file and changeset-overview-runner.ts to keep step definitions self-contained.
// When modifying, keep all copies in sync.
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

const STEP1_SYSTEM_ADDITION = [
  "## Current Step: Overview",
  "- Combine `<changeset_context>` with the file-level `<diff>` to build a high-level working overview of this file for subsequent steps.",
  "- Focus on this file's role in the broader changeset, its primary responsibility, the direction of the change, directly observable behavioral changes, and the directly affected area.",
  "- Keep the scope centered on this file. Only retrieve additional repo context when local evidence is insufficient to determine the file's role, change direction, affected area, or test coverage observation.",
  "- If this file has corresponding test file changes, gather the behavioral expectations and boundary conditions those tests reveal as additional context.",
  "- IMPORTANT: This step gathers information only. Do NOT look for bugs, assess correctness, evaluate risk, map dependency contracts, or anticipate conclusions from later steps.",
  "- Begin the response with `## Overview`."
].join("\n");

const STEP1_INSTRUCTION = [
  "IMPORTANT: This step gathers information only. Do NOT look for bugs, assess correctness, evaluate risk, or anticipate conclusions from later steps.",
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
  "- 整體理解：[how this file fits into the overall changeset; its role in the broader change]",
  "- 行為變更：[observable behavioral changes in this file, or 無行為變更]",
  "- 檔案職責：[the file's primary role and responsibility]",
  "- 改動目的：[the observable reason and direction behind this change, with uncertainty made explicit when needed]",
  "- 影響範圍：[directly affected components, functions, or behaviors visible from this file's changes]",
  "- 測試覆蓋觀察：[whether this file's changes have corresponding test changes and what behavioral context those tests reveal, or 未見對應測試異動]",
  "",
  "Before submitting your response, verify:",
  "- Begins with `## Overview`",
  "- All six fields are present: 整體理解、行為變更、檔案職責、改動目的、影響範圍、測試覆蓋觀察",
  "- Each field contains a meaningful answer, not a placeholder or blank line"
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
    return {
      stepId: this.stepId,
      kind: "section",
      sectionKey: OVERVIEW_SECTION.key,
      prompt: {
        systemMessage: [COMMON_SYSTEM_MESSAGE, STEP1_SYSTEM_ADDITION].join("\n\n"),
        userMessage: buildStep1UserMessage(context, this.#runContext)
      },
      reviewProfile: {
        model: "gpt-5-mini",
        timeoutMs: 300_000
      },
      completionCheck: {
        kind: "judge",
        criteria: STEP1_JUDGE_CRITERIA
      },
      applyTo(targetContext: FileReviewContext, responseText: string) {
        targetContext.setSection(OVERVIEW_SECTION.key, responseText);
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
