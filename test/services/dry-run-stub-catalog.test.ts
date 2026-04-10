import assert from "node:assert/strict";
import test from "node:test";

import {
  getDryRunStubResponse
} from "../../src/services/dry-run-stub-catalog.ts";
import {
  DRY_RUN_REVIEW_STEP_CONTRACTS
} from "../../src/services/dry-run-review-step-contract.ts";

function parseFindingsJson(contract: "validation-interrogation" | "cognitive-simulation") {
  const response = getDryRunStubResponse(contract);
  const parsed = JSON.parse(response) as { findings?: unknown };

  assert.ok(
    typeof parsed === "object" && parsed !== null && "findings" in parsed,
    `${contract} stub must expose a findings field`
  );

  return parsed;
}

test("dry-run stub catalog returns a non-empty response for every supported contract", () => {
  for (const contract of DRY_RUN_REVIEW_STEP_CONTRACTS) {
    const response = getDryRunStubResponse(contract);
    assert.equal(typeof response, "string");
    assert.notEqual(response.trim(), "", `stub must not be empty for contract: ${contract}`);
  }
});

test("dry-run stub catalog markdown responses begin with the expected top-level heading", () => {
  const expectedHeadings = {
    "changeset-overview": "## Changeset Overview",
    overview: "## Overview",
    "dependencies-boundaries": "## Dependencies & Boundaries",
    "knowledge-source-of-truth": "## Knowledge & Source of Truth",
    "strategy-what-if-scenarios": "## Strategy & What-if Scenarios",
    summary: "## Summary"
  } as const;

  for (const [contract, heading] of Object.entries(expectedHeadings)) {
    assert.match(
      getDryRunStubResponse(contract as keyof typeof expectedHeadings),
      new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u"),
      `unexpected top-level heading for contract: ${contract}`
    );
  }
});

test("dry-run overview stub includes the fields required by the Step 1 completion contract", () => {
  const response = getDryRunStubResponse("overview");
  const requiredFields = [
    "整體理解",
    "行為變更",
    "檔案職責",
    "改動目的",
    "影響範圍",
    "測試覆蓋觀察"
  ];

  for (const field of requiredFields) {
    assert.match(response, new RegExp(field, "u"), `overview stub missing field: ${field}`);
  }
});

test("dry-run strategy stub includes multiple What-if scenarios", () => {
  const response = getDryRunStubResponse("strategy-what-if-scenarios");
  const matches = response.match(/\bW\d+\b/gu) ?? [];

  assert.ok(matches.length >= 3, `strategy stub must contain at least 3 W# items, found: ${matches.length}`);
});

test("dry-run findings stubs are valid JSON with an empty findings array", () => {
  for (const contract of ["validation-interrogation", "cognitive-simulation"] as const) {
    const parsed = parseFindingsJson(contract);
    assert.deepEqual(parsed.findings, [], `${contract} stub must contain an empty findings array`);
  }
});

test("dry-run summary stub includes the required reader-facing subsections", () => {
  const response = getDryRunStubResponse("summary");

  for (const section of ["審查基礎", "行為變更提醒", "風險評估"] as const) {
    assert.match(response, new RegExp(section, "u"), `summary stub missing section: ${section}`);
  }
});