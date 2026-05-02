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
      label: "any must finding",
      findings: [createFinding("must", 10)],
      expected: "High"
    },
    {
      label: "mixed must findings still map to High",
      findings: [
        createFinding("must", 1, { title: "first must" }),
        createFinding("must", 96, { title: "another must" })
      ],
      expected: "High"
    },
    {
      label: "nice-only findings",
      findings: [
        createFinding("nice", 10, { title: "first nice" }),
        createFinding("nice", 99, { title: "second nice" })
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
