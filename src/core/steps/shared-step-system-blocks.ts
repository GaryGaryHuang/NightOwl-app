import { COMMON_SYSTEM_BLOCKS } from "./common-system-message.ts";
import {
  composePromptBlocks,
  createPromptBlock,
  getPromptBlockIds,
  type PromptBlock
} from "./prompt-composition.ts";

const JSON_STRUCTURED_OUTPUT_BLOCK = createPromptBlock("json-structured-output", [
  "## Structured JSON Output",
  "- Express assumptions, missing facts, and limitations through the fields required by the current step's JSON contract, not through reader-facing markers or prose outside the object.",
  "- Preserve the exact keys, enum values, and object shape specified by the current step instruction. Do not invent alternate keys or aliases."
]);

export const JSON_COMPLETION_BLOCK = createPromptBlock("json-completion", [
  "## JSON Completion",
  "- Output exactly one JSON object. Begin with `{` and end with `}`.",
  "- Do not include Markdown, code fences, scratch notes, tool transcripts, or a second object.",
  "- If context is incomplete or a tool result is unavailable, still return a minimal valid object for the current step and record only material blockers in the step's designated uncertainty fields.",
  "- Prioritize syntactically complete JSON over exhaustive detail. If the response is getting long, shorten strings or omit lower-signal entries before risking an incomplete object.",
  "- Close every array and object before finishing the response."
]);

export const MISSING_INFORMATION_DISCIPLINE_BLOCK = createPromptBlock("missing-information-discipline", [
  "## Missing Information Discipline",
  "- Use the current step's missing-information fields only for specific facts that materially block reliable judgment for the current step.",
  "- Missing information is not a general uncertainty bucket.",
  "- Do not record generic test gaps, facts merely absent from the current file, internal follow-up ideas, or facts the available repo/tool context can reasonably resolve."
]);

export const MARKDOWN_UNCERTAINTY_BLOCK = createPromptBlock("markdown-uncertainty", [
  "## Reader-Facing Uncertainty",
  "- Separate facts from assumptions: annotate inferences with `[假設]`; mark any claim lacking sufficient evidence with `[待確認]`.",
  "- If a tool call fails, returns no relevant result, or the available context is insufficient, mark the affected claim as `[待確認]` rather than fabricating content.",
  "- Reserve `[假設]` for inferences that genuinely cannot be confirmed from the combined evidence of the diff, user-provided context, changeset context, source files, and tool results. When these sources together make a conclusion clear, state it as fact."
]);

const MARKDOWN_RESPONSE_FORMAT_BLOCK = createPromptBlock("markdown-response-format", [
  "## Markdown Response Format",
  "- Begin with the designated `##` heading.",
  "- Do not add a preamble or extra sections outside the current step's rendering contract."
]);

export const FINDING_ANCHOR_SYSTEM_BLOCK = createPromptBlock("finding-anchor-guidance", [
  "## Code Locations & Inline Anchors",
  "- For JSON findings, anchor the issue to the reviewed file with the smallest head-side line range that lets a reviewer understand the problem.",
  "- When the changed line is the accurate issue location, use a `line-range` that overlaps a changed head-side line listed in `<review_state>.diffSummary.hunks[].changedHeadLines`; use the hunk's `headLineStart`, `headLineEnd`, and changed lines to avoid guessing line numbers.",
  "- Avoid broad ranges longer than 5-10 lines. If a wider context is needed, still choose the shortest subrange that pinpoints the defective expression, statement, or call site.",
  "- Use `diff-hunk` only when the `hunkHeader` exactly matches an actual unified diff hunk from `<diff>` or `<review_state>.diffSummary.hunks`.",
  "- If the real issue is a dependency-path effect that must be explained outside the changed lines, keep the reviewed-file anchor as close to the changed line as possible and include `dependencyPathException` with the external path details.",
  "- Do not include redundant file or line location prose in finding text when the structured `traceability` field already carries the location."
]);

export const JSON_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  JSON_STRUCTURED_OUTPUT_BLOCK,
  JSON_COMPLETION_BLOCK
] as const satisfies readonly PromptBlock[];

export const JSON_FINDING_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  JSON_STRUCTURED_OUTPUT_BLOCK,
  JSON_COMPLETION_BLOCK,
  FINDING_ANCHOR_SYSTEM_BLOCK
] as const satisfies readonly PromptBlock[];

export const MARKDOWN_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  MARKDOWN_UNCERTAINTY_BLOCK,
  MARKDOWN_RESPONSE_FORMAT_BLOCK
] as const satisfies readonly PromptBlock[];

export const JSON_STEP_SYSTEM_BLOCK_IDS = getPromptBlockIds(JSON_STEP_SYSTEM_BLOCKS);
export const JSON_FINDING_STEP_SYSTEM_BLOCK_IDS = getPromptBlockIds(
  JSON_FINDING_STEP_SYSTEM_BLOCKS
);
export const MARKDOWN_STEP_SYSTEM_BLOCK_IDS = getPromptBlockIds(
  MARKDOWN_STEP_SYSTEM_BLOCKS
);

export const JSON_STEP_SYSTEM_MESSAGE = composePromptBlocks(JSON_STEP_SYSTEM_BLOCKS);

export const JSON_FINDING_STEP_SYSTEM_MESSAGE = composePromptBlocks(
  JSON_FINDING_STEP_SYSTEM_BLOCKS
);

export const MARKDOWN_STEP_SYSTEM_MESSAGE = composePromptBlocks(
  MARKDOWN_STEP_SYSTEM_BLOCKS
);

export const SHARED_JSON_COMPLETION_GUIDANCE = JSON_COMPLETION_BLOCK.content;
