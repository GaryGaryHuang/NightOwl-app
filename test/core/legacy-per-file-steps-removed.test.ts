import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import * as sectionContract from "../../src/core/review-section-contract.ts";
import {
  BUILT_IN_DRY_RUN_STEP_IDS,
  getDryRunStubResponse
} from "../../src/services/dry-run-stub-catalog.ts";

const REMOVED_STEP_IDS = [
  "step1-overview",
  "step2-dependencies-boundaries",
  "step3-knowledge-source-of-truth",
  "step4-strategy-what-if-scenarios"
] as const;

const REMOVED_STEP_FILES = [
  "step1-overview.ts",
  "step2-dependencies-boundaries.ts",
  "step3-knowledge-source-of-truth.ts",
  "step4-strategy-what-if-scenarios.ts"
] as const;

test("built-in legacy Step 1-4 implementation files are absent", () => {
  for (const fileName of REMOVED_STEP_FILES) {
    const filePath = new URL(`../../src/core/steps/${fileName}`, import.meta.url);
    assert.equal(existsSync(filePath), false, `${fileName} should not exist`);
  }
});

test("legacy Step 1-4 section constants are not exported", () => {
  for (const constantName of [
    "OVERVIEW_SECTION_KEY",
    "DEPENDENCIES_BOUNDARIES_SECTION_KEY",
    "KNOWLEDGE_SOURCE_OF_TRUTH_SECTION_KEY",
    "STRATEGY_WHAT_IF_SCENARIOS_SECTION_KEY"
  ]) {
    assert.equal(constantName in sectionContract, false, `${constantName} should not be exported`);
  }

  assert.equal(sectionContract.SUMMARY_SECTION_KEY, "summary");
});

test("dry-run catalog excludes legacy Step 1-4 built-in stubs", () => {
  for (const stepId of REMOVED_STEP_IDS) {
    assert.equal((BUILT_IN_DRY_RUN_STEP_IDS as readonly string[]).includes(stepId), false);
    assert.equal(getDryRunStubResponse(stepId), undefined);
  }
});