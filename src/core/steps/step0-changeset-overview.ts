import { JSON_STEP_SYSTEM_MESSAGE } from "./shared-step-system-blocks.ts";
import { normalizeChangesetEntriesForChangeMap } from "../change-map.ts";
import { buildXmlishJsonBlock } from "../prompt-serialization.ts";
import type { ReviewKnowledgeMode } from "../review-knowledge-mode.ts";
import { REVIEW_TURN_TIMEOUT_MS } from "../review-runtime-contract.ts";
import {
  formatReviewChangesetEntry,
  type ReviewChangesetEntry
} from "../../providers/review-source-provider.ts";

export const STEP0_TIMEOUT_MS = REVIEW_TURN_TIMEOUT_MS;

export const STEP0_REVIEW_PROFILE = {
  knowledgeMode: "built-in-context7",
  model: "gpt-5.4-mini",
  timeoutMs: STEP0_TIMEOUT_MS
} as const satisfies {
  knowledgeMode: ReviewKnowledgeMode;
  model: string;
  timeoutMs: number;
};

export const STEP0_SYSTEM_MESSAGE = [
  JSON_STEP_SYSTEM_MESSAGE,
  "",
  "## Current Step: Changeset Overview",
  "- This is a run-level step. Establish a high-level understanding of the overall changeset before per-file review begins.",
  "- The goal of this step is to produce shared context that will help subsequent per-file review. Focus on scope, cross-file boundaries, observable behavioral changes, and any test-derived expectations that materially affect that review.",
  "- Keep analysis high-level and high-signal. Do not analyze every file in detail, and do not fill the overview with generic restatements of file names or change statuses.",
  "- Record behavioral changes as run-level context. If user context states expected behavior or business background, preserve that expectation as review context for subsequent per-file review. Do not emit bug findings or final correctness conclusions in the current step.",
  "- If changed files have corresponding test file changes, gather the behavioral expectations and boundary conditions those tests reveal as additional context for subsequent per-file review.",
  "- If <user_context> is provided, read it completely and preserve stated requirements, expected behavior, Root Cause, business decisions, and first-party background in the current step's output fields.",
  "- If referenced external content cannot be retrieved and the missing content materially affects subsequent per-file review, record the limitation in the current step's output."
].join("\n");

