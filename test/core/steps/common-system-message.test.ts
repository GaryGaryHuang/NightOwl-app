import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMON_SYSTEM_MESSAGE,
  COMMON_SYSTEM_BLOCK_IDS
} from "../../../src/core/steps/common-system-message.ts";
import {
  JSON_FINDING_STEP_SYSTEM_BLOCK_IDS,
  JSON_FINDING_STEP_SYSTEM_MESSAGE,
  JSON_STEP_SYSTEM_BLOCK_IDS,
  JSON_STEP_SYSTEM_MESSAGE,
  MARKDOWN_STEP_SYSTEM_BLOCK_IDS,
  MARKDOWN_STEP_SYSTEM_MESSAGE
} from "../../../src/core/steps/shared-step-system-blocks.ts";

test("common system prompt stays schema-free and globally applicable", () => {
  assert.deepEqual(COMMON_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline"
  ]);

  assert.match(COMMON_SYSTEM_MESSAGE, /## Evidence & Traceability/u);
  assert.match(COMMON_SYSTEM_MESSAGE, /## Uncertainty Discipline/u);
  assert.match(COMMON_SYSTEM_MESSAGE, /## Context Retrieval/u);
  assert.match(COMMON_SYSTEM_MESSAGE, /## Scope Discipline/u);
  assert.match(COMMON_SYSTEM_MESSAGE, /## Response Format/u);
  assert.doesNotMatch(
    COMMON_SYSTEM_MESSAGE,
    /inferences|missingInformation|hypothesisClosure|criticalMissingInformation|missingInformationItems|traceability|dependencyPathException|changedHeadLines/u
  );
  assert.doesNotMatch(COMMON_SYSTEM_MESSAGE, /Code Locations & Inline Anchors/u);
  assert.doesNotMatch(COMMON_SYSTEM_MESSAGE, /\[假設\]|\[待確認\]/u);
});

test("JSON step system prompt block order is deterministic and excludes finding anchors", () => {
  assert.deepEqual(JSON_STEP_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline",
    "json-structured-output",
    "json-completion"
  ]);

  assert.match(JSON_STEP_SYSTEM_MESSAGE, /## Structured JSON Output/u);
  assert.match(JSON_STEP_SYSTEM_MESSAGE, /## JSON Completion/u);
  assert.doesNotMatch(JSON_STEP_SYSTEM_MESSAGE, /Code Locations & Inline Anchors/u);
  assert.doesNotMatch(JSON_STEP_SYSTEM_MESSAGE, /\[假設\]|\[待確認\]/u);
  assert.doesNotMatch(
    JSON_STEP_SYSTEM_MESSAGE,
    /hypothesisClosure|criticalMissingInformation|missingInformationItems|dependencyPathException|changedHeadLines/u
  );
});

test("finding JSON system prompt composes anchor guidance only for finding-producing steps", () => {
  assert.deepEqual(JSON_FINDING_STEP_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline",
    "json-structured-output",
    "json-completion",
    "finding-anchor-guidance"
  ]);

  const anchorIndex = JSON_FINDING_STEP_SYSTEM_MESSAGE.indexOf(
    "## Code Locations & Inline Anchors"
  );
  const completionIndex = JSON_FINDING_STEP_SYSTEM_MESSAGE.indexOf("## JSON Completion");
  assert.ok(anchorIndex > 0, "finding anchor guidance should be present");
  assert.ok(anchorIndex > completionIndex, "finding anchor guidance should follow generic JSON completion");
  assert.match(JSON_FINDING_STEP_SYSTEM_MESSAGE, /changedHeadLines/u);
  assert.match(JSON_FINDING_STEP_SYSTEM_MESSAGE, /Output exactly one JSON object/u);
});

test("markdown step system prompt keeps renderer uncertainty rules outside common", () => {
  assert.deepEqual(MARKDOWN_STEP_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline",
    "markdown-uncertainty",
    "markdown-response-format"
  ]);

  assert.match(MARKDOWN_STEP_SYSTEM_MESSAGE, /\[假設\]|\[待確認\]/u);
  assert.match(MARKDOWN_STEP_SYSTEM_MESSAGE, /Begin with the designated `##` heading/u);
  assert.doesNotMatch(MARKDOWN_STEP_SYSTEM_MESSAGE, /Code Locations & Inline Anchors/u);
  assert.doesNotMatch(COMMON_SYSTEM_MESSAGE, /\[假設\]|\[待確認\]/u);
});
