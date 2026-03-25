import assert from "node:assert/strict";
import test from "node:test";

import { deriveFileRiskLevel } from "../../src/core/risk-level.ts";

test("deriveFileRiskLevel returns High for a must finding at the 90 confidence threshold", () => {
  assert.equal(deriveFileRiskLevel([createFinding("must", 90)]), "High");
});

test("deriveFileRiskLevel returns Medium for must findings below the 90 confidence threshold", () => {
  assert.equal(
    deriveFileRiskLevel([
      createFinding("must", 89, "must below threshold"),
      createFinding("nice", 95, "nice context")
    ]),
    "Medium"
  );
});

test("deriveFileRiskLevel returns Low for nice-only findings", () => {
  assert.equal(deriveFileRiskLevel([createFinding("nice", 91)]), "Low");
});

test("deriveFileRiskLevel returns None for an empty findings array", () => {
  assert.equal(deriveFileRiskLevel([]), "None");
});

test("deriveFileRiskLevel returns High when any must finding meets the threshold even if others are below it", () => {
  assert.equal(
    deriveFileRiskLevel([
      createFinding("must", 82, "lower-confidence must"),
      createFinding("must", 96, "threshold-meeting must")
    ]),
    "High"
  );
});

test("deriveFileRiskLevel returns None for undefined findings", () => {
  assert.equal(deriveFileRiskLevel(undefined), "None");
});

function createFinding(
  type: "must" | "nice",
  confidence: number,
  title = `${type} finding`
) {
  return {
    type,
    title,
    traceability: { kind: "line-range" as const, lineStart: 1, lineEnd: 1 },
    context: "ctx",
    deviation: "dev",
    impact: "impact",
    suggestion: "fix it",
    confidence
  };
}
