import assert from "node:assert/strict";
import test from "node:test";

import { deriveFileRiskLevel, type RiskLevel } from "../../src/core/risk-level.ts";
import { createFinding } from "../helpers/completed-run-finalizer-contract-fixture.ts";

test("deriveFileRiskLevel maps finalized findings to the documented risk levels", () => {
  const cases: Array<{
    label: string;
    findings: Parameters<typeof deriveFileRiskLevel>[0];
    expected: RiskLevel;
  }> = [
    {
      label: "must finding at the 90 confidence threshold",
      findings: [createFinding("must", 90)],
      expected: "High"
    },
    {
      label: "any threshold-meeting must finding",
      findings: [
        createFinding("must", 82, { title: "lower-confidence must" }),
        createFinding("must", 96, { title: "threshold-meeting must" })
      ],
      expected: "High"
    },
    {
      label: "must findings below the 90 confidence threshold",
      findings: [
        createFinding("must", 89, { title: "must below threshold" }),
        createFinding("nice", 95, { title: "nice context" })
      ],
      expected: "Medium"
    },
    {
      label: "nice-only findings regardless of confidence",
      findings: [
        createFinding("nice", 10, { title: "low-confidence nice" }),
        createFinding("nice", 99, { title: "high-confidence nice" })
      ],
      expected: "Low"
    },
    {
      label: "empty findings array",
      findings: [],
      expected: "None"
    },
    {
      label: "undefined findings",
      findings: undefined,
      expected: "None"
    }
  ];

  for (const testCase of cases) {
    assert.equal(
      deriveFileRiskLevel(testCase.findings),
      testCase.expected,
      testCase.label
    );
  }
});
