import assert from "node:assert/strict";
import test from "node:test";
import type { ToolInvocation } from "@github/copilot-sdk";

import {
  VALIDATE_JSON_TOOL_NAME,
  validateJsonSyntax,
  validateJsonTool
} from "../../src/services/validate-json-tool.ts";

function invokeHandler(args: unknown): unknown {
  assert.ok(validateJsonTool.handler, "validateJsonTool should define a handler");
  const invocation: ToolInvocation = {
    sessionId: "session-1",
    toolCallId: "call-1",
    toolName: VALIDATE_JSON_TOOL_NAME,
    arguments: args
  };
  return validateJsonTool.handler(args, invocation);
}

test("validateJsonSyntax accepts a syntactically valid JSON object", () => {
  assert.deepEqual(validateJsonSyntax('{"a":1,"b":[2,3]}'), { valid: true });
});

test("validateJsonSyntax accepts non-object JSON values", () => {
  assert.deepEqual(validateJsonSyntax("123"), { valid: true });
  assert.deepEqual(validateJsonSyntax("true"), { valid: true });
  assert.deepEqual(validateJsonSyntax('"text"'), { valid: true });
  assert.deepEqual(validateJsonSyntax("[1, 2, 3]"), { valid: true });
});

test("validateJsonSyntax reports a reason for malformed JSON", () => {
  const trailingComma = validateJsonSyntax('{"a": 1,}');
  assert.equal(trailingComma.valid, false);
  assert.ok(
    typeof trailingComma.error === "string" && trailingComma.error.length > 0,
    "malformed JSON should include a non-empty error reason"
  );

  const missingBrace = validateJsonSyntax('{"a": 1');
  assert.equal(missingBrace.valid, false);
  assert.ok(
    typeof missingBrace.error === "string" && missingBrace.error.length > 0
  );
});

test("validateJsonSyntax checks syntax only, not fields or semantics", () => {
  // Missing required business fields and unknown enum values are still
  // syntactically valid JSON; the tool must not judge content.
  assert.deepEqual(validateJsonSyntax('{"unknownEnum": "nope"}'), {
    valid: true
  });
  assert.deepEqual(validateJsonSyntax("{}"), { valid: true });
});

test("validateJsonSyntax rejects non-string input with a reason", () => {
  const undefinedInput = validateJsonSyntax(undefined);
  assert.equal(undefinedInput.valid, false);
  assert.ok(
    typeof undefinedInput.error === "string" && undefinedInput.error.length > 0
  );

  const numberInput = validateJsonSyntax(42);
  assert.equal(numberInput.valid, false);
  assert.ok(
    typeof numberInput.error === "string" && numberInput.error.length > 0
  );
});

test("validateJsonTool exposes the expected name and skips permission", () => {
  assert.equal(validateJsonTool.name, VALIDATE_JSON_TOOL_NAME);
  assert.equal(validateJsonTool.name, "validate_json");
  assert.equal(validateJsonTool.skipPermission, true);
  assert.notEqual(validateJsonTool.overridesBuiltInTool, true);
  assert.ok(validateJsonTool.parameters, "tool should declare parameters");
});

test("validateJsonTool handler validates the json argument", () => {
  assert.deepEqual(invokeHandler({ json: '{"ok":true}' }), { valid: true });

  const invalid = invokeHandler({ json: "{" }) as {
    valid: boolean;
    error?: string;
  };
  assert.equal(invalid.valid, false);
  assert.ok(typeof invalid.error === "string" && invalid.error.length > 0);
});

test("validateJsonTool handler rejects a missing json argument", () => {
  const result = invokeHandler({}) as { valid: boolean; error?: string };
  assert.equal(result.valid, false);
  assert.ok(typeof result.error === "string" && result.error.length > 0);
});
