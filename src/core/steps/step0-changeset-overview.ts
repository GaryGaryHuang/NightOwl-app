import { COMMON_SYSTEM_MESSAGE } from "./common-system-message.ts";

export const STEP0_TIMEOUT_MS = 300_000;

export const STEP0_SYSTEM_MESSAGE = [
  COMMON_SYSTEM_MESSAGE,
  "",
  "## Current Step: Changeset Overview",
  "- This is a run-level step. Establish a high-level understanding of the overall changeset before per-file review begins.",
  "- The goal of this step is to produce shared context that will help subsequent per-file review. Focus on scope, cross-file boundaries, observable behavioral changes, and test coverage observations.",
  "- Do not analyze every file in detail. Do not perform bug finding, validation, risk evaluation, or correctness judgment in this step.",
  "- Behavioral changes are business decisions — record them as observations, not conclusions about whether they are correct.",
  "- If changed files have corresponding test file changes, gather the behavioral expectations and boundary conditions those tests reveal as additional context for subsequent steps.",
  "- If <user_context> is provided, incorporate it into your analysis. If it contains URLs or external references, retrieve and incorporate their content only when relevant and needed to understand the changeset, using available tools.",
  "",
  "### Output contract (ChangeMap v1, JSON-only)",
  "- Respond with a SINGLE JSON object — no Markdown fences, no prose before or after, no comments.",
  "- The object MUST have exactly these top-level fields and NO others:",
  "  - `schemaVersion`: the literal number `1`.",
  "  - `overviewMarkdown`: a Markdown string starting with the exact prefix `## Changeset Overview` (no leading whitespace, no extra spaces inside the prefix). Use the four-bullet template described in the Instruction section.",
  "  - `changedFiles`: an array; each entry MUST have exactly `path` (string), `status` (`A`|`M`|`D`|`R`), `category` (`feature`|`bugfix`|`refactor`|`config`|`test`|`docs`), and `basis` (`name-status`|`diff-inspected`|`file-inspected`).",
  "  - `behaviorChanges`: an array; each entry MUST have exactly `description` (string) and `files` (array of paths that all appear in `changedFiles[].path`). Empty array is allowed.",
  "  - `unresolvedUnknowns`: an array; each entry MUST have exactly `question` (string), `blocksFinding` (boolean), and `resolutionPath` (string). Empty array is allowed.",
  "- `changedFiles[]` MUST cover every path in `<changed_files>` exactly once and MUST NOT introduce any path that is not present there. For renames or copies (`R<num>` / `C<num>`), use the head-side (post-change) path.",
  "- Do NOT use placeholder markers such as `TODO`, `TBD`, `N/A`, `<replace>`, or `placeholder`. If something is genuinely unknown, record it under `unresolvedUnknowns` with a concrete `resolutionPath`.",
  "- Do NOT include correctness judgments (e.g. \"bug\", \"defect\", \"incorrect\", \"wrong\", \"broken\", \"缺陷\", \"錯誤\", \"有問題\"). Step 0 records observations, not conclusions."
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
  "The `overviewMarkdown` string MUST follow this template:",
  "",
  "## Changeset Overview",
  "- 調整範圍：[categorized scope of changes across files]",
  "- 跨檔案邊界：[cross-file dependencies and interaction patterns, or 無跨檔案相依]",
  "- 行為變更：[behavioral changes requiring business context validation, or 無行為變更]",
  "- 測試覆蓋觀察：[which changed files have corresponding test changes and what behavioral context those tests reveal, or 未見對應測試異動]",
  "",
  "Minimal example (illustrative; values must reflect the actual changeset):",
  "",
  "```json",
  "{",
  "  \"schemaVersion\": 1,",
  "  \"overviewMarkdown\": \"## Changeset Overview\\n- 調整範圍：feature\\n- 跨檔案邊界：無跨檔案相依\\n- 行為變更：新增 review CLI 入口\\n- 測試覆蓋觀察：未見對應測試異動\",",
  "  \"changedFiles\": [",
  "    { \"path\": \"src/app.ts\", \"status\": \"M\", \"category\": \"feature\", \"basis\": \"diff-inspected\" }",
  "  ],",
  "  \"behaviorChanges\": [",
  "    { \"description\": \"新增 review CLI 入口參數\", \"files\": [\"src/app.ts\"] }",
  "  ],",
  "  \"unresolvedUnknowns\": []",
  "}",
  "```",
  "",
  "Respond with the JSON object only — no fences, no prose."
].join("\n");

export interface Step0PromptInput {
  changedFilesList: string[];
  userContext: string[];
}

export function buildStep0Prompt(input: Step0PromptInput): string {
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
