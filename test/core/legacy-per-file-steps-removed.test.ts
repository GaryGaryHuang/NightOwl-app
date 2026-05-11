import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import * as sectionContract from "../../src/core/review-section-contract.ts";
import {
  BUILT_IN_DRY_RUN_STEP_IDS,
  getDryRunStubResponse
} from "../../src/services/dry-run-stub-catalog.ts";

const RETIRED_PROSE_MODULE_IDS = [
  "overview-module",
  "dependencies-boundaries-module",
  "knowledge-source-of-truth-module",
  "strategy-what-if-scenarios-module"
] as const;

const RETIRED_PROSE_MODULE_FILES = [
  "overview-module.ts",
  "dependencies-boundaries-module.ts",
  "knowledge-source-of-truth-module.ts",
  "strategy-what-if-scenarios-module.ts"
] as const;

test("built-in retired prose module implementation files are absent", () => {
  for (const fileName of RETIRED_PROSE_MODULE_FILES) {
    const filePath = new URL(`../../src/core/steps/${fileName}`, import.meta.url);
    assert.equal(existsSync(filePath), false, `${fileName} should not exist`);
  }
});

test("retired prose module section constants are not exported", () => {
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

test("dry-run catalog excludes retired prose module built-in stubs", () => {
  for (const stepId of RETIRED_PROSE_MODULE_IDS) {
    assert.equal((BUILT_IN_DRY_RUN_STEP_IDS as readonly string[]).includes(stepId), false);
    assert.equal(getDryRunStubResponse(stepId), undefined);
  }
});