const STEP0_INSTRUCTION = [
  "Analyze the changeset across all entries in <changed_files_json> and produce a high-level overview for subsequent per-file review. The JSON block is the canonical changeset input; <changed_files> is diagnostic raw name-status context only.",
  "",
  "Use <changed_files_json> and <user_context> as primary inputs. If <user_context> is provided, read every entry and represent its stated requirements, expected behavior, Root Cause, business decisions, and first-party review background in `reviewObjective`, `userBehavior`, `missingInformation`, and related output fields with enough specificity for subsequent per-file review. Preserve concrete reviewer-relevant facts; do not collapse them into vague phrases such as \"updates logic\" or \"changes files\".",
  "",
  "Retrieve additional repo context only when needed to clarify the changeset's scope, cross-file boundaries, behavioral changes, or test-derived expectations. If external reference content remains unavailable and materially affects subsequent per-file review, use `unresolvedUnknowns`.",
  "",
  "Required output top-level fields:",
  "- `reviewObjective`: `{ summary, requestedFocus, expectedBehaviorSummary }`. Use `summary` for the overall review objective, `requestedFocus` for user-requested or strongly implied focus areas, and `expectedBehaviorSummary` for expected behavior stated by the user or revealed by changed tests.",
  "- `userBehavior`: array of `{ statement, confidence }`. `confidence` must be `explicit` or `inferred`: use `explicit` when the behavior is stated by the user and `inferred` when it is derived from changed code or tests. Empty array is allowed.",
  "- `missingInformation`: array of `{ description, whyItMatters }`. Include only material missing context that would affect review focus or interpretation; do not list ordinary uncertainty or generic lack of tests. Empty array is allowed.",
  "- `overviewMarkdown`: a Markdown string starting with the exact prefix `## Changeset Overview` (no leading whitespace, no extra spaces inside the prefix). Use the four-bullet template below.",
  "- `behaviorChanges`: an array; each entry has `description` and `files`. Describe observable behavior, API, configuration, runtime flow, or test-expectation changes; omit generic file-status summaries. Empty array is allowed.",
  "- `unresolvedUnknowns`: an array; each entry has `question` and `resolutionPath`. Use this only for material questions that require unavailable external content, out-of-repo evidence, or additional verification before subsequent per-file review can interpret the changeset confidently. Empty array is allowed.",
  "",
  "Entry rules:",
  "- `behaviorChanges[].files[]` should reference head-side `path` values from `<changed_files_json>`. For renames (`R<num>`), use the head-side (post-change) path. Copied files are represented as added (`A`) entries in the changed-files inputs.",
  "- Do NOT emit bug findings or final correctness conclusions. The current step records review objective, user-provided expectations, run-level behavior changes, and unresolved unknowns for subsequent per-file validation.",
  "- Prefer empty arrays over low-value filler. If a field has no high-signal content, leave it empty rather than inventing broad claims.",
  "- When summarizing, group related files by changed area or interaction pattern instead of enumerating every file.",
  "",
  "1. Scope: What areas of the codebase are affected? Categorize each changed area using one or more of the following:",
  "   - feature: new capability or behavior",
  "   - bugfix: appears to correct an existing defect",
  "   - refactor: structural change with no intended behavioral change",
  "   - config: configuration, build, or infrastructure change",
  "   - test: test-only addition or modification",
  "   - docs: documentation-only change",
  "2. Cross-file boundaries: Identify dependencies between changed files and key interaction patterns that matter for subsequent per-file review, such as caller/callee relationships, shared contracts, configuration-to-runtime effects, or tests exercising changed production behavior.",
  "3. Behavioral changes: Describe observable runtime behavior changes concisely for the reviewer (for example, new capabilities, removed behavior, changed flow, or API effects). Prefer before/after wording when it is clear from the diff. If user context states expected behavior or business rationale, preserve that expectation as review context without reporting it as a finding in this step.",
  "4. Test-derived expectations: Note which changed files have corresponding test file changes. If test changes exist, extract the behavioral expectations and boundary conditions they reveal as additional context for subsequent per-file review. Do not treat missing corresponding tests as a finding in this step.",
  "",
  "Changeset overview completion policy:",
  "- Keep the overview high-level and selective. Include only information that is likely to improve the accuracy of subsequent per-file review.",
  "",
  "Overview Markdown template:",
  "The `overviewMarkdown` string MUST follow this template:",
  "",
  "## Changeset Overview",
  "- Scope: [categorized scope of changes across files]",
  "- Cross-file boundaries: [cross-file dependencies and interaction patterns, or none]",
  "- Behavior changes: [concise reviewer-facing summary of observable behavior changes, or none]",
  "- Test coverage observations: [which changed files have corresponding test changes and what behavioral context those tests reveal, or no corresponding test changes observed]",
  "",
  "Minimal complete JSON example (illustrative only; values must reflect the actual changeset):",
  "",
  `{"reviewObjective": {"summary": "Review the changeset with evidence-backed per-file basis", "requestedFocus": ["review-flow"], "expectedBehaviorSummary": ["CLI review flow emits structured run context"]}, "userBehavior": [{"statement": "CLI review flow emits structured run context", "confidence": "inferred"}], "missingInformation": [], "overviewMarkdown": "## Changeset Overview\\n- Scope: feature\\n- Cross-file boundaries: none\\n- Behavior changes: adds a review CLI entry point\\n- Test coverage observations: no corresponding test changes observed", "behaviorChanges": [{"description": "adds a review CLI entry parameter", "files": ["src/app.ts"]}], "unresolvedUnknowns": []}`
].join("\n");

export interface Step0PromptInput {
  changesetEntries: ReviewChangesetEntry[];
  userContext: string[];
}

export function buildStep0Prompt(
  input: Step0PromptInput,
  validatorFeedback: unknown = null
): string {
  const promptLines = [
    ...buildXmlishJsonBlock("changed_files_json", {
      entries: normalizeChangesetEntriesForChangeMap(input.changesetEntries)
    }),
    "",
    "<changed_files>",
    input.changesetEntries.map(formatStep0ChangedFileEntry).join("\n"),
    "</changed_files>"
  ];

  if (input.userContext.length > 0) {
    promptLines.push(
      "",
      ...buildXmlishJsonBlock("user_context", { entries: input.userContext })
    );
  }

  promptLines.push(
    "",
    ...buildXmlishJsonBlock("validator_feedback", validatorFeedback),
    "",
    STEP0_INSTRUCTION
  );

  return promptLines.join("\n");
}

export function buildStep0RetryRepairPrompt(
  input: Step0PromptInput,
  previousFailure: unknown
): string {
  return buildStep0Prompt(
    input,
    {
      previousFailure,
      instruction:
        "Return a corrected JSON object that satisfies the current output contract. Preserve the same changed_files and user_context inputs; fix only schema violations identified by the previous failure."
    }
  );
}

function formatStep0ChangedFileEntry(entry: ReviewChangesetEntry): string {
  if (entry.status === "C") {
    return `A\t${entry.path}`;
  }

  return formatReviewChangesetEntry(entry);
}
