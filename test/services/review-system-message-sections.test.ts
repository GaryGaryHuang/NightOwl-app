import assert from "node:assert/strict";
import test from "node:test";

import type { SystemMessageSection } from "@github/copilot-sdk";

import {
  buildRemoveAllSectionsConfig,
  REVIEW_KEPT_SDK_SECTIONS,
  REVIEW_REMOVED_SDK_SECTIONS,
  type ReviewKeptSdkSection,
  type ReviewRemovedSdkSection
} from "../../src/services/review-system-message-sections.ts";

// Compile-time guard: every SDK section must be classified as either removed or
// kept. If `@github/copilot-sdk` adds a new `SystemMessageSection`, this line
// fails to type-check and the maintainer must update the constants.
type AllSectionsClassified = [SystemMessageSection] extends [
  ReviewRemovedSdkSection | ReviewKeptSdkSection
]
  ? true
  : false;
const _allSectionsClassified: AllSectionsClassified = true;
void _allSectionsClassified;

test("REVIEW_REMOVED_SDK_SECTIONS pins the exact set of removed SDK sections", () => {
  assert.deepEqual(
    [...REVIEW_REMOVED_SDK_SECTIONS].sort(),
    [
      "code_change_rules",
      "custom_instructions",
      "guidelines",
      "identity",
      "last_instructions",
      "tone",
      "tool_efficiency",
      "tool_instructions"
    ]
  );
});

test("REVIEW_KEPT_SDK_SECTIONS pins the exact set of retained SDK sections", () => {
  assert.deepEqual(
    [...REVIEW_KEPT_SDK_SECTIONS].sort(),
    ["environment_context", "runtime_instructions", "safety"]
  );
});

test("removed and kept SDK section sets are disjoint", () => {
  const removed = new Set<string>(REVIEW_REMOVED_SDK_SECTIONS);
  for (const name of REVIEW_KEPT_SDK_SECTIONS) {
    assert.equal(
      removed.has(name),
      false,
      `section "${name}" is both removed and kept`
    );
  }
});

test("buildRemoveAllSectionsConfig emits one remove action per removed section", () => {
  const config = buildRemoveAllSectionsConfig();
  assert.deepEqual(
    Object.keys(config).sort(),
    [...REVIEW_REMOVED_SDK_SECTIONS].sort()
  );
  for (const name of REVIEW_REMOVED_SDK_SECTIONS) {
    assert.deepEqual(config[name], { action: "remove" });
  }
});
