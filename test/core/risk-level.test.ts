import assert from "node:assert/strict";
import test from "node:test";

import { deriveFileRiskLevel } from "../../src/core/risk-level.ts";

test("deriveFileRiskLevel returns Critical for a must finding with confidence >= 95", () => {
  assert.equal(
    deriveFileRiskLevel([
      {
        type: "must",
        title: "High-confidence issue",
        context: "ctx",
        deviation: "dev",
        impact: "impact",
        suggestion: "fix it",
        confidence: 97
      },
      {
        type: "nice",
        title: "Minor suggestion",
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 85
      }
    ]),
    "Critical"
  );
});

test("deriveFileRiskLevel returns High for a must finding with confidence below 95", () => {
  assert.equal(
    deriveFileRiskLevel([
      {
        type: "must",
        title: "Must below threshold",
        context: "ctx",
        deviation: "dev",
        impact: "impact",
        suggestion: "fix it",
        confidence: 82
      }
    ]),
    "High"
  );
});

test("deriveFileRiskLevel returns Medium for nice-only findings", () => {
  assert.equal(
    deriveFileRiskLevel([
      {
        type: "nice",
        title: "Nice-to-have",
        context: "ctx",
        deviation: "dev",
        impact: "low",
        suggestion: "optional",
        confidence: 91
      }
    ]),
    "Medium"
  );
});

test("deriveFileRiskLevel returns Low for an empty findings array", () => {
  assert.equal(deriveFileRiskLevel([]), "Low");
});

test("deriveFileRiskLevel returns Critical when any must finding has confidence >= 95 even if others are below", () => {
  assert.equal(
    deriveFileRiskLevel([
      {
        type: "must",
        title: "Low-confidence must",
        context: "ctx",
        deviation: "dev",
        impact: "impact",
        suggestion: "fix",
        confidence: 80
      },
      {
        type: "must",
        title: "High-confidence must",
        context: "ctx",
        deviation: "dev",
        impact: "impact",
        suggestion: "fix",
        confidence: 96
      }
    ]),
    "Critical"
  );
});

test("deriveFileRiskLevel returns Low for undefined findings", () => {
  assert.equal(deriveFileRiskLevel(undefined), "Low");
});
