import { defineTool, type Tool } from "@github/copilot-sdk";

/**
 * LLM-callable tool name for the JSON syntax validator.
 */
export const VALIDATE_JSON_TOOL_NAME = "validate_json";

/**
 * Source-qualified entry used in the review session `availableTools` allowlist.
 * The runtime classifies host-registered tools as `custom`, so the allowlist
 * must reference the validator with the `custom:` prefix.
 */
export const VALIDATE_JSON_AVAILABLE_TOOL = `custom:${VALIDATE_JSON_TOOL_NAME}`;

export interface ValidateJsonResult {
  valid: boolean;
  error?: string;
}

interface ValidateJsonArgs {
  json?: unknown;
}

const MISSING_INPUT_REASON =
  'Expected a string in the "json" argument carrying the JSON text to validate.';

/**
 * Check whether `input` is a syntactically valid JSON document. This validates
 * JSON syntax only (equivalent to `JSON.parse` succeeding); it does not inspect
 * fields, schema, enums, or any semantic content. A malformed document yields
 * the parser's error message so the caller can correct the syntax.
 */
export function validateJsonSyntax(input: unknown): ValidateJsonResult {
  if (typeof input !== "string") {
    return { valid: false, error: MISSING_INPUT_REASON };
  }

  try {
    JSON.parse(input);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Custom tool that lets the model self-check JSON syntax before emitting its
 * final structured output. Registered with `skipPermission` because it performs
 * no I/O and only parses an in-memory string, so it never emits a `custom-tool`
 * permission request and does not weaken the deny-by-default custom-tool policy.
 */
export const validateJsonTool: Tool = defineTool(VALIDATE_JSON_TOOL_NAME, {
  description:
    "Validate whether a string is syntactically valid JSON before you emit it " +
    "as your final answer. Checks JSON syntax only (not fields, schema, or " +
    "semantics). Returns { valid: true } when the syntax is correct, or " +
    "{ valid: false, error } with the parser's reason so you can fix and retry.",
  parameters: {
    type: "object",
    properties: {
      json: {
        type: "string",
        description: "The raw JSON text to validate."
      }
    },
    required: ["json"],
    additionalProperties: false
  },
  skipPermission: true,
  handler: (args) => validateJsonSyntax((args as ValidateJsonArgs).json)
});
