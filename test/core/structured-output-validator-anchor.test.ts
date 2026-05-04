import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewBasisV1 } from "../../src/core/review-basis.ts";
import {
  StructuredOutputValidator,
  StructuredValidationReportError
} from "../../src/core/structured-output-validator.ts";

const DEFAULT_HUNK_HEADER = "@@ -20,2 +20,4 @@";
const DEFAULT_DIFF = [
  DEFAULT_HUNK_HEADER,
  " context-before",
  "+added-21",
  "+added-22",
  " context-after"
].join("\n");

test("StructuredOutputValidator rejects invalid CandidateFindingsV3 traceability payloads", () => {
  const cases: Array<{
    label: string;
    traceability?: Record<string, unknown>;
  }> = [
    { label: "missing traceability", traceability: undefined },
    {
      label: "unsupported traceability kind",
      traceability: { kind: "file-offset", offsetStart: 1, offsetEnd: 2 }
    },
    {
      label: "line-range inverted bounds",
      traceability: { kind: "line-range", lineStart: 20, lineEnd: 19 }
    },
    {
      label: "lineStart is zero",
      traceability: { kind: "line-range", lineStart: 0, lineEnd: 5 }
    },
    {
      label: "lineEnd is negative",
      traceability: { kind: "line-range", lineStart: 1, lineEnd: -1 }
    },
    {
      label: "diff-hunk missing hunkHeader",
      traceability: { kind: "diff-hunk" }
    }
  ];

  for (const testCase of cases) {
    assertCandidateValidationFails(
      createCandidatePayload({ traceability: testCase.traceability }),
      testCase.label
    );
  }
});

test("StructuredOutputValidator rejects CandidateFindingsV3 line-range outside changed head lines", () => {
  const error = assertCandidateValidationFails(
    createCandidatePayload({
      traceability: { kind: "line-range", lineStart: 14, lineEnd: 18 }
    }),
    "line-range outside changed lines"
  );

  assert.equal(error.report.at(-1)?.taxonomy, "ANCHOR");
});

test("StructuredOutputValidator accepts CandidateFindingsV3 line-range on changed head lines", () => {
  const result = validateCandidatePayload(
    createCandidatePayload({
      traceability: { kind: "line-range", lineStart: 21, lineEnd: 22 }
    })
  );

  assert.deepEqual(result.payload.findings[0]?.traceability, {
    kind: "line-range",
    lineStart: 21,
    lineEnd: 22
  });
});

test("StructuredOutputValidator accepts CandidateFindingsV3 diff-hunk with trimmed header", () => {
  const result = validateCandidatePayload(
    createCandidatePayload({
      traceability: { kind: "diff-hunk", hunkHeader: `  ${DEFAULT_HUNK_HEADER}  ` }
    })
  );

  assert.deepEqual(result.payload.findings[0]?.traceability, {
    kind: "diff-hunk",
    hunkHeader: DEFAULT_HUNK_HEADER
  });
});

test("StructuredOutputValidator accepts CandidateFindingsV3 line-range outside changed lines when dependencyPathException is supplied", () => {
  const result = validateCandidatePayload(
    createCandidatePayload({
      traceability: { kind: "line-range", lineStart: 14, lineEnd: 18 },
      dependencyPathException: {
        reason: "called from changed initializer",
        dependencyAnchor: {
          filePath: "src/dep.ts",
          symbol: "bootstrap"
        }
      }
    })
  );

  assert.deepEqual(result.payload.findings[0]?.traceability, {
    kind: "line-range",
    lineStart: 14,
    lineEnd: 18
  });
});

test("StructuredOutputValidator rejects invalid CandidateFindingsV3 dependencyPathException fields", () => {
  const cases: Array<{
    label: string;
    dependencyPathException: Record<string, unknown>;
  }> = [
    {
      label: "empty reason",
      dependencyPathException: {
        reason: "",
        dependencyAnchor: { filePath: "src/dep.ts" }
      }
    },
    {
      label: "empty dependencyAnchor.filePath",
      dependencyPathException: {
        reason: "ok",
        dependencyAnchor: { filePath: "" }
      }
    },
    {
      label: "empty dependencyAnchor.symbol",
      dependencyPathException: {
        reason: "ok",
        dependencyAnchor: { filePath: "src/dep.ts", symbol: "" }
      }
    },
    {
      label: "unknown dependencyPathException field",
      dependencyPathException: {
        reason: "called from changed initializer",
        dependencyAnchor: { filePath: "src/dep.ts" },
        extra: true
      }
    },
    {
      label: "unknown dependencyAnchor field",
      dependencyPathException: {
        reason: "called from changed initializer",
        dependencyAnchor: { filePath: "src/dep.ts", extra: true }
      }
    }
  ];

  for (const testCase of cases) {
    assertCandidateValidationFails(
      createCandidatePayload({
        traceability: { kind: "line-range", lineStart: 14, lineEnd: 18 },
        dependencyPathException: testCase.dependencyPathException
      }),
      testCase.label
    );
  }
});

