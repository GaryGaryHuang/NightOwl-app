import { createRunContext, type RunContext } from "./run-context.ts";
import type { ReviewKnowledgeMode } from "./review-knowledge-mode.ts";
import { SessionTurnAbortedError } from "../services/session-executor.ts";

export interface ChangesetOverviewRunnerInput {
  model: string;
  changedFilesList: string[];
  outputBaseDir: string;
  repoRoot: string;
  signal?: AbortSignal;
  userContext: string[];
  workingDirectory?: string;
}

export interface ReviewSessionFactoryLike {
  createSession(profile: {
    knowledgeMode?: ReviewKnowledgeMode;
    model: string;
    outputBaseDir: string;
    repoRoot: string;
    systemMessage: string;
    workingDirectory?: string;
  }): Promise<{
    sendAndWait(
      prompt: string,
      timeoutMs?: number,
      signal?: AbortSignal
    ): Promise<string | undefined>;
  }>;
}

export interface ChangesetOverviewRunnerOptions {
  reviewSessionFactory: ReviewSessionFactoryLike;
}

const STEP0_TIMEOUT_MS = 300_000;

/**
 * Run the run-level Step 0 review once, retrying only if the response is blank or the session fails.
 */
export class ChangesetOverviewRunner {
  readonly #reviewSessionFactory: ReviewSessionFactoryLike;

  constructor(options: ChangesetOverviewRunnerOptions) {
    this.#reviewSessionFactory = options.reviewSessionFactory;
  }

  async run(input: ChangesetOverviewRunnerInput): Promise<RunContext> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const session = await this.#reviewSessionFactory.createSession({
          knowledgeMode: "built-in-context7",
          model: input.model,
          outputBaseDir: input.outputBaseDir,
          repoRoot: input.repoRoot,
          systemMessage: STEP0_SYSTEM_MESSAGE,
          workingDirectory: input.workingDirectory
        });
        const response = (
          await session.sendAndWait(
            buildStep0Prompt(input),
            STEP0_TIMEOUT_MS,
            input.signal
          )
        )?.trim();

        if (response) {
          return createRunContext({
            changesetOverview: response,
            userContext: input.userContext
          });
        }

        // Step 0 only succeeds when it produces a non-empty overview.
        lastError = new Error(
          "Step 0 changeset overview did not produce a non-empty response."
        );
      } catch (error) {
        if (error instanceof SessionTurnAbortedError) {
          throw error;
        }
        lastError =
          error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error(
      "Step 0 changeset overview did not produce a non-empty response."
    );
  }
}

// Duplicated in each step file and here to keep step definitions self-contained.
// When modifying, keep all copies in sync.
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

const STEP0_SYSTEM_MESSAGE = [
  COMMON_SYSTEM_MESSAGE,
  "",
  "## Current Step: Changeset Overview",
  "- This is a run-level step. Establish a high-level understanding of the overall changeset before per-file review begins.",
  "- The goal of this step is to produce shared context that will help subsequent per-file review. Focus on scope, cross-file boundaries, observable behavioral changes, and test coverage observations.",
  "- Do not analyze every file in detail. Do not perform bug finding, validation, risk evaluation, or correctness judgment in this step.",
  "- Behavioral changes are business decisions — record them as observations, not conclusions about whether they are correct.",
  "- If changed files have corresponding test file changes, gather the behavioral expectations and boundary conditions those tests reveal as additional context for subsequent steps.",
  "- If <user_context> is provided, incorporate it into your analysis. If it contains URLs or external references, retrieve and incorporate their content only when relevant and needed to understand the changeset, using available tools.",
  "- Begin the response with `## Changeset Overview`."
].join("\n");

const STEP0_INSTRUCTION = [
  "Analyze the changeset across all files in <changed_files> (each line: file status — A: added, M: modified, D: deleted, R: renamed — followed by file path) and produce a high-level overview for subsequent per-file review.",
  "",
  "Use <changed_files> as the primary input. Retrieve additional repo context only when needed to clarify the changeset's scope, cross-file boundaries, behavioral changes, or test coverage observations. If <user_context> is provided, incorporate only the parts that are relevant to understanding the changeset.",
  "",
  "1. Scope: What areas of the codebase are affected? Categorize each changed area using one or more of the following:",
  "   - feature: new capability or behavior",
  "   - bugfix: appears to correct an existing defect",
  "   - refactor: structural change with no intended behavioral change",
  "   - config: configuration, build, or infrastructure change",
  "   - test: test-only addition or modification",
  "   - docs: documentation-only change",
  "2. Cross-file boundaries: Identify dependencies between changed files and key interaction patterns that matter for later file-level review.",
  "3. Behavioral changes: Flag observable changes in runtime behavior (new features, removed features, changed logic flow, API changes) — as observations, not correctness judgments.",
  "4. Test coverage observation: Note which changed files have corresponding test file changes. If test changes exist, extract the behavioral expectations and boundary conditions they reveal as additional context for subsequent steps.",
  "",
  "Keep the overview high-level and selective. Include only information that is likely to improve the accuracy of later per-file review.",
  "",
  "Respond in the following format:",
  "",
  "## Changeset Overview",
  "- 調整範圍：[categorized scope of changes across files]",
  "- 跨檔案邊界：[cross-file dependencies and interaction patterns, or 無跨檔案相依]",
  "- 行為變更：[behavioral changes requiring business context validation, or 無行為變更]",
  "- 測試覆蓋觀察：[which changed files have corresponding test changes and what behavioral context those tests reveal, or 未見對應測試異動]"
].join("\n");

function buildStep0Prompt(input: ChangesetOverviewRunnerInput): string {
  const promptLines = [
    "<changed_files>",
    input.changedFilesList.join("\n"),
    "</changed_files>"
  ];

  if (input.userContext.length > 0) {
    promptLines.push(
      "",
      "<user_context>",
      input.userContext.join("\n"),
      "</user_context>"
    );
  }

  promptLines.push(
    "",
    STEP0_INSTRUCTION
  );

  return promptLines.join("\n");
}
