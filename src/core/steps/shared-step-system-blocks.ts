import { COMMON_SYSTEM_BLOCKS } from "./common-system-message.ts";
import {
  composePromptBlocks,
  createPromptBlock,
  getPromptBlockIds,
  type PromptBlock
} from "./prompt-composition.ts";

const JSON_STRUCTURED_OUTPUT_BLOCK = createPromptBlock("json-structured-output", [
  "## Structured JSON Output",
  "- Put assumptions, missing facts, and limitations only in the current step's designated JSON fields.",
  "- Follow the current step instruction for object shape; do not invent alternate keys or aliases."
]);

const JSON_COMPLETION_BLOCK = createPromptBlock("json-completion", [
  "## JSON Completion",
  "- Output exactly one JSON object that begins with `{` and ends with `}`; do not include Markdown, code fences, scratch notes, tool transcripts, or any text outside that object.",
  "- If context is incomplete or a tool result is unavailable, still return a minimal valid object for the current step and record only material blockers in the step's designated uncertainty fields.",
  "- Prioritize syntactically complete JSON over exhaustive detail. If the response is getting long, shorten strings or omit lower-signal entries before risking an incomplete object.",
  "- Close every array and object before finishing the response."
]);

export const MISSING_INFORMATION_DISCIPLINE_BLOCK = createPromptBlock("missing-information-discipline", [
  "## Missing Information Discipline",
  "- Treat missing information as a last-resort blocker, not a confidence note.",
  "- Before recording missing information, try to resolve the question in this order when the current step allows it: current diff and host-injected current-run review state, obvious local repo counterparts and changed tests, obvious local implementations/call sites/contracts, allowed external retrieval, then bounded inference from established code behavior.",
  "- Record missing information only when all of the following are true: the fact is still unresolved after allowed retrieval, the fact would change the current step's judgment about correctness, reachability, impact, or expected contract, and the current step cannot finish reliably without it.",
  "- Do not record missing information for facts that affect confidence only, nice-to-have context, future investigation ideas, generic test gaps, or questions that stop mattering after the current analysis.",
  "- If later analysis shows the question no longer changes the current step's result, remove it instead of carrying it forward."
]);

const MARKDOWN_RESPONSE_FORMAT_BLOCK = createPromptBlock("markdown-response-format", [
  "## Markdown Response Format",
  "- Begin with the heading designated by the current step."
]);

const FINDING_ANCHOR_SYSTEM_BLOCK = createPromptBlock("finding-anchor-guidance", [
  "## Code Locations & Inline Anchors",
  "- For JSON findings, use the smallest reviewed-file `line-range` that lets a reviewer inspect the defective expression, statement, or call site.",
  "- When the changed line is the accurate issue location, overlap a head-side line from `<review_state>.diffSummary.hunks[].changedHeadLines`; use `headLineStart`, `headLineEnd`, and changed lines instead of guessing.",
  "- Use `diff-hunk` only when `hunkHeader` exactly matches an actual hunk from `<diff>` or `<review_state>.diffSummary.hunks`.",
  "- For dependency-path issues outside the changed lines, keep the reviewed-file anchor closest to the changed trigger and include `dependencyPathException` for the external path."
]);

const JSON_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  JSON_STRUCTURED_OUTPUT_BLOCK,
  JSON_COMPLETION_BLOCK
] as const satisfies readonly PromptBlock[];

const JSON_FINDING_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  JSON_STRUCTURED_OUTPUT_BLOCK,
  JSON_COMPLETION_BLOCK,
  FINDING_ANCHOR_SYSTEM_BLOCK
] as const satisfies readonly PromptBlock[];

const MARKDOWN_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
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
