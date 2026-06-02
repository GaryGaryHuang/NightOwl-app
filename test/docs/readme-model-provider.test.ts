import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const readme = readFileSync(path.resolve("README.md"), "utf8");

test("README documents Copilot default mode, BYOK mode, and dry-run authentication", () => {
  assert.match(readme, /Copilot mode/u);
  assert.match(readme, /BYOK mode/u);
  assert.match(readme, /review --dry-run/u);
  assert.match(readme, /does not require .*Copilot.*subscription/iu);
});

test("README documents modelProvider fields and secret environment rules", () => {
  for (const expected of [
    "modelProvider",
    "\"kind\": \"byok\"",
    "\"type\": \"openai\"",
    "\"baseUrl\"",
    "\"model\"",
    "\"apiKeyEnv\"",
    "bearerTokenEnv",
    "wireApi",
    "azure.apiVersion",
    "openai",
    "azure",
    "anthropic"
  ]) {
    assert.ok(readme.includes(expected), `README should include ${expected}`);
  }

  assert.match(readme, /secrets? .*environment variable/iu);
  assert.doesNotMatch(readme, /"apiKey"\s*:\s*"sk-/u);
});

test("README documents review --check as a Copilot availability check", () => {
  assert.match(readme, /review --check[\s\S]*Copilot availability/iu);
});
