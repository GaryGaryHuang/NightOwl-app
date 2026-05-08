import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMON_SYSTEM_MESSAGE,
  COMMON_SYSTEM_BLOCK_IDS
} from "../../../src/core/steps/common-system-message.ts";
import {
  JSON_FINDING_STEP_SYSTEM_BLOCK_IDS,
  JSON_STEP_SYSTEM_BLOCK_IDS,
  JSON_STEP_SYSTEM_MESSAGE,
  MARKDOWN_STEP_SYSTEM_BLOCK_IDS
} from "../../../src/core/steps/shared-step-system-blocks.ts";

test("common system prompt stays schema-free and globally applicable", () => {
  assert.deepEqual(COMMON_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "host-artifact-authority",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline"
  ]);

  assert.doesNotMatch(
    COMMON_SYSTEM_MESSAGE,
    /inferences|missingInformation|hypothesisClosure|criticalMissingInformation|missingInformationItems|traceability|dependencyPathException|changedHeadLines/u
  );
});

test("JSON step system prompt block order is deterministic and excludes finding anchors", () => {
  assert.deepEqual(JSON_STEP_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "host-artifact-authority",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline",
    "json-structured-output",
    "json-completion"
  ]);

  assert.doesNotMatch(
    JSON_STEP_SYSTEM_MESSAGE,
    /hypothesisClosure|criticalMissingInformation|missingInformationItems|dependencyPathException|changedHeadLines/u
  );
});

test("finding JSON system prompt composes anchor guidance only for finding-producing steps", () => {
  assert.deepEqual(JSON_FINDING_STEP_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "host-artifact-authority",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline",
    "json-structured-output",
    "json-completion",
    "finding-anchor-guidance"
  ]);
});

test("markdown step system prompt composes only markdown-specific blocks", () => {
  assert.deepEqual(MARKDOWN_STEP_SYSTEM_BLOCK_IDS, [
    "reviewer-role",
    "evidence-traceability",
    "host-artifact-authority",
    "global-uncertainty",
    "context-retrieval",
    "scope-discipline",
    "global-response-discipline",
    "markdown-response-format"
  ]);
});
