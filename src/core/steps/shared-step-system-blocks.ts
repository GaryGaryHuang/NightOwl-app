import { COMMON_SYSTEM_BLOCKS } from "./common-system-message.ts";

const JSON_OUTPUT_CONTRACT_BLOCK = [
  "## JSON Output Contract",
  "- Output exactly one JSON object that begins with `{` and ends with `}`; do not include Markdown, code fences, scratch notes, tool transcripts, or any text outside that object.",
  "- Follow the current step instruction for object shape; do not invent alternate keys or aliases.",
  "- Close every array and object before finishing the response.",
  "- Prioritize syntactically complete JSON over exhaustive detail. If the response is getting long, shorten strings or omit lower-signal entries before risking an incomplete object.",
  "- Before sending your final message, call the `validate_json` tool once with your drafted JSON object to confirm it parses; it checks JSON syntax only, not fields or content.",
  "- If `validate_json` returns `valid: false`, use the reported error to fix the syntax and check again; send the JSON object as your final message only after it returns `valid: true`, with no other text."
].join("\n");

export const MISSING_INFORMATION_DISCIPLINE_BLOCK = [
  "## Missing Information Discipline",
  "- Missing information is only for a specific unresolved fact that blocks the current step's required decision; it is not a confidence note.",
  "- Before recording missing information, resolve the question in this order when the current step allows it:",
  "  1. Current diff and host-injected current-run review state.",
  "  2. Obvious local repo counterparts, changed tests, implementations, call sites, and contracts.",
  "  3. Allowed external retrieval.",
  "  4. Bounded inference from established code behavior.",
  "- Record missing information only when all gates pass: the fact is still unresolved after allowed checks, the fact would change the current step's judgment about correctness, reachability, impact, or expected contract, and the current step cannot finish reliably without it.",
  "- Do not record missing information for confidence-only facts, nice-to-have context, future investigation ideas, or ordinary coverage gaps alone.",
  "- If the missing fact no longer changes the current step's result, omit it instead of carrying it forward."
].join("\n");

const MARKDOWN_RESPONSE_FORMAT_BLOCK = [
  "## Markdown Response Format",
  "- Begin with the heading designated by the current step."
].join("\n");

const FINDING_ANCHOR_SYSTEM_BLOCK = [
  "## Finding Code Locations & Inline Anchors",
  "- For every JSON finding, set `traceability` to a reviewed-file location.",
  "- Choose the anchor in this order:",
  "  1. Changed-line defect: use `traceability.kind = \"line-range\"` with `lineStart` and `lineEnd` chosen from head-side line numbers that overlap `<review_state>.diffSummary.hunks[].changedHeadLines`.",
  "  2. External dependency-path defect: keep `traceability` on the closest reviewed-file trigger; put the external file or symbol only in `dependencyPathException`, not in `traceability`.",
  "  3. Other reviewed-file defect: use the smallest `line-range` that fully contains the defective expression, statement, or call site.",
  "  4. Fallback hunk anchor: use `traceability.kind = \"diff-hunk\"` only when a precise `line-range` is not defensible and `hunkHeader` can be copied exactly from `<diff>` or `<review_state>.diffSummary.hunks`.",
  "- Do not output `headLineStart` or `headLineEnd` as traceability fields; use them only to understand the hunk's head-side span.",
  "- If exact localization is not defensible, use the closest supportable reviewed-file location, make the evidence basis explicit, and do not invent line numbers."
].join("\n");

const JSON_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  JSON_OUTPUT_CONTRACT_BLOCK
] as const satisfies readonly string[];

const JSON_FINDING_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  JSON_OUTPUT_CONTRACT_BLOCK,
  FINDING_ANCHOR_SYSTEM_BLOCK
] as const satisfies readonly string[];

const MARKDOWN_STEP_SYSTEM_BLOCKS = [
  ...COMMON_SYSTEM_BLOCKS,
  MARKDOWN_RESPONSE_FORMAT_BLOCK
] as const satisfies readonly string[];

export const JSON_STEP_SYSTEM_MESSAGE = JSON_STEP_SYSTEM_BLOCKS.join("\n\n");

export const JSON_FINDING_STEP_SYSTEM_MESSAGE =
  JSON_FINDING_STEP_SYSTEM_BLOCKS.join("\n\n");

export const MARKDOWN_STEP_SYSTEM_MESSAGE =
  MARKDOWN_STEP_SYSTEM_BLOCKS.join("\n\n");

export function formatQuotedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}
