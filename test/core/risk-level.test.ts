import assert from "node:assert/strict";
import test from "node:test";

import { deriveFileRiskLevel } from "../../src/core/risk-level.ts";
import { createFinding } from "../helpers/completed-run-finalizer-contract-fixture.ts";

test("deriveFileRiskLevel returns High for a must finding at the 90 confidence threshold", () => {
  assert.equal(deriveFileRiskLevel([createFinding("must", 90)]), "High");
});

test("deriveFileRiskLevel returns Medium for must findings below the 90 confidence threshold", () => {
  assert.equal(
    deriveFileRiskLevel([
      createFinding("must", 89, { title: "must below threshold" }),
      createFinding("nice", 95, { title: "nice context" })
    ]),
    "Medium"
  );
});

test("deriveFileRiskLevel returns Low for nice-only findings", () => {
  assert.equal(deriveFileRiskLevel([createFinding("nice", 91)]), "Low");
});

test("deriveFileRiskLevel returns Low for nice-only findings regardless of threshold-like confidence values", () => {
  assert.equal(
    deriveFileRiskLevel([
      createFinding("nice", 10, { title: "low-confidence nice" }),
      createFinding("nice", 99, { title: "high-confidence nice" })
    ]),
    "Low"
  );
});

test("deriveFileRiskLevel returns None for an empty findings array", () => {
  assert.equal(deriveFileRiskLevel([]), "None");
});

test("deriveFileRiskLevel returns High when any must finding meets the threshold even if others are below it", () => {
  assert.equal(
    deriveFileRiskLevel([
      createFinding("must", 82, { title: "lower-confidence must" }),
      createFinding("must", 96, { title: "threshold-meeting must" })
    ]),
    "High"
  );
});

test("deriveFileRiskLevel returns Medium when only below-threshold must findings remain, even with strong nice findings", () => {
  assert.equal(
    deriveFileRiskLevel([
      createFinding("must", 89, { title: "below-threshold must" }),
      createFinding("nice", 99, { title: "strong nice" })
    ]),
    "Medium"
  );
});

test("deriveFileRiskLevel returns None for undefined findings", () => {
  assert.equal(deriveFileRiskLevel(undefined), "None");
});