function validateCandidatePayload(payload: Record<string, unknown>) {
  return new StructuredOutputValidator().validateCandidateFindingsV3WithReport({
    responseText: JSON.stringify(payload),
    reviewBasis: createReviewBasis(),
    diffContent: DEFAULT_DIFF,
    filePath: "src/app.ts"
  });
}

function assertCandidateValidationFails(
  payload: Record<string, unknown>,
  label: string
): StructuredValidationReportError {
  assert.throws(
    () => validateCandidatePayload(payload),
    (error: unknown) => {
      assert.equal(error instanceof StructuredValidationReportError, true, label);
      return true;
    },
    label
  );

  try {
    validateCandidatePayload(payload);
  } catch (error) {
    return error as StructuredValidationReportError;
  }

  throw new Error(`expected validation failure for ${label}`);
}

function createCandidatePayload(
  findingOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    result: "FINDINGS_READY",
    findings: [
      {
        findingId: "F1",
        sourceHypothesisIds: ["H1"],
        classification: "confirmed_problem",
        priority: "must",
        severity: "high",
        confidence: "high",
        evidenceStrength: "direct",
        title: "guard moved after dereference",
        traceability: { kind: "line-range", lineStart: 21, lineEnd: 22 },
        codeEvidence: [
          {
            evidenceId: "E1",
            location: "src/app.ts:21",
            summary: "changed branch reads value before fallback"
          }
        ],
        executionPath: ["entry receives nullable input", "changed branch reads value"],
        triggerCondition: "nullable input reaches the changed branch",
        failureMechanism: "guard runs after dereference",
        impact: "request fails before fallback can run",
        counterEvidenceChecked: ["fallback no longer precedes dereference"],
        reproducibility: "deterministic with nullable input",
        fixDirection: "restore guard before dereference",
        testRecommendation: "add nullable input regression coverage",
        ...findingOverrides
      }
    ],
    hypothesisClosure: [
      {
        hypothesisId: "H1",
        status: "closed_by_candidate",
        evidenceIds: ["E1"],
        rationale: "F1 validates the hypothesis."
      }
    ],
    criticalMissingInformation: []
  };
}

function createReviewBasis(): ReviewBasisV1 {
  return {
    schemaVersion: 1,
    filePath: "src/app.ts",
    roleInChangeset: "Owns review prompt harness state handoff.",
    changedBehavior: [
      {
        changeId: "CB1",
        before: "Step 5 consumed prose sections.",
        after: "Step 5 consumes ReviewBasis evidence graph.",
        evidenceIds: ["E1"]
      }
    ],
    facts: [
      {
        factId: "FCT1",
        statement: "ReviewBasis is emitted before Step 5.",
        evidenceIds: ["E1"]
      }
    ],
    inferences: [
      {
        inferenceId: "INF1",
        statement: "Step 5 can validate source evidence IDs.",
        basedOnEvidenceIds: ["E1"],
        confidence: "high"
      }
    ],
    dependencyMap: {
      upstreamCallers: ["ReviewOrchestrator"],
      downstreamConsumers: ["Step5ValidationInterrogationStep"],
      externalContracts: [],
      sharedStateOrSideEffects: ["FileReviewContext"]
    },
    flowMap: {
      entryPoints: ["ReviewBasisStep.prepare"],
      stateTransitions: ["setReviewBasis"],
      asyncBoundaries: [],
      errorPaths: ["validator rejects missing evidence"]
    },
    testCoverage: {
      changedTests: ["test/core/structured-output-validator-anchor.test.ts"],
      observedCoverageSignals: ["anchor validator tests"],
      coverageGaps: []
    },
    identifierRegistry: {
      files: ["src/app.ts"],
      symbols: ["ReviewBasisV1"],
      resourceKeys: [],
      apiNames: [],
      stateNames: ["reviewBasis"]
    },
    hypothesisLedger: [
      {
        hypothesisId: "H1",
        statement: "Evidence refs may be missing.",
        triggerCondition: "Step 5 cites absent evidence ID.",
        whyRelevantHere: "Phase 2 validates evidence refs.",
        closureCriteria: ["Every cited evidence ID exists."]
      }
    ],
    missingInformation: [],
    evidenceRefs: [
      {
        evidenceId: "E1",
        sourceType: "diff",
        location: "src/app.ts:21",
        summary: "review basis state added"
      }
    ]
  };
}
