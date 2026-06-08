import assert from "node:assert/strict";
import test from "node:test";

import {
  JSON_FINDING_STEP_SYSTEM_MESSAGE,
  JSON_STEP_SYSTEM_MESSAGE,
  MARKDOWN_STEP_SYSTEM_MESSAGE
} from "../../../src/core/steps/shared-step-system-blocks.ts";

test("JSON step system message instructs the model to self-check syntax via validate_json", () => {
  assert.match(JSON_STEP_SYSTEM_MESSAGE, /validate_json/u);
  // The guidance must make clear the tool checks syntax only, so the model does
  // not treat a passing check as schema or content correctness.
  assert.match(JSON_STEP_SYSTEM_MESSAGE, /syntax/iu);
});

test("JSON step guidance frames the tool call as a checkpoint and requires emitting the JSON as the final message", () => {
  // Regression guard: gpt-5.4-mini was ending the turn on the validate_json tool
  // call and emitting an empty final message ("empty review response"). The
  // guidance must frame the passing check as a checkpoint (not the deliverable)
  // and require the model to send the complete JSON object as its final message.
  assert.match(JSON_STEP_SYSTEM_MESSAGE, /checkpoint|not the finish line/iu);
  assert.match(JSON_STEP_SYSTEM_MESSAGE, /complete JSON object as your final message/iu);
});

test("JSON finding step system message also carries the validate_json self-check guidance", () => {
  assert.match(JSON_FINDING_STEP_SYSTEM_MESSAGE, /validate_json/u);
  assert.match(JSON_FINDING_STEP_SYSTEM_MESSAGE, /syntax/iu);
  assert.match(JSON_FINDING_STEP_SYSTEM_MESSAGE, /checkpoint|not the finish line/iu);
});

test("Markdown step system message does not carry the JSON validate_json guidance", () => {
  assert.doesNotMatch(MARKDOWN_STEP_SYSTEM_MESSAGE, /validate_json/u);
});
